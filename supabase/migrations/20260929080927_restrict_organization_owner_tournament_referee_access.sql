-- Organization owners manage their clubs and game teams; tournament and referee
-- duties remain separate federation roles.

create or replace function private.is_current_user_organization_owner()
returns boolean language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null and exists(
    select 1 from public.organizations o where o.owner_id=auth.uid()
  );
$$;
revoke all on function private.is_current_user_organization_owner() from public,anon;
grant execute on function private.is_current_user_organization_owner() to authenticated;

create or replace function private.can_manage_organization(p_organization_id uuid,p_capability text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null
    and not (p_capability='create_tournaments' and exists(
      select 1 from public.organizations o where o.owner_id=auth.uid()
    ))
    and (
      private.is_super_admin()
      or exists(select 1 from public.organizations o
        where o.id=p_organization_id and o.owner_id=auth.uid())
      or exists(select 1 from public.organization_memberships m
        where m.organization_id=p_organization_id and m.user_id=auth.uid()
          and p_capability=any(m.capabilities))
    );
$$;

create or replace function public.has_permission(perm text)
returns boolean language sql stable security invoker set search_path = ''
as $$
  select auth.uid() is not null
    and not (
      perm in ('CREATE_TOURNAMENT','REFEREE_MATCHES','VERIFY_TEAMS','START_MATCH',
        'PAUSE_MATCH','APPROVE_RESULT','REJECT_RESULT','FILE_INCIDENT')
      and private.is_current_user_organization_owner()
    )
    and private.user_has_permission(auth.uid(),perm);
$$;

create or replace function public.get_my_roles()
returns table(role_key text,label text,level integer)
language sql stable security invoker set search_path = ''
as $$
  select r.key,r.label,r.level from public.roles r
  where (exists(select 1 from public.user_roles ur where ur.user_id=auth.uid() and ur.role_key=r.key)
      and not (r.key='REFEREE' and private.is_current_user_organization_owner()))
     or (r.key='CAPTAIN' and exists(select 1 from public.team_members tm
          where tm.user_id=auth.uid() and tm.role='captain' and tm.status='active'))
     or (r.key='ORGANIZATION_OWNER' and exists(select 1 from public.organization_memberships om
          where om.user_id=auth.uid() and om.role='owner'))
     or (r.key='TOURNAMENT_ADMIN' and exists(select 1 from public.tournament_staff ts
          where ts.user_id=auth.uid() and 'manage_tournament'=any(ts.capabilities)))
     or (r.key='REFEREE' and not private.is_current_user_organization_owner()
          and (exists(select 1 from public.match_officials mo where mo.user_id=auth.uid())
            or exists(select 1 from public.tournament_staff ts where ts.user_id=auth.uid() and 'referee'=any(ts.capabilities))))
$$;

create or replace function public.get_my_permissions()
returns setof text language sql stable security invoker set search_path = ''
as $$
  with permissions(permission_key) as (
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
  )
  select distinct permission_key from permissions
  where not (permission_key in ('CREATE_TOURNAMENT','REFEREE','REFEREE_MATCHES','VERIFY_TEAMS',
      'START_MATCH','PAUSE_MATCH','APPROVE_RESULT','REJECT_RESULT','FILE_INCIDENT')
    and private.is_current_user_organization_owner());
$$;

create or replace function private.is_tournament_referee(p_tournament_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null
    and not exists(select 1 from public.organizations o where o.owner_id=auth.uid())
    and exists(select 1 from public.tournament_staff ts
      where ts.tournament_id=p_tournament_id and ts.user_id=auth.uid() and 'referee'=any(ts.capabilities));
$$;

-- Owners cannot retain or receive referee work through a role, team assignment,
-- or staff capability. Keep other tournament-staff capabilities intact.
create or replace function private.reject_organization_owner_referee_assignment()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_user_id uuid;
begin
  v_user_id:=new.user_id;
  if exists(select 1 from public.organizations o where o.owner_id=v_user_id) then
    if tg_table_name='tournament_staff' then
      if 'referee'=any(new.capabilities) then
        raise exception 'Organization owners cannot be assigned referee duties';
      end if;
    elsif tg_table_name='match_officials' then
      raise exception 'Organization owners cannot be assigned as match officials';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists organization_owner_no_referee_staff on public.tournament_staff;
create trigger organization_owner_no_referee_staff
before insert or update of user_id,capabilities on public.tournament_staff
for each row execute function private.reject_organization_owner_referee_assignment();

drop trigger if exists organization_owner_no_match_official on public.match_officials;
create trigger organization_owner_no_match_official
before insert or update of user_id on public.match_officials
for each row execute function private.reject_organization_owner_referee_assignment();

create or replace function private.strip_owner_tournament_capability()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.role='owner' or exists(select 1 from public.organizations o
       where o.id=new.organization_id and o.owner_id=new.user_id) then
    new.capabilities:=array_remove(coalesce(new.capabilities,'{}'::text[]),'create_tournaments');
  end if;
  return new;
end;
$$;

drop trigger if exists organization_owner_no_tournament_capability on public.organization_memberships;
create trigger organization_owner_no_tournament_capability
before insert or update of organization_id,user_id,role,capabilities on public.organization_memberships
for each row execute function private.strip_owner_tournament_capability();

create or replace function private.clear_referee_assignments_for_new_owner()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  update public.tournament_staff ts set capabilities=array_remove(ts.capabilities,'referee')
    where ts.user_id=new.owner_id and 'referee'=any(ts.capabilities)
      and cardinality(array_remove(ts.capabilities,'referee'))>0;
  delete from public.tournament_staff ts where ts.user_id=new.owner_id
    and 'referee'=any(ts.capabilities) and cardinality(array_remove(ts.capabilities,'referee'))=0;
  delete from public.match_officials mo where mo.user_id=new.owner_id;
  return new;
end;
$$;

drop trigger if exists organization_owner_clear_referee_assignments on public.organizations;
create trigger organization_owner_clear_referee_assignments
after insert or update of owner_id on public.organizations
for each row execute function private.clear_referee_assignments_for_new_owner();

create or replace function public.assign_role(target uuid,requested_role text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_super_admin() then raise exception 'SUPER_ADMIN required'; end if;
  if target is null or not exists(select 1 from auth.users u where u.id=target) then
    raise exception 'Target account not found';
  end if;
  if requested_role not in ('REFEREE','MODERATOR','TOURNAMENT_ADMIN','PLATFORM_ADMIN','SUPER_ADMIN') then
    raise exception 'Role must be granted through a scoped assignment';
  end if;
  if requested_role='REFEREE' and exists(select 1 from public.organizations o where o.owner_id=target) then
    raise exception 'Organization owners cannot hold referee duties';
  end if;
  if target=auth.uid() and requested_role='SUPER_ADMIN' then raise exception 'Self-grant is not allowed'; end if;
  if requested_role='SUPER_ADMIN' then perform pg_advisory_xact_lock(7349021); end if;
  insert into public.user_roles(user_id,role_key,granted_by)
    values(target,requested_role,auth.uid()) on conflict(user_id,role_key) do nothing;
  perform private.write_audit_event('ROLE_ASSIGN','user_role',target,jsonb_build_object('role_key',requested_role));
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
    where not exists(select 1 from public.organizations o where o.owner_id=p.id)
      and (exists(select 1 from public.user_roles ur where ur.user_id=p.id and ur.role_key='REFEREE')
        or exists(select 1 from public.tournament_staff ts where ts.tournament_id=p_tournament_id
          and ts.user_id=p.id and 'referee'=any(ts.capabilities)))
    order by lower(coalesce(p.username,p.player_name,'')),p.id;
end;
$$;

-- Clean up permissions and assignments already held by current organization owners.
update public.organization_memberships om set capabilities=array_remove(om.capabilities,'create_tournaments')
where om.role='owner' or exists(select 1 from public.organizations o
  where o.id=om.organization_id and o.owner_id=om.user_id);

delete from public.tournament_staff ts using public.organizations o
where o.owner_id=ts.user_id and 'referee'=any(ts.capabilities)
  and cardinality(array_remove(ts.capabilities,'referee'))=0;
update public.tournament_staff ts set capabilities=array_remove(ts.capabilities,'referee')
where 'referee'=any(ts.capabilities) and exists(select 1 from public.organizations o where o.owner_id=ts.user_id);
delete from public.match_officials mo where exists(select 1 from public.organizations o where o.owner_id=mo.user_id);

create or replace function private.reject_organization_owner_tournament_creation()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is not null and new.organizer_id=auth.uid()
    and exists(select 1 from public.organizations o where o.owner_id=auth.uid()) then
    raise exception 'Organization owners cannot create tournaments';
  end if;
  return new;
end;
$$;

drop trigger if exists organization_owner_no_tournament_creation on public.tournaments;
create trigger organization_owner_no_tournament_creation
before insert on public.tournaments
for each row execute function private.reject_organization_owner_tournament_creation();

revoke all on function private.reject_organization_owner_referee_assignment(),
  private.strip_owner_tournament_capability(),private.clear_referee_assignments_for_new_owner(),
  private.reject_organization_owner_tournament_creation()
from public,anon,authenticated;
