create table public.match_map_vetoes (
  match_id uuid not null references public.tournament_matches(id) on delete cascade,
  sequence smallint not null check (sequence > 0),
  team_id uuid not null references public.teams(id) on delete restrict,
  map_name text not null check (length(btrim(map_name)) > 0),
  banned_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (match_id, sequence),
  unique (match_id, map_name)
);
create index match_map_vetoes_team_idx on public.match_map_vetoes(team_id, match_id);
alter table public.match_map_vetoes enable row level security;
revoke all on public.match_map_vetoes from public, anon, authenticated;
grant select on public.match_map_vetoes to authenticated;
create policy match_map_veto_read on public.match_map_vetoes
  for select to authenticated using (private.can_access_match(match_id));

create or replace function public.get_match_room(p_match_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_room jsonb;
begin
  if auth.uid() is null or not private.can_access_match(p_match_id) then
    raise exception 'This match room is available to its players, assigned officials, and event staff';
  end if;

  select jsonb_build_object(
    'id',m.id,
    'tournament_id',m.tournament_id,
    'tournament_name',t.name,
    'game',t.game,
    'best_of',t.best_of,
    'map_pool',to_jsonb(coalesce(t.map_pool,array[]::text[])),
    'veto',coalesce((
      select jsonb_agg(jsonb_build_object('sequence',v.sequence,'team_id',v.team_id,'map_name',v.map_name,
        'banned_by_name',(select coalesce(p.username,p.player_name) from public.public_profiles p where p.id=v.banned_by),
        'created_at',v.created_at) order by v.sequence)
      from public.match_map_vetoes v where v.match_id=m.id
    ),'[]'::jsonb),
    'stage_name',s.name,
    'round_number',m.round_number,
    'position',m.position,
    'bracket_side',m.bracket_side,
    'status',m.status,
    'scheduled_at',m.scheduled_at,
    'started_at',m.started_at,
    'home_score',m.home_score,
    'away_score',m.away_score,
    'teams',jsonb_build_array(
      jsonb_build_object(
        'side','home','team_id',ht.id,'name',ht.name,'tag',ht.tag,'captain_id',ht.captain_id,
        'confirmed',hc.match_id is not null,'confirmed_at',hc.confirmed_at,
        'confirmed_by_name',(select coalesce(p.username,p.player_name) from public.public_profiles p where p.id=hc.confirmed_by),
        'roster',coalesce(hc.roster,(
          select jsonb_agg(jsonb_build_object('user_id',gm.user_id,'name',coalesce(p.username,p.player_name),'role',tm.role)
            order by case tm.role when 'captain' then 0 when 'player' then 1 else 2 end,p.username nulls last,gm.user_id)
          from public.team_game_members gm
          join public.team_members tm on tm.team_id=gm.team_id and tm.user_id=gm.user_id and tm.status='active'
          left join public.public_profiles p on p.id=gm.user_id
          where gm.team_id=ht.id and gm.game=t.game
        ),'[]'::jsonb)
      ),
      jsonb_build_object(
        'side','away','team_id',at.id,'name',at.name,'tag',at.tag,'captain_id',at.captain_id,
        'confirmed',ac.match_id is not null,'confirmed_at',ac.confirmed_at,
        'confirmed_by_name',(select coalesce(p.username,p.player_name) from public.public_profiles p where p.id=ac.confirmed_by),
        'roster',coalesce(ac.roster,(
          select jsonb_agg(jsonb_build_object('user_id',gm.user_id,'name',coalesce(p.username,p.player_name),'role',tm.role)
            order by case tm.role when 'captain' then 0 when 'player' then 1 else 2 end,p.username nulls last,gm.user_id)
          from public.team_game_members gm
          join public.team_members tm on tm.team_id=gm.team_id and tm.user_id=gm.user_id and tm.status='active'
          left join public.public_profiles p on p.id=gm.user_id
          where gm.team_id=at.id and gm.game=t.game
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
revoke all on function public.get_match_room(uuid) from public, anon, authenticated;
grant execute on function public.get_match_room(uuid) to authenticated;

create or replace function public.submit_match_map_ban(p_match_id uuid,p_map_name text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_match public.tournament_matches%rowtype;
  v_tournament public.tournaments%rowtype;
  v_home_team uuid;
  v_away_team uuid;
  v_team_id uuid;
  v_best_of integer;
  v_required integer;
  v_count integer;
  v_sequence integer;
  v_remaining integer;
begin
  if auth.uid() is null then raise exception 'Sign in to submit a map ban'; end if;
  select * into v_match from public.tournament_matches where id=p_match_id for update;
  if not found then raise exception 'Match not found'; end if;
  if v_match.status <> 'ready' then raise exception 'Map veto is only available before the match starts'; end if;

  select * into v_tournament from public.tournaments where id=v_match.tournament_id;
  if cardinality(v_tournament.map_pool) < 2 then raise exception 'The organizer has not configured a map pool for this tournament'; end if;
  if p_map_name is null or not (p_map_name=any(v_tournament.map_pool)) then raise exception 'Choose a map from this tournament map pool'; end if;

  v_best_of := coalesce(nullif(substring(upper(coalesce(v_tournament.best_of,'')) from '[0-9]+'),'')::integer,1);
  v_required := greatest(0,cardinality(v_tournament.map_pool)-v_best_of);
  if v_required=0 then raise exception 'This tournament map pool does not require bans'; end if;

  select hr.team_id,ar.team_id into v_home_team,v_away_team
  from public.tournament_registrations hr,public.tournament_registrations ar
  where hr.id=v_match.home_registration_id and ar.id=v_match.away_registration_id
    and hr.status in ('approved','checked_in') and ar.status in ('approved','checked_in');
  if v_home_team is null or v_away_team is null then raise exception 'Both participating teams must be registered before map veto'; end if;
  if not exists(select 1 from public.match_roster_confirmations c where c.match_id=p_match_id and c.team_id=v_home_team)
    or not exists(select 1 from public.match_roster_confirmations c where c.match_id=p_match_id and c.team_id=v_away_team) then
    raise exception 'Both captains must confirm their rosters before map veto';
  end if;

  select count(*) into v_count from public.match_map_vetoes where match_id=p_match_id;
  if v_count >= v_required then raise exception 'Map veto is already complete'; end if;
  v_sequence:=v_count+1;
  v_team_id:=case when v_sequence%2=1 then v_home_team else v_away_team end;
  if not exists(select 1 from public.teams t where t.id=v_team_id and t.captain_id=auth.uid() and private.is_team_captain(t.id)) then
    raise exception 'Only the captain whose turn it is can ban the next map';
  end if;

  insert into public.match_map_vetoes(match_id,sequence,team_id,map_name,banned_by)
  values(p_match_id,v_sequence,v_team_id,p_map_name,auth.uid());
  v_remaining:=cardinality(v_tournament.map_pool)-v_sequence;
  return jsonb_build_object('sequence',v_sequence,'team_id',v_team_id,'map_name',p_map_name,
    'complete',v_sequence>=v_required,'remaining_maps',v_remaining,
    'next_team_id',case when v_sequence<v_required then case when (v_sequence+1)%2=1 then v_home_team else v_away_team end else null end);
end;
$$;
revoke all on function public.submit_match_map_ban(uuid,text) from public, anon, authenticated;
grant execute on function public.submit_match_map_ban(uuid,text) to authenticated;
