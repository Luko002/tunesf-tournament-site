-- Production authorization and tournament workflows.
-- Existing roles, profiles, tournaments, teams, and registrations are retained.

create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to anon, authenticated;

-- Stop permissive legacy/default ACLs from granting table writes (including
-- TRUNCATE, which bypasses row-level security) to browser roles.
alter default privileges for role postgres in schema public
  revoke all on tables from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from public, anon, authenticated;

-- Scope contextual authority to the target organization or tournament.
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  name text not null check (length(trim(name)) between 2 and 100),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  description text not null default '',
  region text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_memberships (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','admin','staff')),
  capabilities text[] not null default '{}',
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id),
  check (capabilities <@ array['manage_org','manage_staff','manage_teams','create_tournaments','manage_prizes']::text[])
);

create table public.tournament_staff (
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  capabilities text[] not null,
  assigned_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (tournament_id, user_id),
  check (cardinality(capabilities) > 0),
  check (capabilities <@ array['manage_tournament','registrations','bracket','schedule','referee','disputes','prizes','rosters']::text[])
);
create index tournament_staff_user_idx on public.tournament_staff(user_id, tournament_id);
create index organization_memberships_user_idx on public.organization_memberships(user_id, organization_id);

alter table public.tournaments
  add column if not exists organization_id uuid references public.organizations(id) on delete set null;
create index if not exists tournaments_organization_idx on public.tournaments(organization_id, created_at desc);
alter table public.teams
  add column if not exists organization_id uuid references public.organizations(id) on delete set null;
alter table public.tournament_registrations add constraint tournament_registrations_id_tournament_uq unique(id,tournament_id);
create table public.tournament_registration_members (
  tournament_id uuid not null,
  registration_id uuid not null,
  team_id uuid not null,
  user_id uuid not null,
  member_role text not null check (member_role in ('captain','player','substitute')),
  snapshotted_at timestamptz not null default now(),
  primary key(registration_id,user_id),
  unique(tournament_id,user_id),
  foreign key(registration_id,tournament_id) references public.tournament_registrations(id,tournament_id) on delete cascade,
  foreign key(team_id,user_id) references public.team_members(team_id,user_id) on delete restrict
);
create index registration_members_tournament_idx on public.tournament_registration_members(tournament_id,registration_id);
alter table public.tournament_registration_members enable row level security;
revoke all on public.tournament_registration_members from public,anon,authenticated;
grant select on public.tournament_registration_members to authenticated;

-- Context checks are SECURITY DEFINER so RLS can consult private membership
-- tables without opening those tables to direct client writes.
create or replace function private.is_super_admin()
returns boolean language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role_key = 'SUPER_ADMIN'
  );
$$;

create or replace function private.can_manage_tournament(p_tournament_id uuid, p_capability text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null and (
    (p_capability <> 'referee' and private.is_super_admin())
    or (p_capability <> 'referee' and exists (
      select 1 from public.tournaments t
      where t.id = p_tournament_id and t.organizer_id = auth.uid()
    ))
    or exists (
      select 1 from public.tournament_staff s
      where s.tournament_id = p_tournament_id
        and s.user_id = auth.uid()
        and p_capability = any(s.capabilities)
    )
  );
$$;

create or replace function private.can_manage_organization(p_organization_id uuid, p_capability text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null and (
    private.is_super_admin()
    or exists (
      select 1 from public.organizations o
      where o.id = p_organization_id and o.owner_id = auth.uid()
    )
    or exists (
      select 1 from public.organization_memberships m
      where m.organization_id = p_organization_id
        and m.user_id = auth.uid()
        and p_capability = any(m.capabilities)
    )
  );
$$;

create or replace function private.is_team_member(p_team_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.team_members m
    where m.team_id = p_team_id and m.user_id = auth.uid()
      and m.status = 'active'
  );
$$;

create or replace function private.is_team_captain(p_team_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.teams t
    join public.team_members m on m.team_id = t.id and m.user_id = t.captain_id
    where t.id = p_team_id and t.captain_id = auth.uid()
      and m.role = 'captain' and m.status = 'active'
  );
$$;

grant execute on function private.is_super_admin() to anon, authenticated;
grant execute on function private.can_manage_tournament(uuid,text) to anon, authenticated;
grant execute on function private.can_manage_organization(uuid,text) to anon, authenticated;
grant execute on function private.is_team_member(uuid) to anon, authenticated;
grant execute on function private.is_team_captain(uuid) to anon, authenticated;

create policy registration_members_scoped_read on public.tournament_registration_members for select to authenticated
  using (private.is_team_member(team_id) or private.is_team_captain(team_id)
    or private.can_manage_tournament(tournament_id,'rosters')
    or private.can_manage_tournament(tournament_id,'manage_tournament'));

-- Append-only audit trail. Actor identity is copied, not FK-cascaded, so user
-- deletion cannot rewrite historical events.
create table public.audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null check (length(action) between 1 and 100),
  entity_type text not null check (length(entity_type) between 1 and 80),
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_events_entity_idx on public.audit_events(entity_type, entity_id, created_at desc);
create index audit_events_actor_idx on public.audit_events(actor_id, created_at desc);
create or replace function private.write_audit_event(
  p_action text, p_entity_type text, p_entity_id uuid, p_details jsonb default '{}'::jsonb
)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.audit_events(actor_id, action, entity_type, entity_id, details)
  values (auth.uid(), p_action, p_entity_type, p_entity_id,
          coalesce(p_details, '{}'::jsonb) - 'token' - 'email' - 'password');
end;
$$;
revoke all on function private.write_audit_event(text,text,uuid,jsonb) from public,anon,authenticated;
alter table public.audit_events enable row level security;
create policy audit_events_staff_read on public.audit_events for select to authenticated
  using (public.has_permission('AUDIT_LOGS') or private.is_super_admin());

-- Remove all legacy permissive policies and ACLs from lifecycle tables. Reads
-- are added back only where the row itself is safe to expose.
do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname from pg_policies
    where schemaname = 'public' and tablename in
      ('tournaments','teams','team_members','tournament_registrations','user_roles','audit_log','profiles')
  loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end;
$$;

revoke all on public.tournaments, public.teams, public.team_members,
  public.tournament_registrations, public.user_roles, public.audit_log,
  public.organizations, public.organization_memberships, public.tournament_staff,
  public.audit_events from public, anon, authenticated;
grant select (id,name,game,description,format,best_of,region,starts_at,registration_opens_at,
  registration_closes_at,max_teams,roster_size,prize_pool,currency,map_pool,anti_cheat_required,
  substitute_limit,check_in_minutes,status,created_at,updated_at,organization_id)
  on public.tournaments to anon, authenticated;
grant select (id,name,tag,game,region,created_at,organization_id) on public.teams to anon, authenticated;
grant select on public.team_members, public.tournament_registrations to authenticated;
grant select (id,tournament_id,status) on public.tournament_registrations to anon;
grant select on public.user_roles, public.audit_log to authenticated;
grant select (id,name,slug,description,region,created_at,updated_at) on public.organizations to anon,authenticated;
grant select on public.organization_memberships, public.tournament_staff, public.audit_events to authenticated;

alter table public.tournaments enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
create unique index one_active_captain_per_user on public.team_members(user_id)
  where role='captain' and status='active';
alter table public.tournament_registrations enable row level security;
alter table public.user_roles enable row level security;
alter table public.audit_log enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.tournament_staff enable row level security;

create policy tournament_public_read on public.tournaments for select to anon, authenticated
  using (status <> 'draft' or organizer_id = auth.uid() or private.can_manage_tournament(id,'manage_tournament'));
create policy team_public_read on public.teams for select to anon, authenticated using (true);
create policy team_membership_read on public.team_members for select to authenticated
  using (user_id = auth.uid() or private.is_team_member(team_id) or private.is_team_captain(team_id));
create policy registration_scoped_read on public.tournament_registrations for select to authenticated
  using (
    registered_by = auth.uid()
    or private.is_team_captain(team_id)
    or private.can_manage_tournament(tournament_id,'registrations')
    or private.can_manage_tournament(tournament_id,'manage_tournament')
  );
create policy registration_public_approved_read on public.tournament_registrations for select to anon
  using (status in ('approved','checked_in') and exists (
    select 1 from public.tournaments t where t.id = tournament_id and t.status <> 'draft'
  ));
create policy user_roles_self_or_audit_read on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.has_permission('AUDIT_LOGS') or private.is_super_admin());
create policy audit_log_staff_read on public.audit_log for select to authenticated
  using (public.has_permission('AUDIT_LOGS') or private.is_super_admin());
create policy organizations_public_read on public.organizations for select to anon, authenticated using (true);
create policy organization_membership_scoped_read on public.organization_memberships for select to authenticated
  using (user_id = auth.uid() or private.can_manage_organization(organization_id,'manage_staff'));
create policy tournament_staff_scoped_read on public.tournament_staff for select to authenticated
  using (user_id = auth.uid() or private.can_manage_tournament(tournament_id,'manage_tournament'));

-- A separate allowlisted profile-card table supports public safe fields without
-- granting anonymous access to the full account profile row.
drop view if exists public.public_profiles;
create table public.public_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text,
  player_name text not null,
  game text not null,
  region text not null default ''
);
insert into public.public_profiles(id,username,player_name,game,region)
  select id,username,player_name,game,region from public.profiles
on conflict(id) do update set username=excluded.username,player_name=excluded.player_name,game=excluded.game,region=excluded.region;
create or replace function private.sync_public_profile()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.public_profiles(id,username,player_name,game,region)
  values(new.id,new.username,new.player_name,new.game,new.region)
  on conflict(id) do update set username=excluded.username,player_name=excluded.player_name,
    game=excluded.game,region=excluded.region;
  return new;
end;
$$;
create trigger sync_public_profile_card after insert or update of username,player_name,game,region
  on public.profiles for each row execute function private.sync_public_profile();
