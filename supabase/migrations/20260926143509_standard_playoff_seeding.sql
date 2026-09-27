CREATE OR REPLACE FUNCTION public.generate_playoff_stage(p_tournament_id uuid, p_qualifier_count integer DEFAULT 4)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_t public.tournaments%rowtype; v_rr_stage uuid; v_stage uuid; v_ids uuid[];
  v_count integer; v_slots integer:=1; v_rounds integer:=0; v_round integer; v_pos integer;
  v_half integer; v_home uuid; v_away uuid; v_winner uuid; v_row record;
  v_seed_order integer[]; v_seed_order_next integer[]; v_seed_count integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_t from public.tournaments where id=p_tournament_id for update;
  if not found or v_t.format<>'round_robin_playoffs' or v_t.status<>'in_progress'
     or not private.can_manage_tournament(p_tournament_id,'bracket') then
    raise exception 'An active round-robin-playoffs tournament and bracket capability are required';
  end if;
  select id into v_rr_stage from public.tournament_stages
    where tournament_id=p_tournament_id and stage_number=1 and format='round_robin' and status='completed';
  if v_rr_stage is null then raise exception 'The round-robin stage must be completed first'; end if;
  if exists(select 1 from public.tournament_stages where tournament_id=p_tournament_id and stage_number>1) then
    raise exception 'A playoff stage has already been created';
  end if;
  if p_qualifier_count not between 2 and 64 then raise exception 'Qualifier count must be between 2 and 64'; end if;
  select array_agg(q.registration_id order by q.rank,q.registration_id) into v_ids
  from (select st.registration_id,st.rank from public.tournament_standings st
        where st.stage_id=v_rr_stage order by st.rank,st.registration_id limit p_qualifier_count) q;
  v_ids:=coalesce(v_ids,'{}');
  v_count:=cardinality(v_ids);
  if v_count<>p_qualifier_count then raise exception 'Not enough completed standings to seed the requested playoff'; end if;
  while v_slots<v_count loop v_slots:=v_slots*2; v_rounds:=v_rounds+1; end loop;
  if v_slots=v_count then v_rounds:=0; while v_slots>1 loop v_slots:=v_slots/2; v_rounds:=v_rounds+1; end loop; v_slots:=power(2,v_rounds)::integer; end if;
  insert into public.tournament_stages(tournament_id,stage_number,name,format,status,created_by)
    values(p_tournament_id,2,'Playoffs','single_elimination','draft',auth.uid()) returning id into v_stage;
  for v_round in 1..v_rounds loop
    for v_pos in 1..(v_slots/power(2,v_round)::integer) loop
      insert into public.tournament_matches(tournament_id,stage_id,bracket_side,round_number,position,status)
        values(p_tournament_id,v_stage,'main',v_round,v_pos,'pending');
    end loop;
  end loop;
  v_seed_order:=array[1,2]; v_seed_count:=2;
  while v_seed_count<v_slots loop
    v_seed_order_next:='{}';
    for v_round in 1..v_seed_count loop
      v_seed_order_next:=array_append(v_seed_order_next,v_seed_order[v_round]);
      v_seed_order_next:=array_append(v_seed_order_next,2*v_seed_count+1-v_seed_order[v_round]);
    end loop;
    v_seed_order:=v_seed_order_next; v_seed_count:=v_seed_count*2;
  end loop;
  v_half:=v_slots/2;
  for v_pos in 1..v_half loop
    v_home:=v_ids[v_seed_order[(v_pos*2)-1]];
    v_away:=v_ids[v_seed_order[v_pos*2]];
    v_winner:=case when v_home is null then v_away when v_away is null then v_home else null end;
    update public.tournament_matches set home_registration_id=v_home,away_registration_id=v_away,
      home_expected=(v_home is not null),away_expected=(v_away is not null),
      winner_registration_id=v_winner,status=case when v_winner is null then 'ready' else 'completed' end,
      completed_at=case when v_winner is null then null else now() end
    where stage_id=v_stage and round_number=1 and position=v_pos;
  end loop;
  update public.tournament_matches child set winner_to_match_id=parent.id,
    winner_to_slot=case when child.position%2=1 then 'home' else 'away' end
  from public.tournament_matches parent
  where child.stage_id=v_stage and parent.stage_id=v_stage and child.round_number<v_rounds
    and parent.round_number=child.round_number+1 and parent.position=(child.position+1)/2;
  update public.tournament_matches parent set
    home_expected=exists(select 1 from public.tournament_matches c where c.stage_id=v_stage
      and c.round_number=parent.round_number-1 and c.position=parent.position*2-1 and (c.home_expected or c.away_expected)),
    away_expected=exists(select 1 from public.tournament_matches c where c.stage_id=v_stage
      and c.round_number=parent.round_number-1 and c.position=parent.position*2 and (c.home_expected or c.away_expected))
  where parent.stage_id=v_stage and parent.round_number>1;
  for v_row in select id,winner_registration_id from public.tournament_matches
    where stage_id=v_stage and round_number=1 and status='completed' and winner_registration_id is not null
  loop
    perform private.advance_match_winner(v_row.id,v_row.winner_registration_id);
  end loop;
  update public.tournament_stages set status='published' where id=v_stage;
  perform private.write_audit_event('PLAYOFF_STAGE_GENERATED','tournament_stage',v_stage,
    jsonb_build_object('tournament_id',p_tournament_id,'qualifier_count',v_count));
  return v_stage;
end;
$function$
