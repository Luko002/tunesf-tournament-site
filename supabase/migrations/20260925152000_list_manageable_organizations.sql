-- Return organizations available to the signed-in user without relying on
-- several client-side RLS reads. The optional capability scopes the list.
create or replace function public.list_organizations_for_current_user(p_capability text default null)
returns table (
  id uuid,
  club_id uuid,
  owner_id uuid,
  name text,
  slug text,
  description text,
  region text,
  created_at timestamptz,
  owner_username text,
  owner_player_name text,
  my_role text,
  my_capabilities text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to view organizations';
  end if;
  if p_capability is not null and p_capability not in (
    'manage_org','manage_staff','manage_teams','create_tournaments','manage_prizes'
  ) then
    raise exception 'Unsupported organization capability';
  end if;

  return query
  select o.id,o.club_id,o.owner_id,o.name,o.slug,o.description,o.region,o.created_at,
         p.username,p.player_name,
         case when o.owner_id=auth.uid() then 'owner'::text else coalesce(m.role,'member') end,
         coalesce(m.capabilities,'{}'::text[])
    from public.organizations o
    left join public.organization_memberships m
      on m.organization_id=o.id and m.user_id=auth.uid()
    left join public.public_profiles p on p.id=o.owner_id
   where (p_capability is not null and private.can_manage_organization(o.id,p_capability))
      or (p_capability is null and (
        private.is_super_admin() or o.owner_id=auth.uid() or m.user_id=auth.uid()
      ))
   order by o.name;
end;
$$;

revoke all on function public.list_organizations_for_current_user(text) from public,anon,authenticated;
grant execute on function public.list_organizations_for_current_user(text) to authenticated;
