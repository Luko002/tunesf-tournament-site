-- Public tournament pages need to show assigned officials before matches exist.
-- Return only the assigned officials' public names for published tournaments.
create or replace function public.list_tournament_referee_names(p_tournament_id uuid)
returns table(username text, player_name text)
language sql stable security definer set search_path = ''
as $$
  select p.username,p.player_name
  from public.tournament_staff ts
  join public.public_profiles p on p.id=ts.user_id
  join public.tournaments t on t.id=ts.tournament_id
  where ts.tournament_id=p_tournament_id
    and 'referee'=any(ts.capabilities)
    and t.status<>'draft'
  order by lower(coalesce(p.username,p.player_name,'')),p.id;
$$;

revoke all on function public.list_tournament_referee_names(uuid) from public;
grant execute on function public.list_tournament_referee_names(uuid) to anon,authenticated;
