-- Save the balanced first-round bye count and allow admins to prepare and seed
-- a playoff draft while its published round-robin stage is still underway.
alter table public.tournaments
  add column if not exists playoff_bye_count integer not null default 0
  check (playoff_bye_count between 0 and 64);

update public.tournaments t set playoff_bye_count=(
  (select power(2,ceil(log(2,t.playoff_qualifier_count)))::integer)-t.playoff_qualifier_count
) where t.format='round_robin_playoffs';

create or replace function private.enforce_playoff_byes_superadmin()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
 if auth.uid() is not null and not private.is_super_admin() then
  if tg_op='INSERT' and (new.playoff_qualifier_count<>4 or new.playoff_bye_count<>0) then
   raise exception 'Only a Super Admin can set playoff qualifiers and byes';
  end if;
  if tg_op='UPDATE' and (new.playoff_qualifier_count is distinct from old.playoff_qualifier_count
      or new.playoff_bye_count is distinct from old.playoff_bye_count) then
   raise exception 'Only a Super Admin can change playoff qualifiers and byes';
  end if;
 end if;
 return new;
end; $$;
revoke all on function private.enforce_playoff_byes_superadmin() from public,anon,authenticated;
drop trigger if exists enforce_playoff_byes_superadmin on public.tournaments;
create trigger enforce_playoff_byes_superadmin before insert or update on public.tournaments
for each row execute function private.enforce_playoff_byes_superadmin();

create or replace view public.tournament_directory as
 select t.id,t.name,t.game,t.description,t.format,t.best_of,t.region,t.starts_at,t.registration_opens_at,t.registration_closes_at,
  t.max_teams,t.roster_size,t.prize_pool,t.currency,t.map_pool,t.anti_cheat_required,t.substitute_limit,t.check_in_minutes,
  case when t.status='registration_open' and coalesce(t.registration_closes_at,t.starts_at) is not null and coalesce(t.registration_closes_at,t.starts_at)<=now()
   then 'registration_closed' else t.status end as status,
  t.created_at,count(r.id)::integer as registered_teams,t.cover_image_path,t.rules,t.playoff_qualifier_count,t.playoff_bye_count
 from public.tournaments t left join public.tournament_registrations r on r.tournament_id=t.id and r.status in ('approved','checked_in')
 where t.status<>'draft' group by t.id;

