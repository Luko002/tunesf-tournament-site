
-- Replace the project's initial enum roles with the TUNESF role/permission model.
-- Existing auth.users, profiles data shape, and signup flow are preserved.
drop trigger if exists on_auth_user_created_assign_role on auth.users;
drop trigger if exists on_auth_user_created_profile on auth.users;
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists private.assign_default_app_role();
drop function if exists private.create_player_profile();

drop table if exists public.user_roles;
drop type if exists public.app_role;

create table if not exists public.roles (
  key text primary key,
  label text not null,
  level int not null,
  icon text,
  blurb text
);

insert into public.roles (key,label,level,icon,blurb) values
  ('VISITOR','Visitor',0,'eye','Public browsing only — tournaments, standings, brackets and news.'),
  ('PLAYER','Player',1,'user','Competitive participant on a verified roster.'),
  ('CAPTAIN','Captain',2,'crown','Team manager and tournament representative.'),
  ('REFEREE','Referee',3,'gavel','Neutral match official. Never belongs to a team.'),
  ('MODERATOR','Moderator',4,'flag','Community management — reports, content and conduct.'),
  ('TOURNAMENT_ADMIN','Tournament Admin',5,'clipboard-list','Runs a specific tournament end-to-end.'),
  ('ORGANIZATION_OWNER','Org Owner',6,'landmark','Owns an organization: teams, staff, sponsors, brand.'),
  ('PLATFORM_ADMIN','Platform Admin',7,'shield-alert','Full platform control — users, security, payments.'),
  ('SUPER_ADMIN','Super Admin',8,'shield-check','Federation owners only. Everything.')
on conflict (key) do update set label=excluded.label, level=excluded.level, icon=excluded.icon, blurb=excluded.blurb;

create table if not exists public.permissions (
  key text primary key,
  label text not null
);

insert into public.permissions (key,label) values
  ('VIEW_TOURNAMENTS','View tournaments, standings and brackets'),
  ('PLAYER_ZONE','Access the player dashboard'),
  ('CAPTAIN_CONSOLE','Access the captain console'),
  ('RECEIVE_INVITES','Receive team invitations'),
  ('CONFIRM_AVAILABILITY','Confirm availability & mark ready'),
  ('CREATE_TEAM','Create a team'),
  ('INVITE_PLAYERS','Invite or remove players, lock roster'),
  ('REGISTER_TOURNAMENT','Register a team into a tournament'),
  ('CHECKIN_TEAM','Perform team check-in'),
  ('SUBMIT_RESULT','Submit match results'),
  ('UPLOAD_EVIDENCE','Upload match evidence'),
  ('OPEN_DISPUTE','Open a dispute'),
  ('REFEREE_MATCHES','Referee assigned matches'),
  ('VERIFY_TEAMS','Verify teams and rosters'),
  ('START_MATCH','Start matches'),
  ('PAUSE_MATCH','Pause / resume matches'),
  ('APPROVE_RESULT','Approve / validate results'),
  ('REJECT_RESULT','Reject incorrect submissions'),
  ('FILE_INCIDENT','File incident reports'),
  ('REVIEW_REPORTS','Review community reports'),
  ('MODERATE_CONTENT','Remove content, moderate community'),
  ('WARN_USERS','Issue user warnings'),
  ('CREATE_TOURNAMENT','Create and publish tournaments'),
  ('EDIT_BRACKET','Generate and correct brackets'),
  ('SEED_TEAMS','Seed teams into brackets'),
  ('ASSIGN_REFEREES','Assign referees to matches'),
  ('RESOLVE_DISPUTE','Rule on disputes (replay / penalty)'),
  ('MANAGE_SCHEDULE','Manage tournament schedules'),
  ('CONFIRM_ROSTER','Confirm rosters'),
  ('MANAGE_ORGANIZATION','Manage the organization'),
  ('MANAGE_STAFF','Manage organization staff'),
  ('MANAGE_SPONSORS','Manage sponsors'),
  ('MANAGE_BRANDING','Manage branding'),
  ('BAN_USERS','Ban / suspend users and teams'),
  ('RELEASE_PRIZES','Release prize payments'),
  ('FORCE_PAUSE','Force pause / terminate live matches'),
  ('AUDIT_LOGS','Access the audit log'),
  ('MANAGE_PERMISSIONS','Grant roles and permissions'),
  ('PLATFORM_SETTINGS','Platform settings, database, integrations')