alter table public.public_profiles enable row level security;
create policy public_profile_cards_read on public.public_profiles for select to anon,authenticated using (true);
revoke all on public.public_profiles from public, anon, authenticated;
grant select on public.public_profiles to anon, authenticated;
revoke all on public.profiles from public, anon, authenticated;
grant select,update on public.profiles to authenticated;
create policy profiles_self_read on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_self_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Replace the old directory view with a safe public projection. It remains
-- security-invoker and uses only columns explicitly granted to anon.
drop view if exists public.tournament_directory;
create view public.tournament_directory with (security_invoker = true) as
  select t.id,t.name,t.game,t.description,t.format,t.best_of,t.region,t.starts_at,
    t.registration_opens_at,t.registration_closes_at,t.max_teams,t.roster_size,t.prize_pool,
    t.currency,t.map_pool,t.anti_cheat_required,t.substitute_limit,t.check_in_minutes,t.status,t.created_at,
    count(r.id)::integer as registered_teams
  from public.tournaments t left join public.tournament_registrations r
    on r.tournament_id=t.id and r.status in ('approved','checked_in')
  group by t.id;
grant select on public.tournament_directory to anon,authenticated;

-- Role assignments remain global only for platform roles. Captain, org-owner,
-- and tournament-admin powers are contextual and live in membership tables.
delete from public.user_roles where role_key in ('CAPTAIN','ORGANIZATION_OWNER');
delete from public.role_permissions where role_key='TOURNAMENT_ADMIN'
  and permission_key not in ('VIEW_TOURNAMENTS','CREATE_TOURNAMENT');
revoke all on public.user_roles from anon, authenticated;
grant select on public.user_roles to authenticated;

