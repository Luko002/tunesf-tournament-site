-- Public brackets and standings need the team associated with each approved
-- registration. RLS still limits visible registration rows to approved events.
grant select (team_id) on public.tournament_registrations to anon;
