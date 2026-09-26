alter table public.profiles add column if not exists avatar_path text;
alter table public.public_profiles add column if not exists avatar_path text;
alter table public.teams add column if not exists logo_path text;

update public.public_profiles pp set avatar_path=p.avatar_path
from public.profiles p where p.id=pp.id and pp.avatar_path is distinct from p.avatar_path;

create or replace function private.sync_public_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.public_profiles(id,username,player_name,game,region,discord_username,avatar_path)
  values(new.id,new.username,new.player_name,new.game,new.region,new.discord_username,new.avatar_path)
  on conflict(id) do update set username=excluded.username,player_name=excluded.player_name,
    game=excluded.game,region=excluded.region,discord_username=excluded.discord_username,avatar_path=excluded.avatar_path;
  return new;
end;
$$;
drop trigger if exists sync_public_profile_card on public.profiles;
create trigger sync_public_profile_card after insert or update of username,player_name,game,region,discord_username,avatar_path
  on public.profiles for each row execute function private.sync_public_profile();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('public-media','public-media',true,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=true,file_size_limit=5242880,allowed_mime_types=array['image/jpeg','image/png','image/webp'];

create policy public_media_profile_upload on storage.objects for insert to authenticated
with check (bucket_id='public-media' and cardinality(storage.foldername(name))=2
  and (storage.foldername(name))[1]='profiles' and (storage.foldername(name))[2]=(select auth.uid())::text
  and storage.filename(name) ~ '^[0-9a-f]{32}\.(jpg|jpeg|png|webp)$'
  and coalesce(metadata->>'mimetype','') in ('image/jpeg','image/png','image/webp'));

create policy public_media_team_upload on storage.objects for insert to authenticated
with check (bucket_id='public-media' and cardinality(storage.foldername(name))=3
  and (storage.foldername(name))[1]='teams'
  and (storage.foldername(name))[2] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and (storage.foldername(name))[3]=(select auth.uid())::text
  and storage.filename(name) ~ '^[0-9a-f]{32}\.(jpg|jpeg|png|webp)$'
  and coalesce(metadata->>'mimetype','') in ('image/jpeg','image/png','image/webp')
  and exists(select 1 from public.teams t where t.id=((storage.foldername(name))[2])::uuid
    and (private.is_team_captain(t.id) or (t.organization_id is not null and private.can_manage_organization(t.organization_id,'manage_teams')))));

create policy public_media_profile_remove on storage.objects for delete to authenticated
using (bucket_id='public-media' and cardinality(storage.foldername(name))=2
  and (storage.foldername(name))[1]='profiles' and (storage.foldername(name))[2]=(select auth.uid())::text);
create policy public_media_team_remove on storage.objects for delete to authenticated
using (bucket_id='public-media' and cardinality(storage.foldername(name))=3
  and (storage.foldername(name))[1]='teams' and (storage.foldername(name))[3]=(select auth.uid())::text
  and exists(select 1 from public.teams t where t.id=((storage.foldername(name))[2])::uuid
    and (private.is_team_captain(t.id) or (t.organization_id is not null and private.can_manage_organization(t.organization_id,'manage_teams')))));

create or replace function public.set_player_avatar_path(p_avatar_path text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_avatar_path is not null and p_avatar_path !~ ('^profiles/'||auth.uid()::text||'/[0-9a-f]{32}\.(jpg|jpeg|png|webp)$') then
    raise exception 'Invalid profile image path';
  end if;
  if p_avatar_path is not null and not exists(select 1 from storage.objects o where o.bucket_id='public-media' and o.name=p_avatar_path and o.owner_id=auth.uid()::text) then
    raise exception 'Profile image upload was not found';
  end if;
  update public.profiles set avatar_path=p_avatar_path,updated_at=now() where id=auth.uid();
  if not found then raise exception 'Player profile not found'; end if;
end;
$$;

create or replace function public.set_team_logo_path(p_team_id uuid,p_logo_path text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.teams t where t.id=p_team_id and
    (private.is_team_captain(t.id) or (t.organization_id is not null and private.can_manage_organization(t.organization_id,'manage_teams')))) then
    raise exception 'Team captain or organization team manager required';
  end if;
  if p_logo_path is not null and p_logo_path !~ ('^teams/'||p_team_id::text||'/'||auth.uid()::text||'/[0-9a-f]{32}\.(jpg|jpeg|png|webp)$') then
    raise exception 'Invalid team logo path';
  end if;
  if p_logo_path is not null and not exists(select 1 from storage.objects o where o.bucket_id='public-media' and o.name=p_logo_path and o.owner_id=auth.uid()::text) then
    raise exception 'Team logo upload was not found';
  end if;
  update public.teams set logo_path=p_logo_path where id=p_team_id;
end;
$$;
revoke all on function public.set_player_avatar_path(text),public.set_team_logo_path(uuid,text) from public,anon,authenticated;
grant execute on function public.set_player_avatar_path(text),public.set_team_logo_path(uuid,text) to authenticated;

create or replace function public.get_public_player_profile(p_user_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'profile',jsonb_build_object('id',p.id,'username',coalesce(p.username,p.player_name),'game',p.game,'region',p.region,'avatar_path',p.avatar_path),
    'stats',jsonb_build_object(
      'tournaments',(select count(distinct r.tournament_id) from public.tournament_registration_members rm join public.tournament_registrations r on r.id=rm.registration_id and r.status in ('approved','checked_in') join public.tournaments t on t.id=r.tournament_id and t.status<>'draft' where rm.user_id=p_user_id),
      'matches',(select count(*) from public.tournament_matches m join public.tournaments t on t.id=m.tournament_id and t.status<>'draft' where m.status in ('completed','forfeit') and (m.home_registration_id in (select registration_id from public.tournament_registration_members where user_id=p_user_id) or m.away_registration_id in (select registration_id from public.tournament_registration_members where user_id=p_user_id))),
      'wins',(select count(*) from public.tournament_matches m join public.tournaments t on t.id=m.tournament_id and t.status<>'draft' where m.status in ('completed','forfeit') and m.winner_registration_id in (select registration_id from public.tournament_registration_members where user_id=p_user_id))
    ),
    'teams',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'tag',t.tag,'game',t.game,'region',t.region,'role',tm.role,'logo_path',t.logo_path) order by t.name) from public.team_members tm join public.teams t on t.id=tm.team_id where tm.user_id=p_user_id and tm.status='active'),'[]'::jsonb),
    'tournaments',coalesce((select jsonb_agg(x.item order by x.starts_at desc nulls last) from (select distinct on (t.id) t.id,t.starts_at,jsonb_build_object('id',t.id,'name',t.name,'game',t.game,'status',t.status,'starts_at',t.starts_at) item from public.tournament_registration_members rm join public.tournament_registrations r on r.id=rm.registration_id and r.status in ('approved','checked_in') join public.tournaments t on t.id=r.tournament_id and t.status<>'draft' where rm.user_id=p_user_id order by t.id,t.starts_at desc nulls last limit 30) x),'[]'::jsonb),
    'matches',coalesce((select jsonb_agg(x.item order by x.scheduled_at desc nulls last) from (select m.scheduled_at,jsonb_build_object('id',m.id,'tournament_id',t.id,'tournament',t.name,'round',m.round_number,'position',m.position,'scheduled_at',m.scheduled_at,'status',m.status,'home_score',m.home_score,'away_score',m.away_score,'opponent',case when rm.registration_id=m.home_registration_id then away_team.name else home_team.name end,'won',m.winner_registration_id=rm.registration_id) item from public.tournament_registration_members rm join public.tournament_registrations r on r.id=rm.registration_id and r.status in ('approved','checked_in') join public.tournament_matches m on rm.registration_id in (m.home_registration_id,m.away_registration_id) join public.tournaments t on t.id=m.tournament_id and t.status<>'draft' left join public.tournament_registrations home_reg on home_reg.id=m.home_registration_id left join public.tournament_registrations away_reg on away_reg.id=m.away_registration_id left join public.teams home_team on home_team.id=home_reg.team_id left join public.teams away_team on away_team.id=away_reg.team_id where rm.user_id=p_user_id order by m.scheduled_at desc nulls last limit 30) x),'[]'::jsonb)
  ) from public.public_profiles p where p.id=p_user_id;
