create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  player_name text not null check (char_length(trim(player_name)) between 2 and 40),
  game text not null check (char_length(trim(game)) between 2 and 40),
  region text not null default 'Tunisia' check (char_length(trim(region)) between 2 and 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
revoke all on table public.profiles from public, anon, authenticated;
grant select, insert, update on table public.profiles to authenticated;
grant all on table public.profiles to service_role;

create policy "Players can read their own profile" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);
create policy "Players can create their own profile" on public.profiles
  for insert to authenticated with check ((select auth.uid()) = id);
create policy "Players can update their own profile" on public.profiles
  for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create or replace function private.create_player_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, player_name, game)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'player_name'), ''), split_part(new.email, '@', 1)),
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'game'), ''), 'Not selected')
  );
  return new;
end;
$$;
revoke all on function private.create_player_profile() from public, anon, authenticated;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function private.create_player_profile();
