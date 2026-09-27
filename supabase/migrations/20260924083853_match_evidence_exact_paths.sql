-- Restrict evidence object paths to exactly <match UUID>/<owner UUID>/<file>.
-- This prevents clients from leaving arbitrary nested objects in the bucket.
drop policy match_evidence_upload on storage.objects;
create policy match_evidence_upload on storage.objects
for insert to authenticated
with check (
  bucket_id='match-evidence'
  and cardinality(storage.foldername(name))=2
  and owner_id=(select auth.uid()::text)
  and (storage.foldername(name))[2]=(select auth.uid()::text)
  and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and storage.filename(name) ~ '^[0-9a-f]{32}\.(jpg|jpeg|png|webp|mp4)$'
  and storage.extension(name)=any(array['jpg','jpeg','png','webp','mp4'])
  and coalesce(metadata->>'mimetype','')=any(array['image/jpeg','image/png','image/webp','video/mp4'])
  and case when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then private.can_submit_match_evidence((storage.foldername(name))[1]::uuid) else false end
);

drop policy match_evidence_scoped_read on storage.objects;
create policy match_evidence_scoped_read on storage.objects
for select to authenticated
using (
  bucket_id='match-evidence'
  and cardinality(storage.foldername(name))=2
  and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and case when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then private.can_access_match((storage.foldername(name))[1]::uuid) else false end
);

drop policy match_evidence_orphan_cleanup on storage.objects;
create policy match_evidence_orphan_cleanup on storage.objects
for delete to authenticated
using (
  bucket_id='match-evidence'
  and cardinality(storage.foldername(name))=2
  and owner_id=(select auth.uid()::text)
  and (storage.foldername(name))[2]=(select auth.uid()::text)
  and case when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then private.can_submit_match_evidence((storage.foldername(name))[1]::uuid) else false end
  and not exists(select 1 from public.match_evidence e where e.object_key=name)
);


