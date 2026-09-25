-- An organization owns distinct teams per game; each team's captain only manages that team's game roster.
alter table public.tournaments drop constraint tournaments_game_check;
alter table public.tournaments add constraint tournaments_game_check
  check (game in ('cs2','val','lol','rl','eafc','mlbb','efootball'));
alter table public.teams drop constraint teams_game_check;
alter table public.teams add constraint teams_game_check
  check (game in ('cs2','val','lol','rl','eafc','mlbb','efootball'));
alter table public.team_game_rosters drop constraint team_game_rosters_game_check;
alter table public.team_game_rosters add constraint team_game_rosters_game_check
  check (game in ('cs2','val','lol','rl','eafc','mlbb','efootball'));

create or replace function private.is_team_captain(p_team_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.teams t
    where t.id=p_team_id and (
      (t.captain_id=auth.uid() and exists (
        select 1 from public.team_members m where m.team_id=t.id and m.user_id=auth.uid()
          and m.role='captain' and m.status='active'
      ))
      or (t.organization_id is not null and private.can_manage_organization(t.organization_id,'manage_teams'))
    )
  );
$$;
grant execute on function private.is_team_captain(uuid) to authenticated;

create or replace function private.can_manage_team_game_roster(p_team_id uuid,p_game text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.teams t where t.id=p_team_id and (
      (t.organization_id is not null and private.can_manage_organization(t.organization_id,'manage_teams'))
      or (p_game=t.game and private.is_team_captain(t.id))
    )
  );
$$;
revoke all on function private.can_manage_team_game_roster(uuid,text) from public,anon,authenticated;
grant execute on function private.can_manage_team_game_roster(uuid,text) to authenticated;

