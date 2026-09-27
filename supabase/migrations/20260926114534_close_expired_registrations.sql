-- Close tournament signups at their configured deadline, or at the start time
-- when no separate deadline was configured. Match completion remains a
-- separate official result action.
create extension if not exists pg_cron;

create or replace function private.close_expired_tournament_registrations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_closed integer;
begin
  update public.tournaments t
  set status='registration_closed',updated_at=now()
  where t.status='registration_open'
    and coalesce(t.registration_closes_at,t.starts_at) is not null
    and coalesce(t.registration_closes_at,t.starts_at)<=now();
  get diagnostics v_closed = row_count;
  return v_closed;
end;
$$;

revoke all on function private.close_expired_tournament_registrations() from public,anon,authenticated;

-- Update a named job if this migration is reapplied, and run the first sweep
-- immediately so already-expired registrations do not wait for the next tick.
do $$
declare v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname='close-expired-tournament-registrations';
  if v_job_id is not null then perform cron.unschedule(v_job_id); end if;
  perform private.close_expired_tournament_registrations();
  perform cron.schedule(
    'close-expired-tournament-registrations',
    '*/5 * * * *',
    'select private.close_expired_tournament_registrations();'
  );
end;
$$;

-- Make the public event feed reflect the deadline even between scheduled runs.
create or replace view public.tournament_directory with (security_invoker = true) as
  select t.id,t.name,t.game,t.description,t.format,t.best_of,t.region,t.starts_at,
    t.registration_opens_at,t.registration_closes_at,t.max_teams,t.roster_size,t.prize_pool,
    t.currency,t.map_pool,t.anti_cheat_required,t.substitute_limit,t.check_in_minutes,
    case when t.status='registration_open'
      and coalesce(t.registration_closes_at,t.starts_at) is not null
      and coalesce(t.registration_closes_at,t.starts_at)<=now()
      then 'registration_closed' else t.status end as status,
    t.created_at,count(r.id)::integer as registered_teams,t.cover_image_path
  from public.tournaments t left join public.tournament_registrations r
    on r.tournament_id=t.id and r.status in ('approved','checked_in')
  where t.status<>'draft'
  group by t.id;

