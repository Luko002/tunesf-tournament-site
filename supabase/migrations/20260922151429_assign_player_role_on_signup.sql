create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.assign_default_app_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.user_roles (user_id, role)
  values (new.id, 'player'::public.app_role)
  on conflict (user_id, role) do nothing;
  return new;
end;
$$;

revoke all on function private.assign_default_app_role() from public, anon, authenticated;

drop trigger if exists on_auth_user_created_assign_role on auth.users;
create trigger on_auth_user_created_assign_role
after insert on auth.users
for each row execute function private.assign_default_app_role();
