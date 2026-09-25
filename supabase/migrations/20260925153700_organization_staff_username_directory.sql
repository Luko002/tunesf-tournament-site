-- Give organization managers a scoped staff directory and username-based assignment.
create or replace function public.list_organization_staff(p_organization_id uuid)
returns table(user_id uuid,username text,player_name text,role text,capabilities text[])
language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not private.can_manage_organization(p_organization_id,'manage_staff') then
    raise exception 'Organization staff capability required';
  end if;
  return query
    select m.user_id,p.username,p.player_name,m.role,m.capabilities
      from public.organization_memberships m
      left join public.public_profiles p on p.id=m.user_id
     where m.organization_id=p_organization_id
     order by case m.role when 'owner' then 0 when 'admin' then 1 else 2 end,
              coalesce(p.username,p.player_name),m.user_id;
end;
$$;
revoke all on function public.list_organization_staff(uuid) from public,anon,authenticated;
grant execute on function public.list_organization_staff(uuid) to authenticated;

create or replace function public.set_organization_member_by_username(
  p_organization_id uuid,p_username text,p_role text,p_capabilities text[] default '{}'::text[]
)
returns text language plpgsql security definer set search_path = ''
as $$
declare v_matches integer; v_user_id uuid; v_username text;
begin
  if auth.uid() is null or not private.can_manage_organization(p_organization_id,'manage_staff') then
    raise exception 'Organization staff capability required';
  end if;
  if length(trim(coalesce(p_username,''))) not between 2 and 32
     or trim(p_username) !~ '^[A-Za-z0-9_.-]+$' then
    raise exception 'Enter a valid TUNESF username';
  end if;
  select count(*) into v_matches from public.public_profiles p
    where lower(p.username)=lower(trim(p_username));
  if v_matches=0 then raise exception 'No TUNESF account found for username %',trim(p_username); end if;
  if v_matches>1 then raise exception 'That username matches multiple accounts; contact federation support'; end if;
  select p.id,p.username into v_user_id,v_username from public.public_profiles p
    where lower(p.username)=lower(trim(p_username)) limit 1;
  perform public.set_organization_member(p_organization_id,v_user_id,p_role,p_capabilities);
  return v_username;
end;
$$;
revoke all on function public.set_organization_member_by_username(uuid,text,text,text[]) from public,anon,authenticated;
grant execute on function public.set_organization_member_by_username(uuid,text,text,text[]) to authenticated;
