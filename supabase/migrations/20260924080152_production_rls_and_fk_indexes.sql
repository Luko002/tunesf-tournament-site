-- Keep stable auth identity lookups cached per query and avoid duplicate
-- permissive policies on participant registration reads.
drop policy if exists dispute_scoped_read on public.match_disputes;
create policy dispute_scoped_read on public.match_disputes for select to authenticated
  using (opened_by=(select auth.uid()) or private.can_access_match(match_id));

drop policy if exists officials_scoped_read on public.match_officials;
create policy officials_scoped_read on public.match_officials for select to authenticated
  using (user_id=(select auth.uid()) or private.can_access_match(match_id));

drop policy if exists cases_scoped_read on public.moderation_cases;
create policy cases_scoped_read on public.moderation_cases for select to authenticated
  using (reporter_id=(select auth.uid()) or public.has_permission('REVIEW_REPORTS')
    or exists(select 1 from public.moderation_staff m
      where m.user_id=(select auth.uid()) and 'review_cases'=any(m.capabilities)));

drop policy if exists moderation_staff_self_read on public.moderation_staff;
create policy moderation_staff_self_read on public.moderation_staff for select to authenticated
  using (user_id=(select auth.uid()));

drop policy if exists organization_membership_scoped_read on public.organization_memberships;
create policy organization_membership_scoped_read on public.organization_memberships for select to authenticated
  using (user_id=(select auth.uid()) or private.can_manage_organization(organization_id,'manage_staff'));

drop policy if exists profiles_self_read on public.profiles;
create policy profiles_self_read on public.profiles for select to authenticated
  using (id=(select auth.uid()));

drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles for update to authenticated
  using (id=(select auth.uid())) with check (id=(select auth.uid()));

drop policy if exists team_membership_read on public.team_members;
create policy team_membership_read on public.team_members for select to authenticated
  using (user_id=(select auth.uid()) or private.is_team_member(team_id) or private.is_team_captain(team_id));

drop policy if exists registration_scoped_read on public.tournament_registrations;
drop policy if exists registration_match_official_read on public.tournament_registrations;
create policy registration_scoped_read on public.tournament_registrations for select to authenticated
  using (registered_by=(select auth.uid()) or private.is_team_captain(team_id)
    or private.can_manage_tournament(tournament_id,'registrations')
    or private.can_manage_tournament(tournament_id,'manage_tournament')
    or exists(select 1 from public.tournament_matches m
      where (m.home_registration_id=id or m.away_registration_id=id) and private.can_access_match(m.id)));

drop policy if exists tournament_staff_scoped_read on public.tournament_staff;
create policy tournament_staff_scoped_read on public.tournament_staff for select to authenticated
  using (user_id=(select auth.uid()) or private.can_manage_tournament(tournament_id,'manage_tournament'));

drop policy if exists tournament_public_read on public.tournaments;
create policy tournament_public_read on public.tournaments for select to anon,authenticated
  using (status<>'draft' or organizer_id=(select auth.uid())
    or private.can_manage_tournament(id,'manage_tournament'));

drop policy if exists user_roles_self_or_audit_read on public.user_roles;
create policy user_roles_self_or_audit_read on public.user_roles for select to authenticated
  using (user_id=(select auth.uid()) or public.has_permission('AUDIT_LOGS') or private.is_super_admin());

-- Add indexes to child-side foreign keys used for joins and parent deletes.
-- Stable names keep this safe to rerun in a fresh TUNESF environment.
do $$
declare
  fk record;
  index_name text;
begin
  for fk in
    select c.conrelid, c.conkey,
      c.conname,
      n.nspname,
      t.relname,
      string_agg(format('%I',a.attname),',' order by k.ordinality) as column_sql
    from pg_constraint c
    join pg_class t on t.oid=c.conrelid
    join pg_namespace n on n.oid=t.relnamespace
    cross join lateral unnest(c.conkey) with ordinality k(attnum,ordinality)
    join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum
    where c.contype='f' and n.nspname='public'
    group by c.oid,c.conrelid,c.conkey,c.conname,n.nspname,t.relname
  loop
    if not exists (
      select 1 from pg_index i
      where i.indrelid=fk.conrelid and i.indisvalid and i.indpred is null and i.indexprs is null
        and (select array_agg(i.indkey[g.ord]::smallint order by g.ord)
             from generate_series(0,array_length(fk.conkey,1)-1) g(ord))=fk.conkey
    ) then
      index_name:=left('fk_'||fk.relname||'_'||substr(md5(fk.conname),1,10),63);
      execute format('create index if not exists %I on %I.%I (%s)',
        index_name,fk.nspname,fk.relname,fk.column_sql);
    end if;
  end loop;
end;
$$;


