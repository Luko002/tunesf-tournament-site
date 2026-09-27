-- Admin-created users may omit the optional Discord profile field.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare new_name text; new_game text; new_discord_username text;
begin
 new_name:=coalesce(nullif(trim(new.raw_user_meta_data->>'username'),''),nullif(trim(new.raw_user_meta_data->>'player_name'),''),split_part(new.email,'@',1));
 new_game:=coalesce(nullif(trim(new.raw_user_meta_data->>'game'),''),'Not selected');
 new_discord_username:=nullif(trim(new.raw_user_meta_data->>'discord_username'),'');
 if new_discord_username is not null and char_length(new_discord_username) not between 2 and 64 then raise exception 'Discord username must be between 2 and 64 characters'; end if;
 insert into public.profiles(id,player_name,game,username,discord_username) values(new.id,new_name,new_game,new_name,new_discord_username) on conflict(id) do nothing;
 insert into public.user_roles(user_id,role_key) values(new.id,'PLAYER') on conflict do nothing;
 return new;
end; $$;