on conflict (key) do update set label=excluded.label;

create table if not exists public.role_permissions (
  role_key text not null references public.roles(key) on delete cascade,
  permission_key text not null references public.permissions(key) on delete cascade,
  primary key(role_key,permission_key)
);

-- Rebuild the matrix from the supplied SQL so changes are reproducible.
delete from public.role_permissions;
insert into public.role_permissions(role_key,permission_key) values
  ('VISITOR','VIEW_TOURNAMENTS'),
  ('PLAYER','VIEW_TOURNAMENTS'),('PLAYER','PLAYER_ZONE'),('PLAYER','RECEIVE_INVITES'),('PLAYER','CONFIRM_AVAILABILITY'),
  ('CAPTAIN','VIEW_TOURNAMENTS'),('CAPTAIN','PLAYER_ZONE'),('CAPTAIN','CAPTAIN_CONSOLE'),('CAPTAIN','RECEIVE_INVITES'),
  ('CAPTAIN','CONFIRM_AVAILABILITY'),('CAPTAIN','CREATE_TEAM'),('CAPTAIN','INVITE_PLAYERS'),('CAPTAIN','REGISTER_TOURNAMENT'),
  ('CAPTAIN','CHECKIN_TEAM'),('CAPTAIN','SUBMIT_RESULT'),('CAPTAIN','UPLOAD_EVIDENCE'),('CAPTAIN','OPEN_DISPUTE'),
  ('REFEREE','VIEW_TOURNAMENTS'),('REFEREE','REFEREE_MATCHES'),('REFEREE','VERIFY_TEAMS'),('REFEREE','START_MATCH'),
  ('REFEREE','PAUSE_MATCH'),('REFEREE','APPROVE_RESULT'),('REFEREE','REJECT_RESULT'),('REFEREE','FILE_INCIDENT'),
  ('MODERATOR','VIEW_TOURNAMENTS'),('MODERATOR','REVIEW_REPORTS'),('MODERATOR','MODERATE_CONTENT'),('MODERATOR','WARN_USERS'),
  ('TOURNAMENT_ADMIN','VIEW_TOURNAMENTS'),('TOURNAMENT_ADMIN','CREATE_TOURNAMENT'),('TOURNAMENT_ADMIN','EDIT_BRACKET'),
  ('TOURNAMENT_ADMIN','SEED_TEAMS'),('TOURNAMENT_ADMIN','ASSIGN_REFEREES'),('TOURNAMENT_ADMIN','APPROVE_RESULT'),
  ('TOURNAMENT_ADMIN','RESOLVE_DISPUTE'),('TOURNAMENT_ADMIN','MANAGE_SCHEDULE'),('TOURNAMENT_ADMIN','REGISTER_TOURNAMENT'),
  ('TOURNAMENT_ADMIN','CONFIRM_ROSTER'),
  ('ORGANIZATION_OWNER','VIEW_TOURNAMENTS'),('ORGANIZATION_OWNER','MANAGE_ORGANIZATION'),('ORGANIZATION_OWNER','CREATE_TEAM'),
  ('ORGANIZATION_OWNER','INVITE_PLAYERS'),('ORGANIZATION_OWNER','REGISTER_TOURNAMENT'),('ORGANIZATION_OWNER','MANAGE_STAFF'),
  ('ORGANIZATION_OWNER','MANAGE_SPONSORS'),('ORGANIZATION_OWNER','MANAGE_BRANDING'),
  ('PLATFORM_ADMIN','VIEW_TOURNAMENTS'),('PLATFORM_ADMIN','PLAYER_ZONE'),('PLATFORM_ADMIN','CAPTAIN_CONSOLE'),
  ('PLATFORM_ADMIN','REFEREE_MATCHES'),('PLATFORM_ADMIN','REVIEW_REPORTS'),('PLATFORM_ADMIN','MODERATE_CONTENT'),
  ('PLATFORM_ADMIN','WARN_USERS'),('PLATFORM_ADMIN','CREATE_TOURNAMENT'),('PLATFORM_ADMIN','EDIT_BRACKET'),
  ('PLATFORM_ADMIN','APPROVE_RESULT'),('PLATFORM_ADMIN','RESOLVE_DISPUTE'),('PLATFORM_ADMIN','ASSIGN_REFEREES'),
  ('PLATFORM_ADMIN','REGISTER_TOURNAMENT'),('PLATFORM_ADMIN','CONFIRM_ROSTER'),('PLATFORM_ADMIN','CREATE_TEAM'),
  ('PLATFORM_ADMIN','INVITE_PLAYERS'),('PLATFORM_ADMIN','MANAGE_ORGANIZATION'),('PLATFORM_ADMIN','MANAGE_SCHEDULE'),
  ('PLATFORM_ADMIN','START_MATCH'),('PLATFORM_ADMIN','PAUSE_MATCH'),('PLATFORM_ADMIN','BAN_USERS'),
  ('PLATFORM_ADMIN','RELEASE_PRIZES'),('PLATFORM_ADMIN','FORCE_PAUSE'),('PLATFORM_ADMIN','AUDIT_LOGS');
