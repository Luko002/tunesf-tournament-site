-- Let a team's captain or its organization owner permanently delete a team
-- only when doing so cannot erase tournament records. Super Admins may rename
-- any team; both actions are recorded in the audit trail.

-- Force all deletes through the audited RPC below so ownership and history
-- checks cannot be bypassed by calling the table endpoint directly.
drop policy if exists "captains delete their teams" on public.teams;

create or replace function public.delete_team(p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team public.teams%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select * into v_team
  from public.teams
  where id = p_team_id
  for update;

  if not found then
    raise exception 'Team not found';
  end if;

  if not private.is_super_admin()
     and not (
       v_team.captain_id = auth.uid()
       and exists (
         select 1 from public.team_members m
         where m.team_id = v_team.id and m.user_id = auth.uid()
           and m.role = 'captain' and m.status = 'active'
       )
     )
     and not exists (
       select 1 from public.organizations o
       where o.id = v_team.organization_id and o.owner_id = auth.uid()
     ) then
    raise exception 'Only this team captain, its organization owner, or a Super Admin can delete the team';
  end if;

  if exists (
    select 1 from public.tournament_registrations r where r.team_id = v_team.id
  ) then
    raise exception 'This team has tournament history and cannot be deleted. Tournament registrations and results are retained.';
  end if;

  if exists (select 1 from public.match_roster_confirmations c where c.team_id = v_team.id)
     or exists (select 1 from public.match_map_vetoes v where v.team_id = v_team.id or v.side_team_id = v_team.id) then
    raise exception 'This team has match records and cannot be deleted.';
  end if;

  perform private.write_audit_event(
    'TEAM_DELETED', 'team', v_team.id,
    jsonb_build_object('name', v_team.name, 'tag', v_team.tag, 'game', v_team.game,
      'organization_id', v_team.organization_id)
  );
  delete from public.teams where id = v_team.id;
end;
$$;

create or replace function public.rename_team_as_super_admin(p_team_id uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team public.teams%rowtype;
  v_name text := btrim(coalesce(p_name, ''));
begin
  if auth.uid() is null or not private.is_super_admin() then
    raise exception 'SUPER_ADMIN required';
  end if;
  if length(v_name) not between 2 and 80 then
    raise exception 'Team name must contain between 2 and 80 characters';
  end if;

  select * into v_team
  from public.teams
  where id = p_team_id
  for update;

  if not found then
    raise exception 'Team not found';
  end if;
  if v_team.name = v_name then
    return;
  end if;

  update public.teams set name = v_name where id = v_team.id;
  perform private.write_audit_event(
    'TEAM_RENAMED', 'team', v_team.id,
    jsonb_build_object('old_name', v_team.name, 'new_name', v_name, 'tag', v_team.tag)
  );
end;
$$;

revoke all on function public.delete_team(uuid) from public, anon, authenticated;
revoke all on function public.rename_team_as_super_admin(uuid, text) from public, anon, authenticated;
grant execute on function public.delete_team(uuid) to authenticated;
grant execute on function public.rename_team_as_super_admin(uuid, text) to authenticated;
