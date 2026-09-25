-- Admin overrides are separated from match-computed standings so they survive
-- every normal standings rebuild and can be reset without changing match results.
create table public.tournament_standing_overrides (
  stage_id uuid not null references public.tournament_stages(id) on delete cascade,
  registration_id uuid not null references public.tournament_registrations(id) on delete cascade,
  played integer not null check (played between 0 and 1000),
  wins integer not null check (wins between 0 and 1000),
  draws integer not null check (draws between 0 and 1000),
  losses integer not null check (losses between 0 and 1000),
  points integer not null check (points between -10000 and 10000),
  score_for integer not null check (score_for between 0 and 100000),
  score_against integer not null check (score_against between 0 and 100000),
  updated_by uuid not null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  primary key(stage_id,registration_id),
  check (played = wins + draws + losses)
);
alter table public.tournament_standing_overrides enable row level security;
revoke all on public.tournament_standing_overrides from public,anon,authenticated;

create or replace function private.rebuild_standings(p_stage_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.tournament_standings where stage_id=p_stage_id;
  with participants as (
    select home_registration_id as registration_id from public.tournament_matches
      where stage_id=p_stage_id and home_registration_id is not null
    union
    select away_registration_id from public.tournament_matches
      where stage_id=p_stage_id and away_registration_id is not null
  ), outcomes as (
    select home_registration_id registration_id,1 played,
      case when winner_registration_id=home_registration_id then 1 else 0 end wins,0 draws,
      case when winner_registration_id<>home_registration_id then 1 else 0 end losses,
      case when winner_registration_id=home_registration_id then 3 else 0 end points,
      coalesce(home_score,0) score_for,coalesce(away_score,0) score_against
    from public.tournament_matches where stage_id=p_stage_id and status in ('completed','forfeit')
      and home_registration_id is not null and away_registration_id is not null
    union all
    select away_registration_id,1,
      case when winner_registration_id=away_registration_id then 1 else 0 end,0,
      case when winner_registration_id<>away_registration_id then 1 else 0 end,
      case when winner_registration_id=away_registration_id then 3 else 0 end,
      coalesce(away_score,0),coalesce(home_score,0)
    from public.tournament_matches where stage_id=p_stage_id and status in ('completed','forfeit')
      and home_registration_id is not null and away_registration_id is not null
  ), totals as (
    select p.registration_id,coalesce(sum(o.played),0)::integer played,coalesce(sum(o.wins),0)::integer wins,
      coalesce(sum(o.draws),0)::integer draws,coalesce(sum(o.losses),0)::integer losses,
      coalesce(sum(o.points),0)::integer points,coalesce(sum(o.score_for),0)::integer score_for,
      coalesce(sum(o.score_against),0)::integer score_against
    from participants p left join outcomes o using(registration_id) group by p.registration_id
  ), adjusted as (
    select t.registration_id,coalesce(o.played,t.played) played,coalesce(o.wins,t.wins) wins,
      coalesce(o.draws,t.draws) draws,coalesce(o.losses,t.losses) losses,
      coalesce(o.points,t.points) points,coalesce(o.score_for,t.score_for) score_for,
      coalesce(o.score_against,t.score_against) score_against
    from totals t left join public.tournament_standing_overrides o
      on o.stage_id=p_stage_id and o.registration_id=t.registration_id
  ), ranked as (
    select *,dense_rank() over(order by points desc,(score_for-score_against) desc,score_for desc,registration_id)::integer rank
    from adjusted
  )
  insert into public.tournament_standings(stage_id,tournament_id,registration_id,played,wins,draws,losses,points,score_for,score_against,rank)
  select p_stage_id,s.tournament_id,ranked.registration_id,played,wins,draws,losses,points,score_for,score_against,rank
    from ranked cross join public.tournament_stages s where s.id=p_stage_id;
end;
$$;

create or replace function public.set_tournament_standing(
  p_stage_id uuid,p_registration_id uuid,p_played integer,p_wins integer,p_draws integer,
  p_losses integer,p_points integer,p_score_for integer,p_score_against integer
)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_tournament_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select tournament_id into v_tournament_id from public.tournament_stages
    where id=p_stage_id and format='round_robin' for update;
  if v_tournament_id is null or not private.can_manage_tournament(v_tournament_id,'manage_tournament') then
    raise exception 'Tournament management capability required for round-robin standings';
  end if;
  if not exists(select 1 from public.tournament_registrations where id=p_registration_id
       and tournament_id=v_tournament_id and status in ('approved','checked_in')) then
    raise exception 'Team registration does not belong to this tournament';
  end if;
  if p_played is null or p_wins is null or p_draws is null or p_losses is null or p_points is null
     or p_score_for is null or p_score_against is null or p_played<0 or p_played>1000
     or p_wins<0 or p_wins>1000 or p_draws<0 or p_draws>1000 or p_losses<0 or p_losses>1000
     or p_played<>p_wins+p_draws+p_losses or p_points not between -10000 and 10000
     or p_score_for not between 0 and 100000 or p_score_against not between 0 and 100000 then
    raise exception 'Enter valid totals; played must equal wins plus draws plus losses';
  end if;
  insert into public.tournament_standing_overrides(stage_id,registration_id,played,wins,draws,losses,points,score_for,score_against,updated_by)
    values(p_stage_id,p_registration_id,p_played,p_wins,p_draws,p_losses,p_points,p_score_for,p_score_against,auth.uid())
  on conflict(stage_id,registration_id) do update set played=excluded.played,wins=excluded.wins,
    draws=excluded.draws,losses=excluded.losses,points=excluded.points,score_for=excluded.score_for,
    score_against=excluded.score_against,updated_by=excluded.updated_by,updated_at=now();
  perform private.rebuild_standings(p_stage_id);
  perform private.write_audit_event('TOURNAMENT_STANDING_OVERRIDDEN','tournament_stage',p_stage_id,
    jsonb_build_object('registration_id',p_registration_id,'played',p_played,'wins',p_wins,
      'draws',p_draws,'losses',p_losses,'points',p_points,'score_for',p_score_for,'score_against',p_score_against));
end;
$$;

create or replace function public.reset_tournament_standing(p_stage_id uuid,p_registration_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_tournament_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select tournament_id into v_tournament_id from public.tournament_stages
    where id=p_stage_id and format='round_robin' for update;
  if v_tournament_id is null or not private.can_manage_tournament(v_tournament_id,'manage_tournament') then
    raise exception 'Tournament management capability required for round-robin standings';
  end if;
  delete from public.tournament_standing_overrides where stage_id=p_stage_id and registration_id=p_registration_id;
  perform private.rebuild_standings(p_stage_id);
  perform private.write_audit_event('TOURNAMENT_STANDING_OVERRIDE_RESET','tournament_stage',p_stage_id,
    jsonb_build_object('registration_id',p_registration_id));
end;
$$;

create or replace function public.list_tournament_referees(p_tournament_id uuid)
returns table(user_id uuid,username text,player_name text,assigned boolean)
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not private.can_manage_tournament(p_tournament_id,'manage_tournament') then
    raise exception 'Tournament management capability required';
  end if;
  return query
  select p.id,p.username,p.player_name,
    exists(select 1 from public.tournament_staff ts where ts.tournament_id=p_tournament_id
      and ts.user_id=p.id and 'referee'=any(ts.capabilities))
  from public.public_profiles p
  where exists(select 1 from public.user_roles ur where ur.user_id=p.id and ur.role_key='REFEREE')
     or exists(select 1 from public.tournament_staff ts where ts.tournament_id=p_tournament_id
       and ts.user_id=p.id and 'referee'=any(ts.capabilities))
  order by lower(coalesce(p.username,p.player_name,'')),p.id;
end;
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

create or replace function private.is_tournament_referee(p_tournament_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select auth.uid() is not null and exists(select 1 from public.tournament_staff ts
  where ts.tournament_id=p_tournament_id and ts.user_id=auth.uid() and 'referee'=any(ts.capabilities)); $$;

create or replace function public.get_my_roles()
returns table(role_key text,label text,level integer)
language sql stable security invoker set search_path = ''
as $$
  select r.key,r.label,r.level from public.roles r
  where exists(select 1 from public.user_roles ur where ur.user_id=auth.uid() and ur.role_key=r.key)
     or (r.key='CAPTAIN' and exists(select 1 from public.team_members tm
          where tm.user_id=auth.uid() and tm.role='captain' and tm.status='active'))
     or (r.key='ORGANIZATION_OWNER' and exists(select 1 from public.organization_memberships om
          where om.user_id=auth.uid() and om.role='owner'))
     or (r.key='TOURNAMENT_ADMIN' and exists(select 1 from public.tournament_staff ts
          where ts.user_id=auth.uid() and 'manage_tournament'=any(ts.capabilities)))
     or (r.key='REFEREE' and (exists(select 1 from public.match_officials mo where mo.user_id=auth.uid())
          or exists(select 1 from public.tournament_staff ts where ts.user_id=auth.uid() and 'referee'=any(ts.capabilities))))
$$;

create or replace function public.get_my_permissions()
returns setof text language sql stable security invoker set search_path = ''
as $$
  select distinct rp.permission_key from public.user_roles ur
    join public.role_permissions rp on rp.role_key=ur.role_key where ur.user_id=auth.uid()
  union
  select 'PLAYER_ZONE' where exists(select 1 from public.user_roles ur where ur.user_id=auth.uid() and ur.role_key='PLAYER')
  union
  select unnest(array['CAPTAIN_CONSOLE','INVITE_PLAYERS','REGISTER_TOURNAMENT','CHECKIN_TEAM','SUBMIT_RESULT','UPLOAD_EVIDENCE','OPEN_DISPUTE'])
    where exists(select 1 from public.team_members tm where tm.user_id=auth.uid() and tm.role='captain' and tm.status='active')
  union
  select case c when 'create_tournaments' then 'CREATE_TOURNAMENT' when 'manage_staff' then 'MANAGE_STAFF'
    when 'manage_org' then 'MANAGE_ORGANIZATION' when 'manage_teams' then 'INVITE_PLAYERS' when 'manage_prizes' then 'RELEASE_PRIZES' end
  from public.organization_memberships om cross join lateral unnest(om.capabilities) c where om.user_id=auth.uid()
  union
  select case c when 'manage_tournament' then 'MANAGE_SCHEDULE' when 'registrations' then 'CONFIRM_ROSTER'
    when 'bracket' then 'EDIT_BRACKET' when 'schedule' then 'ASSIGN_REFEREES' when 'referee' then 'REFEREE_MATCHES'
    when 'disputes' then 'RESOLVE_DISPUTE' when 'prizes' then 'RELEASE_PRIZES' when 'rosters' then 'CONFIRM_ROSTER' end
  from public.tournament_staff ts cross join lateral unnest(ts.capabilities) c where ts.user_id=auth.uid()
  union
  select case c when 'review_cases' then 'REVIEW_REPORTS' when 'warn_users' then 'WARN_USERS'
    when 'ban_users' then 'BAN_USERS' end
  from public.moderation_staff ms cross join lateral unnest(ms.capabilities) c where ms.user_id=auth.uid()
  union
  select 'REFEREE' where exists(select 1 from public.match_officials mo where mo.user_id=auth.uid())
    or exists(select 1 from public.tournament_staff ts where ts.user_id=auth.uid() and 'referee'=any(ts.capabilities))
  union
  select 'REFEREE_MATCHES' where exists(select 1 from public.match_officials mo where mo.user_id=auth.uid())
    or exists(select 1 from public.tournament_staff ts where ts.user_id=auth.uid() and 'referee'=any(ts.capabilities))
$$;

create or replace function private.can_access_match(p_match_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.tournament_matches m
    left join public.tournament_registrations h on h.id=m.home_registration_id
    left join public.tournament_registrations a on a.id=m.away_registration_id
    where m.id=p_match_id and (
      (h.team_id is not null and private.is_team_member(h.team_id))
      or (a.team_id is not null and private.is_team_member(a.team_id))
      or exists(select 1 from public.match_officials o where o.match_id=m.id and o.user_id=auth.uid())
      or private.is_tournament_referee(m.tournament_id)
      or private.can_manage_tournament(m.tournament_id,'manage_tournament')
    )
  );
$$;

create or replace function public.referee_match(p_match_id uuid,p_action text,p_note text default '')
returns void language plpgsql security definer set search_path = ''
as $$
declare v_match public.tournament_matches%rowtype; v_tournament_id uuid; v_next text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select m.* into v_match from public.tournament_matches m where m.id=p_match_id for update;
  select tournament_id into v_tournament_id from public.tournament_stages where id=v_match.stage_id;
  if v_match.id is null or (not private.is_tournament_referee(v_tournament_id)
     and not exists(select 1 from public.match_officials o where o.match_id=p_match_id and o.user_id=auth.uid())) then
    raise exception 'Assigned match official required';
  end if;
  if p_action='start' and v_match.status='ready' then v_next:='live';
  elsif p_action='pause' and v_match.status='live' then v_next:='paused';
  elsif p_action='resume' and v_match.status='paused' then v_next:='live';
  elsif p_action='cancel' and v_match.status in ('pending','ready') then v_next:='cancelled';
  else raise exception 'Invalid referee action for current match state'; end if;
  update public.tournament_matches set status=v_next,
    started_at=case when v_next='live' and started_at is null then now() else started_at end,updated_at=now()
    where id=p_match_id;
  perform private.write_audit_event('REFEREE_MATCH_ACTION','match',p_match_id,
    jsonb_build_object('action',p_action,'from',v_match.status,'to',v_next));
end;
$$;

create or replace function public.review_match_result(p_submission_id uuid,p_decision text,p_note text default '')
returns void language plpgsql security definer set search_path = ''
as $$
declare v_sub public.match_result_submissions%rowtype; v_match public.tournament_matches%rowtype;
  v_stage public.tournament_stages%rowtype; v_tournament_id uuid; v_winner uuid;
begin
  if auth.uid() is null or p_decision not in ('accept','reject') then raise exception 'Invalid result decision'; end if;
  select * into v_sub from public.match_result_submissions where id=p_submission_id for update;
  if not found then raise exception 'Result submission not found'; end if;
  select * into v_match from public.tournament_matches where id=v_sub.match_id for update;
  select * into v_stage from public.tournament_stages where id=v_match.stage_id;
  v_tournament_id:=v_stage.tournament_id;
  if not private.is_tournament_referee(v_tournament_id)
     and not exists(select 1 from public.match_officials o where o.match_id=v_match.id and o.user_id=auth.uid())
     and not private.can_manage_tournament(v_tournament_id,'bracket') then
    raise exception 'Assigned referee or tournament bracket capability required';
  end if;
  if exists(select 1 from public.tournament_registrations r join public.team_members tm on tm.team_id=r.team_id
      where r.id in (v_match.home_registration_id,v_match.away_registration_id)
        and tm.user_id=auth.uid() and tm.status='active') then raise exception 'A participant cannot approve a match result'; end if;
  if v_sub.status<>'pending' or v_match.status<>'result_pending' then raise exception 'Result is no longer pending or is disputed'; end if;
  if not exists(select 1 from public.match_result_submissions other
      where other.match_id=v_match.id and other.registration_id<>v_sub.registration_id
        and other.status='pending' and other.home_score=v_sub.home_score and other.away_score=v_sub.away_score) then
    raise exception 'Both teams must confirm the same score before approval';
  end if;
  if p_decision='reject' then
    update public.match_result_submissions set status='rejected',reviewed_by=auth.uid(),review_note=left(coalesce(p_note,''),1000),reviewed_at=now()
      where match_id=v_match.id and status='pending';
    update public.tournament_matches set status='live',updated_at=now() where id=v_match.id;
  else
    v_winner:=case when v_sub.home_score>v_sub.away_score then v_match.home_registration_id else v_match.away_registration_id end;
    update public.match_result_submissions set status='accepted',reviewed_by=auth.uid(),review_note=left(coalesce(p_note,''),1000),reviewed_at=now() where id=p_submission_id;
    update public.match_result_submissions set status='accepted',reviewed_by=auth.uid(),
      review_note='Score confirmed by the other team',reviewed_at=now()
      where match_id=v_match.id and registration_id<>v_sub.registration_id and status='pending'
        and home_score=v_sub.home_score and away_score=v_sub.away_score;
    update public.tournament_matches set status='completed',home_score=v_sub.home_score,away_score=v_sub.away_score,
      winner_registration_id=v_winner,completed_at=now(),updated_at=now() where id=v_match.id;
    perform private.advance_match_winner(v_match.id,v_winner);
    if v_stage.format='round_robin' then perform private.rebuild_standings(v_stage.id); end if;
  end if;
  perform private.write_audit_event('MATCH_RESULT_REVIEWED','match',v_match.id,
    jsonb_build_object('submission_id',p_submission_id,'decision',p_decision));
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
  elsif p_outcome in ('forfeit_home','forfeit_away') then
    v_winner:=case when p_outcome='forfeit_home' then v_match.away_registration_id else v_match.home_registration_id end;
    update public.tournament_matches set winner_registration_id=v_winner,status='forfeit',completed_at=now(),updated_at=now() where id=v_match.id;
    perform private.advance_match_winner(v_match.id,v_winner);
  elsif p_outcome='replay' then
    update public.match_result_submissions set status='rejected',reviewed_by=auth.uid(),review_note='Replay ordered',reviewed_at=now()
      where match_id=v_match.id and status in ('pending','accepted');
    update public.tournament_matches set status='ready',winner_registration_id=null,home_score=null,away_score=null,completed_at=null,updated_at=now()
      where id=v_match.id;
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

revoke all on function public.set_tournament_standing(uuid,uuid,integer,integer,integer,integer,integer,integer,integer),
  public.reset_tournament_standing(uuid,uuid),public.list_tournament_referees(uuid),
  public.set_tournament_referee(uuid,uuid),private.is_tournament_referee(uuid) from public,anon;
grant execute on function public.set_tournament_standing(uuid,uuid,integer,integer,integer,integer,integer,integer,integer),
  public.reset_tournament_standing(uuid,uuid),public.list_tournament_referees(uuid),
  public.set_tournament_referee(uuid,uuid),private.is_tournament_referee(uuid) to authenticated;