create or replace function public.create_tournament(p_data jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_org uuid; v_qualifiers integer:=4; v_byes integer; v_max integer; v_slots integer:=1;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if jsonb_typeof(p_data)<>'object' then raise exception 'Tournament payload must be an object'; end if;
 if coalesce(p_data->>'format','single') not in ('single','single_elimination','double','double_elimination','rr','round_robin','round_robin_playoffs') then raise exception 'Unsupported tournament format'; end if;
 if char_length(coalesce(p_data->>'rules',''))>10000 then raise exception 'Tournament rules are too long'; end if;
 if p_data ? 'playoff_qualifier_count' or p_data ? 'playoff_bye_count' then
  if not private.is_super_admin() then raise exception 'Only a Super Admin can set playoff qualifiers and byes'; end if;
  if coalesce(p_data->>'format','single') not in ('rr','round_robin','round_robin_playoffs') then raise exception 'Playoff settings apply only to round-robin tournaments'; end if;
  v_qualifiers:=coalesce((p_data->>'playoff_qualifier_count')::integer,4);
  if v_qualifiers not between 2 and 64 then raise exception 'Playoff qualifier count must be between 2 and 64'; end if;
  v_byes:=nullif(p_data->>'playoff_bye_count','')::integer;
  if v_byes is not null and v_byes not between 0 and 64 then raise exception 'Playoff bye count must be between 0 and 64'; end if;
 end if;
 v_max:=coalesce((p_data->>'max_teams')::integer,64);
 if v_qualifiers>v_max then raise exception 'Playoff qualifiers cannot exceed the tournament team limit'; end if;
 while v_slots<v_qualifiers loop v_slots:=v_slots*2; end loop;
 v_byes:=coalesce(v_byes,v_slots-v_qualifiers);
 if v_byes<>v_slots-v_qualifiers then raise exception 'A balanced single-elimination bracket requires % first-round byes for % qualifiers',v_slots-v_qualifiers,v_qualifiers; end if;
 v_org:=nullif(p_data->>'organization_id','')::uuid;
 if v_org is not null then
  if not private.can_manage_organization(v_org,'create_tournaments') then raise exception 'Organization tournament capability required'; end if;
 elsif not public.has_permission('CREATE_TOURNAMENT') and not private.is_super_admin() then raise exception 'Tournament creation eligibility required'; end if;
 insert into public.tournaments(organizer_id,organization_id,name,game,description,rules,format,best_of,region,starts_at,registration_opens_at,registration_closes_at,max_teams,roster_size,prize_pool,currency,map_pool,anti_cheat_required,substitute_limit,check_in_minutes,playoff_qualifier_count,playoff_bye_count,status)
 values(auth.uid(),v_org,trim(p_data->>'name'),p_data->>'game',coalesce(p_data->>'description',''),coalesce(p_data->>'rules',''),
 case coalesce(p_data->>'format','single') when 'single' then 'single_elimination' when 'double' then 'double_elimination' when 'rr' then 'round_robin_playoffs' else p_data->>'format' end,
 coalesce(p_data->>'best_of','BO3'),coalesce(p_data->>'region',''),nullif(p_data->>'starts_at','')::timestamptz,nullif(p_data->>'registration_opens_at','')::timestamptz,nullif(p_data->>'registration_closes_at','')::timestamptz,
 v_max,coalesce((p_data->>'roster_size')::integer,5),coalesce((p_data->>'prize_pool')::numeric,0),coalesce(p_data->>'currency','TND'),coalesce(array(select jsonb_array_elements_text(p_data->'map_pool')),'{}'),
 coalesce((p_data->>'anti_cheat_required')::boolean,false),coalesce((p_data->>'substitute_limit')::smallint,1),coalesce((p_data->>'check_in_minutes')::smallint,60),v_qualifiers,v_byes,'draft') returning id into v_id;
 perform private.write_audit_event('TOURNAMENT_CREATED','tournament',v_id,jsonb_build_object('playoff_qualifier_count',v_qualifiers,'playoff_bye_count',v_byes));
 return v_id;
end; $$;

drop function if exists public.list_my_tournament_operations();
create function public.list_my_tournament_operations()
returns table(id uuid,name text,game text,format text,status text,starts_at timestamptz,
  registration_closes_at timestamptz,max_teams integer,playoff_qualifier_count integer,playoff_bye_count integer)
language sql stable security definer set search_path = '' as $$
  select t.id,t.name,t.game,t.format,t.status,t.starts_at,t.registration_closes_at,t.max_teams,t.playoff_qualifier_count,t.playoff_bye_count
  from public.tournaments t where auth.uid() is not null and private.can_manage_tournament(t.id,'manage_tournament')
  order by t.created_at desc limit 100;
$$;
revoke all on function public.list_my_tournament_operations() from public,anon;
grant execute on function public.list_my_tournament_operations() to authenticated;

create table if not exists public.tournament_playoff_draft_seeds(
 stage_id uuid not null references public.tournament_stages(id) on delete cascade,
 registration_id uuid not null references public.tournament_registrations(id) on delete cascade,
 seed_number integer not null check(seed_number between 1 and 64),
 primary key(stage_id,registration_id),unique(stage_id,seed_number)
);
alter table public.tournament_playoff_draft_seeds enable row level security;
revoke all on public.tournament_playoff_draft_seeds from public,anon,authenticated;

drop function if exists public.generate_playoff_stage(uuid,integer);
create or replace function public.prepare_playoff_stage(p_tournament_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_t public.tournaments%rowtype; v_rr_stage uuid; v_stage uuid; v_ids uuid[]; v_count integer; v_slots integer:=1;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select * into v_t from public.tournaments where id=p_tournament_id for update;
 if not found or v_t.format<>'round_robin_playoffs' or v_t.status<>'in_progress'
    or not private.can_manage_tournament(p_tournament_id,'bracket') then
  raise exception 'An active round-robin-playoffs tournament and bracket capability are required';
 end if;
 select id into v_rr_stage from public.tournament_stages where tournament_id=p_tournament_id and stage_number=1 and format='round_robin' and status in ('published','in_progress','completed');
 if v_rr_stage is null then raise exception 'Publish the round-robin stage before preparing playoffs'; end if;
 select id into v_stage from public.tournament_stages where tournament_id=p_tournament_id and stage_number>1 for update;
 if v_stage is not null and not exists(select 1 from public.tournament_stages where id=v_stage and status='draft') then raise exception 'The playoff stage has already been published'; end if;
 if v_t.playoff_qualifier_count not between 2 and 64 then raise exception 'Configure between 2 and 64 playoff qualifiers'; end if;
 while v_slots<v_t.playoff_qualifier_count loop v_slots:=v_slots*2; end loop;
 if v_t.playoff_bye_count<>v_slots-v_t.playoff_qualifier_count then raise exception 'The saved bye count does not fit a balanced single-elimination bracket'; end if;
 perform private.rebuild_standings(v_rr_stage);
 select array_agg(r.registration_id order by r.rank,r.registration_id) into v_ids from (
  select st.registration_id,st.rank from public.tournament_standings st where st.stage_id=v_rr_stage order by st.rank,st.registration_id limit v_t.playoff_qualifier_count
 ) r;
 v_ids:=coalesce(v_ids,'{}');v_count:=cardinality(v_ids);
 if v_count<>v_t.playoff_qualifier_count then raise exception 'Not enough eligible teams are present in the round-robin standings'; end if;
 if v_stage is null then
  insert into public.tournament_stages(tournament_id,stage_number,name,format,status,created_by)
   values(p_tournament_id,2,'Playoffs','single_elimination','draft',auth.uid()) returning id into v_stage;
 else
  delete from public.tournament_playoff_draft_seeds where stage_id=v_stage;
 end if;
 insert into public.tournament_playoff_draft_seeds(stage_id,registration_id,seed_number)
  select v_stage,seed.registration_id,seed.seed_number from unnest(v_ids) with ordinality as seed(registration_id,seed_number);
 perform private.write_audit_event('PLAYOFF_STAGE_PREPARED','tournament_stage',v_stage,
  jsonb_build_object('tournament_id',p_tournament_id,'qualifier_count',v_count,'bye_count',v_t.playoff_bye_count));
 return v_stage;
end; $$;

create or replace function public.publish_playoff_stage(p_tournament_id uuid,p_seeded_registration_ids uuid[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare
 v_t public.tournaments%rowtype;v_rr_stage uuid;v_stage uuid;v_ids uuid[];v_current_ids uuid[];
 v_count integer;v_slots integer:=1;v_rounds integer:=0;v_round integer;v_pos integer;v_half integer;
 v_home uuid;v_away uuid;v_winner uuid;v_row record;v_seed_order integer[];v_seed_order_next integer[];v_seed_count integer;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select * into v_t from public.tournaments where id=p_tournament_id for update;
 if not found or v_t.format<>'round_robin_playoffs' or v_t.status<>'in_progress' or not private.can_manage_tournament(p_tournament_id,'bracket') then
  raise exception 'An active round-robin-playoffs tournament and bracket capability are required';
 end if;
 select id into v_rr_stage from public.tournament_stages where tournament_id=p_tournament_id and stage_number=1 and format='round_robin' and status in ('published','in_progress','completed');
 if v_rr_stage is null then raise exception 'The round-robin stage is not available'; end if;
 select id into v_stage from public.tournament_stages where tournament_id=p_tournament_id and stage_number=2 and status='draft' for update;
 if v_stage is null then raise exception 'Prepare a playoff draft before publishing it'; end if;
 perform private.rebuild_standings(v_rr_stage);
 select array_agg(r.registration_id order by r.rank,r.registration_id) into v_current_ids from (
  select st.registration_id,st.rank from public.tournament_standings st where st.stage_id=v_rr_stage order by st.rank,st.registration_id limit v_t.playoff_qualifier_count
 ) r;
 select array_agg(s.registration_id order by s.seed_number) into v_ids from public.tournament_playoff_draft_seeds s where s.stage_id=v_stage;
 v_ids:=coalesce(v_ids,'{}');v_current_ids:=coalesce(v_current_ids,'{}');v_count:=cardinality(v_ids);
 if cardinality(coalesce(p_seeded_registration_ids,'{}'))<>v_count or cardinality(array(select distinct unnest(p_seeded_registration_ids)))<>v_count
    or exists(select unnest(v_ids) except select unnest(p_seeded_registration_ids)) or exists(select unnest(p_seeded_registration_ids) except select unnest(v_ids)) then
  raise exception 'Playoff seeds must contain each drafted qualifier exactly once';
 end if;
 if cardinality(v_current_ids)<>v_count or exists(select unnest(v_ids) except select unnest(v_current_ids)) or exists(select unnest(v_current_ids) except select unnest(v_ids)) then
  raise exception 'Standings changed after the draft was prepared. Refresh the draft before publishing';
 end if;
 if v_count<2 or v_count>64 then raise exception 'Playoff qualifier count must be between 2 and 64'; end if;
 while v_slots<v_count loop v_slots:=v_slots*2;v_rounds:=v_rounds+1;end loop;
 if v_slots=v_count then v_rounds:=0;while v_slots>1 loop v_slots:=v_slots/2;v_rounds:=v_rounds+1;end loop;v_slots:=power(2,v_rounds)::integer;end if;
 for v_round in 1..v_rounds loop for v_pos in 1..(v_slots/power(2,v_round)::integer) loop
  insert into public.tournament_matches(tournament_id,stage_id,bracket_side,round_number,position,status)
   values(p_tournament_id,v_stage,'main',v_round,v_pos,'pending');
 end loop;end loop;
 v_seed_order:=array[1,2];v_seed_count:=2;
 while v_seed_count<v_slots loop
  v_seed_order_next:='{}';
  for v_round in 1..v_seed_count loop
   v_seed_order_next:=array_append(v_seed_order_next,v_seed_order[v_round]);
   v_seed_order_next:=array_append(v_seed_order_next,2*v_seed_count+1-v_seed_order[v_round]);
  end loop;
  v_seed_order:=v_seed_order_next;v_seed_count:=v_seed_count*2;
 end loop;
 -- Move unopposed top seeds out of the first round into their own later-round slots.
 -- For six qualifiers this places seeds 1 and 2 directly in opposite semifinals.
 if v_count<v_slots then
  for v_pos in 1..(v_slots-v_count) loop
   v_seed_order:=array_replace(v_seed_order,v_slots+1-v_pos,-v_pos);
  end loop;
 end if;
 v_half:=v_slots/2;
 for v_pos in 1..v_half loop
  v_home:=case when v_seed_order[(v_pos*2)-1]>0 then p_seeded_registration_ids[v_seed_order[(v_pos*2)-1]] else null end;
  v_away:=case when v_seed_order[v_pos*2]>0 then p_seeded_registration_ids[v_seed_order[v_pos*2]] else null end;
  v_winner:=case when v_home is null then v_away when v_away is null then v_home else null end;
  update public.tournament_matches set home_registration_id=v_home,away_registration_id=v_away,home_expected=(v_home is not null),away_expected=(v_away is not null),
   winner_registration_id=v_winner,status=case when v_winner is null then 'ready' else 'completed' end,completed_at=case when v_winner is null then null else now() end
   where stage_id=v_stage and round_number=1 and position=v_pos;
 end loop;
 update public.tournament_matches child set winner_to_match_id=parent.id,winner_to_slot=case when child.position%2=1 then 'home' else 'away' end
  from public.tournament_matches parent where child.stage_id=v_stage and parent.stage_id=v_stage and child.round_number<v_rounds and parent.round_number=child.round_number+1 and parent.position=(child.position+1)/2;
 update public.tournament_matches parent set
  home_expected=exists(select 1 from public.tournament_matches c where c.stage_id=v_stage and c.round_number=parent.round_number-1 and c.position=parent.position*2-1 and (c.home_expected or c.away_expected)),
  away_expected=exists(select 1 from public.tournament_matches c where c.stage_id=v_stage and c.round_number=parent.round_number-1 and c.position=parent.position*2 and (c.home_expected or c.away_expected))
  where parent.stage_id=v_stage and parent.round_number>1;
 update public.tournament_stages set status='published' where id=v_stage;
 for v_row in select id,winner_registration_id from public.tournament_matches where stage_id=v_stage and round_number=1 and status='completed' and winner_registration_id is not null loop
  perform private.advance_match_winner(v_row.id,v_row.winner_registration_id);
 end loop;
 perform private.write_audit_event('PLAYOFF_STAGE_PUBLISHED','tournament_stage',v_stage,jsonb_build_object('tournament_id',p_tournament_id,
  'qualifier_count',v_count,'bye_count',v_t.playoff_bye_count,'seeded_registration_ids',p_seeded_registration_ids));
 return v_stage;
end; $$;

revoke all on function public.prepare_playoff_stage(uuid),public.publish_playoff_stage(uuid,uuid[]) from public,anon;
grant execute on function public.prepare_playoff_stage(uuid),public.publish_playoff_stage(uuid,uuid[]) to authenticated;
