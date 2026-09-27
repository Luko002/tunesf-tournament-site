create table public.tournaments (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null references auth.users(id) on delete restrict,
  name text not null check (length(trim(name)) between 3 and 120),
  game text not null check (game in ('cs2','val','lol','rl','eafc')),
  description text not null default '',
  format text not null default 'single',
  best_of text not null default 'BO3',
  region text not null default '',
  starts_at timestamptz,
  registration_opens_at timestamptz,
  registration_closes_at timestamptz,
  max_teams integer not null default 64 check (max_teams between 2 and 1024),
  roster_size integer not null default 5 check (roster_size between 1 and 20),
  prize_pool numeric(12,2) not null default 0 check (prize_pool >= 0),
  currency text not null default 'TND' check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'draft' check (status in ('draft','registration_open','registration_closed','in_progress','completed','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tournaments_public_listing_idx on public.tournaments(status, starts_at);
create index tournaments_organizer_idx on public.tournaments(organizer_id, created_at desc);
alter table public.tournaments enable row level security;
create policy "published tournaments are public" on public.tournaments
  for select to anon, authenticated using (status <> 'draft');
create policy "organizers read own drafts" on public.tournaments
  for select to authenticated using (organizer_id = auth.uid());
create policy "authorized organizers create tournaments" on public.tournaments
  for insert to authenticated with check (
    organizer_id = auth.uid() and public.has_permission('CREATE_TOURNAMENT')
  );
create policy "authorized organizers update tournaments" on public.tournaments
  for update to authenticated using (
    organizer_id = auth.uid() and public.has_permission('CREATE_TOURNAMENT')
  ) with check (
    organizer_id = auth.uid() and public.has_permission('CREATE_TOURNAMENT')
  );
create policy "authorized organizers delete drafts" on public.tournaments
  for delete to authenticated using (
    organizer_id = auth.uid() and status = 'draft' and public.has_permission('CREATE_TOURNAMENT')
  );
grant select on public.tournaments to anon, authenticated;
grant insert, update, delete on public.tournaments to authenticated;

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  captain_id uuid not null references auth.users(id) on delete restrict,
  name text not null check (length(trim(name)) between 2 and 80),
  tag text not null check (length(trim(tag)) between 2 and 8),
  game text not null check (game in ('cs2','val','lol','rl','eafc')),
  region text not null default '',
  created_at timestamptz not null default now(),
  unique (captain_id, tag)
);
alter table public.teams enable row level security;

create table public.team_members (
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'player' check (role in ('captain','player','substitute')),
  status text not null default 'invited' check (status in ('invited','active','removed')),
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);
alter table public.team_members enable row level security;
create policy "members see their own membership" on public.team_members
  for select to authenticated using (
    user_id = auth.uid() or exists (
      select 1 from public.teams t where t.id = team_id and t.captain_id = auth.uid()
    )
  );
create policy "captains manage team membership" on public.team_members
  for all to authenticated using (
    exists (select 1 from public.teams t where t.id = team_id and t.captain_id = auth.uid())
  ) with check (
    exists (select 1 from public.teams t where t.id = team_id and t.captain_id = auth.uid())
  );
grant select, insert, update, delete on public.team_members to authenticated;

create policy "captains view their teams" on public.teams
  for select to authenticated using (captain_id = auth.uid());
create policy "players create their own teams" on public.teams
  for insert to authenticated with check (
    captain_id = auth.uid() and public.has_permission('CREATE_TEAM')
  );
create policy "captains manage their teams" on public.teams
  for update to authenticated using (captain_id = auth.uid()) with check (captain_id = auth.uid());
create policy "captains delete their teams" on public.teams
  for delete to authenticated using (captain_id = auth.uid());
grant select, insert, update, delete on public.teams to authenticated;

create table public.tournament_registrations (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete restrict,
  registered_by uuid not null references auth.users(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending','approved','rejected','withdrawn','checked_in')),
  created_at timestamptz not null default now(),
  unique (tournament_id, team_id)
);
create index tournament_registrations_tournament_idx on public.tournament_registrations(tournament_id, status);
alter table public.tournament_registrations enable row level security;
create policy "public can see approved registrations for public events" on public.tournament_registrations
  for select to anon, authenticated using (
    status in ('approved','checked_in') and exists (
      select 1 from public.tournaments t where t.id = tournament_id and t.status <> 'draft'
    )
  );
create policy "captains see own registrations" on public.tournament_registrations
  for select to authenticated using (
    registered_by = auth.uid() or exists (
      select 1 from public.teams tm where tm.id = team_id and tm.captain_id = auth.uid()
    ) or public.has_permission('CREATE_TOURNAMENT')
  );
create policy "captains register own teams" on public.tournament_registrations
  for insert to authenticated with check (
    registered_by = auth.uid() and exists (
      select 1 from public.teams tm where tm.id = team_id and tm.captain_id = auth.uid()
    ) and exists (
      select 1 from public.tournaments t where t.id = tournament_id and t.status = 'registration_open'
        and t.game = (select game from public.teams where id = team_id)
    ) and public.has_permission('REGISTER_TOURNAMENT')
  );
create policy "captains withdraw registrations" on public.tournament_registrations
  for delete to authenticated using (registered_by = auth.uid());
create policy "organizers review registrations" on public.tournament_registrations
  for update to authenticated using (public.has_permission('CREATE_TOURNAMENT'))
  with check (public.has_permission('CREATE_TOURNAMENT'));
grant select on public.tournament_registrations to anon, authenticated;
grant insert, update, delete on public.tournament_registrations to authenticated;

create view public.tournament_directory with (security_invoker = true) as
select t.id, t.organizer_id, t.name, t.game, t.description, t.format, t.best_of,
       t.region, t.starts_at, t.registration_opens_at, t.registration_closes_at,
       t.max_teams, t.roster_size, t.prize_pool, t.currency, t.status, t.created_at,
       count(r.id)::integer as registered_teams
from public.tournaments t
left join public.tournament_registrations r
  on r.tournament_id = t.id and r.status in ('approved','checked_in')
group by t.id;
grant select on public.tournament_directory to anon, authenticated;
