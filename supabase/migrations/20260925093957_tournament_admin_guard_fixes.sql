-- Keep the operations page scoped to tournaments the signed-in organizer manages.
create or replace function public.list_my_tournament_operations()
returns table(id uuid,name text,game text,format text,status text,starts_at timestamptz,
  registration_closes_at timestamptz,max_teams integer)
language sql stable security definer set search_path = ''
as $$
  select t.id,t.name,t.game,t.format,t.status,t.starts_at,t.registration_closes_at,t.max_teams
  from public.tournaments t
  where auth.uid() is not null and private.can_manage_tournament(t.id,'manage_tournament')
  order by t.created_at desc limit 100;
$$;

create or replace function public.set_tournament_referee(p_tournament_id uuid,p_user_id uuid default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_capabilities text[];
begin
  if auth.uid() is null or not private.can_manage_tournament(p_tournament_id,'manage_tournament') then
    raise exception 'Tournament management capability required';
  end if;
  if p_user_id is not null and not exists(select 1 from public.user_roles
      where user_id=p_user_id and role_key='REFEREE')
     and not exists(select 1 from public.tournament_staff where tournament_id=p_tournament_id
       and user_id=p_user_id and 'referee'=any(capabilities)) then raise exception 'Select an account with the referee role'; end if;
  delete from public.tournament_staff ts where ts.tournament_id=p_tournament_id
    and 'referee'=any(ts.capabilities) and ts.user_id is distinct from p_user_id
    and cardinality(array_remove(ts.capabilities,'referee'))=0;
  update public.tournament_staff ts set capabilities=array_remove(ts.capabilities,'referee')
    where ts.tournament_id=p_tournament_id and 'referee'=any(ts.capabilities)
      and ts.user_id is distinct from p_user_id and cardinality(array_remove(ts.capabilities,'referee'))>0;
  if p_user_id is not null then
    select capabilities into v_capabilities from public.tournament_staff
      where tournament_id=p_tournament_id and user_id=p_user_id;
    v_capabilities:=case when 'referee'=any(coalesce(v_capabilities,'{}'::text[]))
      then coalesce(v_capabilities,'{}'::text[]) else array_append(coalesce(v_capabilities,'{}'::text[]),'referee') end;
    insert into public.tournament_staff(tournament_id,user_id,capabilities,assigned_by)
      values(p_tournament_id,p_user_id,v_capabilities,auth.uid())
    on conflict(tournament_id,user_id) do update set capabilities=excluded.capabilities,assigned_by=excluded.assigned_by;
  end if;
  perform private.write_audit_event(case when p_user_id is null then 'TOURNAMENT_REFEREE_REMOVED' else 'TOURNAMENT_REFEREE_ASSIGNED' end,
    'tournament',p_tournament_id,jsonb_build_object('user_id',p_user_id));
end;
$$;

create or replace function public.resolve_match_dispute(p_dispute_id uuid,p_outcome text,p_note text default '')
returns void language plpgsql security definer set search_path = ''
as $$
declare v_dispute public.match_disputes%rowtype; v_match public.tournament_matches%rowtype;
  v_stage public.tournament_stages%rowtype; v_tournament_id uuid; v_winner uuid;
  v_selected public.match_result_submissions%rowtype; v_selected_registration uuid;
begin
  if auth.uid() is null or p_outcome not in ('uphold','replay','forfeit_home','forfeit_away','accept_home','accept_away') then raise exception 'Invalid dispute outcome'; end if;
  select * into v_dispute from public.match_disputes where id=p_dispute_id for update;
  if not found or v_dispute.status not in ('open','under_review') then raise exception 'Dispute already resolved'; end if;
  select * into v_match from public.tournament_matches where id=v_dispute.match_id for update;
  select * into v_stage from public.tournament_stages where id=v_match.stage_id;
  v_tournament_id:=v_stage.tournament_id;
  if not private.can_manage_tournament(v_tournament_id,'disputes')
     and not private.is_tournament_referee(v_tournament_id)
     and not exists(select 1 from public.match_officials o where o.match_id=v_match.id and o.user_id=auth.uid()) then
    raise exception 'Assigned match official or dispute resolver required';
  end if;
  if exists(select 1 from public.tournament_registrations r join public.team_members tm on tm.team_id=r.team_id
      where r.id in (v_match.home_registration_id,v_match.away_registration_id)
        and tm.user_id=auth.uid() and tm.status='active') then raise exception 'A participant cannot resolve a match dispute'; end if;
  if p_outcome<>'uphold' and exists(select 1 from public.tournament_matches downstream
      where downstream.stage_id=v_match.stage_id and downstream.round_number>v_match.round_number
        and downstream.status not in ('pending','ready')) then
    raise exception 'A downstream match has started; bracket correction is locked';
  end if;
  if p_outcome in ('accept_home','accept_away') then
    v_selected_registration:=case when p_outcome='accept_home' then v_match.home_registration_id else v_match.away_registration_id end;
    perform 1 from public.match_result_submissions where match_id=v_match.id for update;
    select * into v_selected from public.match_result_submissions
      where match_id=v_match.id and registration_id=v_selected_registration and status in ('pending','accepted')
      order by created_at desc,id desc limit 1;
    if not found then raise exception 'The selected side has no eligible score submission'; end if;
    update public.match_result_submissions set status='rejected',reviewed_by=auth.uid(),
      review_note='Not selected by dispute resolution',reviewed_at=now()
      where match_id=v_match.id and id<>v_selected.id and status in ('pending','accepted');
    update public.match_result_submissions set status='accepted',reviewed_by=auth.uid(),
      review_note='Selected by dispute resolution',reviewed_at=now() where id=v_selected.id;
    v_match.home_score:=v_selected.home_score;
    v_match.away_score:=v_selected.away_score;
    if v_match.home_score=v_match.away_score then raise exception 'A tie cannot decide this match'; end if;
    v_winner:=case when v_match.home_score>v_match.away_score then v_match.home_registration_id else v_match.away_registration_id end;
    update public.tournament_matches set status='completed',winner_registration_id=v_winner,
      home_score=v_match.home_score,away_score=v_match.away_score,completed_at=now(),updated_at=now() where id=v_match.id;
    perform private.advance_match_winner(v_match.id,v_winner);
  elsif p_outcome='replay' then
    update public.match_result_submissions set status='rejected',reviewed_by=auth.uid(),review_note='Replay ordered',reviewed_at=now()
      where match_id=v_match.id and status in ('pending','accepted');
    update public.tournament_matches set status='ready',winner_registration_id=null,home_score=null,away_score=null,completed_at=null,updated_at=now()
      where id=v_match.id;
  elsif p_outcome in ('forfeit_home','forfeit_away') then
    v_winner:=case when p_outcome='forfeit_home' then v_match.away_registration_id else v_match.home_registration_id end;
    update public.tournament_matches set status='forfeit',winner_registration_id=v_winner,completed_at=now(),updated_at=now()
      where id=v_match.id;
    perform private.advance_match_winner(v_match.id,v_winner);
  elsif v_match.winner_registration_id is not null then
    update public.tournament_matches set status='completed',updated_at=now() where id=v_match.id;
  else
    raise exception 'Cannot uphold a result that has not been decided';
  end if;
  update public.match_disputes set status='resolved',outcome=p_outcome,resolution_note=left(coalesce(p_note,''),3000),
    resolved_by=auth.uid(),resolved_at=now() where id=p_dispute_id;
  if v_stage.format='round_robin' and p_outcome in ('forfeit_home','forfeit_away','accept_home','accept_away') then perform private.rebuild_standings(v_stage.id); end if;
  perform private.write_audit_event('MATCH_DISPUTE_RESOLVED','match_dispute',p_dispute_id,
    jsonb_build_object('match_id',v_match.id,'outcome',p_outcome));
end;
$$;

revoke all on function public.list_my_tournament_operations() from public,anon;
grant execute on function public.list_my_tournament_operations() to authenticated;