insert into public.role_permissions(role_key,permission_key)
select 'SUPER_ADMIN', key from public.permissions
on conflict do nothing;

alter table public.profiles add column if not exists username text;
alter table public.profiles add column if not exists team text;
alter table public.profiles add column if not exists org text;
create unique index if not exists profiles_username_unique on public.profiles(username) where username is not null;

create table public.user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role_key text not null references public.roles(key) on delete cascade,
  granted_by uuid references auth.users(id),
  granted_at timestamptz not null default now(),
  primary key(user_id,role_key)
);
create index user_roles_user_idx on public.user_roles(user_id);
create index role_permissions_role_idx on public.role_permissions(role_key);

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  actor uuid references auth.users(id),
  action text not null,
  detail text,
  created_at timestamptz not null default now()
);

create or replace function private.user_has_permission(uid uuid, perm text)
returns boolean language sql stable security definer set search_path=''
as $$
  select exists (
    select 1 from public.user_roles ur
    join public.role_permissions rp on rp.role_key=ur.role_key
    where ur.user_id=uid and rp.permission_key=perm
  );
$$;

create or replace function public.has_permission(perm text)
returns boolean language sql stable security definer set search_path=''
as $$ select auth.uid() is not null and private.user_has_permission(auth.uid(),perm); $$;

create or replace function public.get_my_roles()
returns table(role_key text,label text,level int)
language sql stable security invoker set search_path=''
as $$
  select r.key,r.label,r.level from public.user_roles ur
  join public.roles r on r.key=ur.role_key
  where ur.user_id=auth.uid();
$$;

create or replace function public.get_my_permissions()
returns setof text language sql stable security invoker set search_path=''
as $$
  select distinct rp.permission_key from public.user_roles ur
  join public.role_permissions rp on rp.role_key=ur.role_key
  where ur.user_id=auth.uid();
$$;

create or replace function public.assign_role(target uuid, requested_role text)
returns void language plpgsql security definer set search_path=''
as $$
begin
  if not public.has_permission('MANAGE_PERMISSIONS') then
    raise exception 'MANAGE_PERMISSIONS required to assign roles';
  end if;
  if requested_role='VISITOR' or not exists(select 1 from public.roles r where r.key=requested_role) then
    raise exception 'Unknown or non-assignable role: %', requested_role;
  end if;
  insert into public.user_roles(user_id,role_key,granted_by)
  values(target,requested_role,auth.uid()) on conflict do nothing;
  insert into public.audit_log(actor,action,detail)
  values(auth.uid(),'ROLE_ASSIGN',requested_role || ' -> ' || target::text);
end;
$$;

