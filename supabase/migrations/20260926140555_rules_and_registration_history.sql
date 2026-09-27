-- Persist event rules separately from the public event description and record
-- registration status changes for authorized tournament operators.
alter table public.tournaments add column if not exists rules text not null default '' check (char_length(rules)<=10000);
update public.tournaments set rules=substring(description from length(E'\n\nTOURNAMENT RULES\n')+1), description=left(description,length(description)-length(E'\n\nTOURNAMENT RULES\n')-length(substring(description from length(E'\n\nTOURNAMENT RULES\n')+1))) where position(E'\n\nTOURNAMENT RULES\n' in description)>0;

create or replace view public.tournament_directory as
 select t.id,t.name,t.game,t.description,t.format,t.best_of,t.region,t.starts_at,t.registration_opens_at,t.registration_closes_at,
  t.max_teams,t.roster_size,t.prize_pool,t.currency,t.map_pool,t.anti_cheat_required,t.substitute_limit,t.check_in_minutes,
  case when t.status='registration_open' and coalesce(t.registration_closes_at,t.starts_at) is not null and coalesce(t.registration_closes_at,t.starts_at)<=now()
   then 'registration_closed' else t.status end as status,
  t.created_at,count(r.id)::integer as registered_teams,t.cover_image_path,t.rules
 from public.tournaments t left join public.tournament_registrations r on r.tournament_id=t.id and r.status in ('approved','checked_in')
 where t.status<>'draft' group by t.id;

