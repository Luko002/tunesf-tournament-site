-- These tables are available through guarded SECURITY DEFINER RPCs only.
-- Keep direct Data API access denied even if grants are added accidentally.
create policy deny_api_access on public.team_contact_messages
  for all to anon, authenticated using (false) with check (false);
create policy deny_api_access on public.team_invitations
  for all to anon, authenticated using (false) with check (false);
create policy deny_api_access on public.team_join_requests
  for all to anon, authenticated using (false) with check (false);
create policy deny_api_access on public.tournament_standing_overrides
  for all to anon, authenticated using (false) with check (false);
