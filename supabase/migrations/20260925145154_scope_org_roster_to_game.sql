-- Organization owners manage the roster that belongs to the team's own game.
create or replace function private.can_manage_team_game_roster(p_team_id uuid,p_game text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.teams t where t.id=p_team_id and p_game=t.game and (
      (t.organization_id is not null and private.can_manage_organization(t.organization_id,'manage_teams'))
      or private.is_team_captain(t.id)
    )
  );
$$;
revoke all on function private.can_manage_team_game_roster(uuid,text) from public,anon,authenticated;
grant execute on function private.can_manage_team_game_roster(uuid,text) to authenticated;
