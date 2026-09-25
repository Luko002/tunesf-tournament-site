-- Match operations shared by scoped tournament admins and assigned referees.
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

create or replace function public.record_official_match_result(
  p_match_id uuid,p_home_score smallint,p_away_score smallint,p_reason text
)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_match public.tournament_matches%rowtype; v_stage public.tournament_stages%rowtype;
  v_game text; v_map_pool text[]; v_best_of text; v_needed integer; v_winner uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_match from public.tournament_matches where id=p_match_id for update;
  if v_match.id is null then raise exception 'Match not found'; end if;
  select * into v_stage from public.tournament_stages where id=v_match.stage_id;
  if not private.can_manage_tournament(v_match.tournament_id,'manage_tournament')
     and not private.is_tournament_referee(v_match.tournament_id)
     and not exists(select 1 from public.match_officials o where o.match_id=p_match_id and o.user_id=auth.uid()) then
    raise exception 'Assigned referee or tournament manager required';
  end if;
  if not private.is_super_admin() and exists (
    select 1 from public.tournament_registrations r join public.team_members tm
      on tm.team_id=r.team_id and tm.user_id=auth.uid() and tm.status='active'
    where r.id in (v_match.home_registration_id,v_match.away_registration_id)) then
    raise exception 'A participant cannot set an official match result';
  end if;
  if v_match.home_registration_id is null or v_match.away_registration_id is null
     or v_match.status not in ('ready','live','paused','result_pending','completed') then
    raise exception 'This match cannot receive an official result';
  end if;
  if length(btrim(coalesce(p_reason,''))) not between 5 and 500 then
    raise exception 'Give a reason of 5 to 500 characters for the audit trail';
  end if;
  select t.game,t.map_pool,t.best_of into v_game,v_map_pool,v_best_of
    from public.tournaments t where t.id=v_match.tournament_id;
  v_needed:=case v_best_of when 'BO1' then 1 when 'BO3' then 2
    when 'BO5' then 3 when 'BO7' then 4 else 2 end;
  if p_home_score is null or p_away_score is null or p_home_score<0 or p_away_score<0
     or greatest(p_home_score,p_away_score)<>v_needed
     or least(p_home_score,p_away_score)>=v_needed then
    raise exception 'Score must decide the configured best-of series';
  end if;
  v_winner:=case when p_home_score>p_away_score then v_match.home_registration_id
    else v_match.away_registration_id end;
  if v_match.status='completed' and v_match.winner_registration_id is distinct from v_winner
     and v_stage.format<>'round_robin' then
    raise exception 'Changing an elimination winner after bracket advancement requires bracket repair';
  end if;
  if v_match.status='ready' then
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
  end if;
  update public.match_result_submissions set status='rejected',reviewed_by=auth.uid(),
    review_note='Superseded by official result',reviewed_at=now()
    where match_id=p_match_id and status in ('pending','accepted');
  update public.tournament_matches set status='completed',home_score=p_home_score,
    away_score=p_away_score,winner_registration_id=v_winner,
    completed_at=coalesce(completed_at,now()),updated_at=now() where id=p_match_id;
  if v_match.status<>'completed' then perform private.advance_match_winner(p_match_id,v_winner); end if;
  if v_stage.format='round_robin' then perform private.rebuild_standings(v_stage.id); end if;
  perform private.write_audit_event('OFFICIAL_MATCH_RESULT_SET','match',p_match_id,
    jsonb_build_object('old_home_score',v_match.home_score,'old_away_score',v_match.away_score,
      'home_score',p_home_score,'away_score',p_away_score,'reason',btrim(p_reason)));
end;
$$;
revoke all on function public.record_official_match_result(uuid,smallint,smallint,text) from public,anon,authenticated;
grant execute on function public.record_official_match_result(uuid,smallint,smallint,text) to authenticated;
