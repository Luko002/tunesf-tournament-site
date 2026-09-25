-- Tournament covers are kept private until an event is published.
alter table public.tournaments
  add column cover_image_path text
  check (cover_image_path is null or cover_image_path ~
    ('^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{32}\.(jpg|png|webp)$'));

create or replace view public.tournament_directory with (security_invoker = true) as
  select t.id,t.name,t.game,t.description,t.format,t.best_of,t.region,t.starts_at,
    t.registration_opens_at,t.registration_closes_at,t.max_teams,t.roster_size,t.prize_pool,
    t.currency,t.map_pool,t.anti_cheat_required,t.substitute_limit,t.check_in_minutes,t.status,t.created_at,
    count(r.id)::integer as registered_teams,t.cover_image_path
  from public.tournaments t left join public.tournament_registrations r
    on r.tournament_id=t.id and r.status in ('approved','checked_in')
  group by t.id;

grant select on public.tournament_directory to anon,authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('tournament-covers','tournament-covers',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create policy tournament_cover_read on storage.objects
for select to anon,authenticated
using (
  bucket_id='tournament-covers'
  and cardinality(storage.foldername(name))=1
  and case when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then private.can_manage_tournament((storage.foldername(name))[1]::uuid,'manage_tournament')
      or exists(select 1 from public.tournaments t where t.id=(storage.foldername(name))[1]::uuid and t.status<>'draft')
    else false end
);
create policy tournament_cover_read_scope on storage.objects
as restrictive for select to anon,authenticated
using (
  bucket_id<>'tournament-covers' or (
    cardinality(storage.foldername(name))=1
    and case when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then private.can_manage_tournament((storage.foldername(name))[1]::uuid,'manage_tournament')
        or exists(select 1 from public.tournaments t where t.id=(storage.foldername(name))[1]::uuid and t.status<>'draft')
      else false end
  )
);

create policy tournament_cover_upload on storage.objects
for insert to authenticated
with check (
  bucket_id='tournament-covers'
  and cardinality(storage.foldername(name))=1
  and owner_id=(select auth.uid()::text)
  and storage.filename(name) ~ '^[0-9a-f]{32}\.(jpg|png|webp)$'
  and coalesce(metadata->>'mimetype','')=any(array['image/jpeg','image/png','image/webp'])
  and case when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then private.can_manage_tournament((storage.foldername(name))[1]::uuid,'manage_tournament')
    else false end
);
create policy tournament_cover_upload_scope on storage.objects
as restrictive for insert to authenticated
with check (
  bucket_id<>'tournament-covers' or (
    cardinality(storage.foldername(name))=1
    and owner_id=(select auth.uid()::text)
    and storage.filename(name) ~ '^[0-9a-f]{32}\.(jpg|png|webp)$'
    and coalesce(metadata->>'mimetype','')=any(array['image/jpeg','image/png','image/webp'])
    and case when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then private.can_manage_tournament((storage.foldername(name))[1]::uuid,'manage_tournament')
      else false end
  )
);

create policy tournament_cover_remove on storage.objects
for delete to authenticated
using (
  bucket_id='tournament-covers'
  and cardinality(storage.foldername(name))=1
  and owner_id=(select auth.uid()::text)
  and case when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then private.can_manage_tournament((storage.foldername(name))[1]::uuid,'manage_tournament')
    else false end
);
create policy tournament_cover_remove_scope on storage.objects
as restrictive for delete to authenticated
using (
  bucket_id<>'tournament-covers' or (
    cardinality(storage.foldername(name))=1
    and owner_id=(select auth.uid()::text)
    and case when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then private.can_manage_tournament((storage.foldername(name))[1]::uuid,'manage_tournament')
      else false end
  )
);

create or replace function public.set_tournament_cover(p_tournament_id uuid,p_cover_path text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  perform 1 from public.tournaments where id=p_tournament_id for update;
  if not found or not private.can_manage_tournament(p_tournament_id,'manage_tournament') then
    raise exception 'Tournament management capability required';
  end if;
  if p_cover_path is not null and p_cover_path !~
    ('^'||p_tournament_id::text||'/[0-9a-f]{32}\.(jpg|png|webp)$') then
    raise exception 'Invalid tournament cover path';
  end if;
  if p_cover_path is not null and not exists(
    select 1 from storage.objects o where o.bucket_id='tournament-covers' and o.name=p_cover_path
      and o.owner_id=auth.uid()::text
      and coalesce(o.metadata->>'mimetype','')=any(array['image/jpeg','image/png','image/webp'])
  ) then raise exception 'Tournament cover upload not found'; end if;
  update public.tournaments set cover_image_path=p_cover_path,updated_at=now()
    where id=p_tournament_id and status='draft';
  if not found then raise exception 'Only tournament drafts can change their cover'; end if;
  perform private.write_audit_event('TOURNAMENT_COVER_UPDATED','tournament',p_tournament_id,'{}'::jsonb);
end;
$$;
revoke all on function public.set_tournament_cover(uuid,text) from public,anon,authenticated;
grant execute on function public.set_tournament_cover(uuid,text) to authenticated;
