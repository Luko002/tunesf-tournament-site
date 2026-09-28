create table public.player_faceit_links(
  user_id uuid primary key references auth.users(id) on delete cascade,
  faceit_player_id text unique,
  nickname text not null,
  avatar text,
  country text,
  faceit_url text,
  game_id text not null default 'cs2',
  skill_level smallint,
  faceit_elo integer,
  skill_level_label text,
  region text,
  lifetime_stats jsonb,
  segment_stats jsonb,
  visible boolean not null default true,
  verified boolean not null default false,
  fetched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index player_faceit_links_nickname_lower_uidx on public.player_faceit_links(lower(nickname));
alter table public.player_faceit_links enable row level security;
create policy player_faceit_links_read_visible_or_owner on public.player_faceit_links for select to anon,authenticated
  using(visible=true or user_id=(select auth.uid()));
revoke all on public.player_faceit_links from public,anon,authenticated;
grant select on public.player_faceit_links to anon,authenticated;
grant all on public.player_faceit_links to service_role;

create or replace function public.claim_faceit_nickname(p_nickname text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_nickname text:=btrim(p_nickname);
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if v_nickname is null or length(v_nickname)<2 or length(v_nickname)>64 or v_nickname !~ '^[A-Za-z0-9_.-]+$' then
    raise exception 'Enter a valid FACEIT nickname';
  end if;
  insert into public.player_faceit_links(user_id,nickname,verified,updated_at)
  values(auth.uid(),v_nickname,false,now())
  on conflict(user_id) do update set nickname=excluded.nickname,verified=false,updated_at=now();
end;
$$;

create or replace function public.set_faceit_link_visibility(p_visible boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  update public.player_faceit_links set visible=p_visible,updated_at=now() where user_id=auth.uid();
  if not found then raise exception 'Link a FACEIT account first'; end if;
end;
$$;
revoke all on function public.claim_faceit_nickname(text),public.set_faceit_link_visibility(boolean) from public,anon,authenticated;
grant execute on function public.claim_faceit_nickname(text),public.set_faceit_link_visibility(boolean) to authenticated;
