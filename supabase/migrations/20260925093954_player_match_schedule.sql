-- A player's schedule is scoped to teams where they have active membership.
-- The function bypasses table RLS only after verifying the caller's team IDs.
create or replace function public.get_my_team_matches()
returns table (
  match_id uuid,
  tournament_id uuid,
  tournament_name text,
  game text,
  stage_name text,
  bracket_side text,
  round_number smallint,
  match_position smallint,
  match_status text,
  scheduled_at timestamptz,
  started_at timestamptz,
  your_team_name text,
  your_team_tag text,
  opponent_team_name text,
  opponent_team_tag text,
  your_score smallint,
  opponent_score smallint
)
language sql stable security definer set search_path = ''
as $$
  select distinct
    m.id,
    m.tournament_id,
    t.name,
    t.game,
    s.name,
    m.bracket_side,
    m.round_number,
    m.position,
    m.status,
    m.scheduled_at,
    m.started_at,
    case when private.is_team_member(home.team_id) then home_team.name else away_team.name end,
    case when private.is_team_member(home.team_id) then home_team.tag else away_team.tag end,
    case when private.is_team_member(home.team_id) then away_team.name else home_team.name end,
    case when private.is_team_member(home.team_id) then away_team.tag else home_team.tag end,
    case when private.is_team_member(home.team_id) then m.home_score else m.away_score end,
    case when private.is_team_member(home.team_id) then m.away_score else m.home_score end
  from public.tournament_matches m
  join public.tournaments t on t.id = m.tournament_id
  join public.tournament_stages s on s.id = m.stage_id
  left join public.tournament_registrations home on home.id = m.home_registration_id
  left join public.tournament_registrations away on away.id = m.away_registration_id
  left join public.teams home_team on home_team.id = home.team_id
  left join public.teams away_team on away_team.id = away.team_id
  where (select auth.uid()) is not null
    and t.status <> 'draft'
    and m.status in ('ready','live','paused','result_pending','disputed')
    and (
      (home.team_id is not null and private.is_team_member(home.team_id))
      or (away.team_id is not null and private.is_team_member(away.team_id))
    )
  order by m.scheduled_at nulls last, m.started_at desc;
$$;

revoke all on function public.get_my_team_matches() from public, anon, authenticated;
grant execute on function public.get_my_team_matches() to authenticated;
