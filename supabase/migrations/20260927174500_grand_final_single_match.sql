CREATE OR REPLACE FUNCTION private.advance_match_winner(p_match_id uuid, p_winner_registration_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_match public.tournament_matches%rowtype;
  v_stage public.tournament_stages%rowtype;
  v_parent_id uuid;
  v_loser_parent_id uuid;
  v_slot text;
  v_next_status text;
  v_loser uuid;
  v_loser_match public.tournament_matches%rowtype;
begin
  select * into v_match from public.tournament_matches where id=p_match_id;
  select * into v_stage from public.tournament_stages where id=v_match.stage_id;

  -- The double-elimination championship is decided by one grand final.
  if v_stage.format='double_elimination'
     and v_match.bracket_side='grand_final'
     and v_match.round_number=1
     and v_match.position=1 then
    update public.tournament_matches
      set status='cancelled',winner_registration_id=null,updated_at=now()
      where stage_id=v_match.stage_id and bracket_side='grand_final'
        and round_number=2 and position=1 and status not in ('completed','forfeit');
    update public.tournament_stages set status='completed' where id=v_stage.id;
    return;
  end if;

  if v_match.winner_to_match_id is not null then
    v_parent_id:=v_match.winner_to_match_id;
    v_slot:=v_match.winner_to_slot;
    v_loser:=case when p_winner_registration_id=v_match.home_registration_id
      then v_match.away_registration_id else v_match.home_registration_id end;
    if v_match.loser_to_match_id is not null and v_loser is not null then
      v_loser_parent_id:=v_match.loser_to_match_id;
      update public.tournament_matches set
        home_registration_id=case when v_match.loser_to_slot='home' then v_loser else home_registration_id end,
        away_registration_id=case when v_match.loser_to_slot='away' then v_loser else away_registration_id end
        where id=v_match.loser_to_match_id;
      update public.tournament_matches set status='ready',updated_at=now()
        where id=v_loser_parent_id and home_registration_id is not null
          and away_registration_id is not null and status='pending';
      select * into v_loser_match from public.tournament_matches where id=v_loser_parent_id;
      if v_loser_match.status='pending' and v_loser_match.home_registration_id is not null
         and not v_loser_match.away_expected then
        update public.tournament_matches set status='completed',
          winner_registration_id=v_loser_match.home_registration_id,completed_at=now(),updated_at=now()
          where id=v_loser_parent_id;
        perform private.advance_match_winner(v_loser_parent_id,v_loser_match.home_registration_id);
      elsif v_loser_match.status='pending' and v_loser_match.away_registration_id is not null
            and not v_loser_match.home_expected then
        update public.tournament_matches set status='completed',
          winner_registration_id=v_loser_match.away_registration_id,completed_at=now(),updated_at=now()
          where id=v_loser_parent_id;
        perform private.advance_match_winner(v_loser_parent_id,v_loser_match.away_registration_id);
      end if;
    end if;
    update public.tournament_matches set
      home_registration_id=case when v_slot='home' then p_winner_registration_id else home_registration_id end,
      away_registration_id=case when v_slot='away' then p_winner_registration_id else away_registration_id end
      where id=v_parent_id;
  elsif v_stage.format='single_elimination' then
    select id into v_parent_id from public.tournament_matches
      where stage_id=v_match.stage_id and round_number=v_match.round_number+1
        and position=(v_match.position+1)/2;
    v_slot:=case when v_match.position%2=1 then 'home' else 'away' end;
    if v_parent_id is not null then
      update public.tournament_matches set
        home_registration_id=case when v_slot='home' then p_winner_registration_id else home_registration_id end,
        away_registration_id=case when v_slot='away' then p_winner_registration_id else away_registration_id end
        where id=v_parent_id;
    end if;
  end if;

  if v_parent_id is null then
    update public.tournament_stages set status='completed' where id=v_stage.id
      and not exists(select 1 from public.tournament_matches
        where stage_id=v_stage.id and status not in ('completed','forfeit','cancelled'));
    return;
  end if;
  select case
    when home_registration_id is not null and away_registration_id is not null then 'ready'
    when home_registration_id is not null and not away_expected then 'completed'
    when away_registration_id is not null and not home_expected then 'completed'
    else 'pending' end into v_next_status
    from public.tournament_matches where id=v_parent_id;
  if v_next_status='completed' then
    update public.tournament_matches set status='completed',
      winner_registration_id=coalesce(home_registration_id,away_registration_id),
      completed_at=now(),updated_at=now() where id=v_parent_id;
    perform private.advance_match_winner(v_parent_id,
      coalesce((select home_registration_id from public.tournament_matches where id=v_parent_id),
               (select away_registration_id from public.tournament_matches where id=v_parent_id)));
  else
    update public.tournament_matches set status=v_next_status,updated_at=now() where id=v_parent_id;
  end if;
end;
$function$;
