create table public.faceit_oauth_states (
  state_hash text primary key,
  verifier text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  return_to text not null default '/dashboard.html',
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.faceit_oauth_states enable row level security;
revoke all on public.faceit_oauth_states from public, anon, authenticated;
grant all on public.faceit_oauth_states to service_role;

create index faceit_oauth_states_expires_at_idx on public.faceit_oauth_states(expires_at);
