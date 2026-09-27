-- Publish verified awards without exposing internal payout references or reviewer data.
create or replace function public.list_public_player_achievements(p_user_id uuid)
returns table(tournament_id uuid,tournament_name text,place smallint,label text,award_status text,awarded_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select t.id,t.name,p.place,p.label,a.status,a.approved_at
  from public.prize_awards a
  join public.tournament_prizes p on p.id=a.prize_id and p.tournament_id=a.tournament_id
  join public.tournament_registrations r on r.id=a.registration_id and r.tournament_id=a.tournament_id
  join public.tournament_registration_members rm on rm.registration_id=r.id and rm.tournament_id=r.tournament_id
  join public.tournaments t on t.id=a.tournament_id and t.status='completed'
  where rm.user_id=p_user_id and a.status in ('approved','paid')
  order by p.place,a.approved_at desc nulls last,t.name;
$$;

revoke all on function public.list_public_player_achievements(uuid) from public;
grant execute on function public.list_public_player_achievements(uuid) to anon,authenticated;
