alter table public.match_map_vetoes
  add column action_type text not null default 'ban' check (action_type in ('ban','pick','decider')),
  add column map_number smallint,
  add column side_choice text check (side_choice in ('attack','defense')),
  add column side_team_id uuid references public.teams(id) on delete restrict,
  add column side_picked_by uuid references auth.users(id) on delete restrict;

alter table public.match_map_vetoes add constraint match_map_veto_map_number_check
  check ((action_type='ban' and map_number is null) or (action_type='pick' and map_number between 1 and 4) or (action_type='decider' and map_number between 1 and 5));
create unique index match_map_veto_map_number_unique on public.match_map_vetoes(match_id,map_number) where action_type in ('pick','decider');

create or replace function public.get_match_room(p_match_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_room jsonb;
begin
  if auth.uid() is null or not private.can_access_match(p_match_id) then
    raise exception 'This match room is available to its players, assigned officials, and event staff';
  end if;
  select jsonb_build_object(
    'id',m.id,'tournament_id',m.tournament_id,'tournament_name',t.name,'game',t.game,'best_of',t.best_of,
    'map_pool',to_jsonb(coalesce(t.map_pool,array[]::text[])),
    'veto',coalesce((select jsonb_agg(jsonb_build_object(
      'sequence',v.sequence,'action_type',v.action_type,'map_number',v.map_number,'team_id',v.team_id,
      'map_name',v.map_name,'side_choice',v.side_choice,'side_team_id',v.side_team_id,
      'actor_name',(select coalesce(p.username,p.player_name) from public.public_profiles p where p.id=v.banned_by),
      'side_picked_by_name',(select coalesce(p.username,p.player_name) from public.public_profiles p where p.id=v.side_picked_by),
      'created_at',v.created_at) order by v.sequence)
      from public.match_map_vetoes v where v.match_id=m.id),'[]'::jsonb),
    'stage_name',s.name,'round_number',m.round_number,'position',m.position,'bracket_side',m.bracket_side,
    'status',m.status,'scheduled_at',m.scheduled_at,'started_at',m.started_at,'home_score',m.home_score,'away_score',m.away_score,
    'teams',jsonb_build_array(
      jsonb_build_object('side','home','team_id',ht.id,'name',ht.name,'tag',ht.tag,'captain_id',ht.captain_id,
        'confirmed',hc.match_id is not null,'confirmed_at',hc.confirmed_at,
        'confirmed_by_name',(select coalesce(p.username,p.player_name) from public.public_profiles p where p.id=hc.confirmed_by),
        'roster',coalesce(hc.roster,(select jsonb_agg(jsonb_build_object('user_id',gm.user_id,'name',coalesce(p.username,p.player_name),'role',tm.role)
          order by case tm.role when 'captain' then 0 when 'player' then 1 else 2 end,p.username nulls last,gm.user_id)
          from public.team_game_members gm join public.team_members tm on tm.team_id=gm.team_id and tm.user_id=gm.user_id and tm.status='active'
          left join public.public_profiles p on p.id=gm.user_id where gm.team_id=ht.id and gm.game=t.game),'[]'::jsonb)),
      jsonb_build_object('side','away','team_id',at.id,'name',at.name,'tag',at.tag,'captain_id',at.captain_id,
        'confirmed',ac.match_id is not null,'confirmed_at',ac.confirmed_at,
        'confirmed_by_name',(select coalesce(p.username,p.player_name) from public.public_profiles p where p.id=ac.confirmed_by),
        'roster',coalesce(ac.roster,(select jsonb_agg(jsonb_build_object('user_id',gm.user_id,'name',coalesce(p.username,p.player_name),'role',tm.role)
          order by case tm.role when 'captain' then 0 when 'player' then 1 else 2 end,p.username nulls last,gm.user_id)
          from public.team_game_members gm join public.team_members tm on tm.team_id=gm.team_id and tm.user_id=gm.user_id and tm.status='active'
          left join public.public_profiles p on p.id=gm.user_id where gm.team_id=at.id and gm.game=t.game),'[]'::jsonb))
    )) into v_room
  from public.tournament_matches m join public.tournaments t on t.id=m.tournament_id
  join public.tournament_stages s on s.id=m.stage_id
  left join public.tournament_registrations hr on hr.id=m.home_registration_id
  left join public.tournament_registrations ar on ar.id=m.away_registration_id
  left join public.teams ht on ht.id=hr.team_id left join public.teams at on at.id=ar.team_id
  left join public.match_roster_confirmations hc on hc.match_id=m.id and hc.team_id=ht.id
  left join public.match_roster_confirmations ac on ac.match_id=m.id and ac.team_id=at.id
  where m.id=p_match_id;
  if v_room is null then raise exception 'Match not found'; end if;
  return v_room;
end;
$$;
revoke all on function public.get_match_room(uuid) from public, anon, authenticated;
grant execute on function public.get_match_room(uuid) to authenticated;

create or replace function public.submit_match_veto_action(
  p_match_id uuid,p_action text,p_map_name text default null,p_side text default null
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_match public.tournament_matches%rowtype;
  v_t public.tournaments%rowtype;
  v_home uuid; v_away uuid; v_turn uuid; v_last_team uuid;
  v_bans integer; v_picks integer; v_decider_exists boolean;
  v_bans_required integer; v_picks_required integer; v_bestof integer;
  v_sequence integer; v_map_number integer; v_map text; v_side text;
  v_is_val boolean; v_complete boolean; v_ban_phase boolean;
begin
  if auth.uid() is null then raise exception 'Sign in to continue the map veto'; end if;
  select * into v_match from public.tournament_matches where id=p_match_id for update;
  if not found then raise exception 'Match not found'; end if;
  if v_match.status <> 'ready' then raise exception 'Map veto is only available before the match starts'; end if;
  select * into v_t from public.tournaments where id=v_match.tournament_id;
  if cardinality(v_t.map_pool)<2 then raise exception 'The organizer has not configured a map pool'; end if;
  v_bestof:=coalesce(nullif(substring(upper(coalesce(v_t.best_of,'')) from '[0-9]+'),'')::integer,1);
  if v_bestof<1 or v_bestof>5 or cardinality(v_t.map_pool)<v_bestof then raise exception 'This best-of format does not fit the tournament map pool'; end if;
  v_is_val:=lower(v_t.game)='val';
  v_bans_required:=greatest(0,cardinality(v_t.map_pool)-v_bestof);
  v_picks_required:=greatest(0,v_bestof-1);
  if p_action not in ('ban','pick','side','decider_side') then raise exception 'Unknown map veto action'; end if;

  select hr.team_id,ar.team_id into v_home,v_away
  from public.tournament_registrations hr,public.tournament_registrations ar
  where hr.id=v_match.home_registration_id and ar.id=v_match.away_registration_id
    and hr.status in ('approved','checked_in') and ar.status in ('approved','checked_in');
  if v_home is null or v_away is null then raise exception 'Both participating teams must be registered'; end if;
  if not exists(select 1 from public.match_roster_confirmations c where c.match_id=p_match_id and c.team_id=v_home)
    or not exists(select 1 from public.match_roster_confirmations c where c.match_id=p_match_id and c.team_id=v_away) then
    raise exception 'Both captains must confirm their rosters before map veto';
  end if;
  select count(*) filter(where action_type='ban'),count(*) filter(where action_type='pick'),
    coalesce(bool_or(action_type='decider'),false)
    into v_bans,v_picks,v_decider_exists from public.match_map_vetoes where match_id=p_match_id;
  select sequence,team_id,side_choice into v_sequence,v_last_team,v_side
    from public.match_map_vetoes where match_id=p_match_id and action_type='pick' order by map_number desc limit 1;

  v_ban_phase:=v_bans<case when v_is_val and v_bestof in (3,5) then least(2,v_bans_required) else v_bans_required end
    or (v_is_val and v_bestof=3 and v_picks>=v_picks_required and v_side is not null and v_bans<v_bans_required);
  if v_ban_phase then
    if p_action<>'ban' or p_side is not null then raise exception 'The next step is a map ban'; end if;
    v_turn:=case when v_is_val and v_bestof=3 and v_bans>=2 then case when (v_bans-2)%2=0 then v_home else v_away end
      else case when v_bans%2=0 then v_home else v_away end end;
    if not exists(select 1 from public.teams t where t.id=v_turn and t.captain_id=auth.uid() and private.is_team_captain(t.id)) then raise exception 'Only the captain whose turn it is can ban a map'; end if;
    if p_map_name is null or not(p_map_name=any(v_t.map_pool)) then raise exception 'Choose a map from this tournament pool'; end if;
    if exists(select 1 from public.match_map_vetoes where match_id=p_match_id and map_name=p_map_name) then raise exception 'That map has already been removed from the pool'; end if;
    select coalesce(max(sequence),0)+1 into v_sequence from public.match_map_vetoes where match_id=p_match_id;
    insert into public.match_map_vetoes(match_id,sequence,team_id,map_name,banned_by,action_type)
      values(p_match_id,v_sequence,v_turn,p_map_name,auth.uid(),'ban');
    if v_bans+1=v_bans_required and v_picks=v_picks_required and (v_picks_required=0 or (v_is_val and v_bestof=3)) then
      select u.map_name into v_map from unnest(v_t.map_pool) with ordinality u(map_name,ordinality)
        where not exists(select 1 from public.match_map_vetoes x where x.match_id=p_match_id and x.map_name=u.map_name)
        order by u.ordinality limit 1;
      if v_map is not null then insert into public.match_map_vetoes(match_id,sequence,team_id,map_name,banned_by,action_type,map_number)
        values(p_match_id,v_sequence+1,case when v_is_val and v_bestof=3 then v_home else v_away end,v_map,auth.uid(),'decider',v_bestof); end if;
    end if;
  elsif v_is_val and v_picks>0 and v_side is null then
    if p_action<>'side' or p_map_name is not null or p_side not in ('attack','defense') then raise exception 'The next step is to choose the starting side for Map %',v_picks; end if;
    v_turn:=case when v_last_team=v_home then v_away else v_home end;
    if not exists(select 1 from public.teams t where t.id=v_turn and t.captain_id=auth.uid() and private.is_team_captain(t.id)) then raise exception 'Only the opposing team captain can choose this map side'; end if;
    update public.match_map_vetoes set side_choice=p_side,side_team_id=v_turn,side_picked_by=auth.uid()
      where match_id=p_match_id and action_type='pick' and map_number=v_picks;
  elsif v_picks<v_picks_required then
    if p_action<>'pick' or p_side is not null then raise exception 'The next step is to pick Map %',v_picks+1; end if;
    v_map_number:=v_picks+1;
    v_turn:=case when v_picks%2=0 then v_home else v_away end;
    if p_map_name is null or not(p_map_name=any(v_t.map_pool)) then raise exception 'Choose a map from this tournament pool'; end if;
    if exists(select 1 from public.match_map_vetoes where match_id=p_match_id and map_name=p_map_name) then raise exception 'That map is no longer available'; end if;
    if not exists(select 1 from public.teams t where t.id=v_turn and t.captain_id=auth.uid() and private.is_team_captain(t.id)) then raise exception 'Only the captain whose turn it is can pick this map'; end if;
    select coalesce(max(sequence),0)+1 into v_sequence from public.match_map_vetoes where match_id=p_match_id;
    insert into public.match_map_vetoes(match_id,sequence,team_id,map_name,banned_by,action_type,map_number)
      values(p_match_id,v_sequence,v_turn,p_map_name,auth.uid(),'pick',v_map_number);
    if v_map_number=v_picks_required then
      select u.map_name into v_map from unnest(v_t.map_pool) with ordinality u(map_name,ordinality)
        where not exists(select 1 from public.match_map_vetoes x where x.match_id=p_match_id and x.map_name=u.map_name)
        order by u.ordinality limit 1;
      if v_map is null then raise exception 'The remaining decider map could not be determined'; end if;
      insert into public.match_map_vetoes(match_id,sequence,team_id,map_name,banned_by,action_type,map_number)
        values(p_match_id,v_sequence+1,v_away,v_map,auth.uid(),'decider',v_bestof);
    end if;
  elsif v_is_val and v_decider_exists and not exists(select 1 from public.match_map_vetoes where match_id=p_match_id and action_type='decider' and side_choice is not null) then
    v_turn:=case when v_bestof=3 then v_home else v_away end;
    if p_action<>'decider_side' or p_map_name is not null or p_side not in ('attack','defense') then raise exception 'The designated team must choose the starting side for Map %',v_bestof; end if;
    if not exists(select 1 from public.teams t where t.id=v_turn and t.captain_id=auth.uid() and private.is_team_captain(t.id)) then raise exception 'Only the designated captain can choose the decider side'; end if;
    update public.match_map_vetoes set side_choice=p_side,side_team_id=v_turn,side_picked_by=auth.uid()
      where match_id=p_match_id and action_type='decider';
  else
    raise exception 'Map veto is already complete';
  end if;

  select coalesce(bool_or(action_type='decider' and (not v_is_val or side_choice is not null)),false)
    into v_complete from public.match_map_vetoes where match_id=p_match_id;
  return jsonb_build_object('action',p_action,'map_name',p_map_name,'side',p_side,'complete',v_complete);
end;
$$;
revoke all on function public.submit_match_veto_action(uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.submit_match_veto_action(uuid,text,text,text) to authenticated;
revoke all on function public.submit_match_map_ban(uuid,text) from public, anon, authenticated;