$$;

create or replace function public.get_public_team_profile(p_team_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'team',jsonb_build_object('id',t.id,'name',t.name,'tag',t.tag,'game',t.game,'region',t.region,'created_at',t.created_at,'logo_path',t.logo_path,'captain',coalesce(cp.username,cp.player_name)),
    'roster',coalesce((select jsonb_agg(jsonb_build_object('user_id',r.user_id,'username',coalesce(r.username,r.player_name),'role',r.member_role,'game',r.game,'avatar_path',pp.avatar_path) order by case r.member_role when 'captain' then 0 else 1 end,r.username) from public.list_public_team_rosters(p_team_id) r left join public.public_profiles pp on pp.id=r.user_id),'[]'::jsonb),
    'stats',jsonb_build_object(
      'tournaments',(select count(*) from public.tournament_registrations r join public.tournaments e on e.id=r.tournament_id and e.status<>'draft' where r.team_id=t.id and r.status in ('approved','checked_in')),
      'matches',(select count(*) from public.tournament_matches m join public.tournaments e on e.id=m.tournament_id and e.status<>'draft' where m.status in ('completed','forfeit') and exists(select 1 from public.tournament_registrations r where r.id in (m.home_registration_id,m.away_registration_id) and r.team_id=t.id)),
      'wins',(select count(*) from public.tournament_matches m join public.tournaments e on e.id=m.tournament_id and e.status<>'draft' join public.tournament_registrations r on r.id=m.winner_registration_id where m.status in ('completed','forfeit') and r.team_id=t.id),
      'losses',(select count(*) from public.tournament_matches m join public.tournaments e on e.id=m.tournament_id and e.status<>'draft' where m.status in ('completed','forfeit') and m.winner_registration_id is not null and exists(select 1 from public.tournament_registrations r where r.id in (m.home_registration_id,m.away_registration_id) and r.team_id=t.id) and not exists(select 1 from public.tournament_registrations r where r.id=m.winner_registration_id and r.team_id=t.id))
    ),
    'tournaments',coalesce((select jsonb_agg(x.item order by x.starts_at desc nulls last) from (select distinct on (e.id) e.id,e.starts_at,jsonb_build_object('id',e.id,'name',e.name,'game',e.game,'status',e.status,'starts_at',e.starts_at) item from public.tournament_registrations r join public.tournaments e on e.id=r.tournament_id and e.status<>'draft' where r.team_id=t.id and r.status in ('approved','checked_in') order by e.id,e.starts_at desc nulls last limit 30) x),'[]'::jsonb),
    'matches',coalesce((select jsonb_agg(x.item order by x.scheduled_at desc nulls last) from (select m.scheduled_at,jsonb_build_object('id',m.id,'tournament_id',e.id,'tournament',e.name,'round',m.round_number,'position',m.position,'scheduled_at',m.scheduled_at,'status',m.status,'home_score',m.home_score,'away_score',m.away_score,'opponent',case when r.id=m.home_registration_id then away_team.name else home_team.name end,'won',m.winner_registration_id=r.id) item from public.tournament_registrations r join public.tournaments e on e.id=r.tournament_id and e.status<>'draft' join public.tournament_matches m on r.id in (m.home_registration_id,m.away_registration_id) left join public.tournament_registrations home_reg on home_reg.id=m.home_registration_id left join public.tournament_registrations away_reg on away_reg.id=m.away_registration_id left join public.teams home_team on home_team.id=home_reg.team_id left join public.teams away_team on away_team.id=away_reg.team_id where r.team_id=t.id and r.status in ('approved','checked_in') order by m.scheduled_at desc nulls last limit 30) x),'[]'::jsonb)
  ) from public.teams t left join public.public_profiles cp on cp.id=t.captain_id where t.id=p_team_id;
