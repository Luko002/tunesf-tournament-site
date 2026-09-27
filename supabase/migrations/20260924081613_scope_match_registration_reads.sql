-- Assigned officials and participants may inspect only registrations in a
-- match they are authorized to access. Qualify the outer row explicitly.
drop policy if exists registration_scoped_read on public.tournament_registrations;
create policy registration_scoped_read on public.tournament_registrations for select to authenticated
  using (registered_by=(select auth.uid()) or private.is_team_captain(team_id)
    or private.can_manage_tournament(tournament_id,'registrations')
    or private.can_manage_tournament(tournament_id,'manage_tournament')
    or exists(select 1 from public.tournament_matches m
      where (m.home_registration_id=public.tournament_registrations.id
        or m.away_registration_id=public.tournament_registrations.id)
        and private.can_access_match(m.id)));


