-- An organization has at most one roster team for each game.
create unique index if not exists teams_one_game_per_organization
  on public.teams(organization_id,game)
  where organization_id is not null;
