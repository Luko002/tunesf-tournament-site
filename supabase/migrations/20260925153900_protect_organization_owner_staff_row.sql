-- Keep staff role updates from overwriting the canonical owner membership row.
create or replace function public.set_organization_member_by_username(
  p_organization_id uuid,p_username text,p_role text,p_capabilities text[] default '{}'::text[]
)
returns text language plpgsql security definer set search_path = ''
as $$
declare v_matches integer; v_user_id uuid; v_username text;
begin
  if auth.uid() is null or not private.can_manage_organization(p_organization_id,'manage_staff') then raise exception 'Organization staff capability required'; end if;
  if length(trim(coalesce(p_username,''))) not between 2 and 32 or trim(p_username) !~ '^[A-Za-z0-9_.-]+$' then raise exception 'Enter a valid TUNESF username'; end if;
  select count(*) into v_matches from public.public_profiles p where lower(p.username)=lower(trim(p_username));
  if v_matches=0 then raise exception 'No TUNESF account found for username %',trim(p_username); end if;
  if v_matches>1 then raise exception 'That username matches multiple accounts; contact federation support'; end if;
  select p.id,p.username into v_user_id,v_username from public.public_profiles p where lower(p.username)=lower(trim(p_username)) limit 1;
  if exists(select 1 from public.organizations o where o.id=p_organization_id and o.owner_id=v_user_id) then raise exception 'The organization owner is managed from the owner assignment field'; end if;
  perform public.set_organization_member(p_organization_id,v_user_id,p_role,p_capabilities);
  return v_username;
end;
$$;
