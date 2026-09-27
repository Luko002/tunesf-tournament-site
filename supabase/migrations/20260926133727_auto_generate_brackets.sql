-- Publish the first competition stage automatically when registration closes.
create or replace function private.generate_bracket_after_registration_close()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_eligible integer;
begin
  if old.status is not distinct from new.status or new.status<>'registration_closed' then return new; end if;
  -- Never synthesize an auth identity for background database jobs. The current
  -- organizer action must pass the same bracket capability check as the RPC.
  if auth.uid() is null or not private.can_manage_tournament(new.id,'bracket') then return new; end if;
  select count(*) into v_eligible from public.tournament_registrations r
    where r.tournament_id=new.id and r.status in ('approved','checked_in');
  if v_eligible<2 then return new; end if;
  if new.format='double_elimination' and (v_eligible<4 or (v_eligible & (v_eligible-1))<>0) then return new; end if;
  if exists(select 1 from public.tournament_stages s where s.tournament_id=new.id and s.status<>'draft') then return new; end if;

  perform public.generate_bracket(new.id,null::uuid[]);
  return new;
end;
$$;

drop trigger if exists auto_generate_bracket_after_registration_close on public.tournaments;
create trigger auto_generate_bracket_after_registration_close
  after update of status on public.tournaments
  for each row execute function private.generate_bracket_after_registration_close();

revoke all on function private.generate_bracket_after_registration_close() from public,anon,authenticated;
