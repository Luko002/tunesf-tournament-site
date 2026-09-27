-- Allow only Super Admins to move existing teams between organizations.
-- The team remains the same identity; organization logos are resolved by the app.
create or replace function public.set_team_organization_as_super_admin(
  p_team_id uuid,
  p_organization_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team public.teams%rowtype;
  v_old_organization_name text;
  v_new_organization_name text;
begin
  if auth.uid() is null or not private.is_super_admin() then
    raise exception 'SUPER_ADMIN required';
  end if;

  select * into v_team
  from public.teams
  where id = p_team_id
  for update;

  if not found then
    raise exception 'Team not found';
  end if;

  if v_team.organization_id is not distinct from p_organization_id then
    return;
  end if;

  if v_team.organization_id is not null then
    select name into v_old_organization_name
    from public.organizations where id = v_team.organization_id;
  end if;

  if p_organization_id is not null then
    select name into v_new_organization_name
    from public.organizations where id = p_organization_id;
    if not found then
      raise exception 'Organization not found';
    end if;

    if exists (
      select 1 from public.teams existing
      where existing.organization_id = p_organization_id
        and existing.game = v_team.game
        and existing.id <> v_team.id
    ) then
      raise exception 'This organization already has a team for this game';
    end if;
  end if;

  update public.teams
  set organization_id = p_organization_id
  where id = v_team.id;

  perform private.write_audit_event(
    'TEAM_ORGANIZATION_CHANGED', 'team', v_team.id,
    jsonb_build_object(
      'team_name', v_team.name,
      'game', v_team.game,
      'previous_organization_id', v_team.organization_id,
      'previous_organization_name', v_old_organization_name,
      'organization_id', p_organization_id,
      'organization_name', v_new_organization_name
    )
  );
end;
$$;

revoke all on function public.set_team_organization_as_super_admin(uuid, uuid) from public, anon, authenticated;
grant execute on function public.set_team_organization_as_super_admin(uuid, uuid) to authenticated;
