CREATE OR REPLACE FUNCTION public.generate_bracket(p_tournament_id uuid, p_seeded_registration_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_t public.tournaments%rowtype; v_stage uuid; v_format text; v_ids uuid[]; v_count integer;
  v_slots integer:=1; v_rounds integer:=0; v_round integer; v_pos integer; v_half integer;
  v_seed_order integer[]; v_seed_order_next integer[]; v_seed_count integer;
  v_lower_round integer; v_lower_rounds integer; v_lower_count integer; v_this_match uuid;
  v_home uuid; v_away uuid; v_winner uuid; v_parent uuid; v_parent_pos integer;
  v_row record;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_t from public.tournaments where id=p_tournament_id for update;
  if not found or not private.can_manage_tournament(p_tournament_id,'bracket') then
    raise exception 'Tournament bracket capability required';
  end if;
  if v_t.status <> 'registration_closed' then raise exception 'Close registration before generating a bracket'; end if;
  if exists(select 1 from public.tournament_stages where tournament_id=p_tournament_id and status <> 'draft') then
    raise exception 'A published stage already exists';
  end if;
  select array_agg(id order by created_at,id) into v_ids from public.tournament_registrations
    where tournament_id=p_tournament_id and status in ('approved','checked_in');
  v_ids:=coalesce(v_ids,'{}');
  v_count:=cardinality(v_ids);
  if v_count < 2 then raise exception 'At least two eligible registrations are required'; end if;
  if p_seeded_registration_ids is not null then
    if cardinality(p_seeded_registration_ids) <> v_count
       or cardinality(array(select distinct unnest(p_seeded_registration_ids))) <> v_count
       or exists(select unnest(v_ids) except select unnest(p_seeded_registration_ids))
       or exists(select unnest(p_seeded_registration_ids) except select unnest(v_ids)) then
      raise exception 'Seeds must contain every eligible registration exactly once';
    end if;
    v_ids:=p_seeded_registration_ids;
  end if;
  if v_t.format in ('round_robin','round_robin_playoffs') then
    v_format:='round_robin';
  elsif v_t.format='double_elimination' then
    v_format:='double_elimination';
  elsif v_t.format='single_elimination' then
    v_format:='single_elimination';
  else
    raise exception 'Unsupported tournament format: %',v_t.format;
  end if;
  insert into public.tournament_stages(tournament_id,stage_number,name,format,status,created_by)
    values(p_tournament_id,1,case when v_t.format='round_robin_playoffs' then 'Round Robin' else 'Main Stage' end,v_format,'draft',auth.uid()) returning id into v_stage;
  if v_format='double_elimination' then
    while v_slots < v_count loop
      v_slots:=v_slots*2;
      v_rounds:=v_rounds+1;
    end loop;
    v_lower_rounds:=2*(v_rounds-1);
    for v_round in 1..v_rounds loop
      for v_pos in 1..(v_slots/power(2,v_round)::integer) loop
        insert into public.tournament_matches(tournament_id,stage_id,bracket_side,round_number,position,status,home_expected,away_expected)
          values(p_tournament_id,v_stage,'winners',v_round,v_pos,'pending',true,true);
      end loop;
    end loop;
    for v_lower_round in 1..v_lower_rounds loop
      v_lower_count:=v_slots/power(2,((v_lower_round+1)/2)::integer+1)::integer;
      for v_pos in 1..v_lower_count loop
        insert into public.tournament_matches(tournament_id,stage_id,bracket_side,round_number,position,status,home_expected,away_expected)
          values(p_tournament_id,v_stage,'losers',v_lower_round,v_pos,'pending',true,true);
      end loop;
    end loop;
    insert into public.tournament_matches(tournament_id,stage_id,bracket_side,round_number,position,status,home_expected,away_expected)
      values(p_tournament_id,v_stage,'grand_final',1,1,'pending',true,true),
            (p_tournament_id,v_stage,'grand_final',1,2,'pending',true,true);
    -- Place seeds in a standard mirrored bracket so odd fields receive real byes.
    v_seed_order:=array[1,2]; v_seed_count:=2;
    while v_seed_count<v_slots loop
      v_seed_order_next:='{}';
      for v_half in 1..v_seed_count loop
        v_seed_order_next:=array_append(v_seed_order_next,v_seed_order[v_half]);
        v_seed_order_next:=array_append(v_seed_order_next,2*v_seed_count+1-v_seed_order[v_half]);
      end loop;
      v_seed_order:=v_seed_order_next; v_seed_count:=v_seed_count*2;
    end loop;
    for v_pos in 1..(v_slots/2) loop
      v_home:=v_ids[v_seed_order[(v_pos*2)-1]]; v_away:=v_ids[v_seed_order[v_pos*2]];
      v_winner:=case when v_home is null then v_away when v_away is null then v_home else null end;
      update public.tournament_matches set home_registration_id=v_home,away_registration_id=v_away,
        home_expected=(v_home is not null),away_expected=(v_away is not null),winner_registration_id=v_winner,
        status=case when v_home is null and v_away is null then 'cancelled' when v_winner is not null then 'completed' else 'ready' end,
        completed_at=case when v_winner is null then null else now() end
      where stage_id=v_stage and bracket_side='winners' and round_number=1 and position=v_pos;
    end loop;
    update public.tournament_matches w set winner_to_match_id=n.id,
      winner_to_slot=case when w.position%2=1 then 'home' else 'away' end
      from public.tournament_matches n
      where w.stage_id=v_stage and n.stage_id=v_stage and w.bracket_side='winners'
        and w.round_number<v_rounds and n.bracket_side='winners'
        and n.round_number=w.round_number+1 and n.position=(w.position+1)/2;
    update public.tournament_matches w set loser_to_match_id=l.id,
      loser_to_slot=case when w.round_number=1 then case when w.position%2=1 then 'home' else 'away' end else 'home' end
      from public.tournament_matches l
      where w.stage_id=v_stage and l.stage_id=v_stage and w.bracket_side='winners'
        and ((w.round_number=1 and l.bracket_side='losers' and l.round_number=1 and l.position=(w.position+1)/2)
          or (w.round_number>1 and w.round_number<v_rounds and l.bracket_side='losers'
              and l.round_number=2*w.round_number-2 and l.position=w.position));
    update public.tournament_matches w set winner_to_match_id=g.id,winner_to_slot='home'
      from public.tournament_matches g
      where w.stage_id=v_stage and w.bracket_side='winners' and w.round_number=v_rounds
        and g.stage_id=v_stage and g.bracket_side='grand_final' and g.position=1;
    if v_lower_rounds=0 then
      update public.tournament_matches w set loser_to_match_id=g.id,loser_to_slot='away'
        from public.tournament_matches g
        where w.stage_id=v_stage and w.bracket_side='winners' and w.round_number=v_rounds and g.stage_id=v_stage and g.bracket_side='grand_final' and g.position=1;
    else
      update public.tournament_matches w set loser_to_match_id=l.id,loser_to_slot='home'
        from public.tournament_matches l
        where w.stage_id=v_stage and w.bracket_side='winners' and w.round_number=v_rounds and l.stage_id=v_stage and l.bracket_side='losers' and l.round_number=v_lower_rounds and l.position=1;
    end if;
    for v_lower_round in 1..v_lower_rounds loop
      if v_lower_round=v_lower_rounds then
        update public.tournament_matches l set winner_to_match_id=g.id,winner_to_slot='away'
          from public.tournament_matches g
          where l.stage_id=v_stage and l.bracket_side='losers' and l.round_number=v_lower_round
            and g.stage_id=v_stage and g.bracket_side='grand_final' and g.position=1;
      elsif v_lower_round%2=1 then
        update public.tournament_matches l set winner_to_match_id=n.id,winner_to_slot='away'
          from public.tournament_matches n
          where l.stage_id=v_stage and l.bracket_side='losers' and l.round_number=v_lower_round
            and n.stage_id=v_stage and n.bracket_side='losers' and n.round_number=v_lower_round+1 and n.position=l.position;
      else
        update public.tournament_matches l set winner_to_match_id=n.id,
          winner_to_slot=case when l.position%2=1 then 'home' else 'away' end
          from public.tournament_matches n
          where l.stage_id=v_stage and l.bracket_side='losers' and l.round_number=v_lower_round
            and n.stage_id=v_stage and n.bracket_side='losers' and n.round_number=v_lower_round+1 and n.position=(l.position+1)/2;
      end if;
    end loop;
    -- Mark possible entrants through both brackets before resolving any byes.
    for v_round in 2..v_rounds loop
      update public.tournament_matches parent set
        home_expected=exists(select 1 from public.tournament_matches c where c.stage_id=v_stage and c.bracket_side='winners' and c.round_number=parent.round_number-1 and c.position=parent.position*2-1 and (c.home_expected or c.away_expected)),
        away_expected=exists(select 1 from public.tournament_matches c where c.stage_id=v_stage and c.bracket_side='winners' and c.round_number=parent.round_number-1 and c.position=parent.position*2 and (c.home_expected or c.away_expected)),
        status=case when exists(select 1 from public.tournament_matches c where c.stage_id=v_stage and c.bracket_side='winners' and c.round_number=parent.round_number-1 and (c.position=parent.position*2-1 or c.position=parent.position*2) and (c.home_expected or c.away_expected)) then 'pending' else 'cancelled' end
      where parent.stage_id=v_stage and parent.bracket_side='winners' and parent.round_number=v_round;
    end loop;
    update public.tournament_matches l set
      home_expected=exists(select 1 from public.tournament_matches w where w.stage_id=v_stage and w.bracket_side='winners' and w.round_number=1 and w.position=l.position*2-1 and w.home_expected and w.away_expected),
      away_expected=exists(select 1 from public.tournament_matches w where w.stage_id=v_stage and w.bracket_side='winners' and w.round_number=1 and w.position=l.position*2 and w.home_expected and w.away_expected)
    where l.stage_id=v_stage and l.bracket_side='losers' and l.round_number=1;
    for v_lower_round in 2..v_lower_rounds loop
      if v_lower_round%2=0 then
        update public.tournament_matches l set
          home_expected=exists(select 1 from public.tournament_matches w where w.stage_id=v_stage and w.bracket_side='winners' and w.round_number=(v_lower_round+2)/2 and w.position=l.position and w.home_expected and w.away_expected),
          away_expected=exists(select 1 from public.tournament_matches p where p.stage_id=v_stage and p.bracket_side='losers' and p.round_number=l.round_number-1 and p.position=l.position and (p.home_expected or p.away_expected))
        where l.stage_id=v_stage and l.bracket_side='losers' and l.round_number=v_lower_round;
      else
        update public.tournament_matches l set
          home_expected=exists(select 1 from public.tournament_matches p where p.stage_id=v_stage and p.bracket_side='losers' and p.round_number=l.round_number-1 and p.position=l.position*2-1 and (p.home_expected or p.away_expected)),
          away_expected=exists(select 1 from public.tournament_matches p where p.stage_id=v_stage and p.bracket_side='losers' and p.round_number=l.round_number-1 and p.position=l.position*2 and (p.home_expected or p.away_expected))
        where l.stage_id=v_stage and l.bracket_side='losers' and l.round_number=v_lower_round;
      end if;
    end loop;
    update public.tournament_matches l set status=case when l.home_expected or l.away_expected then 'pending' else 'cancelled' end where l.stage_id=v_stage and l.bracket_side='losers';
    update public.tournament_matches g set
      home_expected=exists(select 1 from public.tournament_matches w where w.stage_id=v_stage and w.bracket_side='winners' and w.round_number=v_rounds and (w.home_expected or w.away_expected)),
      away_expected=case when v_lower_rounds=0 then exists(select 1 from public.tournament_matches w where w.stage_id=v_stage and w.bracket_side='winners' and w.round_number=v_rounds and w.home_expected and w.away_expected)
        else exists(select 1 from public.tournament_matches l where l.stage_id=v_stage and l.bracket_side='losers' and l.round_number=v_lower_rounds and (l.home_expected or l.away_expected)) end
    where g.stage_id=v_stage and g.bracket_side='grand_final' and g.position=1;
    for v_row in select id,winner_registration_id from public.tournament_matches where stage_id=v_stage and bracket_side='winners' and round_number=1 and status='completed' and winner_registration_id is not null
    loop perform private.advance_match_winner(v_row.id,v_row.winner_registration_id); end loop;
  elsif v_format='round_robin' then
    v_pos:=0;
    for v_round in 1..v_count loop
      for v_half in (v_round+1)..v_count loop
        v_pos:=v_pos+1;
        insert into public.tournament_matches(tournament_id,stage_id,round_number,position,home_registration_id,away_registration_id,status)
          values(p_tournament_id,v_stage,1,v_pos,v_ids[v_round],v_ids[v_half],'ready');
      end loop;
    end loop;
  else
    while v_slots < v_count loop v_slots:=v_slots*2; v_rounds:=v_rounds+1; end loop;
    if v_slots=v_count then v_rounds:=0; while v_slots>1 loop v_slots:=v_slots/2; v_rounds:=v_rounds+1; end loop; v_slots:=power(2,v_rounds)::integer; end if;
    if v_rounds=0 then v_rounds:=1; v_slots:=2; end if;
    for v_round in 1..v_rounds loop
      for v_pos in 1..(v_slots / power(2,v_round)::integer) loop
        insert into public.tournament_matches(tournament_id,stage_id,round_number,position,status)
          values(p_tournament_id,v_stage,v_round,v_pos,'pending');
      end loop;
    end loop;
    v_half:=v_slots/2;
    for v_pos in 1..v_half loop
      v_home:=v_ids[v_pos];
      v_away:=v_ids[v_pos+v_half];
      if v_home is null and v_away is null then continue; end if;
      v_winner:=case when v_home is null then v_away when v_away is null then v_home else null end;
      update public.tournament_matches set home_registration_id=v_home,away_registration_id=v_away,
        home_expected=(v_home is not null),away_expected=(v_away is not null),
        winner_registration_id=v_winner,status=case when v_winner is null then 'ready' else 'completed' end,
        completed_at=case when v_winner is null then null else now() end
      where stage_id=v_stage and round_number=1 and position=v_pos;
    end loop;
    update public.tournament_matches child set
      winner_to_match_id=parent.id,
      winner_to_slot=case when child.position%2=1 then 'home' else 'away' end
    from public.tournament_matches parent
    where child.stage_id=v_stage and parent.stage_id=v_stage
      and child.round_number< v_rounds
      and parent.round_number=child.round_number+1
      and parent.position=(child.position+1)/2;
    update public.tournament_matches parent set
      home_expected=exists(select 1 from public.tournament_matches c where c.stage_id=v_stage
        and c.round_number=parent.round_number-1 and c.position=parent.position*2-1
        and (c.home_expected or c.away_expected)),
      away_expected=exists(select 1 from public.tournament_matches c where c.stage_id=v_stage
        and c.round_number=parent.round_number-1 and c.position=parent.position*2
        and (c.home_expected or c.away_expected))
    where parent.stage_id=v_stage and parent.round_number>1;
    for v_row in select id,winner_registration_id from public.tournament_matches
      where stage_id=v_stage and round_number=1 and status='completed' and winner_registration_id is not null
    loop
      perform private.advance_match_winner(v_row.id,v_row.winner_registration_id);
    end loop;
  end if;
  update public.tournament_stages set status='published' where id=v_stage;
  perform private.write_audit_event('BRACKET_GENERATED','tournament_stage',v_stage,
    jsonb_build_object('tournament_id',p_tournament_id,'format',v_format,'registration_count',v_count));
  return v_stage;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.advance_match_winner(p_match_id uuid, p_winner_registration_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_match public.tournament_matches%rowtype; v_stage public.tournament_stages%rowtype;
  v_parent_id uuid; v_loser_parent_id uuid; v_slot text; v_next_status text; v_loser uuid;
  v_loser_match public.tournament_matches%rowtype;
begin
  select * into v_match from public.tournament_matches where id=p_match_id;
  select * into v_stage from public.tournament_stages where id=v_match.stage_id;
  if v_stage.format='double_elimination' and v_match.bracket_side='grand_final' and v_match.position=1 then
    if p_winner_registration_id=v_match.home_registration_id then
      update public.tournament_matches set status='cancelled',updated_at=now()
        where stage_id=v_match.stage_id and bracket_side='grand_final' and position=2;
      update public.tournament_stages set status='completed' where id=v_stage.id;
    else
      update public.tournament_matches set home_registration_id=v_match.home_registration_id,
        away_registration_id=v_match.away_registration_id,home_expected=true,away_expected=true,
        status='ready',updated_at=now()
        where stage_id=v_match.stage_id and bracket_side='grand_final' and position=2;
    end if;
    return;
  end if;
  if v_match.winner_to_match_id is not null then
    v_parent_id:=v_match.winner_to_match_id;
    v_slot:=v_match.winner_to_slot;
    v_loser:=case when p_winner_registration_id=v_match.home_registration_id then v_match.away_registration_id else v_match.home_registration_id end;
    if v_match.loser_to_match_id is not null and v_loser is not null then
      v_loser_parent_id:=v_match.loser_to_match_id;
      update public.tournament_matches set
        home_registration_id=case when v_match.loser_to_slot='home' then v_loser else home_registration_id end,
        away_registration_id=case when v_match.loser_to_slot='away' then v_loser else away_registration_id end
      where id=v_match.loser_to_match_id;
      update public.tournament_matches set status='ready',updated_at=now()
        where id=v_loser_parent_id and home_registration_id is not null and away_registration_id is not null and status='pending';
      select * into v_loser_match from public.tournament_matches where id=v_loser_parent_id;
      if v_loser_match.status='pending' and v_loser_match.home_registration_id is not null and not v_loser_match.away_expected then
        update public.tournament_matches set status='completed',winner_registration_id=v_loser_match.home_registration_id,completed_at=now(),updated_at=now() where id=v_loser_parent_id;
        perform private.advance_match_winner(v_loser_parent_id,v_loser_match.home_registration_id);
      elsif v_loser_match.status='pending' and v_loser_match.away_registration_id is not null and not v_loser_match.home_expected then
        update public.tournament_matches set status='completed',winner_registration_id=v_loser_match.away_registration_id,completed_at=now(),updated_at=now() where id=v_loser_parent_id;
        perform private.advance_match_winner(v_loser_parent_id,v_loser_match.away_registration_id);
      end if;
    end if;
    update public.tournament_matches set
      home_registration_id=case when v_slot='home' then p_winner_registration_id else home_registration_id end,
      away_registration_id=case when v_slot='away' then p_winner_registration_id else away_registration_id end
    where id=v_parent_id;
  elsif v_stage.format='single_elimination' then
    select id into v_parent_id from public.tournament_matches
      where stage_id=v_match.stage_id and round_number=v_match.round_number+1 and position=(v_match.position+1)/2;
    v_slot:=case when v_match.position%2=1 then 'home' else 'away' end;
    if v_parent_id is not null then
      update public.tournament_matches set
        home_registration_id=case when v_slot='home' then p_winner_registration_id else home_registration_id end,
        away_registration_id=case when v_slot='away' then p_winner_registration_id else away_registration_id end
      where id=v_parent_id;
    end if;
  end if;
  if v_parent_id is null then
    update public.tournament_stages set status='completed' where id=v_stage.id
      and not exists(select 1 from public.tournament_matches where stage_id=v_stage.id and status not in ('completed','forfeit','cancelled'));
    return;
  end if;
  select case
    when home_registration_id is not null and away_registration_id is not null then 'ready'
    when home_registration_id is not null and not away_expected then 'completed'
    when away_registration_id is not null and not home_expected then 'completed'
    else 'pending' end
    into v_next_status from public.tournament_matches where id=v_parent_id;
  if v_next_status='completed' then
    update public.tournament_matches set status='completed',winner_registration_id=coalesce(home_registration_id,away_registration_id),completed_at=now(),updated_at=now()
      where id=v_parent_id;
    perform private.advance_match_winner(v_parent_id,coalesce((select home_registration_id from public.tournament_matches where id=v_parent_id),(select away_registration_id from public.tournament_matches where id=v_parent_id)));
  else
    update public.tournament_matches set status=v_next_status,updated_at=now() where id=v_parent_id;
  end if;
end;
$function$
;