create or replace function public.create_tournament(p_data jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_org uuid;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if jsonb_typeof(p_data)<>'object' then raise exception 'Tournament payload must be an object'; end if;
 if coalesce(p_data->>'format','single') not in ('single','single_elimination','double','double_elimination','rr','round_robin','round_robin_playoffs') then raise exception 'Unsupported tournament format'; end if;
 if char_length(coalesce(p_data->>'rules',''))>10000 then raise exception 'Tournament rules are too long'; end if;
 v_org:=nullif(p_data->>'organization_id','')::uuid;
 if v_org is not null then
  if not private.can_manage_organization(v_org,'create_tournaments') then raise exception 'Organization tournament capability required'; end if;
 elsif not public.has_permission('CREATE_TOURNAMENT') and not private.is_super_admin() then raise exception 'Tournament creation eligibility required'; end if;
 insert into public.tournaments(organizer_id,organization_id,name,game,description,rules,format,best_of,region,starts_at,registration_opens_at,registration_closes_at,max_teams,roster_size,prize_pool,currency,map_pool,anti_cheat_required,substitute_limit,check_in_minutes,status)
 values(auth.uid(),v_org,trim(p_data->>'name'),p_data->>'game',coalesce(p_data->>'description',''),coalesce(p_data->>'rules',''),
 case coalesce(p_data->>'format','single') when 'single' then 'single_elimination' when 'double' then 'double_elimination' when 'rr' then 'round_robin_playoffs' else p_data->>'format' end,
 coalesce(p_data->>'best_of','BO3'),coalesce(p_data->>'region',''),nullif(p_data->>'starts_at','')::timestamptz,nullif(p_data->>'registration_opens_at','')::timestamptz,nullif(p_data->>'registration_closes_at','')::timestamptz,
 coalesce((p_data->>'max_teams')::integer,64),coalesce((p_data->>'roster_size')::integer,5),coalesce((p_data->>'prize_pool')::numeric,0),coalesce(p_data->>'currency','TND'),coalesce(array(select jsonb_array_elements_text(p_data->'map_pool')),'{}'),
 coalesce((p_data->>'anti_cheat_required')::boolean,false),coalesce((p_data->>'substitute_limit')::smallint,1),coalesce((p_data->>'check_in_minutes')::smallint,60),'draft') returning id into v_id;
 perform private.write_audit_event('TOURNAMENT_CREATED','tournament',v_id,'{}'::jsonb);
 return v_id;
end; $$;

create or replace function public.update_tournament(p_tournament_id uuid,p_data jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if p_data ? 'format' and p_data->>'format' not in ('single','single_elimination','double','double_elimination','rr','round_robin','round_robin_playoffs') then raise exception 'Unsupported tournament format'; end if;
 if p_data ? 'rules' and char_length(p_data->>'rules')>10000 then raise exception 'Tournament rules are too long'; end if;
 perform 1 from public.tournaments where id=p_tournament_id for update;
 if not found or not private.can_manage_tournament(p_tournament_id,'manage_tournament') then raise exception 'Tournament management capability required'; end if;
 if exists(select 1 from public.tournament_stages where tournament_id=p_tournament_id and status<>'draft') then raise exception 'Tournament settings are locked after bracket publication'; end if;
 update public.tournaments set
  name=coalesce(nullif(trim(p_data->>'name'),''),name),game=coalesce(p_data->>'game',game),
  format=case p_data->>'format' when 'single' then 'single_elimination' when 'double' then 'double_elimination' when 'rr' then 'round_robin_playoffs' else coalesce(p_data->>'format',format) end,
  best_of=coalesce(p_data->>'best_of',best_of),description=coalesce(p_data->>'description',description),rules=coalesce(p_data->>'rules',rules),region=coalesce(p_data->>'region',region),
  starts_at=case when p_data ? 'starts_at' then nullif(p_data->>'starts_at','')::timestamptz else starts_at end,
  registration_opens_at=case when p_data ? 'registration_opens_at' then nullif(p_data->>'registration_opens_at','')::timestamptz else registration_opens_at end,
  registration_closes_at=case when p_data ? 'registration_closes_at' then nullif(p_data->>'registration_closes_at','')::timestamptz else registration_closes_at end,
  max_teams=coalesce((p_data->>'max_teams')::integer,max_teams),roster_size=coalesce((p_data->>'roster_size')::integer,roster_size),prize_pool=coalesce((p_data->>'prize_pool')::numeric,prize_pool),currency=coalesce(p_data->>'currency',currency),
  map_pool=case when p_data ? 'map_pool' then array(select jsonb_array_elements_text(p_data->'map_pool')) else map_pool end,
  anti_cheat_required=coalesce((p_data->>'anti_cheat_required')::boolean,anti_cheat_required),substitute_limit=coalesce((p_data->>'substitute_limit')::smallint,substitute_limit),check_in_minutes=coalesce((p_data->>'check_in_minutes')::smallint,check_in_minutes),updated_at=now()
 where id=p_tournament_id and status='draft';
 if not found then raise exception 'Only drafts can be edited'; end if;
 perform private.write_audit_event('TOURNAMENT_UPDATED','tournament',p_tournament_id,'{}'::jsonb);
end; $$;

create table if not exists public.tournament_registration_events(
 id bigint generated always as identity primary key,
 registration_id uuid not null references public.tournament_registrations(id) on delete cascade,
 tournament_id uuid not null references public.tournaments(id) on delete cascade,
 actor_id uuid references auth.users(id) on delete set null,
 from_status text,
 to_status text not null check(to_status in ('pending','approved','rejected','withdrawn','checked_in')),
 event_at timestamptz not null default now()
);
alter table public.tournament_registration_events enable row level security;
revoke all on public.tournament_registration_events from public,anon,authenticated;
grant select on public.tournament_registration_events to authenticated;
drop policy if exists "Tournament staff can review registration history" on public.tournament_registration_events;
create policy "Tournament staff can review registration history" on public.tournament_registration_events for select to authenticated using (private.can_manage_tournament(tournament_id,'registrations') or private.can_manage_tournament(tournament_id,'manage_tournament'));

create or replace function private.log_tournament_registration_status()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
 if tg_op='INSERT' then
  insert into public.tournament_registration_events(registration_id,tournament_id,actor_id,to_status) values(new.id,new.tournament_id,auth.uid(),new.status);
 elsif old.status is distinct from new.status then
  insert into public.tournament_registration_events(registration_id,tournament_id,actor_id,from_status,to_status) values(new.id,new.tournament_id,auth.uid(),old.status,new.status);
 end if;
 return new;
end; $$;
revoke all on function private.log_tournament_registration_status() from public,anon,authenticated;
drop trigger if exists log_tournament_registration_status on public.tournament_registrations;
create trigger log_tournament_registration_status after insert or update of status on public.tournament_registrations for each row execute function private.log_tournament_registration_status();

create or replace function public.list_tournament_registration_history(p_tournament_id uuid)
returns table(registration_id uuid,from_status text,to_status text,event_at timestamptz,actor_name text)
language plpgsql stable security definer set search_path = '' as $$
begin
 if auth.uid() is null or not (private.can_manage_tournament(p_tournament_id,'registrations') or private.can_manage_tournament(p_tournament_id,'manage_tournament')) then raise exception 'Tournament registration capability required'; end if;
 return query select e.registration_id,e.from_status,e.to_status,e.event_at,coalesce(p.username,p.player_name)
 from public.tournament_registration_events e left join public.public_profiles p on p.id=e.actor_id
 where e.tournament_id=p_tournament_id order by e.event_at desc,e.id desc limit 500;
end; $$;
revoke all on function public.list_tournament_registration_history(uuid) from public,anon;
grant execute on function public.list_tournament_registration_history(uuid) to authenticated;
