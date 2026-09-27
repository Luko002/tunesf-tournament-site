-- Store the preferred round-robin qualification count and expose it to event views.
alter table public.tournaments
  add column if not exists playoff_qualifier_count integer not null default 4
  check (playoff_qualifier_count between 2 and 64);

create or replace function private.enforce_playoff_qualifier_superadmin()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
 if auth.uid() is not null and not private.is_super_admin() then
  if tg_op='INSERT' and new.playoff_qualifier_count<>4 then raise exception 'Only a Super Admin can set playoff qualifiers'; end if;
  if tg_op='UPDATE' and new.playoff_qualifier_count is distinct from old.playoff_qualifier_count then raise exception 'Only a Super Admin can change playoff qualifiers'; end if;
 end if;
 return new;
end; $$;
revoke all on function private.enforce_playoff_qualifier_superadmin() from public,anon,authenticated;
drop trigger if exists enforce_playoff_qualifier_superadmin on public.tournaments;
create trigger enforce_playoff_qualifier_superadmin before insert or update on public.tournaments
for each row execute function private.enforce_playoff_qualifier_superadmin();

create or replace view public.tournament_directory as
 select t.id,t.name,t.game,t.description,t.format,t.best_of,t.region,t.starts_at,t.registration_opens_at,t.registration_closes_at,
  t.max_teams,t.roster_size,t.prize_pool,t.currency,t.map_pool,t.anti_cheat_required,t.substitute_limit,t.check_in_minutes,
  case when t.status='registration_open' and coalesce(t.registration_closes_at,t.starts_at) is not null and coalesce(t.registration_closes_at,t.starts_at)<=now()
   then 'registration_closed' else t.status end as status,
  t.created_at,count(r.id)::integer as registered_teams,t.cover_image_path,t.rules,t.playoff_qualifier_count
 from public.tournaments t left join public.tournament_registrations r on r.tournament_id=t.id and r.status in ('approved','checked_in')
 where t.status<>'draft' group by t.id;

create or replace function public.create_tournament(p_data jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_org uuid; v_qualifiers integer; v_max integer;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if jsonb_typeof(p_data)<>'object' then raise exception 'Tournament payload must be an object'; end if;
 if coalesce(p_data->>'format','single') not in ('single','single_elimination','double','double_elimination','rr','round_robin','round_robin_playoffs') then raise exception 'Unsupported tournament format'; end if;
 if char_length(coalesce(p_data->>'rules',''))>10000 then raise exception 'Tournament rules are too long'; end if;
 if p_data ? 'playoff_qualifier_count' then
  if not private.is_super_admin() then raise exception 'Only a Super Admin can set playoff qualifiers'; end if;
  if coalesce(p_data->>'format','single') not in ('rr','round_robin','round_robin_playoffs') then raise exception 'Playoff qualifiers apply only to round-robin tournaments'; end if;
  v_qualifiers:=(p_data->>'playoff_qualifier_count')::integer;
  if v_qualifiers not between 2 and 64 then raise exception 'Playoff qualifier count must be between 2 and 64'; end if;
 end if;
 v_max:=coalesce((p_data->>'max_teams')::integer,64);
 if v_qualifiers is not null and v_qualifiers>v_max then raise exception 'Playoff qualifiers cannot exceed the tournament team limit'; end if;
 v_org:=nullif(p_data->>'organization_id','')::uuid;
 if v_org is not null then
  if not private.can_manage_organization(v_org,'create_tournaments') then raise exception 'Organization tournament capability required'; end if;
 elsif not public.has_permission('CREATE_TOURNAMENT') and not private.is_super_admin() then raise exception 'Tournament creation eligibility required'; end if;
 insert into public.tournaments(organizer_id,organization_id,name,game,description,rules,format,best_of,region,starts_at,registration_opens_at,registration_closes_at,max_teams,roster_size,prize_pool,currency,map_pool,anti_cheat_required,substitute_limit,check_in_minutes,playoff_qualifier_count,status)
 values(auth.uid(),v_org,trim(p_data->>'name'),p_data->>'game',coalesce(p_data->>'description',''),coalesce(p_data->>'rules',''),
 case coalesce(p_data->>'format','single') when 'single' then 'single_elimination' when 'double' then 'double_elimination' when 'rr' then 'round_robin_playoffs' else p_data->>'format' end,
 coalesce(p_data->>'best_of','BO3'),coalesce(p_data->>'region',''),nullif(p_data->>'starts_at','')::timestamptz,nullif(p_data->>'registration_opens_at','')::timestamptz,nullif(p_data->>'registration_closes_at','')::timestamptz,
 v_max,coalesce((p_data->>'roster_size')::integer,5),coalesce((p_data->>'prize_pool')::numeric,0),coalesce(p_data->>'currency','TND'),coalesce(array(select jsonb_array_elements_text(p_data->'map_pool')),'{}'),
 coalesce((p_data->>'anti_cheat_required')::boolean,false),coalesce((p_data->>'substitute_limit')::smallint,1),coalesce((p_data->>'check_in_minutes')::smallint,60),coalesce(v_qualifiers,4),'draft') returning id into v_id;
 perform private.write_audit_event('TOURNAMENT_CREATED','tournament',v_id,jsonb_build_object('playoff_qualifier_count',coalesce(v_qualifiers,4)));
 return v_id;
end; $$;

drop function if exists public.list_my_tournament_operations();
create function public.list_my_tournament_operations()
returns table(id uuid,name text,game text,format text,status text,starts_at timestamptz,
  registration_closes_at timestamptz,max_teams integer,playoff_qualifier_count integer)
language sql stable security definer set search_path = ''
as $$
  select t.id,t.name,t.game,t.format,t.status,t.starts_at,t.registration_closes_at,t.max_teams,t.playoff_qualifier_count
  from public.tournaments t
  where auth.uid() is not null and private.can_manage_tournament(t.id,'manage_tournament')
  order by t.created_at desc limit 100;
$$;
revoke all on function public.list_my_tournament_operations() from public,anon;
grant execute on function public.list_my_tournament_operations() to authenticated;
