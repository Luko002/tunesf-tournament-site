-- Public profile payloads contain only the fields already approved for public display.
create or replace function public.get_public_player_profile(p_user_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'profile',jsonb_build_object('id',p.id,'username',coalesce(p.username,p.player_name),'game',p.game,'region',p.region),
    'stats',jsonb_build_object(
      'tournaments',(select count(distinct r.tournament_id) from public.tournament_registration_members rm
        join public.tournament_registrations r on r.id=rm.registration_id and r.status in ('approved','checked_in')
        join public.tournaments t on t.id=r.tournament_id and t.status<>'draft' where rm.user_id=p_user_id),
      'matches',(select count(*) from public.tournament_matches m join public.tournaments t on t.id=m.tournament_id and t.status<>'draft'
        where m.status in ('completed','forfeit') and (m.home_registration_id in (select registration_id from public.tournament_registration_members where user_id=p_user_id)
          or m.away_registration_id in (select registration_id from public.tournament_registration_members where user_id=p_user_id))),
      'wins',(select count(*) from public.tournament_matches m join public.tournaments t on t.id=m.tournament_id and t.status<>'draft'
        where m.status in ('completed','forfeit') and m.winner_registration_id in (select registration_id from public.tournament_registration_members where user_id=p_user_id))
    ),
    'teams',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'tag',t.tag,'game',t.game,'region',t.region,'role',tm.role) order by t.name)
      from public.team_members tm join public.teams t on t.id=tm.team_id where tm.user_id=p_user_id and tm.status='active'),'[]'::jsonb),
    'tournaments',coalesce((select jsonb_agg(x.item order by x.starts_at desc nulls last) from (
      select distinct on (t.id) t.id,t.starts_at,jsonb_build_object('id',t.id,'name',t.name,'game',t.game,'status',t.status,'starts_at',t.starts_at) item
      from public.tournament_registration_members rm join public.tournament_registrations r on r.id=rm.registration_id and r.status in ('approved','checked_in')
      join public.tournaments t on t.id=r.tournament_id and t.status<>'draft' where rm.user_id=p_user_id order by t.id,t.starts_at desc nulls last limit 30
    ) x),'[]'::jsonb),
    'matches',coalesce((select jsonb_agg(x.item order by x.scheduled_at desc nulls last) from (
      select m.scheduled_at,jsonb_build_object('id',m.id,'tournament_id',t.id,'tournament',t.name,'round',m.round_number,'position',m.position,
        'scheduled_at',m.scheduled_at,'status',m.status,'home_score',m.home_score,'away_score',m.away_score,
        'opponent',case when rm.registration_id=m.home_registration_id then away_team.name else home_team.name end,
        'won',m.winner_registration_id=rm.registration_id) item
      from public.tournament_registration_members rm join public.tournament_registrations r on r.id=rm.registration_id and r.status in ('approved','checked_in')
      join public.tournament_matches m on rm.registration_id in (m.home_registration_id,m.away_registration_id)
      join public.tournaments t on t.id=m.tournament_id and t.status<>'draft'
      left join public.tournament_registrations home_reg on home_reg.id=m.home_registration_id
      left join public.tournament_registrations away_reg on away_reg.id=m.away_registration_id
      left join public.teams home_team on home_team.id=home_reg.team_id left join public.teams away_team on away_team.id=away_reg.team_id
      where rm.user_id=p_user_id order by m.scheduled_at desc nulls last limit 30
    ) x),'[]'::jsonb)
  ) from public.public_profiles p where p.id=p_user_id;
$$;

