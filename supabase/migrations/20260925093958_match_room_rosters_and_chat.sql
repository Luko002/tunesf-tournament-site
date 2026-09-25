-- Match room data is restricted to registered match members, assigned officials,
-- and the tournament's authorized staff.
create table public.match_roster_confirmations (
  match_id uuid not null references public.tournament_matches(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete restrict,
  confirmed_by uuid not null references auth.users(id) on delete restrict,
  roster jsonb not null check (jsonb_typeof(roster) = 'array'),
  confirmed_at timestamptz not null default now(),
  primary key (match_id, team_id)
);
create index match_roster_confirmations_team_idx on public.match_roster_confirmations(team_id, match_id);
alter table public.match_roster_confirmations enable row level security;
revoke all on public.match_roster_confirmations from public, anon, authenticated;
grant select on public.match_roster_confirmations to authenticated;
create policy match_roster_confirmation_read on public.match_roster_confirmations
  for select to authenticated using (private.can_access_match(match_id));

create table public.match_chat_messages (
  id uuid primary key default extensions.gen_random_uuid(),
  match_id uuid not null references public.tournament_matches(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete restrict,
  body text not null check (length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index match_chat_messages_room_idx on public.match_chat_messages(match_id, created_at, id);
alter table public.match_chat_messages enable row level security;
revoke all on public.match_chat_messages from public, anon, authenticated;
grant select, insert on public.match_chat_messages to authenticated;
create policy match_chat_read on public.match_chat_messages
  for select to authenticated using (private.can_access_match(match_id));
create policy match_chat_send on public.match_chat_messages
  for insert to authenticated
  with check (sender_id = (select auth.uid()) and private.can_access_match(match_id));

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

create or replace function public.confirm_match_roster(p_match_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_match public.tournament_matches%rowtype;
  v_team_id uuid;
  v_game text;
  v_roster jsonb;
  v_confirmed_at timestamptz;
begin
  if auth.uid() is null then raise exception 'Sign in to confirm a roster'; end if;
  select * into v_match from public.tournament_matches where id=p_match_id for update;
  if not found then raise exception 'Match not found'; end if;
  if v_match.status <> 'ready' then raise exception 'Rosters can only be confirmed before the match starts'; end if;

  select t.id,t.game into v_team_id,v_game
  from public.tournament_registrations r
  join public.teams t on t.id=r.team_id
  where r.id in (v_match.home_registration_id,v_match.away_registration_id)
    and r.status in ('approved','checked_in')
    and t.captain_id=auth.uid()
    and private.is_team_captain(t.id)
  limit 1;
  if v_team_id is null then raise exception 'Only a participating team captain can confirm its roster'; end if;

  select coalesce(jsonb_agg(jsonb_build_object('user_id',gm.user_id,'name',coalesce(p.username,p.player_name),'role',tm.role)
    order by case tm.role when 'captain' then 0 when 'player' then 1 else 2 end,p.username nulls last,gm.user_id),'[]'::jsonb)
  into v_roster
  from public.team_game_members gm
  join public.team_members tm on tm.team_id=gm.team_id and tm.user_id=gm.user_id and tm.status='active'
  left join public.public_profiles p on p.id=gm.user_id
  where gm.team_id=v_team_id and gm.game=v_game;
  if jsonb_array_length(v_roster)=0 then raise exception 'Add players to this game roster before confirming'; end if;

  insert into public.match_roster_confirmations(match_id,team_id,confirmed_by,roster,confirmed_at)
  values(p_match_id,v_team_id,auth.uid(),v_roster,now())
  on conflict(match_id,team_id) do update
    set confirmed_by=excluded.confirmed_by,roster=excluded.roster,confirmed_at=excluded.confirmed_at
  returning confirmed_at into v_confirmed_at;
  return jsonb_build_object('team_id',v_team_id,'confirmed_at',v_confirmed_at,'roster_count',jsonb_array_length(v_roster));
end;
$$;
revoke all on function public.confirm_match_roster(uuid) from public, anon, authenticated;
grant execute on function public.confirm_match_roster(uuid) to authenticated;
