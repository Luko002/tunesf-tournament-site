-- `teams` already uses the team_public_read RLS policy; expose the intended
-- public reads through Supabase's Data API while retaining row policies.
grant select on table public.teams to anon, authenticated;
