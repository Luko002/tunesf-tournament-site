-- Tournament registration locks a game-specific starting lineup and optional
-- substitutes instead of snapshotting every member of a team's game roster.

create or replace function public.register_team(p_tournament_id uuid,p_team_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.is_team_captain(p_team_id) then raise exception 'Team captain required'; end if;
  raise exception 'Choose the tournament starters and substitutes before registering this team';
end;
$$;

create or replace function public.register_team_with_lineup(
  p_tournament_id uuid,
  p_team_id uuid,
  p_starter_user_ids uuid[],
  p_substitute_user_ids uuid[] default '{}'::uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t public.tournaments%rowtype;
  v_reg uuid;
  v_used integer;
  v_starters uuid[] := coalesce(p_starter_user_ids,'{}'::uuid[]);
  v_substitutes uuid[] := coalesce(p_substitute_user_ids,'{}'::uuid[]);
  v_selected uuid[];
  v_valid integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select * into v_t from public.tournaments where id=p_tournament_id for update;
  if not found then raise exception 'Tournament not found'; end if;

  perform 1 from public.teams where id=p_team_id for update;
  if not found or not private.is_team_captain(p_team_id) then raise exception 'Team captain required'; end if;

  if v_t.status <> 'registration_open'
     or (v_t.registration_opens_at is not null and now()<v_t.registration_opens_at)
     or coalesce(v_t.registration_closes_at,v_t.starts_at)<=now() then
    raise exception 'Tournament registration is closed';
  end if;

  if not exists(
    select 1 from public.teams t
    join public.team_game_rosters gr on gr.team_id=t.id and gr.game=v_t.game
    where t.id=p_team_id and t.game=v_t.game
  ) then
    raise exception 'Team game does not match tournament';
  end if;

  if cardinality(v_starters)<>v_t.roster_size then
    raise exception 'Select exactly % starters for this tournament',v_t.roster_size;
  end if;
  if cardinality(v_substitutes)>v_t.substitute_limit then
    raise exception 'Select no more than % substitutes',v_t.substitute_limit;
  end if;

  v_selected := v_starters || v_substitutes;
  if exists(select 1 from unnest(v_selected) as chosen(user_id) where user_id is null)
     or (select count(distinct user_id) from unnest(v_selected) as chosen(user_id))<>cardinality(v_selected) then
    raise exception 'Each player can only be selected once';
  end if;

  select count(*) into v_valid
  from unnest(v_selected) as chosen(user_id)
  join public.team_game_members gm
    on gm.team_id=p_team_id and gm.game=v_t.game and gm.user_id=chosen.user_id
  join public.team_members m
    on m.team_id=gm.team_id and m.user_id=gm.user_id and m.status='active';
  if v_valid<>cardinality(v_selected) then
    raise exception 'Every selected player must be active on this team game roster';
  end if;

  if exists(select 1 from public.tournament_registrations r
    where r.tournament_id=p_tournament_id and r.team_id=p_team_id
      and r.status in ('pending','approved','checked_in')) then
    raise exception 'This team is already registered for the tournament';
  end if;

  select count(*) into v_used from public.tournament_registrations r
    where r.tournament_id=p_tournament_id and r.status in ('pending','approved','checked_in');
  if v_used>=v_t.max_teams then raise exception 'Tournament is full'; end if;

  insert into public.tournament_registrations(tournament_id,team_id,registered_by,status)
    values(p_tournament_id,p_team_id,auth.uid(),'pending') returning id into v_reg;

  insert into public.tournament_registration_members(tournament_id,registration_id,team_id,user_id,member_role)
  select p_tournament_id,v_reg,p_team_id,m.user_id,
    case when m.user_id=any(v_substitutes) then 'substitute'
         when m.role='captain' then 'captain'
         else 'player' end
  from public.team_members m
  where m.team_id=p_team_id and m.status='active' and m.user_id=any(v_selected);

  perform private.write_audit_event('TEAM_REGISTERED','tournament_registration',v_reg,
    jsonb_build_object('tournament_id',p_tournament_id,'team_id',p_team_id,
      'starter_count',cardinality(v_starters),'substitute_count',cardinality(v_substitutes)));
  return v_reg;
end;
$$;

revoke all on function public.register_team_with_lineup(uuid,uuid,uuid[],uuid[]) from public,anon,authenticated;
grant execute on function public.register_team_with_lineup(uuid,uuid,uuid[],uuid[]) to authenticated;

-- Match rooms and captain confirmation must use the immutable tournament
-- roster snapshot, not the team's larger pool of available game players.
create or replace function public.get_match_room(p_match_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_room jsonb;
begin
  if auth.uid() is null or not private.can_access_match(p_match_id) then
    raise exception 'This match room is available to its players, assigned officials, and event staff';
  end if;

  select jsonb_build_object(
    'id',m.id,'tournament_id',m.tournament_id,'tournament_name',t.name,'game',t.game,
    'stage_name',s.name,'round_number',m.round_number,'position',m.position,
    'bracket_side',m.bracket_side,'status',m.status,'scheduled_at',m.scheduled_at,
    'started_at',m.started_at,'home_score',m.home_score,'away_score',m.away_score,
    'teams',jsonb_build_array(
      jsonb_build_object(
        'side','home','team_id',ht.id,'name',ht.name,'tag',ht.tag,'captain_id',ht.captain_id,
        'confirmed',hc.match_id is not null,'confirmed_at',hc.confirmed_at,
        'confirmed_by_name',(select coalesce(p.username,p.player_name) from public.public_profiles p where p.id=hc.confirmed_by),
        'roster',coalesce(hc.roster,(
          select jsonb_agg(jsonb_build_object('user_id',rm.user_id,'name',coalesce(p.username,p.player_name),'role',rm.member_role)
            order by case rm.member_role when 'captain' then 0 when 'player' then 1 else 2 end,p.username nulls last,rm.user_id)
          from public.tournament_registration_members rm
          left join public.public_profiles p on p.id=rm.user_id
          where rm.registration_id=hr.id
        ),'[]'::jsonb)
      ),
      jsonb_build_object(
        'side','away','team_id',at.id,'name',at.name,'tag',at.tag,'captain_id',at.captain_id,
        'confirmed',ac.match_id is not null,'confirmed_at',ac.confirmed_at,
        'confirmed_by_name',(select coalesce(p.username,p.player_name) from public.public_profiles p where p.id=ac.confirmed_by),
        'roster',coalesce(ac.roster,(
          select jsonb_agg(jsonb_build_object('user_id',rm.user_id,'name',coalesce(p.username,p.player_name),'role',rm.member_role)
            order by case rm.member_role when 'captain' then 0 when 'player' then 1 else 2 end,p.username nulls last,rm.user_id)
          from public.tournament_registration_members rm
          left join public.public_profiles p on p.id=rm.user_id
          where rm.registration_id=ar.id
        ),'[]'::jsonb)
      )
    )
  ) into v_room
  from public.tournament_matches m
  join public.tournaments t on t.id=m.tournament_id
  join public.tournament_stages s on s.id=m.stage_id
  left join public.tournament_registrations hr on hr.id=m.home_registration_id
  left join public.tournament_registrations ar on ar.id=m.away_registration_id
  left join public.teams ht on ht.id=hr.team_id
  left join public.teams at on at.id=ar.team_id
  left join public.match_roster_confirmations hc on hc.match_id=m.id and hc.team_id=ht.id
  left join public.match_roster_confirmations ac on ac.match_id=m.id and ac.team_id=at.id
  where m.id=p_match_id;

  if v_room is null then raise exception 'Match not found'; end if;
  return v_room;
end;
$$;
revoke all on function public.get_match_room(uuid) from public,anon,authenticated;
grant execute on function public.get_match_room(uuid) to authenticated;

create or replace function public.confirm_match_roster(p_match_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_match public.tournament_matches%rowtype;
  v_registration_id uuid;
  v_team_id uuid;
  v_roster jsonb;
  v_confirmed_at timestamptz;
begin
  if auth.uid() is null then raise exception 'Sign in to confirm a roster'; end if;
  select * into v_match from public.tournament_matches where id=p_match_id for update;
  if not found then raise exception 'Match not found'; end if;
  if v_match.status <> 'ready' then raise exception 'Rosters can only be confirmed before the match starts'; end if;

  select r.id,t.id into v_registration_id,v_team_id
  from public.tournament_registrations r
  join public.teams t on t.id=r.team_id
  where r.id in (v_match.home_registration_id,v_match.away_registration_id)
    and r.status in ('approved','checked_in')
    and t.captain_id=auth.uid()
    and private.is_team_captain(t.id)
  limit 1;
  if v_team_id is null then raise exception 'Only a participating team captain can confirm its roster'; end if;

  select coalesce(jsonb_agg(jsonb_build_object('user_id',rm.user_id,'name',coalesce(p.username,p.player_name),'role',rm.member_role)
    order by case rm.member_role when 'captain' then 0 when 'player' then 1 else 2 end,p.username nulls last,rm.user_id),'[]'::jsonb)
  into v_roster
  from public.tournament_registration_members rm
  left join public.public_profiles p on p.id=rm.user_id
  where rm.registration_id=v_registration_id;
  if jsonb_array_length(v_roster)=0 then raise exception 'The tournament roster is missing; contact the organizer'; end if;

  insert into public.match_roster_confirmations(match_id,team_id,confirmed_by,roster,confirmed_at)
  values(p_match_id,v_team_id,auth.uid(),v_roster,now())
  on conflict(match_id,team_id) do update
    set confirmed_by=excluded.confirmed_by,roster=excluded.roster,confirmed_at=excluded.confirmed_at
  returning confirmed_at into v_confirmed_at;
  return jsonb_build_object('team_id',v_team_id,'confirmed_at',v_confirmed_at,'roster_count',jsonb_array_length(v_roster));
end;
$$;
revoke all on function public.confirm_match_roster(uuid) from public,anon,authenticated;
grant execute on function public.confirm_match_roster(uuid) to authenticated;
