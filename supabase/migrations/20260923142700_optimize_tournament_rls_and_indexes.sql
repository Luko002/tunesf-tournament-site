create index audit_log_actor_idx on public.audit_log(actor);
create index role_permissions_permission_idx on public.role_permissions(permission_key);
create index user_roles_granted_by_idx on public.user_roles(granted_by);
create index user_roles_role_idx on public.user_roles(role_key);
create index teams_captain_idx on public.teams(captain_id);
create index team_members_user_idx on public.team_members(user_id);
create index tournament_registrations_team_idx on public.tournament_registrations(team_id);
create index tournament_registrations_registered_by_idx on public.tournament_registrations(registered_by);

drop policy if exists "profile own update" on public.profiles;
drop policy if exists "profile admin update" on public.profiles;
create policy "profile authorized update" on public.profiles for update to authenticated
  using (id = (select auth.uid()) or (select public.has_permission('BAN_USERS')))
  with check (id = (select auth.uid()) or (select public.has_permission('BAN_USERS')));

drop policy if exists "published tournaments are public" on public.tournaments;
drop policy if exists "organizers read own drafts" on public.tournaments;
drop policy if exists "authorized organizers create tournaments" on public.tournaments;
drop policy if exists "authorized organizers update tournaments" on public.tournaments;
drop policy if exists "authorized organizers delete drafts" on public.tournaments;
create policy "published tournaments are public" on public.tournaments
  for select to anon using (status <> 'draft');
create policy "authenticated tournament visibility" on public.tournaments
  for select to authenticated using (
    status <> 'draft' or organizer_id = (select auth.uid())
  );
create policy "authorized organizers create tournaments" on public.tournaments
  for insert to authenticated with check (
    organizer_id = (select auth.uid()) and (select public.has_permission('CREATE_TOURNAMENT'))
  );
create policy "authorized organizers update tournaments" on public.tournaments
  for update to authenticated using (
    organizer_id = (select auth.uid()) and (select public.has_permission('CREATE_TOURNAMENT'))
  ) with check (
    organizer_id = (select auth.uid()) and (select public.has_permission('CREATE_TOURNAMENT'))
  );
create policy "authorized organizers delete drafts" on public.tournaments
  for delete to authenticated using (
    organizer_id = (select auth.uid()) and status = 'draft'
    and (select public.has_permission('CREATE_TOURNAMENT'))
  );

drop policy if exists "captains view their teams" on public.teams;
drop policy if exists "players create their own teams" on public.teams;
drop policy if exists "captains manage their teams" on public.teams;
drop policy if exists "captains delete their teams" on public.teams;
create policy "captains view their teams" on public.teams
  for select to authenticated using (captain_id = (select auth.uid()));
create policy "players create their own teams" on public.teams
  for insert to authenticated with check (
    captain_id = (select auth.uid()) and (select public.has_permission('CREATE_TEAM'))
  );
create policy "captains manage their teams" on public.teams
  for update to authenticated using (captain_id = (select auth.uid()))
  with check (captain_id = (select auth.uid()));
create policy "captains delete their teams" on public.teams
  for delete to authenticated using (captain_id = (select auth.uid()));

drop policy if exists "members see their own membership" on public.team_members;
drop policy if exists "captains manage team membership" on public.team_members;
create policy "members and captains read membership" on public.team_members
  for select to authenticated using (
    user_id = (select auth.uid()) or exists (
      select 1 from public.teams t where t.id = team_id and t.captain_id = (select auth.uid())
    )
  );
create policy "captains add team members" on public.team_members
  for insert to authenticated with check (
    exists (select 1 from public.teams t where t.id = team_id and t.captain_id = (select auth.uid()))
  );
create policy "captains update team members" on public.team_members
  for update to authenticated using (
    exists (select 1 from public.teams t where t.id = team_id and t.captain_id = (select auth.uid()))
  ) with check (
    exists (select 1 from public.teams t where t.id = team_id and t.captain_id = (select auth.uid()))
  );
create policy "captains remove team members" on public.team_members
  for delete to authenticated using (
    exists (select 1 from public.teams t where t.id = team_id and t.captain_id = (select auth.uid()))
  );

drop policy if exists "public can see approved registrations for public events" on public.tournament_registrations;
drop policy if exists "captains see own registrations" on public.tournament_registrations;
drop policy if exists "captains register own teams" on public.tournament_registrations;
drop policy if exists "captains withdraw registrations" on public.tournament_registrations;
drop policy if exists "organizers review registrations" on public.tournament_registrations;
create policy "public can see approved registrations for public events" on public.tournament_registrations
  for select to anon using (
    status in ('approved','checked_in') and exists (
      select 1 from public.tournaments t where t.id = tournament_id and t.status <> 'draft'
    )
  );
create policy "authenticated can read registrations" on public.tournament_registrations
  for select to authenticated using (
    (status in ('approved','checked_in') and exists (
      select 1 from public.tournaments t where t.id = tournament_id and t.status <> 'draft'
    )) or registered_by = (select auth.uid()) or exists (
      select 1 from public.teams tm where tm.id = team_id and tm.captain_id = (select auth.uid())
    ) or (select public.has_permission('CREATE_TOURNAMENT'))
  );
create policy "captains register own teams" on public.tournament_registrations
  for insert to authenticated with check (
    registered_by = (select auth.uid()) and exists (
      select 1 from public.teams tm where tm.id = team_id and tm.captain_id = (select auth.uid())
    ) and exists (
      select 1 from public.tournaments t where t.id = tournament_id and t.status = 'registration_open'
        and t.game = (select game from public.teams where id = team_id)
    ) and (select public.has_permission('REGISTER_TOURNAMENT'))
  );
create policy "captains withdraw pending registrations" on public.tournament_registrations
  for delete to authenticated using (
    registered_by = (select auth.uid()) and status = 'pending'
  );
create policy "organizers review registrations" on public.tournament_registrations
  for update to authenticated using ((select public.has_permission('CREATE_TOURNAMENT')))
  with check ((select public.has_permission('CREATE_TOURNAMENT')));

drop policy if exists "roles own read" on public.user_roles;
drop policy if exists "roles staff read" on public.user_roles;
drop policy if exists "roles super write" on public.user_roles;
create policy "authorized users read role assignments" on public.user_roles
  for select to authenticated using (
    user_id = (select auth.uid()) or (select public.has_permission('AUDIT_LOGS'))
  );
create policy "super admins assign roles" on public.user_roles
  for insert to authenticated with check ((select public.has_permission('MANAGE_PERMISSIONS')));
create policy "super admins update roles" on public.user_roles
  for update to authenticated using ((select public.has_permission('MANAGE_PERMISSIONS')))
  with check ((select public.has_permission('MANAGE_PERMISSIONS')));
create policy "super admins revoke roles" on public.user_roles
  for delete to authenticated using ((select public.has_permission('MANAGE_PERMISSIONS')));

drop policy if exists "audit read" on public.audit_log;
drop policy if exists "audit insert" on public.audit_log;
create policy "audit read" on public.audit_log for select to authenticated
  using ((select public.has_permission('AUDIT_LOGS')));
create policy "audit insert" on public.audit_log for insert to authenticated
  with check (actor = (select auth.uid()));
