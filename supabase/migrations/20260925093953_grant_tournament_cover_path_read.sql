-- The security-invoker directory view exposes cover_image_path for visible
-- tournaments, so grant the same narrow read access to its underlying column.
grant select (cover_image_path) on public.tournaments to anon, authenticated;