create or replace function public.revoke_role(target uuid, requested_role text)
returns void language plpgsql security definer set search_path=''
as $$
begin
  if not public.has_permission('MANAGE_PERMISSIONS') then
    raise exception 'MANAGE_PERMISSIONS required to revoke roles';
  end if;
  if requested_role='SUPER_ADMIN' and not exists(
    select 1 from public.user_roles ur
    where ur.role_key='SUPER_ADMIN' and ur.user_id<>target
  ) then
    raise exception 'Cannot revoke the last Super Admin role';
  end if;
  delete from public.user_roles ur where ur.user_id=target and ur.role_key=requested_role;
  insert into public.audit_log(actor,action,detail)
  values(auth.uid(),'ROLE_REVOKE',requested_role || ' x ' || target::text);
end;
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path=''
as $$
declare
  new_name text;
  new_game text;
begin
  new_name:=coalesce(nullif(trim(new.raw_user_meta_data->>'username'),''),nullif(trim(new.raw_user_meta_data->>'player_name'),''),split_part(new.email,'@',1));
  new_game:=coalesce(nullif(trim(new.raw_user_meta_data->>'game'),''),'Not selected');
  insert into public.profiles(id,player_name,game,username)
  values(new.id,new_name,new_game,new_name)
  on conflict(id) do nothing;
  insert into public.user_roles(user_id,role_key)
  values(new.id,'PLAYER') on conflict do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.audit_log enable row level security;

drop policy if exists "roles public read" on public.roles;
create policy "roles public read" on public.roles for select to anon,authenticated using(true);
drop policy if exists "permissions public read" on public.permissions;
create policy "permissions public read" on public.permissions for select to anon,authenticated using(true);
drop policy if exists "matrix public read" on public.role_permissions;
create policy "matrix public read" on public.role_permissions for select to anon,authenticated using(true);

drop policy if exists "Players can create their own profile" on public.profiles;
drop policy if exists "Players can read their own profile" on public.profiles;
drop policy if exists "Players can update their own profile" on public.profiles;
drop policy if exists "profiles public read" on public.profiles;
drop policy if exists "profile own update" on public.profiles;
drop policy if exists "profile admin update" on public.profiles;
create policy "profiles public read" on public.profiles for select to anon,authenticated using(true);
create policy "profile own update" on public.profiles for update to authenticated
using(auth.uid()=id) with check(auth.uid()=id);
create policy "profile admin update" on public.profiles for update to authenticated
using(public.has_permission('BAN_USERS')) with check(public.has_permission('BAN_USERS'));

drop policy if exists "Users can read their own roles" on public.user_roles;
drop policy if exists "roles own read" on public.user_roles;
drop policy if exists "roles staff read" on public.user_roles;
drop policy if exists "roles super write" on public.user_roles;
create policy "roles own read" on public.user_roles for select to authenticated using(auth.uid()=user_id);
create policy "roles staff read" on public.user_roles for select to authenticated using(public.has_permission('AUDIT_LOGS'));
create policy "roles super write" on public.user_roles for all to authenticated
using(public.has_permission('MANAGE_PERMISSIONS')) with check(public.has_permission('MANAGE_PERMISSIONS'));

drop policy if exists "audit read" on public.audit_log;
drop policy if exists "audit insert" on public.audit_log;
create policy "audit read" on public.audit_log for select to authenticated using(public.has_permission('AUDIT_LOGS'));
create policy "audit insert" on public.audit_log for insert to authenticated with check(auth.uid()=actor);

grant select on public.roles,public.permissions,public.role_permissions,public.profiles to anon,authenticated;
grant select,insert,update,delete on public.user_roles to authenticated;
grant select,insert on public.audit_log to authenticated;
grant usage,select on sequence public.audit_log_id_seq to authenticated;

revoke all on function private.user_has_permission(uuid,text) from public,anon,authenticated;
revoke all on function public.has_permission(text) from public,anon;
grant execute on function public.has_permission(text) to authenticated;
revoke all on function public.get_my_roles() from public,anon;
grant execute on function public.get_my_roles() to authenticated;
revoke all on function public.get_my_permissions() from public,anon;
grant execute on function public.get_my_permissions() to authenticated;
revoke all on function public.assign_role(uuid,text) from public,anon;
grant execute on function public.assign_role(uuid,text) to authenticated;
revoke all on function public.revoke_role(uuid,text) from public,anon;
grant execute on function public.revoke_role(uuid,text) to authenticated;
revoke all on function public.handle_new_user() from public,anon,authenticated;


