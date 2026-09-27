-- A stage marks itself completed when its final result is advanced. Allow
-- tournament completion after every stage has reached that terminal state.
create or replace function public.transition_tournament(p_tournament_id uuid,p_new_status text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_status text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select status into v_status from public.tournaments where id=p_tournament_id for update;
  if not found or not private.can_manage_tournament(p_tournament_id,'manage_tournament') then
    raise exception 'Tournament management capability required';
  end if;
  if not ((v_status='draft' and p_new_status='registration_open')
      or (v_status='registration_open' and p_new_status='registration_closed')
      or (v_status='registration_closed' and p_new_status='in_progress')
      or (v_status='in_progress' and p_new_status='completed')
      or (v_status in ('draft','registration_open','registration_closed') and p_new_status='cancelled')) then
    raise exception 'Invalid tournament state transition';
  end if;
  if p_new_status='registration_open' and exists(select 1 from public.tournaments where id=p_tournament_id
      and registration_closes_at is not null and registration_closes_at<=now()) then
    raise exception 'Registration close time has passed';
  end if;
  if p_new_status='in_progress' and not exists(select 1 from public.tournament_stages
      where tournament_id=p_tournament_id and status='published') then
    raise exception 'Publish a competition stage before starting the tournament';
  end if;
  if p_new_status='completed' and (
    not exists(select 1 from public.tournament_stages
      where tournament_id=p_tournament_id and status in ('published','in_progress','completed'))
    or exists(select 1 from public.tournament_stages where tournament_id=p_tournament_id and status<>'completed')
    or exists(select 1 from public.tournament_matches m where m.tournament_id=p_tournament_id
      and m.status not in ('completed','forfeit','cancelled'))
    or exists(select 1 from public.match_disputes d where d.match_id in
      (select id from public.tournament_matches where tournament_id=p_tournament_id) and d.status in ('open','under_review'))
  ) then raise exception 'Resolve every stage, match, and dispute before completing the tournament'; end if;
  if p_new_status='completed' then perform private.rebuild_final_placements(p_tournament_id); end if;
  update public.tournaments set status=p_new_status,updated_at=now() where id=p_tournament_id;
  perform private.write_audit_event('TOURNAMENT_STATUS_CHANGED','tournament',p_tournament_id,
    jsonb_build_object('from',v_status,'to',p_new_status));
end;
$$;


