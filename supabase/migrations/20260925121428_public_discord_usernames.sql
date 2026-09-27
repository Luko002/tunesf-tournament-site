alter table public.profiles
  add column if not exists discord_username text;

alter table public.profiles
  drop constraint if exists profiles_discord_username_length_check;
alter table public.profiles
  add constraint profiles_discord_username_length_check
  check (discord_username is null or char_length(btrim(discord_username)) between 2 and 64);

alter table public.public_profiles
  add column if not exists discord_username text;

alter table public.public_profiles
  drop constraint if exists public_profiles_discord_username_length_check;
alter table public.public_profiles
  add constraint public_profiles_discord_username_length_check
  check (discord_username is null or char_length(btrim(discord_username)) between 2 and 64);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  new_name text;
  new_game text;
  new_discord_username text;
begin
  new_name := coalesce(nullif(trim(new.raw_user_meta_data->>'username'),''), nullif(trim(new.raw_user_meta_data->>'player_name'),''), split_part(new.email,'@',1));
  new_game := coalesce(nullif(trim(new.raw_user_meta_data->>'game'),''), 'Not selected');
  new_discord_username := nullif(trim(new.raw_user_meta_data->>'discord_username'),'');

  if new_discord_username is null or char_length(new_discord_username) not between 2 and 64 then
    raise exception 'A Discord username between 2 and 64 characters is required';
  end if;

  insert into public.profiles(id,player_name,game,username,discord_username)
  values(new.id,new_name,new_game,new_name,new_discord_username)
  on conflict(id) do nothing;

  insert into public.user_roles(user_id,role_key)
  values(new.id,'PLAYER') on conflict do nothing;
  return new;
end;
$function$;

create or replace function private.sync_public_profile()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  insert into public.public_profiles(id,username,player_name,game,region,discord_username)
  values(new.id,new.username,new.player_name,new.game,new.region,new.discord_username)
  on conflict(id) do update set
    username=excluded.username,
    player_name=excluded.player_name,
    game=excluded.game,
    region=excluded.region,
    discord_username=excluded.discord_username;
  return new;
end;
$function$;

drop trigger if exists sync_public_profile_card on public.profiles;
create trigger sync_public_profile_card
after insert or update of username,player_name,game,region,discord_username
on public.profiles
for each row execute function private.sync_public_profile();

update public.profiles p
set discord_username = nullif(trim(u.raw_user_meta_data->>'discord_username'),'')
from auth.users u
where u.id=p.id
  and p.discord_username is null
  and char_length(trim(u.raw_user_meta_data->>'discord_username')) between 2 and 64;