create or replace function public.list_organization_player_accounts(p_organization_id uuid)
returns table(user_id uuid,username text,player_name text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not private.can_manage_organization(p_organization_id,'manage_teams') then
    raise exception 'Organization team capability required';
  end if;
  return query select p.id,p.username,p.player_name
    from public.public_profiles p join public.user_roles r on r.user_id=p.id and r.role_key='PLAYER'
    order by coalesce(p.username,p.player_name),p.id;
end;
$$;
revoke all on function public.list_organization_player_accounts(uuid) from public,anon,authenticated;
grant execute on function public.list_organization_player_accounts(uuid) to authenticated;

create or replace function public.create_organization_game_team(
  p_organization_id uuid,p_name text,p_tag text,p_game text,p_region text,p_captain_id uuid
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_team_id uuid;
begin
  if auth.uid() is null or not private.can_manage_organization(p_organization_id,'manage_teams') then
    raise exception 'Organization team capability required';
  end if;
  if length(trim(coalesce(p_name,''))) not between 2 and 80
     or length(trim(coalesce(p_tag,''))) not between 2 and 8
     or p_game not in ('cs2','val','lol','rl','eafc','mlbb','efootball')
     or not exists(select 1 from public.user_roles where user_id=p_captain_id and role_key='PLAYER') then
    raise exception 'Choose a valid team name, tag, game, and player captain';
  end if;
  insert into public.teams(captain_id,name,tag,game,region,organization_id)
    values(p_captain_id,trim(p_name),upper(trim(p_tag)),p_game,coalesce(trim(p_region),''),p_organization_id)
    returning id into v_team_id;
  insert into public.team_members(team_id,user_id,role,status)
    values(v_team_id,p_captain_id,'captain','active');
  perform private.write_audit_event('ORGANIZATION_GAME_TEAM_CREATED','team',v_team_id,
    jsonb_build_object('organization_id',p_organization_id,'game',p_game,'captain_id',p_captain_id));
  return v_team_id;
end;
$$;
revoke all on function public.create_organization_game_team(uuid,text,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.create_organization_game_team(uuid,text,text,text,text,uuid) to authenticated;

create or replace function public.set_organization_team_captain(p_team_id uuid,p_user_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_team public.teams%rowtype; v_old_captain uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_team from public.teams where id=p_team_id for update;
  if v_team.id is null or v_team.organization_id is null
     or not private.can_manage_organization(v_team.organization_id,'manage_teams') then
    raise exception 'Organization team capability required';
  end if;
  if exists(select 1 from public.tournament_registrations where team_id=p_team_id and status in ('pending','approved','checked_in')) then
    raise exception 'Captain changes are locked while the team is registered in a tournament';
  end if;
  if not exists(select 1 from public.user_roles where user_id=p_user_id and role_key='PLAYER') then
    raise exception 'The selected account needs the PLAYER role';
  end if;
  v_old_captain:=v_team.captain_id;
  if v_old_captain is distinct from p_user_id then
    update public.team_members set role='player' where team_id=p_team_id and user_id=v_old_captain and role='captain';
    insert into public.team_members(team_id,user_id,role,status) values(p_team_id,p_user_id,'captain','active')
      on conflict(team_id,user_id) do update set role='captain',status='active';
    update public.teams set captain_id=p_user_id where id=p_team_id;
  end if;
  perform private.write_audit_event('ORGANIZATION_TEAM_CAPTAIN_SET','team',p_team_id,
    jsonb_build_object('previous_captain_id',v_old_captain,'captain_id',p_user_id,'game',v_team.game));
end;
$$;
revoke all on function public.set_organization_team_captain(uuid,uuid) from public,anon,authenticated;
grant execute on function public.set_organization_team_captain(uuid,uuid) to authenticated;

create or replace function public.create_team(
  p_name text,p_tag text,p_game text,p_region text default '',p_organization_id uuid default null
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_team_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.user_roles where user_id=auth.uid() and role_key='PLAYER') then
    raise exception 'PLAYER role required';
  end if;
  if p_organization_id is not null and not private.can_manage_organization(p_organization_id,'manage_teams') then
    raise exception 'Organization team capability required';
  end if;
  if length(trim(coalesce(p_name,''))) not between 2 and 80
     or length(trim(coalesce(p_tag,''))) not between 2 and 8
     or p_game not in ('cs2','val','lol','rl','eafc','mlbb','efootball') then
    raise exception 'Invalid team details';
  end if;
  insert into public.teams(captain_id,name,tag,game,region,organization_id)
    values(auth.uid(),trim(p_name),upper(trim(p_tag)),p_game,coalesce(trim(p_region),''),p_organization_id)
    returning id into v_team_id;
  insert into public.team_members(team_id,user_id,role,status) values(v_team_id,auth.uid(),'captain','active');
  perform private.write_audit_event('TEAM_CREATED','team',v_team_id,'{}'::jsonb);
  return v_team_id;
end;
$$;
revoke all on function public.create_team(text,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.create_team(text,text,text,text,uuid) to authenticated;

create or replace function public.set_team_games(p_team_id uuid,p_games text[])
returns void language plpgsql security definer set search_path = ''
as $$
declare v_primary text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select game into v_primary from public.teams where id=p_team_id for update;
  if v_primary is null then raise exception 'Team not found'; end if;
  if not exists(select 1 from public.teams t where t.id=p_team_id and t.organization_id is not null
    and private.can_manage_organization(t.organization_id,'manage_teams')) then
    raise exception 'Only the organization owner can change game teams';
  end if;
  if coalesce(cardinality(p_games),0)<>1 or p_games[1]<>v_primary then
    raise exception 'Create a separate organization team for each game roster';
  end if;
end;
$$;
revoke all on function public.set_team_games(uuid,text[]) from public,anon,authenticated;
grant execute on function public.set_team_games(uuid,text[]) to authenticated;

create or replace function public.set_team_game_member(p_team_id uuid,p_game text,p_user_id uuid,p_active boolean)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not private.can_manage_team_game_roster(p_team_id,p_game) then
    raise exception 'Only this game team captain or its organization owner can manage the roster';
  end if;
  perform 1 from public.teams where id=p_team_id for update;
  if p_game not in ('cs2','val','lol','rl','eafc','mlbb','efootball')
     or not exists(select 1 from public.team_game_rosters where team_id=p_team_id and game=p_game)
     or not exists(select 1 from public.team_members where team_id=p_team_id and user_id=p_user_id and status='active') then
    raise exception 'Choose an active team player and enabled game roster';
  end if;
  if exists(select 1 from public.tournament_registrations where team_id=p_team_id and status in ('pending','approved','checked_in')) then
    raise exception 'Rosters are locked while the team is registered';
  end if;
  if p_active then
    if (select count(*) from public.team_game_members where team_id=p_team_id and game=p_game)>=20
       and not exists(select 1 from public.team_game_members where team_id=p_team_id and game=p_game and user_id=p_user_id) then
      raise exception 'Game roster is full';
    end if;
    insert into public.team_game_members(team_id,game,user_id) values(p_team_id,p_game,p_user_id) on conflict do nothing;
  else
    delete from public.team_game_members where team_id=p_team_id and game=p_game and user_id=p_user_id;
  end if;
end;
$$;
revoke all on function public.set_team_game_member(uuid,text,uuid,boolean) from public,anon,authenticated;
grant execute on function public.set_team_game_member(uuid,text,uuid,boolean) to authenticated;
