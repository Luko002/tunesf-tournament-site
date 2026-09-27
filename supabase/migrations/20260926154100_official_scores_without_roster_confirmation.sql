-- Authorized tournament staff may record an official result even when one or
-- both captains did not confirm the match roster. Keep the role, participant,
-- score, and audit checks; omit only pre-match checks that depend on captain
-- actions so an official can resolve the result directly.
create or replace function public.record_official_match_result(
  p_match_id uuid,p_home_score smallint,p_away_score smallint,p_reason text
)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_match public.tournament_matches%rowtype; v_stage public.tournament_stages%rowtype;
  v_best_of text; v_needed integer; v_winner uuid;
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
  select t.best_of into v_best_of from public.tournaments t where t.id=v_match.tournament_id;
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
      'home_score',p_home_score,'away_score',p_away_score,'reason',btrim(p_reason),
      'roster_confirmation_bypassed',true));
end;
$$;
revoke all on function public.record_official_match_result(uuid,smallint,smallint,text) from public,anon,authenticated;
grant execute on function public.record_official_match_result(uuid,smallint,smallint,text) to authenticated;
