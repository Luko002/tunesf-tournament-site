-- Let a tournament administrator correct a premature registration close.
-- A bracket must not exist yet, and the configured registration deadline must
-- still be in the future.
create or replace function public.reopen_tournament_registration(p_tournament_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_closes_at timestamptz; v_status text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select status,registration_closes_at into v_status,v_closes_at
    from public.tournaments where id=p_tournament_id for update;
  if not found or not private.can_manage_tournament(p_tournament_id,'manage_tournament') then
    raise exception 'Tournament management capability required';
  end if;
  if v_status<>'registration_closed' then raise exception 'Only a closed registration can be reopened'; end if;
  if v_closes_at is not null and v_closes_at<=now() then raise exception 'The registration deadline has passed'; end if;
  if exists(select 1 from public.tournament_stages where tournament_id=p_tournament_id and status<>'draft') then
    raise exception 'Registration cannot be reopened after a competition stage is published';
  end if;
  update public.tournaments set status='registration_open',updated_at=now() where id=p_tournament_id;
  perform private.write_audit_event('TOURNAMENT_REGISTRATION_REOPENED','tournament',p_tournament_id,'{}'::jsonb);
end;
$$;
revoke all on function public.reopen_tournament_registration(uuid) from public,anon,authenticated;
grant execute on function public.reopen_tournament_registration(uuid) to authenticated;
