-- A user present on both rosters must be able to confirm each team's locked roster.
alter table public.match_player_readiness drop constraint match_player_readiness_pkey;
alter table public.match_player_readiness add primary key (match_id,team_id,user_id);

create or replace function public.confirm_match_player_ready(p_match_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_match public.tournament_matches%rowtype;
  v_game text; v_map_pool text[];
begin
  if auth.uid() is null then raise exception 'Sign in to confirm readiness'; end if;
  select * into v_match from public.tournament_matches where id=p_match_id for update;
  if v_match.id is null then raise exception 'Match not found'; end if;
  if v_match.status<>'ready' then raise exception 'Readiness can only be confirmed before the match starts'; end if;
  select t.game,t.map_pool into v_game,v_map_pool from public.tournaments t where t.id=v_match.tournament_id;
  if cardinality(coalesce(v_map_pool,'{}'::text[]))>=2 and not exists (
    select 1 from public.match_map_vetoes v where v.match_id=p_match_id
      and v.action_type='decider' and (v_game<>'val' or v.side_choice is not null)) then
    raise exception 'Complete the map veto first';
  end if;
  if (select count(*) from public.match_roster_confirmations c where c.match_id=p_match_id)<>2 then
    raise exception 'Both rosters must be confirmed first';
  end if;
  if not exists (
    select 1 from public.match_roster_confirmations c
    where c.match_id=p_match_id and exists (
      select 1 from jsonb_array_elements(c.roster) member
      where member->>'user_id'=auth.uid()::text and member->>'role'<>'substitute'
    )
  ) then raise exception 'Only a player on a confirmed active match roster can confirm readiness'; end if;
  insert into public.match_player_readiness(match_id,team_id,user_id)
    select p_match_id,c.team_id,auth.uid() from public.match_roster_confirmations c
    where c.match_id=p_match_id and exists (
      select 1 from jsonb_array_elements(c.roster) member
      where member->>'user_id'=auth.uid()::text and member->>'role'<>'substitute'
    ) on conflict(match_id,team_id,user_id) do nothing;
end;
$$;
revoke all on function public.confirm_match_player_ready(uuid) from public,anon,authenticated;
grant execute on function public.confirm_match_player_ready(uuid) to authenticated;
