-- Match the production view security mode: expose only the published directory fields
-- using the migration owner, since tournament base tables intentionally deny public reads.
alter view public.tournament_directory reset (security_invoker);
