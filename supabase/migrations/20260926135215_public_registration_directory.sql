-- Public tournament pages need approved entrant IDs, not direct access to registration rows.
create or replace function public.list_public_tournament_registrations(p_tournament_id uuid)
returns table(id uuid,team_id uuid,status text)
language sql stable security definer set search_path = '' as $$
  select r.id,r.team_id,r.status
  from public.tournament_registrations r
  join public.tournaments t on t.id=r.tournament_id
  where r.tournament_id=p_tournament_id
    and r.status in ('approved','checked_in')
    and t.status<>'draft'
  order by r.created_at,r.id;
$$;

revoke all on function public.list_public_tournament_registrations(uuid) from public;
grant execute on function public.list_public_tournament_registrations(uuid) to anon,authenticated;