$$;
revoke all on function public.get_public_player_profile(uuid),public.get_public_team_profile(uuid) from public;
grant execute on function public.get_public_player_profile(uuid),public.get_public_team_profile(uuid) to anon,authenticated;

drop function if exists public.list_public_clubs();
create function public.list_public_clubs()
returns table(club_id uuid,name text,source_url text,season integer,team_id uuid,tag text,game text,region text,captain_name text,roster_size integer,logo_path text)
language sql stable security definer set search_path = '' as $$
  select c.id,c.name,c.source_url,c.season,null::uuid,null::text,null::text,null::text,null::text,0,null::text from public.clubs c
  union all
  select null::uuid,t.name,''::text,0,t.id,t.tag,t.game,t.region,p.username,
    (select count(*)::integer from public.team_game_members gm join public.team_members m using(team_id,user_id) where gm.team_id=t.id and gm.game=t.game and m.status='active'),t.logo_path
  from public.teams t join public.public_profiles p on p.id=t.captain_id
  order by name;
$$;
revoke all on function public.list_public_clubs() from public;
grant execute on function public.list_public_clubs() to anon,authenticated;

drop function if exists public.get_my_team_matches();
create function public.get_my_team_matches()
returns table(match_id uuid,tournament_id uuid,tournament_name text,game text,stage_name text,bracket_side text,
  round_number smallint,match_position smallint,match_status text,scheduled_at timestamptz,started_at timestamptz,
  your_team_name text,your_team_tag text,your_team_id uuid,your_team_logo_path text,
  opponent_team_name text,opponent_team_tag text,opponent_team_id uuid,opponent_team_logo_path text,
  your_score smallint,opponent_score smallint)
