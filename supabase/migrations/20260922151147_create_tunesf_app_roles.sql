create type public.app_role as enum ('player', 'captain', 'referee', 'admin');

create table public.user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

alter table public.user_roles enable row level security;

create policy "Users can read their own roles"
  on public.user_roles
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.user_roles from public, anon, authenticated;
grant select on table public.user_roles to authenticated;
grant all on table public.user_roles to service_role;
