-- Private match evidence is accessible only to signed-in match participants,
-- their assigned officials, and scoped tournament staff. Captains may upload
-- evidence only for a live match they can submit a result for.
create or replace function private.can_submit_match_evidence(p_match_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.tournament_matches m
    left join public.tournament_registrations h on h.id=m.home_registration_id
    left join public.tournament_registrations a on a.id=m.away_registration_id
    where m.id=p_match_id and m.status in ('live','result_pending')
      and (private.is_team_captain(h.team_id) or private.is_team_captain(a.team_id))
  );
$$;
revoke all on function private.can_submit_match_evidence(uuid) from public,anon,authenticated;
grant execute on function private.can_submit_match_evidence(uuid) to authenticated;

create policy match_evidence_upload on storage.objects
for insert to authenticated
with check (
  bucket_id='match-evidence'
  and owner_id=(select auth.uid()::text)
  and (storage.foldername(name))[2]=(select auth.uid()::text)
  and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and storage.filename(name) ~ '^[0-9a-f]{32}\.(jpg|jpeg|png|webp|mp4)$'
  and storage.extension(name)=any(array['jpg','jpeg','png','webp','mp4'])
  and coalesce(metadata->>'mimetype','')=any(array['image/jpeg','image/png','image/webp','video/mp4'])
  and case when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then private.can_submit_match_evidence((storage.foldername(name))[1]::uuid) else false end
);

create policy match_evidence_scoped_read on storage.objects
for select to authenticated
using (
  bucket_id='match-evidence'
  and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and case when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then private.can_access_match((storage.foldername(name))[1]::uuid) else false end
);

-- Permit cleanup only for an orphaned upload that was never attached to a
-- result submission; evidence referenced by the audit trail is immutable.
create policy match_evidence_orphan_cleanup on storage.objects
for delete to authenticated
using (
  bucket_id='match-evidence'
  and owner_id=(select auth.uid()::text)
  and (storage.foldername(name))[2]=(select auth.uid()::text)
  and case when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then private.can_submit_match_evidence((storage.foldername(name))[1]::uuid) else false end
  and not exists(select 1 from public.match_evidence e where e.object_key=name)
);


