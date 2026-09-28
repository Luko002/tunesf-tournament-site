create table public.player_game_identity_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  game_key text not null check(game_key in ('rl','mlbb','eafc','efootball')),
  player_id text not null check(length(btrim(player_id)) between 2 and 100),
  platform text check(platform is null or length(btrim(platform)) between 2 and 40),
  proof_url text not null check(proof_url ~ '^https://'),
  status text not null default 'pending' check(status in ('pending','verified','rejected')),
  review_note text,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  unique(user_id,game_key)
);

create index player_game_identity_links_review_idx on public.player_game_identity_links(status,submitted_at desc);
alter table public.player_game_identity_links enable row level security;
create policy player_game_identity_links_owner_read on public.player_game_identity_links
  for select to authenticated using((select auth.uid())=user_id);
revoke all on public.player_game_identity_links from public,anon,authenticated;
grant select on public.player_game_identity_links to authenticated;
grant all on public.player_game_identity_links to service_role;

create or replace function public.submit_player_game_identity_link(
  p_game_key text,p_player_id text,p_platform text,p_proof_url text
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_player_id text:=btrim(p_player_id); v_platform text:=nullif(btrim(p_platform),''); v_proof_url text:=btrim(p_proof_url);
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_game_key is null or p_game_key not in ('rl','mlbb','eafc','efootball') then raise exception 'Unsupported game'; end if;
  if v_player_id is null or length(v_player_id)<2 or length(v_player_id)>100 then raise exception 'Enter a valid in-game ID'; end if;
  if v_platform is not null and length(v_platform)>40 then raise exception 'Platform must be 40 characters or fewer'; end if;
  if v_proof_url is null or v_proof_url !~ '^https://[^[:space:]]+$' or length(v_proof_url)>500 then raise exception 'Add a valid HTTPS profile or proof link'; end if;
  insert into public.player_game_identity_links(user_id,game_key,player_id,platform,proof_url,status,review_note,submitted_at,reviewed_at,reviewed_by)
  values(auth.uid(),p_game_key,v_player_id,v_platform,v_proof_url,'pending',null,now(),null,null)
  on conflict(user_id,game_key) do update set player_id=excluded.player_id,platform=excluded.platform,proof_url=excluded.proof_url,status='pending',review_note=null,submitted_at=now(),reviewed_at=null,reviewed_by=null
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.list_pending_player_game_identity_links()
returns table(id uuid,user_id uuid,username text,game_key text,player_id text,platform text,proof_url text,submitted_at timestamptz)
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not exists(select 1 from public.user_roles where user_id=auth.uid() and role_key in ('SUPER_ADMIN','PLATFORM_ADMIN')) then raise exception 'Platform admin required'; end if;
  return query select l.id,l.user_id,coalesce(p.username,'Player'),l.game_key,l.player_id,l.platform,l.proof_url,l.submitted_at
    from public.player_game_identity_links l left join public.public_profiles p on p.id=l.user_id
    where l.status='pending' order by l.submitted_at;
end;
$$;

create or replace function public.review_player_game_identity_link(p_link_id uuid,p_status text,p_review_note text default null)
returns void language plpgsql security definer set search_path='' as $$
declare v_note text:=nullif(btrim(p_review_note),'');
begin
  if auth.uid() is null or not exists(select 1 from public.user_roles where user_id=auth.uid() and role_key in ('SUPER_ADMIN','PLATFORM_ADMIN')) then raise exception 'Platform admin required'; end if;
  if p_status not in ('verified','rejected') then raise exception 'Choose verified or rejected'; end if;
  if v_note is not null and length(v_note)>500 then raise exception 'Review note must be 500 characters or fewer'; end if;
  update public.player_game_identity_links set status=p_status,review_note=v_note,reviewed_at=now(),reviewed_by=auth.uid() where id=p_link_id and status='pending';
  if not found then raise exception 'Pending game link not found'; end if;
end;
$$;

revoke all on function public.submit_player_game_identity_link(text,text,text,text),public.list_pending_player_game_identity_links(),public.review_player_game_identity_link(uuid,text,text) from public,anon,authenticated;
grant execute on function public.submit_player_game_identity_link(text,text,text,text),public.list_pending_player_game_identity_links(),public.review_player_game_identity_link(uuid,text,text) to authenticated;
