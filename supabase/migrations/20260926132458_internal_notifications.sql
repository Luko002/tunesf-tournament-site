-- Deliver private in-app updates from the existing tournament workflows.
create table if not exists public.notifications (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  message text not null check (char_length(message) between 1 and 500),
  type text not null check (type in ('registration','match','result','team','tournament')),
  entity_type text,
  entity_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_inbox_idx
  on public.notifications(user_id, created_at desc);

alter table public.notifications enable row level security;
revoke all on public.notifications from public, anon;
grant select, update(read_at) on public.notifications to authenticated;

create policy notifications_read_own on public.notifications
  for select to authenticated using ((select auth.uid()) = user_id);
create policy notifications_mark_own on public.notifications
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create or replace function private.deliver_notification(
  p_user_id uuid, p_title text, p_message text, p_type text,
  p_entity_type text, p_entity_id uuid
) returns void language sql security definer set search_path = '' as $$
  insert into public.notifications(user_id,title,message,type,entity_type,entity_id)
  select p_user_id,left(btrim(p_title),120),left(btrim(p_message),500),p_type,p_entity_type,p_entity_id
  where p_user_id is not null
    and exists(select 1 from auth.users u where u.id=p_user_id);
$$;

create or replace function private.notify_registration_status()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_title text; v_message text;
begin
  if tg_op <> 'UPDATE' or new.status is not distinct from old.status
     or new.status not in ('approved','rejected') then return new; end if;
  v_title := case new.status when 'approved' then 'Tournament entry approved' else 'Tournament entry declined' end;
  select format('%s: your team registration was %s.',t.name,new.status) into v_message
    from public.tournaments t where t.id=new.tournament_id;
  perform private.deliver_notification(tm.user_id,v_title,coalesce(v_message,'Your tournament registration was updated.'),
    'registration','tournament',new.tournament_id)
    from public.team_members tm where tm.team_id=new.team_id and tm.status='active';
  return new;
end;
$$;

create or replace function private.notify_match_schedule()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_name text;
begin
  if new.scheduled_at is null or new.scheduled_at is not distinct from old.scheduled_at
     or new.status in ('completed','cancelled','forfeit') then return new; end if;
  select t.name into v_name from public.tournaments t where t.id=new.tournament_id;
  perform private.deliver_notification(tm.user_id,'Match scheduled',
    format('%s · Round %s match %s is scheduled for %s.',coalesce(v_name,'Tournament'),new.round_number,new.position,
      to_char(new.scheduled_at at time zone 'UTC','Mon DD, YYYY HH24:MI')||' UTC'),
    'match','match',new.id)
  from public.tournament_registrations r join public.team_members tm on tm.team_id=r.team_id and tm.status='active'
  where r.id in (new.home_registration_id,new.away_registration_id);
  return new;
end;
$$;

create or replace function private.notify_match_official_assignment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.deliver_notification(new.user_id,'Match assignment',
    'You have been assigned as an official for a tournament match. Open the referee workspace to review it.',
    'match','match',new.match_id);
  return new;
end;
$$;

create or replace function private.notify_result_submission()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_home uuid; v_away uuid;
begin
  select home_registration_id,away_registration_id into v_home,v_away
    from public.tournament_matches where id=new.match_id;
  perform private.deliver_notification(tm.user_id,'Match result submitted',
    format('A team submitted %s–%s. Review the result in the match room.',new.home_score,new.away_score),
    'result','match',new.match_id)
  from public.tournament_registrations r join public.team_members tm on tm.team_id=r.team_id and tm.status='active'
  where r.id in (v_home,v_away) and r.id<>new.registration_id;
  perform private.deliver_notification(o.user_id,'Result review needed',
    'A match result is waiting for official review.', 'result','match',new.match_id)
  from public.match_officials o where o.match_id=new.match_id;
  return new;
end;
$$;

create or replace function private.notify_result_review()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_title text; v_message text;
begin
  if new.status is not distinct from old.status or new.status not in ('accepted','rejected') then return new; end if;
  v_title := case new.status when 'accepted' then 'Match result confirmed' else 'Match result needs attention' end;
  v_message := case new.status when 'accepted' then 'Your submitted match result was accepted.'
    else 'Your submitted match result was declined.'||case when nullif(btrim(new.review_note),'') is not null then ' Note: '||left(btrim(new.review_note),350) else '' end end;
  perform private.deliver_notification(new.submitted_by,v_title,v_message,'result','match',new.match_id);
  return new;
end;
$$;

create or replace function private.notify_team_invitation()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_team text;
begin
  if new.invitee_user_id is null then return new; end if;
  select name into v_team from public.teams where id=new.team_id;
  perform private.deliver_notification(new.invitee_user_id,'Team invitation',
    format('You have been invited to join %s.',coalesce(v_team,'a team')),'team','team',new.team_id);
  return new;
end;
$$;

create or replace function private.notify_tournament_progress()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_title text; v_message text;
begin
  if new.status is not distinct from old.status or new.status not in ('registration_closed','in_progress','completed','cancelled') then return new; end if;
  v_title := case new.status when 'registration_closed' then 'Registration closed'
    when 'in_progress' then 'Tournament started' when 'completed' then 'Tournament finished' else 'Tournament cancelled' end;
  v_message := format('%s: tournament status is now %s.',new.name,replace(new.status,'_',' '));
  perform private.deliver_notification(tm.user_id,v_title,v_message,'tournament','tournament',new.id)
  from public.tournament_registrations r join public.team_members tm on tm.team_id=r.team_id and tm.status='active'
  where r.tournament_id=new.id and r.status in ('approved','checked_in');
  return new;
end;
$$;

drop trigger if exists notifications_registration_status on public.tournament_registrations;
create trigger notifications_registration_status after update of status on public.tournament_registrations
  for each row execute function private.notify_registration_status();
drop trigger if exists notifications_match_schedule on public.tournament_matches;
create trigger notifications_match_schedule after update of scheduled_at on public.tournament_matches
  for each row execute function private.notify_match_schedule();
drop trigger if exists notifications_match_official on public.match_officials;
create trigger notifications_match_official after insert on public.match_officials
  for each row execute function private.notify_match_official_assignment();
drop trigger if exists notifications_result_submission on public.match_result_submissions;
create trigger notifications_result_submission after insert on public.match_result_submissions
  for each row execute function private.notify_result_submission();
drop trigger if exists notifications_result_review on public.match_result_submissions;
create trigger notifications_result_review after update of status on public.match_result_submissions
  for each row execute function private.notify_result_review();
drop trigger if exists notifications_team_invitation on public.team_invitations;
create trigger notifications_team_invitation after insert on public.team_invitations
  for each row execute function private.notify_team_invitation();
drop trigger if exists notifications_tournament_progress on public.tournaments;
create trigger notifications_tournament_progress after update of status on public.tournaments
  for each row execute function private.notify_tournament_progress();

revoke all on function private.deliver_notification(uuid,text,text,text,text,uuid) from public,anon,authenticated;
revoke all on function private.notify_registration_status() from public,anon,authenticated;
revoke all on function private.notify_match_schedule() from public,anon,authenticated;
revoke all on function private.notify_match_official_assignment() from public,anon,authenticated;
revoke all on function private.notify_result_submission() from public,anon,authenticated;
revoke all on function private.notify_result_review() from public,anon,authenticated;
revoke all on function private.notify_team_invitation() from public,anon,authenticated;
revoke all on function private.notify_tournament_progress() from public,anon,authenticated;