language sql stable security definer set search_path = '' as $$
  select distinct m.id,m.tournament_id,t.name,t.game,s.name,m.bracket_side,m.round_number,m.position,m.status,m.scheduled_at,m.started_at,
    case when private.is_team_member(home.team_id) then home_team.name else away_team.name end,
    case when private.is_team_member(home.team_id) then home_team.tag else away_team.tag end,
    case when private.is_team_member(home.team_id) then home_team.id else away_team.id end,
    case when private.is_team_member(home.team_id) then home_team.logo_path else away_team.logo_path end,
    case when private.is_team_member(home.team_id) then away_team.name else home_team.name end,
    case when private.is_team_member(home.team_id) then away_team.tag else home_team.tag end,
    case when private.is_team_member(home.team_id) then away_team.id else home_team.id end,
    case when private.is_team_member(home.team_id) then away_team.logo_path else home_team.logo_path end,
    case when private.is_team_member(home.team_id) then m.home_score else m.away_score end,
    case when private.is_team_member(home.team_id) then m.away_score else m.home_score end
  from public.tournament_matches m join public.tournaments t on t.id=m.tournament_id join public.tournament_stages s on s.id=m.stage_id
  left join public.tournament_registrations home on home.id=m.home_registration_id
  left join public.tournament_registrations away on away.id=m.away_registration_id
  left join public.teams home_team on home_team.id=home.team_id left join public.teams away_team on away_team.id=away.team_id
  where (select auth.uid()) is not null and t.status<>'draft' and m.status in ('ready','live','paused','result_pending','disputed')
    and ((home.team_id is not null and private.is_team_member(home.team_id)) or (away.team_id is not null and private.is_team_member(away.team_id)))
  order by m.scheduled_at nulls last,m.started_at desc;
$$;
revoke all on function public.get_my_team_matches() from public,anon,authenticated;
grant execute on function public.get_my_team_matches() to authenticated;