-- Enforce the same deadline in the privileged registration path, including
-- tournaments whose periodic close job has not run yet.
create or replace function public.register_team(p_tournament_id uuid,p_team_id uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_t public.tournaments%rowtype; v_reg uuid; v_members integer; v_subs integer; v_used integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_t from public.tournaments where id=p_tournament_id for update;
  if not found then raise exception 'Tournament not found'; end if;
  perform 1 from public.teams where id=p_team_id for update;
  if not private.is_team_captain(p_team_id) then raise exception 'Team captain required'; end if;
  if v_t.status <> 'registration_open'
     or (v_t.registration_opens_at is not null and now()<v_t.registration_opens_at)
     or coalesce(v_t.registration_closes_at,v_t.starts_at)<=now() then
    raise exception 'Tournament registration is closed';
  end if;
  if not exists(select 1 from public.teams t where t.id=p_team_id and t.game=v_t.game) then
    raise exception 'Team game does not match tournament';
  end if;
  select count(*) filter(where role <> 'substitute'),count(*) filter(where role='substitute')
    into v_members,v_subs from public.team_members where team_id=p_team_id and status='active';
  if v_members<>v_t.roster_size or v_subs>v_t.substitute_limit then
    raise exception 'Team roster must match the event size and substitute limit';
  end if;
  select count(*) into v_used from public.tournament_registrations r
    where r.tournament_id=p_tournament_id and r.status in ('pending','approved','checked_in');
  if v_used>=v_t.max_teams then raise exception 'Tournament is full'; end if;
  insert into public.tournament_registrations(tournament_id,team_id,registered_by,status)
    values(p_tournament_id,p_team_id,auth.uid(),'pending') returning id into v_reg;
  insert into public.tournament_registration_members(tournament_id,registration_id,team_id,user_id,member_role)
    select p_tournament_id,v_reg,m.team_id,m.user_id,m.role from public.team_members m
      where m.team_id=p_team_id and m.status='active';
  perform private.write_audit_event('TEAM_REGISTERED','tournament_registration',v_reg,
    jsonb_build_object('tournament_id',p_tournament_id,'team_id',p_team_id));
  return v_reg;
end;
$$;

-- Reopening and manual registration reviews must respect the same cutoff.
create or replace function public.reopen_tournament_registration(p_tournament_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_closes_at timestamptz; v_starts_at timestamptz; v_status text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select status,registration_closes_at,starts_at into v_status,v_closes_at,v_starts_at
    from public.tournaments where id=p_tournament_id for update;
  if not found or not private.can_manage_tournament(p_tournament_id,'manage_tournament') then
    raise exception 'Tournament management capability required';
  end if;
  if v_status<>'registration_closed' then raise exception 'Only a closed registration can be reopened'; end if;
  if coalesce(v_closes_at,v_starts_at)<=now() then raise exception 'The registration deadline has passed'; end if;
  if exists(select 1 from public.tournament_stages where tournament_id=p_tournament_id and status<>'draft') then
    raise exception 'Registration cannot be reopened after a competition stage is published';
  end if;
  update public.tournaments set status='registration_open',updated_at=now() where id=p_tournament_id;
  perform private.write_audit_event('TOURNAMENT_REGISTRATION_REOPENED','tournament',p_tournament_id,'{}'::jsonb);
end;
$$;
revoke all on function public.reopen_tournament_registration(uuid) from public,anon,authenticated;
grant execute on function public.reopen_tournament_registration(uuid) to authenticated;

create or replace function public.transition_tournament(p_tournament_id uuid,p_new_status text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_status text; v_closes_at timestamptz; v_starts_at timestamptz;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select status,registration_closes_at,starts_at into v_status,v_closes_at,v_starts_at
    from public.tournaments where id=p_tournament_id for update;
  if not found or not private.can_manage_tournament(p_tournament_id,'manage_tournament') then
    raise exception 'Tournament management capability required';
  end if;
  if not ((v_status='draft' and p_new_status='registration_open')
      or (v_status='registration_open' and p_new_status='registration_closed')
      or (v_status='registration_closed' and p_new_status='in_progress')
      or (v_status='in_progress' and p_new_status='completed')
      or (v_status in ('draft','registration_open','registration_closed') and p_new_status='cancelled')) then
    raise exception 'Invalid tournament state transition';
  end if;
  if p_new_status='registration_open' and coalesce(v_closes_at,v_starts_at)<=now() then
    raise exception 'Registration close time has passed';
  end if;
  if p_new_status='in_progress' and not exists(select 1 from public.tournament_stages
      where tournament_id=p_tournament_id and status='published') then
    raise exception 'Publish a competition stage before starting the tournament';
  end if;
  if p_new_status='completed' and (
    not exists(select 1 from public.tournament_stages
      where tournament_id=p_tournament_id and status in ('published','in_progress','completed'))
    or exists(select 1 from public.tournament_stages where tournament_id=p_tournament_id and status<>'completed')
    or exists(select 1 from public.tournament_matches m where m.tournament_id=p_tournament_id
      and m.status not in ('completed','forfeit','cancelled'))
    or exists(select 1 from public.match_disputes d where d.match_id in
      (select id from public.tournament_matches where tournament_id=p_tournament_id) and d.status in ('open','under_review'))
  ) then raise exception 'Resolve every stage, match, and dispute before completing the tournament'; end if;
  if p_new_status='completed' then perform private.rebuild_final_placements(p_tournament_id); end if;
  update public.tournaments set status=p_new_status,updated_at=now() where id=p_tournament_id;
  perform private.write_audit_event('TOURNAMENT_STATUS_CHANGED','tournament',p_tournament_id,
    jsonb_build_object('from',v_status,'to',p_new_status));
end;
$$;
revoke all on function public.transition_tournament(uuid,text) from public,anon,authenticated;
grant execute on function public.transition_tournament(uuid,text) to authenticated;