create or replace function public.assign_role(target uuid, requested_role text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_super_admin() then
    raise exception 'SUPER_ADMIN required';
  end if;
  if target is null or not exists(select 1 from auth.users u where u.id = target) then
    raise exception 'Target account not found';
  end if;
  if requested_role not in ('REFEREE','MODERATOR','TOURNAMENT_ADMIN','PLATFORM_ADMIN','SUPER_ADMIN') then
    raise exception 'Role must be granted through a scoped assignment';
  end if;
  if target = auth.uid() and requested_role = 'SUPER_ADMIN' then
    raise exception 'Self-grant is not allowed';
  end if;
  if requested_role = 'SUPER_ADMIN' then
    perform pg_advisory_xact_lock(7349021);
  end if;
  insert into public.user_roles(user_id, role_key, granted_by)
  values (target, requested_role, auth.uid()) on conflict (user_id, role_key) do nothing;
  perform private.write_audit_event('ROLE_ASSIGN', 'user_role', target,
    jsonb_build_object('role_key', requested_role));
end;
$$;

create or replace function public.revoke_role(target uuid, requested_role text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_super_admin() then
    raise exception 'SUPER_ADMIN required';
  end if;
  if requested_role not in ('REFEREE','MODERATOR','TOURNAMENT_ADMIN','PLATFORM_ADMIN','SUPER_ADMIN') then
    raise exception 'Role is not globally assignable';
  end if;
  if requested_role = 'SUPER_ADMIN' then
    perform pg_advisory_xact_lock(7349021);
    if (select count(*) from public.user_roles where role_key = 'SUPER_ADMIN') <= 1 then
      raise exception 'Cannot revoke the last Super Admin role';
    end if;
  end if;
  delete from public.user_roles where user_id = target and role_key = requested_role;
  perform private.write_audit_event('ROLE_REVOKE', 'user_role', target,
    jsonb_build_object('role_key', requested_role));
end;
$$;
revoke all on function public.assign_role(uuid,text), public.revoke_role(uuid,text) from public, anon;
grant execute on function public.assign_role(uuid,text), public.revoke_role(uuid,text) to authenticated;

-- Team memberships are created only by the RPCs below. The captain identity
-- remains immutable and is represented by exactly one active captain row.
create table public.team_invitations (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  invitee_user_id uuid references auth.users(id) on delete cascade,
  member_role text not null check (member_role in ('player','substitute')),
  token_hash bytea not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  accepted_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  check (not (revoked_at is not null and accepted_at is not null))
);
create index team_invitations_team_idx on public.team_invitations(team_id, created_at desc);
create index team_invitations_expiry_idx on public.team_invitations(expires_at) where accepted_at is null and revoked_at is null;
alter table public.team_invitations enable row level security;
revoke all on public.team_invitations from public, anon, authenticated;

create or replace function public.create_team(
  p_name text, p_tag text, p_game text, p_region text default '', p_organization_id uuid default null
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_team_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists (select 1 from public.user_roles where user_id = auth.uid() and role_key = 'PLAYER') then
    raise exception 'PLAYER role required';
  end if;
  if p_organization_id is not null and not private.can_manage_organization(p_organization_id,'manage_teams') then
    raise exception 'Organization team capability required';
  end if;
  if length(trim(coalesce(p_name,''))) not between 2 and 80
     or length(trim(coalesce(p_tag,''))) not between 2 and 8
     or p_game not in ('cs2','val','lol','rl','eafc') then
    raise exception 'Invalid team details';
  end if;
  insert into public.teams(captain_id,name,tag,game,region,organization_id)
  values(auth.uid(),trim(p_name),trim(p_tag),p_game,coalesce(trim(p_region),''),p_organization_id)
  returning id into v_team_id;
  insert into public.team_members(team_id,user_id,role,status)
  values(v_team_id,auth.uid(),'captain','active');
  perform private.write_audit_event('TEAM_CREATED','team',v_team_id,'{}'::jsonb);
  return v_team_id;
end;
$$;

create or replace function public.create_team_invitation(
  p_team_id uuid,
  p_member_role text default 'player',
  p_expires_in interval default interval '7 days',
  p_invitee_user_id uuid default null
)
returns table(invitation_id uuid, token text, expires_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare v_token text; v_id uuid; v_expires timestamptz;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_member_role not in ('player','substitute') or p_expires_in <= interval '0 seconds'
     or p_expires_in > interval '14 days' then raise exception 'Invalid invitation settings'; end if;
  perform 1 from public.teams where id = p_team_id for update;
  if not private.is_team_captain(p_team_id) then raise exception 'Team captain required'; end if;
  if exists(select 1 from public.tournament_registrations where team_id=p_team_id and status in ('pending','approved','checked_in')) then
    raise exception 'Roster is locked while the team is registered';
  end if;
  if p_invitee_user_id is not null and not exists(select 1 from auth.users where id = p_invitee_user_id) then
    raise exception 'Invitee not found';
  end if;
  v_token := encode(extensions.gen_random_bytes(32),'hex');
  v_expires := now() + p_expires_in;
  insert into public.team_invitations(team_id,invitee_user_id,member_role,token_hash,expires_at,created_by)
  values(p_team_id,p_invitee_user_id,p_member_role,
         extensions.digest(convert_to(v_token,'UTF8'),'sha256'),v_expires,auth.uid())
  returning id into v_id;
  perform private.write_audit_event('TEAM_INVITE_CREATED','team',p_team_id,
    jsonb_build_object('invitation_id',v_id,'member_role',p_member_role,'expires_at',v_expires));
  return query select v_id,v_token,v_expires;
end;
$$;

create or replace function public.list_team_invitations(p_team_id uuid)
returns table(invitation_id uuid, invitee_user_id uuid, member_role text, expires_at timestamptz,
              revoked_at timestamptz, accepted_at timestamptz, created_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_team_captain(p_team_id) then
    raise exception 'Team captain required';
  end if;
  return query select i.id,i.invitee_user_id,i.member_role,i.expires_at,i.revoked_at,i.accepted_at,i.created_at
    from public.team_invitations i where i.team_id = p_team_id order by i.created_at desc;
end;
$$;

create or replace function public.accept_team_invitation(p_token text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_inv public.team_invitations%rowtype; v_team public.teams%rowtype; v_member_count integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.user_roles where user_id=auth.uid() and role_key='PLAYER') then
    raise exception 'PLAYER role required';
  end if;
  if p_token is null or length(p_token) <> 64 or p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid invitation';
  end if;
  select * into v_inv from public.team_invitations
  where token_hash = extensions.digest(convert_to(p_token,'UTF8'),'sha256') for update;
  if not found or v_inv.revoked_at is not null or v_inv.accepted_at is not null
     or v_inv.expires_at <= now()
     or (v_inv.invitee_user_id is not null and v_inv.invitee_user_id <> auth.uid()) then
    raise exception 'Invitation is invalid or expired';
  end if;
  select * into v_team from public.teams where id = v_inv.team_id for update;
  if exists(select 1 from public.tournament_registrations where team_id=v_team.id and status in ('pending','approved','checked_in')) then
    raise exception 'Roster is locked while the team is registered';
  end if;
  if exists(select 1 from public.team_members where team_id = v_team.id and user_id = auth.uid() and status = 'active') then
    raise exception 'Already an active team member';
  end if;
  select count(*) into v_member_count from public.team_members
    where team_id = v_team.id and status = 'active' and role <> 'substitute';
  if v_inv.member_role = 'player' and v_member_count >= 20 then raise exception 'Team roster is full'; end if;
  if v_inv.member_role = 'substitute' and
     (select count(*) from public.team_members where team_id = v_team.id and status='active' and role='substitute') >= 10 then
    raise exception 'Substitute roster is full';
  end if;
  insert into public.team_members(team_id,user_id,role,status)
  values(v_team.id,auth.uid(),v_inv.member_role,'active')
  on conflict(team_id,user_id) do update set role=excluded.role,status='active',created_at=now()
  where public.team_members.status='removed' and public.team_members.role<>'captain';
  if not found then raise exception 'Existing membership prevents accepting this invitation'; end if;
  update public.team_invitations set accepted_at = now() where id = v_inv.id;
  perform private.write_audit_event('TEAM_INVITE_ACCEPTED','team',v_team.id,
    jsonb_build_object('invitation_id',v_inv.id,'member_user_id',auth.uid()));
  return v_team.id;
end;
$$;

create or replace function public.revoke_team_invitation(p_invitation_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_team_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select team_id into v_team_id from public.team_invitations where id = p_invitation_id for update;
  if v_team_id is null or not private.is_team_captain(v_team_id) then raise exception 'Team captain required'; end if;
  update public.team_invitations set revoked_at = now()
    where id = p_invitation_id and accepted_at is null and revoked_at is null and expires_at > now();
  if not found then raise exception 'Invitation is no longer pending'; end if;
  perform private.write_audit_event('TEAM_INVITE_REVOKED','team',v_team_id,
    jsonb_build_object('invitation_id',p_invitation_id));
end;
$$;

create or replace function public.list_team_roster(p_team_id uuid)
returns table(user_id uuid,username text,player_name text,member_role text,status text,joined_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null or (not private.is_team_member(p_team_id) and not private.is_team_captain(p_team_id)) then
    raise exception 'Active team membership required';
  end if;
  return query select m.user_id,p.username,p.player_name,m.role,m.status,m.created_at
    from public.team_members m join public.public_profiles p on p.id=m.user_id
    where m.team_id=p_team_id and m.status='active'
    order by case m.role when 'captain' then 0 when 'player' then 1 else 2 end,m.created_at,m.user_id;
end;
$$;

create or replace function public.update_team(
  p_team_id uuid,p_name text,p_tag text,p_game text,p_region text default '',p_organization_id uuid default null
)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_team public.teams%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_team from public.teams where id=p_team_id for update;
  if not found or not private.is_team_captain(p_team_id) then raise exception 'Team captain required'; end if;
  if exists(select 1 from public.tournament_registrations where team_id=p_team_id and status in ('pending','approved','checked_in')) then
    raise exception 'Team profile and roster are locked while registered';
  end if;
  if length(trim(coalesce(p_name,''))) not between 2 and 80
     or length(trim(coalesce(p_tag,''))) not between 2 and 8
     or p_game not in ('cs2','val','lol','rl','eafc') then raise exception 'Invalid team details'; end if;
  if p_organization_id is not null and not private.can_manage_organization(p_organization_id,'manage_teams') then
    raise exception 'Organization team capability required';
  end if;
  update public.teams set name=trim(p_name),tag=trim(p_tag),game=p_game,region=coalesce(trim(p_region),''),
    organization_id=coalesce(p_organization_id,v_team.organization_id) where id=p_team_id;
  perform private.write_audit_event('TEAM_UPDATED','team',p_team_id,'{}'::jsonb);
end;
$$;

create or replace function public.remove_team_member(p_team_id uuid,p_user_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  perform 1 from public.teams where id=p_team_id for update;
  if not private.is_team_captain(p_team_id) then raise exception 'Team captain required'; end if;
  if exists(select 1 from public.tournament_registration_members where team_id=p_team_id and user_id=p_user_id) then
    raise exception 'A snapshotted tournament roster member cannot be removed';
  end if;
  update public.team_members set status='removed' where team_id=p_team_id and user_id=p_user_id
    and status='active' and role<>'captain';
  if not found then raise exception 'Active non-captain member not found'; end if;
  perform private.write_audit_event('TEAM_MEMBER_REMOVED','team',p_team_id,jsonb_build_object('user_id',p_user_id));
end;
$$;

create or replace function public.change_member_role(p_team_id uuid,p_user_id uuid,p_member_role text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_count integer;
begin
  if auth.uid() is null or p_member_role not in ('player','substitute') then raise exception 'Invalid team role'; end if;
  perform 1 from public.teams where id=p_team_id for update;
  if not private.is_team_captain(p_team_id) then raise exception 'Team captain required'; end if;
  if exists(select 1 from public.tournament_registration_members where team_id=p_team_id and user_id=p_user_id) then
    raise exception 'A snapshotted tournament roster member cannot change role';
  end if;
  if p_member_role='player' then
    select count(*) into v_count from public.team_members where team_id=p_team_id and status='active' and role='player';
    if v_count>=20 then raise exception 'Team player roster is full'; end if;
  else
    select count(*) into v_count from public.team_members where team_id=p_team_id and status='active' and role='substitute';
    if v_count>=10 then raise exception 'Team substitute roster is full'; end if;
  end if;
  update public.team_members set role=p_member_role where team_id=p_team_id and user_id=p_user_id
    and status='active' and role<>'captain';
  if not found then raise exception 'Active non-captain member not found'; end if;
  perform private.write_audit_event('TEAM_MEMBER_ROLE_CHANGED','team',p_team_id,
    jsonb_build_object('user_id',p_user_id,'member_role',p_member_role));
end;
$$;

create or replace function public.leave_team(p_team_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  perform 1 from public.teams where id=p_team_id for update;
  if exists(select 1 from public.team_members where team_id=p_team_id and user_id=auth.uid() and role='captain' and status='active') then
    raise exception 'Captain must transfer or dissolve the team before leaving';
  end if;
  if exists(select 1 from public.tournament_registration_members where team_id=p_team_id and user_id=auth.uid()) then
    raise exception 'A snapshotted tournament roster member cannot leave';
  end if;
  update public.team_members set status='removed' where team_id=p_team_id and user_id=auth.uid() and status='active';
  if not found then raise exception 'No active membership found'; end if;
  perform private.write_audit_event('TEAM_MEMBER_LEFT','team',p_team_id,'{}'::jsonb);
end;
$$;

-- A captain cannot be removed/demoted through any SQL path. Client DML on
-- team tables is revoked; this trigger protects trusted future maintenance too.
create or replace function private.protect_team_captain_membership()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if old.role = 'captain' then
    if tg_op='DELETE' or new.role <> 'captain' or new.status <> 'active'
       or new.user_id <> old.user_id or new.team_id <> old.team_id then
      raise exception 'Captain membership cannot be removed or changed';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
create trigger protect_team_captain_membership
before update or delete on public.team_members
for each row execute function private.protect_team_captain_membership();

create or replace function private.protect_snapshotted_membership()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if exists(select 1 from public.tournament_registration_members rm
      join public.tournament_registrations r on r.id=rm.registration_id
      where rm.team_id=old.team_id and rm.user_id=old.user_id
        and r.status in ('pending','approved','checked_in')) then
    raise exception 'A registered tournament roster is locked';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
create trigger protect_snapshotted_team_membership
before update or delete on public.team_members
for each row execute function private.protect_snapshotted_membership();

create table public.tournament_stages (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  stage_number smallint not null check (stage_number between 1 and 20),
  name text not null default 'Main Stage',
  format text not null check (format in ('single_elimination','double_elimination','round_robin')),
  status text not null default 'draft' check (status in ('draft','published','completed')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(tournament_id,stage_number),
  unique(id,tournament_id)
);

create table public.tournament_matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  stage_id uuid not null references public.tournament_stages(id) on delete cascade,
  winner_to_match_id uuid references public.tournament_matches(id) on delete restrict,
  winner_to_slot text check (winner_to_slot in ('home','away')),
  loser_to_match_id uuid references public.tournament_matches(id) on delete restrict,
  loser_to_slot text check (loser_to_slot in ('home','away')),
  bracket_side text not null default 'main' check (bracket_side in ('main','winners','losers','grand_final')),
  home_expected boolean not null default false,
  away_expected boolean not null default false,
  round_number smallint not null check (round_number between 1 and 20),
  position smallint not null check (position between 1 and 1024),
  home_registration_id uuid references public.tournament_registrations(id) on delete restrict,
  away_registration_id uuid references public.tournament_registrations(id) on delete restrict,
  winner_registration_id uuid references public.tournament_registrations(id) on delete restrict,
  status text not null default 'pending'
    check (status in ('pending','ready','live','paused','result_pending','disputed','completed','forfeit','cancelled')),
  home_score smallint check (home_score >= 0),
  away_score smallint check (away_score >= 0),
  scheduled_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(stage_id,bracket_side,round_number,position),
  unique(id,tournament_id),
  foreign key(winner_to_match_id,tournament_id) references public.tournament_matches(id,tournament_id) on delete restrict,
  foreign key(loser_to_match_id,tournament_id) references public.tournament_matches(id,tournament_id) on delete restrict,
  foreign key(stage_id,tournament_id) references public.tournament_stages(id,tournament_id) on delete cascade,
  foreign key(home_registration_id,tournament_id) references public.tournament_registrations(id,tournament_id) on delete restrict,
  foreign key(away_registration_id,tournament_id) references public.tournament_registrations(id,tournament_id) on delete restrict,
  foreign key(winner_registration_id,tournament_id) references public.tournament_registrations(id,tournament_id) on delete restrict,
  check (home_registration_id is null or away_registration_id is null or home_registration_id <> away_registration_id),
  check (winner_registration_id is null or winner_registration_id in (home_registration_id,away_registration_id)),
  check ((winner_to_match_id is null) = (winner_to_slot is null)),
  check ((loser_to_match_id is null) = (loser_to_slot is null)),
  check (winner_to_match_id is null or winner_to_match_id <> id),
  check (loser_to_match_id is null or loser_to_match_id <> id)
);
create index tournament_matches_stage_status_idx on public.tournament_matches(stage_id,status,round_number,position);
create index tournament_matches_home_idx on public.tournament_matches(home_registration_id) where home_registration_id is not null;
create index tournament_matches_away_idx on public.tournament_matches(away_registration_id) where away_registration_id is not null;

create table public.match_officials (
  match_id uuid not null references public.tournament_matches(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete restrict,
  assigned_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key(match_id,user_id)
);

create table public.match_result_submissions (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  match_id uuid not null references public.tournament_matches(id) on delete cascade,
  submitted_by uuid not null references auth.users(id) on delete restrict,
  registration_id uuid not null references public.tournament_registrations(id) on delete restrict,
  home_score smallint not null check (home_score >= 0),
  away_score smallint not null check (away_score >= 0),
  status text not null default 'pending' check (status in ('pending','accepted','rejected')),
  reviewed_by uuid references auth.users(id) on delete restrict,
  review_note text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  foreign key(match_id,tournament_id) references public.tournament_matches(id,tournament_id) on delete cascade,
  foreign key(registration_id,tournament_id) references public.tournament_registrations(id,tournament_id) on delete restrict
);
create unique index one_live_result_per_team on public.match_result_submissions(match_id,registration_id)
  where status in ('pending','accepted');

create table public.match_evidence (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  match_id uuid not null references public.tournament_matches(id) on delete cascade,
  submitted_by uuid not null references auth.users(id) on delete restrict,
  object_key text not null unique,
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp','video/mp4')),
  byte_size bigint not null check (byte_size between 1 and 20971520),
  created_at timestamptz not null default now(),
  foreign key(match_id,tournament_id) references public.tournament_matches(id,tournament_id) on delete cascade
);

create table public.match_disputes (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  match_id uuid not null references public.tournament_matches(id) on delete cascade,
  opened_by uuid not null references auth.users(id) on delete restrict,
  registration_id uuid not null references public.tournament_registrations(id) on delete restrict,
  reason text not null check (length(trim(reason)) between 5 and 3000),
  status text not null default 'open' check (status in ('open','under_review','resolved','rejected')),
  outcome text check (outcome in ('uphold','replay','forfeit_home','forfeit_away','accept_home','accept_away')),
  resolution_note text,
  resolved_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  foreign key(match_id,tournament_id) references public.tournament_matches(id,tournament_id) on delete cascade,
  foreign key(registration_id,tournament_id) references public.tournament_registrations(id,tournament_id) on delete restrict,
  unique(match_id)
);
create unique index one_open_dispute_per_match on public.match_disputes(match_id)
  where status in ('open','under_review');

create table public.tournament_standings (
  stage_id uuid not null references public.tournament_stages(id) on delete cascade,
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  registration_id uuid not null references public.tournament_registrations(id) on delete cascade,
  played integer not null default 0 check (played >= 0),
  wins integer not null default 0 check (wins >= 0),
  draws integer not null default 0 check (draws >= 0),
  losses integer not null default 0 check (losses >= 0),
  points integer not null default 0,
  score_for integer not null default 0,
  score_against integer not null default 0,
  rank integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key(stage_id,registration_id),
  foreign key(stage_id,tournament_id) references public.tournament_stages(id,tournament_id) on delete cascade,
  foreign key(registration_id,tournament_id) references public.tournament_registrations(id,tournament_id) on delete cascade
);

create table public.tournament_prizes (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  place smallint not null check (place between 1 and 1024),
  label text not null default '',
  amount numeric(12,2) not null check (amount >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(),
  unique(tournament_id,place)
  ,unique(id,tournament_id)
);

create table public.prize_awards (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  prize_id uuid not null references public.tournament_prizes(id) on delete restrict,
  registration_id uuid not null references public.tournament_registrations(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending','approved','paid','cancelled')),
  approved_by uuid references auth.users(id) on delete restrict,
  approved_at timestamptz,
  paid_at timestamptz,
  payment_reference text,
  created_at timestamptz not null default now(),
  unique(prize_id,registration_id),
  foreign key(prize_id,tournament_id) references public.tournament_prizes(id,tournament_id) on delete restrict,
  foreign key(registration_id,tournament_id) references public.tournament_registrations(id,tournament_id) on delete restrict,
  check ((status <> 'paid') or (approved_at is not null and paid_at is not null))
);

create table public.moderation_cases (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references auth.users(id) on delete set null,
  subject_user_id uuid references auth.users(id) on delete set null,
  subject_team_id uuid references public.teams(id) on delete set null,
  subject_tournament_id uuid references public.tournaments(id) on delete set null,
  category text not null check (length(category) between 2 and 80),
  description text not null check (length(trim(description)) between 5 and 5000),
  status text not null default 'open' check (status in ('open','under_review','resolved','dismissed')),
  assigned_to uuid references auth.users(id) on delete set null,
  decision text,
  decision_note text,
  resolved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(subject_user_id,subject_team_id,subject_tournament_id) = 1)
);

create table public.moderation_staff (
  user_id uuid primary key references auth.users(id) on delete cascade,
  capabilities text[] not null default array['review_cases']::text[],
  assigned_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (capabilities <@ array['review_cases','warn_users','suspend_users','ban_users']::text[])
);

-- Install role lookups after every referenced workflow table exists so this
-- migration also works on the earlier TUNESF schema where they did not.
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
     or (r.key='REFEREE' and exists(select 1 from public.match_officials mo where mo.user_id=auth.uid()))
$$;

create or replace function public.get_my_permissions()
returns setof text language sql stable security invoker set search_path = ''
as $$
  select distinct rp.permission_key from public.user_roles ur
    join public.role_permissions rp on rp.role_key=ur.role_key
    where ur.user_id=auth.uid()
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
  union
  select 'REFEREE_MATCHES' where exists(select 1 from public.match_officials mo where mo.user_id=auth.uid())
$$;
revoke all on function public.get_my_roles(),public.get_my_permissions() from public,anon;
grant execute on function public.get_my_roles(),public.get_my_permissions() to authenticated;

create or replace function private.reject_audit_mutation()
returns trigger language plpgsql security definer set search_path = ''
as $$ begin raise exception 'Audit events are append-only'; end; $$;
create trigger audit_events_immutable before update or delete on public.audit_events
  for each row execute function private.reject_audit_mutation();

create index match_result_submissions_match_idx on public.match_result_submissions(match_id,created_at desc);
create index match_disputes_match_idx on public.match_disputes(match_id,created_at desc);
create index standings_registration_idx on public.tournament_standings(registration_id);
create index prizes_tournament_idx on public.tournament_prizes(tournament_id,place);
create index moderation_cases_status_idx on public.moderation_cases(status,created_at desc);

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
      or private.can_manage_tournament(m.tournament_id,'manage_tournament')
    )
  );
$$;
grant execute on function private.can_access_match(uuid) to authenticated;
create policy registration_match_official_read on public.tournament_registrations for select to authenticated
  using (exists(select 1 from public.tournament_matches m
    where (m.home_registration_id=id or m.away_registration_id=id) and private.can_access_match(m.id)));

alter table public.tournament_stages enable row level security;
alter table public.tournament_matches enable row level security;
alter table public.match_officials enable row level security;
alter table public.match_result_submissions enable row level security;
alter table public.match_evidence enable row level security;
alter table public.match_disputes enable row level security;
alter table public.tournament_standings enable row level security;
alter table public.tournament_prizes enable row level security;
alter table public.prize_awards enable row level security;
alter table public.moderation_cases enable row level security;
alter table public.moderation_staff enable row level security;

revoke all on public.tournament_stages, public.tournament_matches, public.match_officials,
  public.match_result_submissions, public.match_evidence, public.match_disputes,
  public.tournament_standings, public.tournament_prizes, public.prize_awards,
  public.moderation_cases, public.moderation_staff from public, anon, authenticated;
grant select on public.tournament_stages, public.tournament_matches,
  public.tournament_standings, public.tournament_prizes to anon, authenticated;
grant select on public.match_officials, public.match_result_submissions,
  public.match_evidence, public.match_disputes, public.prize_awards,
  public.moderation_cases, public.moderation_staff to authenticated;

create policy stages_public_read on public.tournament_stages for select to anon, authenticated
  using (status <> 'draft' or private.can_manage_tournament(tournament_id,'manage_tournament'));
create policy matches_public_read on public.tournament_matches for select to anon, authenticated
  using (exists(select 1 from public.tournament_stages s join public.tournaments t on t.id=s.tournament_id
    where s.id=stage_id and t.status <> 'draft'));
create policy standings_public_read on public.tournament_standings for select to anon, authenticated
  using (exists(select 1 from public.tournament_stages s join public.tournaments t on t.id=s.tournament_id
    where s.id=stage_id and t.status <> 'draft'));
create policy prizes_public_read on public.tournament_prizes for select to anon, authenticated
  using (exists(select 1 from public.tournaments t where t.id=tournament_id and t.status <> 'draft'));
create policy officials_scoped_read on public.match_officials for select to authenticated
  using (user_id=auth.uid() or private.can_access_match(match_id));
create policy result_scoped_read on public.match_result_submissions for select to authenticated
  using (private.can_access_match(match_id));
create policy evidence_scoped_read on public.match_evidence for select to authenticated
  using (private.can_access_match(match_id));
create policy dispute_scoped_read on public.match_disputes for select to authenticated
  using (opened_by=auth.uid() or private.can_access_match(match_id));
create policy awards_scoped_read on public.prize_awards for select to authenticated
  using (private.can_manage_tournament((select tournament_id from public.tournament_prizes p where p.id=prize_id),'prizes'));
create policy cases_scoped_read on public.moderation_cases for select to authenticated
  using (reporter_id=auth.uid() or public.has_permission('REVIEW_REPORTS')
    or exists(select 1 from public.moderation_staff m where m.user_id=auth.uid() and 'review_cases'=any(m.capabilities)));
create policy moderation_staff_self_read on public.moderation_staff for select to authenticated using (user_id=auth.uid());

-- All tournament changes go through these RPCs; row locks serialize capacity,
-- lifecycle transitions, bracket creation, results, disputes, and awards.
create or replace function public.create_tournament(p_data jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_id uuid; v_org uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if jsonb_typeof(p_data) <> 'object' then raise exception 'Tournament payload must be an object'; end if;
  if coalesce(p_data->>'format','single') not in ('single','single_elimination','double','double_elimination','rr','round_robin','round_robin_playoffs') then
    raise exception 'Unsupported tournament format';
  end if;
  v_org := nullif(p_data->>'organization_id','')::uuid;
  if v_org is not null then
    if not private.can_manage_organization(v_org,'create_tournaments') then
      raise exception 'Organization tournament capability required';
    end if;
  elsif not public.has_permission('CREATE_TOURNAMENT') and not private.is_super_admin() then
    raise exception 'Tournament creation eligibility required';
  end if;
  insert into public.tournaments(
    organizer_id,organization_id,name,game,description,format,best_of,region,
    starts_at,registration_opens_at,registration_closes_at,max_teams,roster_size,
    prize_pool,currency,map_pool,anti_cheat_required,substitute_limit,check_in_minutes,status
  ) values (
    auth.uid(),v_org,trim(p_data->>'name'),p_data->>'game',coalesce(p_data->>'description',''),
    case coalesce(p_data->>'format','single') when 'single' then 'single_elimination'
      when 'double' then 'double_elimination' when 'rr' then 'round_robin_playoffs'
      else p_data->>'format' end,
    coalesce(p_data->>'best_of','BO3'),coalesce(p_data->>'region',''),
    nullif(p_data->>'starts_at','')::timestamptz,nullif(p_data->>'registration_opens_at','')::timestamptz,
    nullif(p_data->>'registration_closes_at','')::timestamptz,
    coalesce((p_data->>'max_teams')::integer,64),coalesce((p_data->>'roster_size')::integer,5),
    coalesce((p_data->>'prize_pool')::numeric,0),coalesce(p_data->>'currency','TND'),
    coalesce(array(select jsonb_array_elements_text(p_data->'map_pool')), '{}'),
    coalesce((p_data->>'anti_cheat_required')::boolean,false),
    coalesce((p_data->>'substitute_limit')::smallint,1),coalesce((p_data->>'check_in_minutes')::smallint,60),
    'draft'
  ) returning id into v_id;
  perform private.write_audit_event('TOURNAMENT_CREATED','tournament',v_id,'{}'::jsonb);
  return v_id;
end;
$$;

create or replace function public.update_tournament(p_tournament_id uuid,p_data jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_data ? 'format' and p_data->>'format' not in ('single','single_elimination','double','double_elimination','rr','round_robin','round_robin_playoffs') then
    raise exception 'Unsupported tournament format';
  end if;
  perform 1 from public.tournaments where id=p_tournament_id for update;
  if not found or not private.can_manage_tournament(p_tournament_id,'manage_tournament') then
    raise exception 'Tournament management capability required';
  end if;
  if exists(select 1 from public.tournament_stages where tournament_id=p_tournament_id and status <> 'draft') then
    raise exception 'Tournament settings are locked after bracket publication';
  end if;
  update public.tournaments set
    name=coalesce(nullif(trim(p_data->>'name'),''),name),
    game=coalesce(p_data->>'game',game),
    format=case p_data->>'format' when 'single' then 'single_elimination'
      when 'double' then 'double_elimination' when 'rr' then 'round_robin_playoffs'
      else coalesce(p_data->>'format',format) end,
    best_of=coalesce(p_data->>'best_of',best_of),
    description=coalesce(p_data->>'description',description),
    region=coalesce(p_data->>'region',region),
    starts_at=case when p_data ? 'starts_at' then nullif(p_data->>'starts_at','')::timestamptz else starts_at end,
    registration_opens_at=case when p_data ? 'registration_opens_at' then nullif(p_data->>'registration_opens_at','')::timestamptz else registration_opens_at end,
    registration_closes_at=case when p_data ? 'registration_closes_at' then nullif(p_data->>'registration_closes_at','')::timestamptz else registration_closes_at end,
    max_teams=coalesce((p_data->>'max_teams')::integer,max_teams),
    roster_size=coalesce((p_data->>'roster_size')::integer,roster_size),
    prize_pool=coalesce((p_data->>'prize_pool')::numeric,prize_pool),
    currency=coalesce(p_data->>'currency',currency),
    map_pool=case when p_data ? 'map_pool' then array(select jsonb_array_elements_text(p_data->'map_pool')) else map_pool end,
    anti_cheat_required=coalesce((p_data->>'anti_cheat_required')::boolean,anti_cheat_required),
    substitute_limit=coalesce((p_data->>'substitute_limit')::smallint,substitute_limit),
    check_in_minutes=coalesce((p_data->>'check_in_minutes')::smallint,check_in_minutes),
    updated_at=now()
  where id=p_tournament_id and status='draft';
  if not found then raise exception 'Only drafts can be edited'; end if;
  perform private.write_audit_event('TOURNAMENT_UPDATED','tournament',p_tournament_id,'{}'::jsonb);
end;
$$;

create or replace function public.transition_tournament(p_tournament_id uuid,p_new_status text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_status text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select status into v_status from public.tournaments where id=p_tournament_id for update;
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
  if p_new_status='registration_open' and exists(select 1 from public.tournaments where id=p_tournament_id and
      (registration_closes_at is not null and registration_closes_at <= now())) then
    raise exception 'Registration close time has passed';
  end if;
  if p_new_status='in_progress' and not exists(select 1 from public.tournament_stages
      where tournament_id=p_tournament_id and status='published') then
    raise exception 'Publish a competition stage before starting the tournament';
  end if;
  if p_new_status='completed' and (
    not exists(select 1 from public.tournament_stages where tournament_id=p_tournament_id and status='published')
    or exists(select 1 from public.tournament_matches m where m.tournament_id=p_tournament_id
      and m.status not in ('completed','forfeit','cancelled'))
    or exists(select 1 from public.match_disputes d where d.match_id in
      (select id from public.tournament_matches where tournament_id=p_tournament_id) and d.status in ('open','under_review'))
  ) then raise exception 'Resolve every match and dispute before completing the tournament'; end if;
  if p_new_status='completed' then perform private.rebuild_final_placements(p_tournament_id); end if;
  update public.tournaments set status=p_new_status,updated_at=now() where id=p_tournament_id;
  perform private.write_audit_event('TOURNAMENT_STATUS_CHANGED','tournament',p_tournament_id,
    jsonb_build_object('from',v_status,'to',p_new_status));
end;
$$;

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
  if v_t.status <> 'registration_open' or (v_t.registration_opens_at is not null and now()<v_t.registration_opens_at)
     or (v_t.registration_closes_at is not null and now()>=v_t.registration_closes_at) then
    raise exception 'Tournament registration is closed';
  end if;
  if not exists(select 1 from public.teams t where t.id=p_team_id and t.game=v_t.game) then
    raise exception 'Team game does not match tournament';
  end if;
  select count(*) filter(where role <> 'substitute'), count(*) filter(where role = 'substitute')
    into v_members,v_subs from public.team_members where team_id=p_team_id and status='active';
  if v_members <> v_t.roster_size or v_subs > v_t.substitute_limit then raise exception 'Team roster must match the event size and substitute limit'; end if;
  select count(*) into v_used from public.tournament_registrations r
    where r.tournament_id=p_tournament_id and r.status in ('pending','approved','checked_in');
  if v_used >= v_t.max_teams then raise exception 'Tournament is full'; end if;
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

create or replace function public.review_registration(p_registration_id uuid,p_new_status text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_tournament_id uuid; v_status text; v_event_status text;
begin
  if auth.uid() is null or p_new_status not in ('approved','rejected') then raise exception 'Invalid review'; end if;
  select tournament_id into v_tournament_id from public.tournament_registrations where id=p_registration_id;
  if not found then raise exception 'Registration not found'; end if;
  select status into v_event_status from public.tournaments where id=v_tournament_id for update;
  select status into v_status from public.tournament_registrations
    where id=p_registration_id and tournament_id=v_tournament_id for update;
  if not found or not (private.can_manage_tournament(v_tournament_id,'registrations')
                       or private.can_manage_tournament(v_tournament_id,'manage_tournament')) then
    raise exception 'Tournament registration capability required';
  end if;
  if v_event_status not in ('registration_open','registration_closed')
     or exists(select 1 from public.tournament_stages s where s.tournament_id=v_tournament_id and s.status in ('published','in_progress','completed')) then
    raise exception 'Registration review is locked after event close or bracket publication';
  end if;
  if v_status <> 'pending' then raise exception 'Only pending registrations can be reviewed'; end if;
  update public.tournament_registrations set status=p_new_status where id=p_registration_id;
  perform private.write_audit_event('REGISTRATION_REVIEWED','tournament_registration',p_registration_id,
    jsonb_build_object('status',p_new_status));
end;
$$;

create or replace function public.check_in_team(p_registration_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_t public.tournaments%rowtype; v_tournament_id uuid; v_team_id uuid; v_status text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select tournament_id into v_tournament_id from public.tournament_registrations where id=p_registration_id;
  if not found then raise exception 'Registration not found'; end if;
  -- Keep the tournament-before-registration lock order shared with registration review.
  select * into v_t from public.tournaments where id=v_tournament_id for update;
  select team_id,status into v_team_id,v_status from public.tournament_registrations
    where id=p_registration_id and tournament_id=v_tournament_id for update;
  if not found then raise exception 'Registration not found'; end if;
  if v_team_id is null or not private.is_team_captain(v_team_id) then raise exception 'Team captain required'; end if;
  if v_status <> 'approved' or v_t.status not in ('registration_closed','in_progress') then raise exception 'Registration is not check-in eligible'; end if;
  if v_t.starts_at is not null and now() < v_t.starts_at - make_interval(mins => v_t.check_in_minutes) then
    raise exception 'Check-in window has not opened';
  end if;
  if v_t.starts_at is not null and now() > v_t.starts_at then raise exception 'Check-in window has closed'; end if;
  update public.tournament_registrations set status='checked_in' where id=p_registration_id;
  perform private.write_audit_event('TEAM_CHECKED_IN','tournament_registration',p_registration_id,'{}'::jsonb);
end;
$$;

create or replace function public.create_organization(p_name text,p_slug text,p_description text default '',p_region text default '')
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  insert into public.organizations(owner_id,name,slug,description,region)
    values(auth.uid(),trim(p_name),lower(trim(p_slug)),coalesce(p_description,''),coalesce(p_region,''))
    returning id into v_id;
  insert into public.organization_memberships(organization_id,user_id,role,capabilities)
    values(v_id,auth.uid(),'owner',array['manage_org','manage_staff','manage_teams','create_tournaments','manage_prizes']);
  perform private.write_audit_event('ORGANIZATION_CREATED','organization',v_id,'{}'::jsonb);
  return v_id;
end;
$$;

create or replace function public.set_organization_member(
  p_organization_id uuid,p_user_id uuid,p_role text,p_capabilities text[] default '{}'
)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not private.can_manage_organization(p_organization_id,'manage_staff') then
    raise exception 'Organization staff capability required';
  end if;
  if p_user_id is null or not exists(select 1 from auth.users where id=p_user_id)
     or p_role not in ('admin','staff')
     or not (coalesce(p_capabilities,'{}') <@ array['manage_org','manage_staff','manage_teams','create_tournaments','manage_prizes']::text[]) then
    raise exception 'Invalid organization membership';
  end if;
  insert into public.organization_memberships(organization_id,user_id,role,capabilities)
    values(p_organization_id,p_user_id,p_role,coalesce(p_capabilities,'{}'))
  on conflict(organization_id,user_id) do update set role=excluded.role,capabilities=excluded.capabilities;
  perform private.write_audit_event('ORG_MEMBER_ASSIGNED','organization',p_organization_id,
    jsonb_build_object('user_id',p_user_id,'role',p_role,'capabilities',p_capabilities));
end;
$$;

create or replace function public.set_tournament_staff(
  p_tournament_id uuid,p_user_id uuid,p_capabilities text[]
)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not private.can_manage_tournament(p_tournament_id,'manage_tournament') then
    raise exception 'Tournament management capability required';
  end if;
  if p_user_id is null or not exists(select 1 from auth.users where id=p_user_id)
     or cardinality(coalesce(p_capabilities,'{}'))=0
     or not (p_capabilities <@ array['manage_tournament','registrations','bracket','schedule','referee','disputes','prizes','rosters']::text[]) then
    raise exception 'Invalid tournament staff assignment';
  end if;
  insert into public.tournament_staff(tournament_id,user_id,capabilities,assigned_by)
    values(p_tournament_id,p_user_id,p_capabilities,auth.uid())
  on conflict(tournament_id,user_id) do update set capabilities=excluded.capabilities,assigned_by=excluded.assigned_by;
  perform private.write_audit_event('TOURNAMENT_STAFF_ASSIGNED','tournament',p_tournament_id,
    jsonb_build_object('user_id',p_user_id,'capabilities',p_capabilities));
end;
$$;

create or replace function public.remove_tournament_staff(p_tournament_id uuid,p_user_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not private.can_manage_tournament(p_tournament_id,'manage_tournament') then
    raise exception 'Tournament management capability required';
  end if;
  delete from public.tournament_staff where tournament_id=p_tournament_id and user_id=p_user_id;
  perform private.write_audit_event('TOURNAMENT_STAFF_REMOVED','tournament',p_tournament_id,
    jsonb_build_object('user_id',p_user_id));
end;
$$;

create or replace function public.generate_bracket(
  p_tournament_id uuid,p_seeded_registration_ids uuid[] default null
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_t public.tournaments%rowtype; v_stage uuid; v_format text; v_ids uuid[]; v_count integer;
  v_slots integer:=1; v_rounds integer:=0; v_round integer; v_pos integer; v_half integer;
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
    if v_count<4 or v_slots<>v_count then raise exception 'Double elimination currently requires at least four eligible teams and a power-of-two field'; end if;
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
    for v_pos in 1..(v_slots/2) loop
      update public.tournament_matches set home_registration_id=v_ids[(v_pos*2)-1],away_registration_id=v_ids[v_pos*2],status='ready'
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
    update public.tournament_matches w set loser_to_match_id=l.id,loser_to_slot='home'
      from public.tournament_matches l
      where w.stage_id=v_stage and w.bracket_side='winners' and w.round_number=v_rounds
        and l.stage_id=v_stage and l.bracket_side='losers' and l.round_number=v_lower_rounds and l.position=1;
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
$$;

-- Round-robin playoffs are a two-phase workflow. This RPC may be called only
-- after the round-robin stage is final; qualifiers come from stored standings.
create or replace function public.generate_playoff_stage(p_tournament_id uuid,p_qualifier_count integer default 4)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_t public.tournaments%rowtype; v_rr_stage uuid; v_stage uuid; v_ids uuid[];
  v_count integer; v_slots integer:=1; v_rounds integer:=0; v_round integer; v_pos integer;
  v_half integer; v_home uuid; v_away uuid; v_winner uuid; v_row record;
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
  v_half:=v_slots/2;
  for v_pos in 1..v_half loop
    v_home:=v_ids[v_pos]; v_away:=v_ids[v_pos+v_half];
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
$$;

create or replace function public.assign_match_official(p_match_id uuid,p_user_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_tournament_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select s.tournament_id into v_tournament_id from public.tournament_matches m
    join public.tournament_stages s on s.id=m.stage_id where m.id=p_match_id for update of m;
  if v_tournament_id is null or not private.can_manage_tournament(v_tournament_id,'schedule') then
    raise exception 'Tournament schedule capability required';
  end if;
  if not exists(select 1 from public.user_roles where user_id=p_user_id and role_key='REFEREE')
     and not exists(select 1 from public.tournament_staff ts where ts.tournament_id=v_tournament_id
       and ts.user_id=p_user_id and 'referee'=any(ts.capabilities)) then
    raise exception 'Referee eligibility required';
  end if;
  if exists(select 1 from public.tournament_matches m
      left join public.tournament_registrations h on h.id=m.home_registration_id
      left join public.tournament_registrations a on a.id=m.away_registration_id
      where m.id=p_match_id and (
        exists(select 1 from public.team_members tm where tm.team_id=h.team_id and tm.user_id=p_user_id and tm.status='active')
        or exists(select 1 from public.team_members tm where tm.team_id=a.team_id and tm.user_id=p_user_id and tm.status='active')
      )) then raise exception 'A match participant cannot officiate that match'; end if;
  insert into public.match_officials(match_id,user_id,assigned_by) values(p_match_id,p_user_id,auth.uid())
    on conflict(match_id,user_id) do nothing;
  perform private.write_audit_event('MATCH_OFFICIAL_ASSIGNED','match',p_match_id,
    jsonb_build_object('user_id',p_user_id,'tournament_id',v_tournament_id));
end;
$$;

create or replace function public.schedule_match(p_match_id uuid,p_scheduled_at timestamptz)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_tournament_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select s.tournament_id into v_tournament_id from public.tournament_matches m
    join public.tournament_stages s on s.id=m.stage_id where m.id=p_match_id for update of m;
  if v_tournament_id is null or not private.can_manage_tournament(v_tournament_id,'schedule') then
    raise exception 'Tournament schedule capability required';
  end if;
  update public.tournament_matches set scheduled_at=p_scheduled_at,updated_at=now()
    where id=p_match_id and status in ('pending','ready');
  if not found then raise exception 'Match cannot be rescheduled in its current state'; end if;
  perform private.write_audit_event('MATCH_SCHEDULED','match',p_match_id,
    jsonb_build_object('scheduled_at',p_scheduled_at));
end;
$$;

create or replace function public.referee_match(p_match_id uuid,p_action text,p_note text default '')
returns void language plpgsql security definer set search_path = ''
as $$
declare v_match public.tournament_matches%rowtype; v_tournament_id uuid; v_next text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select m.* into v_match from public.tournament_matches m
    join public.tournament_stages s on s.id=m.stage_id where m.id=p_match_id for update of m;
  select tournament_id into v_tournament_id from public.tournament_stages where id=v_match.stage_id;
  if v_match.id is null or not exists(select 1 from public.match_officials o where o.match_id=p_match_id and o.user_id=auth.uid()) then
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

create or replace function public.submit_match_result(
  p_match_id uuid,p_home_score smallint,p_away_score smallint,p_evidence_object_keys text[] default '{}'
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_match public.tournament_matches%rowtype; v_stage public.tournament_stages%rowtype;
  v_home_team uuid; v_away_team uuid; v_registration uuid; v_team_id uuid; v_needed integer; v_id uuid; v_key text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_match from public.tournament_matches where id=p_match_id for update;
  if not found then raise exception 'Match not found'; end if;
  select * into v_stage from public.tournament_stages where id=v_match.stage_id;
  select team_id into v_home_team from public.tournament_registrations where id=v_match.home_registration_id;
  select team_id into v_away_team from public.tournament_registrations where id=v_match.away_registration_id;
  if private.is_team_captain(v_home_team) then v_registration:=v_match.home_registration_id; v_team_id:=v_home_team;
  elsif private.is_team_captain(v_away_team) then v_registration:=v_match.away_registration_id; v_team_id:=v_away_team;
  else raise exception 'Only a participant team captain may submit a result'; end if;
  if v_match.status not in ('live','result_pending') then raise exception 'Match is not accepting results'; end if;
  if p_home_score is null or p_away_score is null or p_home_score<0 or p_away_score<0 or p_home_score=p_away_score then
    raise exception 'Invalid score';
  end if;
  select case t.best_of when 'BO1' then 1 when 'BO3' then 2 when 'BO5' then 3 when 'BO7' then 4 else 2 end
    into v_needed from public.tournaments t where t.id=v_stage.tournament_id;
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

create or replace function private.advance_match_winner(p_match_id uuid,p_winner_registration_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_match public.tournament_matches%rowtype; v_stage public.tournament_stages%rowtype;
  v_parent_id uuid; v_loser_parent_id uuid; v_slot text; v_next_status text; v_loser uuid;
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
        where id=v_loser_parent_id and home_registration_id is not null and away_registration_id is not null
          and status='pending';
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
  if not exists(select 1 from public.match_officials o where o.match_id=v_match.id and o.user_id=auth.uid())
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

create or replace function public.open_match_dispute(p_match_id uuid,p_reason text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_match public.tournament_matches%rowtype; v_reg uuid; v_home_team uuid; v_away_team uuid; v_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_match from public.tournament_matches where id=p_match_id for update;
  if not found or v_match.status not in ('live','result_pending','completed','forfeit') then raise exception 'Match cannot be disputed'; end if;
  select team_id into v_home_team from public.tournament_registrations where id=v_match.home_registration_id;
  select team_id into v_away_team from public.tournament_registrations where id=v_match.away_registration_id;
  if private.is_team_captain(v_home_team) then v_reg:=v_match.home_registration_id;
  elsif private.is_team_captain(v_away_team) then v_reg:=v_match.away_registration_id;
  else raise exception 'Only a participant team captain may open a dispute'; end if;
  if exists(select 1 from public.match_disputes where match_id=p_match_id) then raise exception 'This match has already had a dispute'; end if;
  if v_match.completed_at is not null and now()>v_match.completed_at+interval '24 hours' then raise exception 'Dispute deadline has passed'; end if;
  insert into public.match_disputes(tournament_id,match_id,opened_by,registration_id,reason)
    values(v_match.tournament_id,p_match_id,auth.uid(),v_reg,trim(p_reason)) returning id into v_id;
  update public.tournament_matches set status='disputed',updated_at=now() where id=p_match_id;
  perform private.write_audit_event('MATCH_DISPUTE_OPENED','match_dispute',v_id,
    jsonb_build_object('match_id',p_match_id,'registration_id',v_reg));
  return v_id;
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
      review_note='Selected by dispute resolution',reviewed_at=now()
      where id=v_selected.id;
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
  ), ranked as (
    select *,dense_rank() over(order by points desc,(score_for-score_against) desc,score_for desc,registration_id)::integer rank
    from totals
  )
  insert into public.tournament_standings(stage_id,tournament_id,registration_id,played,wins,draws,losses,points,score_for,score_against,rank)
  select p_stage_id,s.tournament_id,ranked.registration_id,played,wins,draws,losses,points,score_for,score_against,rank
    from ranked cross join public.tournament_stages s where s.id=p_stage_id;
end;
$$;

-- Elimination stages expose authoritative podium placements only after the
-- entire event is settled. Other elimination places are not inferred.
create or replace function private.rebuild_final_placements(p_tournament_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_stage public.tournament_stages%rowtype; v_final public.tournament_matches%rowtype;
  v_winner uuid; v_runner_up uuid;
begin
  select * into v_stage from public.tournament_stages
    where tournament_id=p_tournament_id order by stage_number desc limit 1;
  if not found or v_stage.format='round_robin' then return; end if;
  if v_stage.format='double_elimination' then
    select * into v_final from public.tournament_matches where stage_id=v_stage.id
      and bracket_side='grand_final' and status in ('completed','forfeit')
      order by position desc limit 1;
  else
    select * into v_final from public.tournament_matches where stage_id=v_stage.id
      and bracket_side='main' and round_number=(select max(round_number) from public.tournament_matches
        where stage_id=v_stage.id and bracket_side='main') and status in ('completed','forfeit')
      order by position limit 1;
  end if;
  if v_final.id is null or v_final.winner_registration_id is null then
    raise exception 'Final match result is missing; podium standings cannot be created';
  end if;
  v_winner:=v_final.winner_registration_id;
  v_runner_up:=case when v_final.home_registration_id=v_winner then v_final.away_registration_id else v_final.home_registration_id end;
  if v_runner_up is null then raise exception 'Final match has no runner-up'; end if;
  delete from public.tournament_standings where stage_id=v_stage.id;
  with participants as (
    select v_winner registration_id,1::integer rank
    union all select v_runner_up,2::integer
  ), outcomes as (
    select home_registration_id registration_id,1 played,
      case when winner_registration_id=home_registration_id then 1 else 0 end wins,
      case when winner_registration_id<>home_registration_id then 1 else 0 end losses,
      case when winner_registration_id=home_registration_id then 3 else 0 end points,
      coalesce(home_score,0)::integer score_for,coalesce(away_score,0)::integer score_against
    from public.tournament_matches where stage_id=v_stage.id and status in ('completed','forfeit')
      and home_registration_id is not null and away_registration_id is not null
    union all
    select away_registration_id,1,
      case when winner_registration_id=away_registration_id then 1 else 0 end,
      case when winner_registration_id<>away_registration_id then 1 else 0 end,
      case when winner_registration_id=away_registration_id then 3 else 0 end,
      coalesce(away_score,0)::integer,coalesce(home_score,0)::integer
    from public.tournament_matches where stage_id=v_stage.id and status in ('completed','forfeit')
      and home_registration_id is not null and away_registration_id is not null
  ), totals as (
    select registration_id,sum(played)::integer played,sum(wins)::integer wins,sum(losses)::integer losses,
      sum(points)::integer points,sum(score_for)::integer score_for,sum(score_against)::integer score_against
    from outcomes group by registration_id
  )
  insert into public.tournament_standings(stage_id,tournament_id,registration_id,played,wins,losses,points,score_for,score_against,rank)
  select v_stage.id,p_tournament_id,p.registration_id,coalesce(t.played,0),coalesce(t.wins,0),
    coalesce(t.losses,0),coalesce(t.points,0),coalesce(t.score_for,0),coalesce(t.score_against,0),p.rank
  from participants p left join totals t using(registration_id);
end;
$$;

create or replace function public.create_moderation_case(
  p_subject_user_id uuid,p_subject_team_id uuid,p_subject_tournament_id uuid,p_category text,p_description text
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  insert into public.moderation_cases(reporter_id,subject_user_id,subject_team_id,subject_tournament_id,category,description)
    values(auth.uid(),p_subject_user_id,p_subject_team_id,p_subject_tournament_id,trim(p_category),trim(p_description))
    returning id into v_id;
  perform private.write_audit_event('MODERATION_CASE_CREATED','moderation_case',v_id,'{}'::jsonb);
  return v_id;
end;
$$;

create or replace function public.set_moderation_staff(p_user_id uuid,p_capabilities text[] default array['review_cases']::text[])
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_super_admin() then raise exception 'SUPER_ADMIN required'; end if;
  if p_user_id is null or not exists(select 1 from auth.users where id=p_user_id)
     or cardinality(p_capabilities)=0 or not (p_capabilities <@ array['review_cases','warn_users','suspend_users','ban_users']::text[]) then
    raise exception 'Invalid moderation staff assignment';
  end if;
  insert into public.moderation_staff(user_id,capabilities,assigned_by) values(p_user_id,p_capabilities,auth.uid())
    on conflict(user_id) do update set capabilities=excluded.capabilities,assigned_by=excluded.assigned_by;
  perform private.write_audit_event('MODERATOR_ASSIGNED','user',p_user_id,'{}'::jsonb);
end;
$$;

create or replace function public.review_moderation_case(
  p_case_id uuid,p_new_status text,p_decision text,p_decision_note text default ''
)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_case public.moderation_cases%rowtype;
begin
  if auth.uid() is null or p_new_status not in ('under_review','resolved','dismissed') then raise exception 'Invalid moderation action'; end if;
  select * into v_case from public.moderation_cases where id=p_case_id for update;
  if not found or v_case.status in ('resolved','dismissed') then raise exception 'Case is closed'; end if;
  if v_case.assigned_to is distinct from auth.uid() and not private.is_super_admin() then
    raise exception 'Case assignment required';
  end if;
  if p_new_status in ('resolved','dismissed') and length(trim(coalesce(p_decision,'')))<2 then
    raise exception 'A resolution decision is required';
  end if;
  update public.moderation_cases set status=p_new_status,decision=case when p_new_status='under_review' then decision else left(p_decision,100) end,
    decision_note=case when p_new_status='under_review' then decision_note else left(coalesce(p_decision_note,''),3000) end,
    assigned_to=case when p_new_status='under_review' then auth.uid() else assigned_to end,
    resolved_by=case when p_new_status in ('resolved','dismissed') then auth.uid() else resolved_by end,
    updated_at=now() where id=p_case_id;
  perform private.write_audit_event('MODERATION_CASE_REVIEWED','moderation_case',p_case_id,
    jsonb_build_object('status',p_new_status,'decision',case when p_new_status='under_review' then null else p_decision end));
end;
$$;

create or replace function public.assign_moderation_case(p_case_id uuid,p_reviewer_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_status text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.is_super_admin() and not public.has_permission('REVIEW_REPORTS')
     and not exists(select 1 from public.moderation_staff
      where user_id=auth.uid() and 'review_cases'=any(capabilities)) then
    raise exception 'Moderator assignment capability required';
  end if;
  if not exists(select 1 from public.moderation_staff where user_id=p_reviewer_id and 'review_cases'=any(capabilities))
     and not exists(select 1 from public.user_roles where user_id=p_reviewer_id and role_key='MODERATOR')
     and not private.is_super_admin() then raise exception 'Reviewer is not eligible'; end if;
  select status into v_status from public.moderation_cases where id=p_case_id for update;
  if not found or v_status in ('resolved','dismissed') then raise exception 'Case is closed'; end if;
  update public.moderation_cases set assigned_to=p_reviewer_id,status='under_review',updated_at=now() where id=p_case_id;
  perform private.write_audit_event('MODERATION_CASE_ASSIGNED','moderation_case',p_case_id,
    jsonb_build_object('reviewer_id',p_reviewer_id));
end;
$$;

create or replace function public.record_prize_award(
  p_tournament_id uuid,p_prize_id uuid,p_registration_id uuid
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_id uuid; v_place smallint;
begin
  if auth.uid() is null or not private.can_manage_tournament(p_tournament_id,'prizes') then
    raise exception 'Tournament prize capability required';
  end if;
  select place into v_place from public.tournament_prizes where id=p_prize_id and tournament_id=p_tournament_id;
  if not found or not exists(select 1 from public.tournaments where id=p_tournament_id and status='completed')
     or not exists(select 1 from public.tournament_registrations where id=p_registration_id and tournament_id=p_tournament_id)
     or not exists(select 1 from public.tournament_standings st
        join public.tournament_stages sg on sg.id=st.stage_id and sg.tournament_id=st.tournament_id
        where st.tournament_id=p_tournament_id and st.registration_id=p_registration_id and st.rank=v_place
          and sg.status='completed' and sg.stage_number=(select max(sg2.stage_number)
            from public.tournament_stages sg2 where sg2.tournament_id=p_tournament_id)) then
    raise exception 'Prize, completed event, and recipient must belong to the same tournament';
  end if;
  insert into public.prize_awards(tournament_id,prize_id,registration_id,status)
    values(p_tournament_id,p_prize_id,p_registration_id,'pending')
    on conflict(prize_id,registration_id) do update set prize_id=excluded.prize_id
    returning id into v_id;
  perform private.write_audit_event('PRIZE_AWARD_RECORDED','prize_award',v_id,
    jsonb_build_object('tournament_id',p_tournament_id,'registration_id',p_registration_id));
  return v_id;
end;
$$;

create or replace function public.approve_prize_award(p_award_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_award public.prize_awards%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_award from public.prize_awards where id=p_award_id for update;
  if not found or not private.can_manage_tournament(v_award.tournament_id,'prizes') then
    raise exception 'Tournament prize capability required';
  end if;
  if v_award.status<>'pending' then raise exception 'Only pending awards can be approved'; end if;
  update public.prize_awards set status='approved',approved_by=auth.uid(),approved_at=now() where id=p_award_id;
  perform private.write_audit_event('PRIZE_AWARD_APPROVED','prize_award',p_award_id,'{}'::jsonb);
end;
$$;

create or replace function public.upsert_tournament_prize(
  p_tournament_id uuid,p_place smallint,p_label text,p_amount numeric,p_currency text
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  if auth.uid() is null or not private.can_manage_tournament(p_tournament_id,'prizes') then
    raise exception 'Tournament prize capability required';
  end if;
  perform 1 from public.tournaments where id=p_tournament_id and status='draft' for update;
  if not found then raise exception 'Prize schedule is locked after registration opens'; end if;
  if p_place<1 or p_amount<0 or p_currency !~ '^[A-Z]{3}$' then raise exception 'Invalid prize'; end if;
  insert into public.tournament_prizes(tournament_id,place,label,amount,currency)
    values(p_tournament_id,p_place,left(coalesce(p_label,''),120),p_amount,p_currency)
  on conflict(tournament_id,place) do update set label=excluded.label,amount=excluded.amount,currency=excluded.currency
  returning id into v_id;
  perform private.write_audit_event('TOURNAMENT_PRIZE_SCHEDULED','tournament_prize',v_id,
    jsonb_build_object('tournament_id',p_tournament_id,'place',p_place));
  return v_id;
end;
$$;

-- Payment completion is an internal webhook-only transition. No browser role
-- can mark an award paid without verified provider confirmation.
create or replace function public.mark_prize_paid(p_award_id uuid,p_payment_reference text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_award public.prize_awards%rowtype;
begin
  if auth.role()<>'service_role' then raise exception 'Verified payment webhook required'; end if;
  if length(trim(coalesce(p_payment_reference,''))) not between 4 and 200 then raise exception 'Invalid payment reference'; end if;
  select * into v_award from public.prize_awards where id=p_award_id for update;
  if not found then raise exception 'Prize award not found'; end if;
  if v_award.status='paid' then return; end if;
  if v_award.status<>'approved' then raise exception 'Only approved awards can be marked paid'; end if;
  update public.prize_awards set status='paid',paid_at=now(),payment_reference=p_payment_reference where id=p_award_id;
  perform private.write_audit_event('PRIZE_AWARD_PAID','prize_award',p_award_id,'{}'::jsonb);
end;
$$;

-- Private evidence uploads are restricted by a restrictive policy as well as
-- bucket-specific allow policies, so unrelated permissive storage policies
-- cannot make this bucket public.
-- The Supabase-managed storage.objects table is owned by supabase_storage_admin;
-- this database migration role cannot safely install bucket policies. The
-- private match-evidence bucket is provisioned separately in Storage settings
-- after applying the scoped policies there. No browser upload is enabled yet.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('match-evidence','match-evidence',false,20971520,array['image/jpeg','image/png','image/webp','video/mp4'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

-- Explicit browser-function allowlist. SECURITY DEFINER does not replace the
-- scope/state checks inside each body; this only controls who may invoke them.
revoke all on function public.create_team(text,text,text,text,uuid),
  public.create_team_invitation(uuid,text,interval,uuid),public.list_team_invitations(uuid),
  public.accept_team_invitation(text),public.revoke_team_invitation(uuid),public.list_team_roster(uuid),
  public.update_team(uuid,text,text,text,text,uuid),public.remove_team_member(uuid,uuid),
  public.change_member_role(uuid,uuid,text),public.leave_team(uuid),public.create_organization(text,text,text,text),
  public.set_organization_member(uuid,uuid,text,text[]),public.set_tournament_staff(uuid,uuid,text[]),
  public.remove_tournament_staff(uuid,uuid),public.create_tournament(jsonb),public.update_tournament(uuid,jsonb),
  public.transition_tournament(uuid,text),public.register_team(uuid,uuid),public.review_registration(uuid,text),
  public.check_in_team(uuid),public.generate_bracket(uuid,uuid[]),public.assign_match_official(uuid,uuid),
  public.generate_playoff_stage(uuid,integer),
  public.schedule_match(uuid,timestamptz),public.referee_match(uuid,text,text),
  public.submit_match_result(uuid,smallint,smallint,text[]),public.review_match_result(uuid,text,text),
  public.open_match_dispute(uuid,text),public.resolve_match_dispute(uuid,text,text),
  public.create_moderation_case(uuid,uuid,uuid,text,text),public.set_moderation_staff(uuid,text[]),
  public.assign_moderation_case(uuid,uuid),public.review_moderation_case(uuid,text,text,text),
  public.record_prize_award(uuid,uuid,uuid),
  public.upsert_tournament_prize(uuid,smallint,text,numeric,text),public.approve_prize_award(uuid),
  public.mark_prize_paid(uuid,text) from public,anon,authenticated;
grant execute on function public.create_team(text,text,text,text,uuid),
  public.create_team_invitation(uuid,text,interval,uuid),public.list_team_invitations(uuid),
  public.accept_team_invitation(text),public.revoke_team_invitation(uuid),public.list_team_roster(uuid),
  public.update_team(uuid,text,text,text,text,uuid),public.remove_team_member(uuid,uuid),
  public.change_member_role(uuid,uuid,text),public.leave_team(uuid),public.create_organization(text,text,text,text),
  public.set_organization_member(uuid,uuid,text,text[]),public.set_tournament_staff(uuid,uuid,text[]),
  public.remove_tournament_staff(uuid,uuid),public.create_tournament(jsonb),public.update_tournament(uuid,jsonb),
  public.transition_tournament(uuid,text),public.register_team(uuid,uuid),public.review_registration(uuid,text),
  public.check_in_team(uuid),public.generate_bracket(uuid,uuid[]),public.assign_match_official(uuid,uuid),
  public.generate_playoff_stage(uuid,integer),
  public.schedule_match(uuid,timestamptz),public.referee_match(uuid,text,text),
  public.submit_match_result(uuid,smallint,smallint,text[]),public.review_match_result(uuid,text,text),
  public.open_match_dispute(uuid,text),public.resolve_match_dispute(uuid,text,text),
  public.create_moderation_case(uuid,uuid,uuid,text,text),public.set_moderation_staff(uuid,text[]),
  public.assign_moderation_case(uuid,uuid),public.review_moderation_case(uuid,text,text,text),
  public.record_prize_award(uuid,uuid,uuid),
  public.upsert_tournament_prize(uuid,smallint,text,numeric,text),public.approve_prize_award(uuid)
  to authenticated;
grant execute on function public.mark_prize_paid(uuid,text) to service_role;
revoke all on function private.advance_match_winner(uuid,uuid),private.rebuild_standings(uuid),private.rebuild_final_placements(uuid),
  private.protect_team_captain_membership(),private.protect_snapshotted_membership(),
  private.sync_public_profile(),private.reject_audit_mutation() from public,anon,authenticated;
grant execute on function private.can_access_match(uuid) to authenticated;

-- Keep role lookups available to signed-in screens. Role grants themselves
-- remain available only through the guarded SUPER_ADMIN assign/revoke RPCs.
grant execute on function public.has_permission(text),public.get_my_roles(),public.get_my_permissions() to authenticated;
revoke execute on function public.has_permission(text),public.get_my_roles(),public.get_my_permissions() from anon;

do $$
begin
  if has_table_privilege('anon','public.tournaments','INSERT')
     or has_table_privilege('authenticated','public.tournaments','UPDATE')
     or has_table_privilege('anon','public.audit_events','TRUNCATE')
     or has_table_privilege('authenticated','public.user_roles','DELETE')
     or has_table_privilege('anon','public.team_invitations','SELECT')
     or has_table_privilege('authenticated','public.team_invitations','INSERT') then
    raise exception 'Unexpected browser privilege remains on a protected table';
  end if;
  if not has_function_privilege('authenticated','public.create_team(text,text,text,text,uuid)','EXECUTE')
     or has_function_privilege('anon','public.create_team(text,text,text,text,uuid)','EXECUTE')
     or has_function_privilege('authenticated','public.mark_prize_paid(uuid,text)','EXECUTE') then
    raise exception 'Unexpected browser RPC privilege on a protected function';
  end if;
end;
$$;


