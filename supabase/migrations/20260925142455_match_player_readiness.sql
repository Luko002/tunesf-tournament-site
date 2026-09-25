-- Each locked roster player confirms readiness after the veto and before kickoff.
create table public.match_player_readiness (
  match_id uuid not null references public.tournament_matches(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  confirmed_at timestamptz not null default now(),
  primary key (match_id,user_id)
);
create index match_player_readiness_team_idx on public.match_player_readiness(match_id,team_id);
alter table public.match_player_readiness enable row level security;
revoke all on public.match_player_readiness from public,anon,authenticated;

create or replace function private.match_players_ready(p_match_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select (select count(*) from public.match_roster_confirmations c where c.match_id=p_match_id)=2
    and not exists (
      select 1 from public.match_roster_confirmations c
      where c.match_id=p_match_id and (
        not exists (select 1 from jsonb_array_elements(c.roster) member where member->>'role'<>'substitute')
        or exists (
          select 1 from jsonb_array_elements(c.roster) member
          where member->>'role'<>'substitute' and not exists (
            select 1 from public.match_player_readiness r
            where r.match_id=p_match_id and r.team_id=c.team_id
              and r.user_id=(member->>'user_id')::uuid
          )
        )
      )
    );
$$;
revoke all on function private.match_players_ready(uuid) from public,anon,authenticated;

create or replace function public.get_match_readiness(p_match_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not private.can_access_match(p_match_id) then
    raise exception 'This match room is available to its players, assigned officials, and event staff';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'team_id',r.team_id,'user_id',r.user_id,'confirmed_at',r.confirmed_at)
    order by r.confirmed_at,r.user_id)
    from public.match_player_readiness r where r.match_id=p_match_id),'[]'::jsonb);
end;
$$;
revoke all on function public.get_match_readiness(uuid) from public,anon,authenticated;
grant execute on function public.get_match_readiness(uuid) to authenticated;

create or replace function public.confirm_match_player_ready(p_match_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_match public.tournament_matches%rowtype; v_team_id uuid;
  v_game text; v_map_pool text[];
begin
  if auth.uid() is null then raise exception 'Sign in to confirm readiness'; end if;
  select * into v_match from public.tournament_matches where id=p_match_id for update;
  if v_match.id is null then raise exception 'Match not found'; end if;
  if v_match.status<>'ready' then raise exception 'Readiness can only be confirmed before the match starts'; end if;
  select t.game,t.map_pool into v_game,v_map_pool from public.tournaments t where t.id=v_match.tournament_id;
  if cardinality(coalesce(v_map_pool,'{}'::text[]))>=2 and not exists (
    select 1 from public.match_map_vetoes v where v.match_id=p_match_id
      and v.action_type='decider' and (v_game<>'val' or v.side_choice is not null)) then
    raise exception 'Complete the map veto first';
  end if;
  select c.team_id into v_team_id from public.match_roster_confirmations c
  where c.match_id=p_match_id and exists (
    select 1 from jsonb_array_elements(c.roster) member
    where member->>'user_id'=auth.uid()::text and member->>'role'<>'substitute'
  ) limit 1;
  if v_team_id is null then raise exception 'Only a player on a confirmed active match roster can confirm readiness'; end if;
  if (select count(*) from public.match_roster_confirmations c where c.match_id=p_match_id)<>2 then
    raise exception 'Both rosters must be confirmed first';
  end if;
  insert into public.match_player_readiness(match_id,team_id,user_id)
    values(p_match_id,v_team_id,auth.uid()) on conflict(match_id,user_id) do nothing;
end;
$$;
revoke all on function public.confirm_match_player_ready(uuid) from public,anon,authenticated;
grant execute on function public.confirm_match_player_ready(uuid) to authenticated;

create or replace function public.referee_match(p_match_id uuid,p_action text,p_note text default '')
returns void language plpgsql security definer set search_path = ''
as $$
declare v_match public.tournament_matches%rowtype; v_tournament_id uuid; v_next text;
  v_game text; v_map_pool text[];
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_match from public.tournament_matches where id=p_match_id for update;
  if v_match.id is null then raise exception 'Match not found'; end if;
  select t.id,t.game,t.map_pool into v_tournament_id,v_game,v_map_pool
    from public.tournaments t where t.id=v_match.tournament_id;
  if not private.can_manage_tournament(v_tournament_id,'manage_tournament')
     and not private.is_tournament_referee(v_tournament_id)
     and not exists(select 1 from public.match_officials o where o.match_id=p_match_id and o.user_id=auth.uid()) then
    raise exception 'Assigned referee or tournament manager required';
  end if;
  if p_action='start' and v_match.status='ready' then
    if (select count(*) from public.match_roster_confirmations c where c.match_id=p_match_id
          and c.team_id in (select r.team_id from public.tournament_registrations r
            where r.id in (v_match.home_registration_id,v_match.away_registration_id)))<>2 then
      raise exception 'Both captains must confirm their rosters first';
    end if;
    if cardinality(coalesce(v_map_pool,'{}'::text[]))>=2 and not exists (
      select 1 from public.match_map_vetoes v where v.match_id=p_match_id
        and v.action_type='decider' and (v_game<>'val' or v.side_choice is not null)) then
      raise exception 'Complete the map veto first';
    end if;
    if not private.match_players_ready(p_match_id) then
      raise exception 'All active roster players on both teams must confirm readiness first';
    end if;
    v_next:='live';
  elsif p_action='pause' and v_match.status='live' then v_next:='paused';
  elsif p_action='resume' and v_match.status='paused' then v_next:='live';
  elsif p_action='cancel' and v_match.status in ('pending','ready') then v_next:='cancelled';
  else raise exception 'Invalid match action for its current state'; end if;
  update public.tournament_matches set status=v_next,
    started_at=case when v_next='live' and started_at is null then now() else started_at end,
    updated_at=now() where id=p_match_id;
  perform private.write_audit_event('REFEREE_MATCH_ACTION','match',p_match_id,
    jsonb_build_object('action',p_action,'from',v_match.status,'to',v_next,'note',left(coalesce(p_note,''),500)));
end;
$$;
revoke all on function public.referee_match(uuid,text,text) from public,anon,authenticated;
grant execute on function public.referee_match(uuid,text,text) to authenticated;
