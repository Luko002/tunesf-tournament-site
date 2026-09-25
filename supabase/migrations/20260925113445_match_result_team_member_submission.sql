-- Permit any active member of a participating team to attach evidence and report its score.
create or replace function private.can_submit_match_evidence(p_match_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.tournament_matches m
    join public.tournament_stages s on s.id=m.stage_id
    join public.tournaments t on t.id=s.tournament_id
    left join public.tournament_registrations h on h.id=m.home_registration_id
    left join public.tournament_registrations a on a.id=m.away_registration_id
    where m.id=p_match_id and m.status in ('live','result_pending')
      and (private.is_team_member(h.team_id) or private.is_team_member(a.team_id))
      and exists(select 1 from public.match_roster_confirmations c where c.match_id=m.id and c.team_id=h.team_id)
      and exists(select 1 from public.match_roster_confirmations c where c.match_id=m.id and c.team_id=a.team_id)
      and (cardinality(coalesce(t.map_pool,'{}'::text[]))<2 or exists(
        select 1 from public.match_map_vetoes v where v.match_id=m.id and v.action_type='decider'
          and (lower(t.game)<>'val' or v.side_choice is not null)))
  );
$$;

revoke all on function private.can_submit_match_evidence(uuid) from public,anon,authenticated;
grant execute on function private.can_submit_match_evidence(uuid) to authenticated;

create or replace function public.submit_match_result(
  p_match_id uuid,p_home_score smallint,p_away_score smallint,p_evidence_object_keys text[] default '{}'
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_match public.tournament_matches%rowtype; v_stage public.tournament_stages%rowtype;
  v_tournament public.tournaments%rowtype; v_home_team uuid; v_away_team uuid;
  v_registration uuid; v_needed integer; v_id uuid; v_key text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_match from public.tournament_matches where id=p_match_id for update;
  if not found then raise exception 'Match not found'; end if;
  select * into v_stage from public.tournament_stages where id=v_match.stage_id;
  select team_id into v_home_team from public.tournament_registrations where id=v_match.home_registration_id;
  select team_id into v_away_team from public.tournament_registrations where id=v_match.away_registration_id;
  if private.is_team_member(v_home_team) then v_registration:=v_match.home_registration_id;
  elsif private.is_team_member(v_away_team) then v_registration:=v_match.away_registration_id;
  else raise exception 'Only an active player or captain from a participating team may submit a result'; end if;
  if v_match.status not in ('live','result_pending') then raise exception 'Match is not accepting results'; end if;
  if not exists(select 1 from public.match_roster_confirmations c where c.match_id=p_match_id and c.team_id=v_home_team)
     or not exists(select 1 from public.match_roster_confirmations c where c.match_id=p_match_id and c.team_id=v_away_team) then
    raise exception 'Both team captains must confirm their rosters before results can be submitted';
  end if;
  select * into v_tournament from public.tournaments where id=v_stage.tournament_id;
  if cardinality(coalesce(v_tournament.map_pool,'{}'::text[]))>=2 and not exists(
      select 1 from public.match_map_vetoes v where v.match_id=p_match_id and v.action_type='decider'
        and (lower(v_tournament.game)<>'val' or v.side_choice is not null)) then
    raise exception 'Complete the map veto before submitting a result';
  end if;
  if p_home_score is null or p_away_score is null or p_home_score<0 or p_away_score<0 or p_home_score=p_away_score then
    raise exception 'Invalid score';
  end if;
  v_needed:=case v_tournament.best_of when 'BO1' then 1 when 'BO3' then 2 when 'BO5' then 3 when 'BO7' then 4 else 2 end;
  if greatest(p_home_score,p_away_score)<>v_needed or least(p_home_score,p_away_score)>=v_needed then
    raise exception 'Score does not match the configured best-of format';
  end if;
  if cardinality(coalesce(p_evidence_object_keys,'{}'))>5 then raise exception 'Evidence limit is five files'; end if;
  if exists(select 1 from public.match_result_submissions where match_id=p_match_id and registration_id=v_registration
      and status in ('pending','accepted')) then
    raise exception 'This team already has a pending or accepted result';
  end if;
  insert into public.match_result_submissions(tournament_id,match_id,submitted_by,registration_id,home_score,away_score)
    values(v_stage.tournament_id,p_match_id,auth.uid(),v_registration,p_home_score,p_away_score) returning id into v_id;
  foreach v_key in array coalesce(p_evidence_object_keys,'{}') loop
    if v_key !~ ('^'||p_match_id::text||'/'||auth.uid()::text||'/[A-Za-z0-9._-]{1,180}$')
       or not exists(select 1 from storage.objects o where o.bucket_id='match-evidence' and o.name=v_key
          and o.owner_id=auth.uid()::text and (o.metadata->>'size')::bigint between 1 and 20971520
          and o.metadata->>'mimetype' in ('image/jpeg','image/png','image/webp','video/mp4')) then
      raise exception 'Evidence file is missing, oversized, or outside this match';
    end if;
    insert into public.match_evidence(tournament_id,match_id,submitted_by,object_key,mime_type,byte_size)
      select v_stage.tournament_id,p_match_id,auth.uid(),v_key,o.metadata->>'mimetype',(o.metadata->>'size')::bigint
        from storage.objects o where o.bucket_id='match-evidence' and o.name=v_key;
  end loop;
  update public.tournament_matches set status='result_pending',updated_at=now() where id=p_match_id;
  if exists(select 1 from public.match_result_submissions s where s.match_id=p_match_id
      and s.registration_id<>v_registration and s.status='pending'
      and (s.home_score<>p_home_score or s.away_score<>p_away_score)) then
    update public.tournament_matches set status='disputed',updated_at=now() where id=p_match_id;
    insert into public.match_disputes(tournament_id,match_id,opened_by,registration_id,reason)
      values(v_stage.tournament_id,p_match_id,auth.uid(),v_registration,'Conflicting team result submissions require an official decision');
  end if;
  perform private.write_audit_event('MATCH_RESULT_SUBMITTED','match',p_match_id,
    jsonb_build_object('submission_id',v_id,'registration_id',v_registration,'evidence_count',cardinality(coalesce(p_evidence_object_keys,'{}'))));
  return v_id;
end;
$$;

revoke all on function public.submit_match_result(uuid,smallint,smallint,text[]) from public,anon,authenticated;
grant execute on function public.submit_match_result(uuid,smallint,smallint,text[]) to authenticated;
