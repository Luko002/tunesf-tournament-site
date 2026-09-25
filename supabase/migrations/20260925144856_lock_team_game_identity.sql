-- A game team stays tied to its original game. Organization managers administer
-- organization teams; standalone team captains can manage their team profile.
create or replace function public.update_team(
  p_team_id uuid,p_name text,p_tag text,p_game text,p_region text default '',p_organization_id uuid default null
)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_team public.teams%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_team from public.teams where id=p_team_id for update;
  if not found then raise exception 'Team not found'; end if;
  if v_team.organization_id is not null then
    if not private.can_manage_organization(v_team.organization_id,'manage_teams') then
      raise exception 'Organization owner controls this game team';
    end if;
  elsif not (v_team.captain_id=auth.uid() and private.is_team_captain(p_team_id)) then
    raise exception 'Team captain required';
  end if;
  if exists(select 1 from public.tournament_registrations where team_id=p_team_id and status in ('pending','approved','checked_in')) then
    raise exception 'Team profile and roster are locked while registered';
  end if;
  if p_game is distinct from v_team.game then
    raise exception 'A team is for one game. Ask the organization owner to create another game team.';
  end if;
  if length(trim(coalesce(p_name,''))) not between 2 and 80
     or length(trim(coalesce(p_tag,''))) not between 2 and 8 then
    raise exception 'Invalid team details';
  end if;
  if p_organization_id is not null and p_organization_id is distinct from v_team.organization_id
     and not private.can_manage_organization(p_organization_id,'manage_teams') then
    raise exception 'Organization team capability required';
  end if;
  update public.teams set name=trim(p_name),tag=upper(trim(p_tag)),region=coalesce(trim(p_region),''),
    organization_id=coalesce(p_organization_id,v_team.organization_id) where id=p_team_id;
  perform private.write_audit_event('TEAM_UPDATED','team',p_team_id,'{}'::jsonb);
end;
$$;
revoke all on function public.update_team(uuid,text,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.update_team(uuid,text,text,text,text,uuid) to authenticated;