create or replace function public.get_public_team_profile(p_team_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'team',jsonb_build_object('id',t.id,'name',t.name,'tag',t.tag,'game',t.game,'region',t.region,'created_at',t.created_at,
      'captain',coalesce(cp.username,cp.player_name)),
    'roster',coalesce((select jsonb_agg(jsonb_build_object('user_id',r.user_id,'username',coalesce(r.username,r.player_name),'role',r.member_role,'game',r.game) order by case r.member_role when 'captain' then 0 else 1 end,r.username)
      from public.list_public_team_rosters(p_team_id) r),'[]'::jsonb),
    'stats',jsonb_build_object(
      'tournaments',(select count(*) from public.tournament_registrations r join public.tournaments e on e.id=r.tournament_id and e.status<>'draft' where r.team_id=t.id and r.status in ('approved','checked_in')),
      'matches',(select count(*) from public.tournament_matches m join public.tournaments e on e.id=m.tournament_id and e.status<>'draft'
        where m.status in ('completed','forfeit') and exists(select 1 from public.tournament_registrations r where r.id in (m.home_registration_id,m.away_registration_id) and r.team_id=t.id)),
      'wins',(select count(*) from public.tournament_matches m join public.tournaments e on e.id=m.tournament_id and e.status<>'draft'
        join public.tournament_registrations r on r.id=m.winner_registration_id where m.status in ('completed','forfeit') and r.team_id=t.id),
      'losses',(select count(*) from public.tournament_matches m join public.tournaments e on e.id=m.tournament_id and e.status<>'draft'
        where m.status in ('completed','forfeit') and m.winner_registration_id is distinct from null
          and exists(select 1 from public.tournament_registrations r where r.id in (m.home_registration_id,m.away_registration_id) and r.team_id=t.id)
          and not exists(select 1 from public.tournament_registrations r where r.id=m.winner_registration_id and r.team_id=t.id))
    ),
    'tournaments',coalesce((select jsonb_agg(x.item order by x.starts_at desc nulls last) from (
      select distinct on (e.id) e.id,e.starts_at,jsonb_build_object('id',e.id,'name',e.name,'game',e.game,'status',e.status,'starts_at',e.starts_at) item
      from public.tournament_registrations r join public.tournaments e on e.id=r.tournament_id and e.status<>'draft'
      where r.team_id=t.id and r.status in ('approved','checked_in') order by e.id,e.starts_at desc nulls last limit 30
    ) x),'[]'::jsonb),
    'matches',coalesce((select jsonb_agg(x.item order by x.scheduled_at desc nulls last) from (
      select m.scheduled_at,jsonb_build_object('id',m.id,'tournament_id',e.id,'tournament',e.name,'round',m.round_number,'position',m.position,
        'scheduled_at',m.scheduled_at,'status',m.status,'home_score',m.home_score,'away_score',m.away_score,
        'opponent',case when r.id=m.home_registration_id then away_team.name else home_team.name end,
        'won',m.winner_registration_id=r.id) item
      from public.tournament_registrations r join public.tournaments e on e.id=r.tournament_id and e.status<>'draft'
      join public.tournament_matches m on r.id in (m.home_registration_id,m.away_registration_id)
      left join public.tournament_registrations home_reg on home_reg.id=m.home_registration_id
      left join public.tournament_registrations away_reg on away_reg.id=m.away_registration_id
      left join public.teams home_team on home_team.id=home_reg.team_id left join public.teams away_team on away_team.id=away_reg.team_id
      where r.team_id=t.id and r.status in ('approved','checked_in') order by m.scheduled_at desc nulls last limit 30
    ) x),'[]'::jsonb)
  ) from public.teams t left join public.public_profiles cp on cp.id=t.captain_id where t.id=p_team_id;
$$;

create or replace function public.get_admin_analytics()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if auth.uid() is null or not exists(select 1 from public.user_roles ur where ur.user_id=auth.uid() and ur.role_key in ('PLATFORM_ADMIN','SUPER_ADMIN')) then
    raise exception 'Platform analytics permission required';
  end if;
  with months as (select generate_series(date_trunc('month',now())-interval '5 months',date_trunc('month',now()),interval '1 month') as bucket),
  user_counts as (select date_trunc('month',created_at) as bucket,count(*) value from public.profiles where created_at>=date_trunc('month',now())-interval '5 months' group by 1),
  reg_counts as (select date_trunc('month',r.created_at) as bucket,count(*) value from public.tournament_registrations r where r.created_at>=date_trunc('month',now())-interval '5 months' group by 1),
  match_counts as (select date_trunc('month',m.completed_at) as bucket,count(*) value from public.tournament_matches m where m.status in ('completed','forfeit') and m.completed_at>=date_trunc('month',now())-interval '5 months' group by 1),
  game_counts as (select t.game,count(r.id) value from public.tournaments t left join public.tournament_registrations r on r.tournament_id=t.id and r.status in ('approved','checked_in') where t.status<>'draft' group by t.game order by count(r.id) desc,t.game limit 8)
  select jsonb_build_object(
    'totals',jsonb_build_object('users',(select count(*) from public.profiles),'teams',(select count(*) from public.teams),
      'tournaments',(select count(*) from public.tournaments where status<>'draft'),
      'active_tournaments',(select count(*) from public.tournaments where status in ('registration_open','in_progress')),
      'completed_matches',(select count(*) from public.tournament_matches where status in ('completed','forfeit')),
      'registered_players',(select count(distinct rm.user_id) from public.tournament_registration_members rm join public.tournament_registrations r on r.id=rm.registration_id and r.status in ('approved','checked_in'))),
    'user_growth',(select coalesce(jsonb_agg(jsonb_build_object('month',to_char(m.bucket,'Mon YYYY'),'value',coalesce(c.value,0)) order by m.bucket),'[]'::jsonb) from months m left join user_counts c using(bucket)),
    'tournament_participation',(select coalesce(jsonb_agg(jsonb_build_object('month',to_char(m.bucket,'Mon YYYY'),'value',coalesce(c.value,0)) order by m.bucket),'[]'::jsonb) from months m left join reg_counts c using(bucket)),
    'completed_matches',(select coalesce(jsonb_agg(jsonb_build_object('month',to_char(m.bucket,'Mon YYYY'),'value',coalesce(c.value,0)) order by m.bucket),'[]'::jsonb) from months m left join match_counts c using(bucket)),
    'popular_games',(select coalesce(jsonb_agg(jsonb_build_object('game',game,'registrations',value) order by value desc),'[]'::jsonb) from game_counts)
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.get_public_player_profile(uuid) from public;
grant execute on function public.get_public_player_profile(uuid) to anon,authenticated;
revoke all on function public.get_public_team_profile(uuid) from public;
grant execute on function public.get_public_team_profile(uuid) to anon,authenticated;
revoke all on function public.get_admin_analytics() from public,anon;
grant execute on function public.get_admin_analytics() to authenticated;
