create or replace function public.list_pending_player_game_identity_links()
returns table(
  id uuid,
  user_id uuid,
  username text,
  game_key text,
  player_id text,
  platform text,
  proof_url text,
  submitted_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not exists (
    select 1
    from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.role_key in ('SUPER_ADMIN', 'PLATFORM_ADMIN')
  ) then
    raise exception 'Platform admin required';
  end if;

  return query
    select
      l.id,
      l.user_id,
      coalesce(p.username, 'Player'),
      l.game_key,
      l.player_id,
      l.platform,
      l.proof_url,
      l.submitted_at
    from public.player_game_identity_links l
    left join public.public_profiles p on p.id = l.user_id
    where l.status = 'pending'
    order by l.submitted_at;
end;
$$;

revoke all on function public.list_pending_player_game_identity_links() from public, anon, authenticated;
grant execute on function public.list_pending_player_game_identity_links() to authenticated;
