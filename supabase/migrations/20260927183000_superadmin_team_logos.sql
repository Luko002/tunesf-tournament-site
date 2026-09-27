-- Allow Super Admins to upload and remove team logos through the Storage API,
-- and record administrator logo changes in the audit trail.
drop policy if exists public_media_team_upload on storage.objects;
create policy public_media_team_upload on storage.objects for insert to authenticated
with check (
  bucket_id='public-media'
  and cardinality(storage.foldername(name))=3
  and (storage.foldername(name))[1]='teams'
  and (storage.foldername(name))[2] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and (storage.foldername(name))[3]=(select auth.uid())::text
  and storage.filename(name) ~ '^[0-9a-f]{32}\.(jpg|jpeg|png|webp)$'
  and coalesce(metadata->>'mimetype','') in ('image/jpeg','image/png','image/webp')
  and exists(
    select 1 from public.teams t
    where t.id=((storage.foldername(name))[2])::uuid
      and (private.is_super_admin() or private.is_team_captain(t.id)
        or (t.organization_id is not null and private.can_manage_organization(t.organization_id,'manage_teams')))
  )
);

drop policy if exists public_media_team_remove on storage.objects;
create policy public_media_team_remove on storage.objects for delete to authenticated
using (
  bucket_id='public-media'
  and cardinality(storage.foldername(name))=3
  and (storage.foldername(name))[1]='teams'
  and (storage.foldername(name))[2] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and (
    (storage.foldername(name))[3]=(select auth.uid())::text
    or private.is_super_admin()
  )
  and exists(
    select 1 from public.teams t
    where t.id=((storage.foldername(name))[2])::uuid
      and (private.is_super_admin() or private.is_team_captain(t.id)
        or (t.organization_id is not null and private.can_manage_organization(t.organization_id,'manage_teams')))
  )
);

create or replace function public.set_team_logo_path(p_team_id uuid,p_logo_path text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_team public.teams%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_team from public.teams t where t.id=p_team_id for update;
  if not found then raise exception 'Team not found'; end if;
  if not private.is_super_admin()
    and not (private.is_team_captain(v_team.id)
      or (v_team.organization_id is not null and private.can_manage_organization(v_team.organization_id,'manage_teams'))) then
    raise exception 'Team captain, organization team manager, or Super Admin required';
  end if;
  if p_logo_path is not null and p_logo_path !~ ('^teams/'||p_team_id::text||'/'||auth.uid()::text||'/[0-9a-f]{32}\.(jpg|jpeg|png|webp)$') then
    raise exception 'Invalid team logo path';
  end if;
  if p_logo_path is not null and not exists(
    select 1 from storage.objects o
    where o.bucket_id='public-media' and o.name=p_logo_path and o.owner_id=auth.uid()::text
  ) then
    raise exception 'Team logo upload was not found';
  end if;
  if v_team.logo_path is not distinct from p_logo_path then return; end if;
  update public.teams set logo_path=p_logo_path where id=p_team_id;
  if private.is_super_admin() then
    perform private.write_audit_event(
      'TEAM_LOGO_UPDATED','team',p_team_id,
      jsonb_build_object('old_logo_path',v_team.logo_path,'new_logo_path',p_logo_path,'name',v_team.name)
    );
  end if;
end;
$$;
revoke all on function public.set_team_logo_path(uuid,text) from public,anon,authenticated;
grant execute on function public.set_team_logo_path(uuid,text) to authenticated;
