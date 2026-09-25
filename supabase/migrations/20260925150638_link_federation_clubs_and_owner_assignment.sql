-- Treat every imported federation club as the corresponding TUNESF organization.
alter table public.organizations
  add column if not exists club_id uuid references public.clubs(id) on delete restrict;
create unique index if not exists organizations_club_id_uidx
  on public.organizations(club_id) where club_id is not null;

do $$
declare v_root_owner uuid;
begin
  select id into v_root_owner from public.public_profiles
    where lower(username)='luko' order by id limit 1;
  if v_root_owner is null then raise exception 'The federation superadmin profile luko was not found'; end if;
  insert into public.organizations(club_id,owner_id,name,slug,description,region)
    select c.id,v_root_owner,c.name,c.external_slug,'','Tunisia'
    from public.clubs c
    where not exists(select 1 from public.organizations existing where existing.club_id=c.id);
  insert into public.organization_memberships(organization_id,user_id,role,capabilities)
    select o.id,o.owner_id,'owner',array['manage_org','manage_staff','manage_teams','create_tournaments','manage_prizes']
    from public.organizations o where o.club_id is not null
    on conflict (organization_id,user_id) do update
      set role='owner',capabilities=excluded.capabilities;
end;
$$;

create or replace function public.create_organization(
  p_name text,p_slug text,p_description text default '',p_region text default ''
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  if auth.uid() is null or not private.is_super_admin() then
    raise exception 'Only a federation superadmin can create organizations';
  end if;
  insert into public.organizations(owner_id,name,slug,description,region)
    values(auth.uid(),trim(p_name),lower(trim(p_slug)),coalesce(p_description,''),coalesce(p_region,''))
    returning id into v_id;
  insert into public.organization_memberships(organization_id,user_id,role,capabilities)
    values(v_id,auth.uid(),'owner',array['manage_org','manage_staff','manage_teams','create_tournaments','manage_prizes']);
  perform private.write_audit_event('ORGANIZATION_CREATED','organization',v_id,'{}'::jsonb);
  return v_id;
end;
$$;
revoke all on function public.create_organization(text,text,text,text) from public,anon,authenticated;
grant execute on function public.create_organization(text,text,text,text) to authenticated;

create or replace function public.set_organization_owner(p_organization_id uuid,p_username text)
returns text language plpgsql security definer set search_path = ''
as $$
declare v_new_owner uuid; v_username text; v_previous_owner uuid; v_player_name text;
begin
  if auth.uid() is null or not private.is_super_admin() then
    raise exception 'Federation superadmin access required';
  end if;
  if length(trim(coalesce(p_username,''))) not between 2 and 32 then
    raise exception 'Enter the account username';
  end if;
  select p.id,p.username,p.player_name into v_new_owner,v_username,v_player_name
    from public.public_profiles p where lower(p.username)=lower(trim(p_username)) limit 1;
  if v_new_owner is null then raise exception 'No account found for username %',trim(p_username); end if;
  select owner_id into v_previous_owner from public.organizations where id=p_organization_id for update;
  if not found then raise exception 'Organization not found'; end if;
  if v_previous_owner is distinct from v_new_owner then
    update public.organizations set owner_id=v_new_owner where id=p_organization_id;
    update public.organization_memberships set role='staff',capabilities='{}'::text[]
      where organization_id=p_organization_id and user_id=v_previous_owner and role='owner';
    insert into public.organization_memberships(organization_id,user_id,role,capabilities)
      values(p_organization_id,v_new_owner,'owner',array['manage_org','manage_staff','manage_teams','create_tournaments','manage_prizes'])
      on conflict(organization_id,user_id) do update
        set role='owner',capabilities=excluded.capabilities;
    insert into public.user_roles(user_id,role_key,granted_by)
      values(v_new_owner,'ORGANIZATION_OWNER',auth.uid()) on conflict(user_id,role_key) do nothing;
    if not exists(select 1 from public.organizations where owner_id=v_previous_owner) then
      delete from public.user_roles where user_id=v_previous_owner and role_key='ORGANIZATION_OWNER';
    end if;
    perform private.write_audit_event('ORGANIZATION_OWNER_CHANGED','organization',p_organization_id,
      jsonb_build_object('previous_owner_id',v_previous_owner,'owner_id',v_new_owner,'username',v_username));
  end if;
  return coalesce(v_username,v_player_name);
end;
$$;
revoke all on function public.set_organization_owner(uuid,text) from public,anon,authenticated;
grant execute on function public.set_organization_owner(uuid,text) to authenticated;
