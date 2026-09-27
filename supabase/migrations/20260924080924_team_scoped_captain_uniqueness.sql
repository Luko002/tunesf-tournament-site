-- Captain uniqueness belongs to the team; a player may create multiple teams.
drop index if exists public.one_active_captain_per_user;
create unique index if not exists one_active_captain_per_team on public.team_members(team_id)
  where role='captain' and status='active';


