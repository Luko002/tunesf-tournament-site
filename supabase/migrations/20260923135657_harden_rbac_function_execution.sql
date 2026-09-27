
create or replace function private.user_has_permission(uid uuid, perm text)
returns boolean language sql stable security definer set search_path=''
as $$
  select uid=auth.uid() and exists (
    select 1 from public.user_roles ur
    join public.role_permissions rp on rp.role_key=ur.role_key
    where ur.user_id=uid and rp.permission_key=perm
  );
$$;

create or replace function public.has_permission(perm text)
returns boolean language sql stable security invoker set search_path=''
as $$ select auth.uid() is not null and private.user_has_permission(auth.uid(),perm); $$;

create or replace function public.assign_role(target uuid, requested_role text)
returns void language plpgsql security invoker set search_path=''
as $$
begin
  if not public.has_permission('MANAGE_PERMISSIONS') then
    raise exception 'MANAGE_PERMISSIONS required to assign roles';
  end if;
  if requested_role='VISITOR' or not exists(select 1 from public.roles r where r.key=requested_role) then
    raise exception 'Unknown or non-assignable role: %', requested_role;
  end if;
  insert into public.user_roles(user_id,role_key,granted_by)
  values(target,requested_role,auth.uid()) on conflict do nothing;
  insert into public.audit_log(actor,action,detail)
  values(auth.uid(),'ROLE_ASSIGN',requested_role || ' -> ' || target::text);
end;
$$;

create or replace function public.revoke_role(target uuid, requested_role text)
returns void language plpgsql security invoker set search_path=''
as $$
begin
  if not public.has_permission('MANAGE_PERMISSIONS') then
    raise exception 'MANAGE_PERMISSIONS required to revoke roles';
  end if;
  if requested_role='SUPER_ADMIN' and not exists(
    select 1 from public.user_roles ur
    where ur.role_key='SUPER_ADMIN' and ur.user_id<>target
  ) then
    raise exception 'Cannot revoke the last Super Admin role';
  end if;
  delete from public.user_roles ur where ur.user_id=target and ur.role_key=requested_role;
  insert into public.audit_log(actor,action,detail)
  values(auth.uid(),'ROLE_REVOKE',requested_role || ' x ' || target::text);
end;
$$;

grant execute on function private.user_has_permission(uuid,text) to authenticated;

