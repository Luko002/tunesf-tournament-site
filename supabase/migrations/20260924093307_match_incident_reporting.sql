alter table public.moderation_cases
  add column subject_match_id uuid references public.tournament_matches(id) on delete restrict;

alter table public.moderation_cases
  drop constraint if exists moderation_cases_check,
  add constraint moderation_cases_one_subject
    check (num_nonnulls(subject_user_id,subject_team_id,subject_tournament_id,subject_match_id)=1);

create index moderation_cases_subject_match_idx
  on public.moderation_cases(subject_match_id) where subject_match_id is not null;

-- Keep the original five-argument RPC for already-open clients. Match reports use
-- the six-argument overload below; neither signature has defaulted arguments.
create function public.create_moderation_case(
  p_subject_user_id uuid,
  p_subject_team_id uuid,
  p_subject_tournament_id uuid,
  p_subject_match_id uuid,
  p_category text,
  p_description text
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if num_nonnulls(p_subject_user_id,p_subject_team_id,p_subject_tournament_id,p_subject_match_id)<>1 then
    raise exception 'Choose exactly one report target';
  end if;
  if p_subject_match_id is not null and not private.can_access_match(p_subject_match_id) then
    raise exception 'You are not a participant or assigned official for this match';
  end if;
  insert into public.moderation_cases(
    reporter_id,subject_user_id,subject_team_id,subject_tournament_id,subject_match_id,category,description
  ) values (
    auth.uid(),p_subject_user_id,p_subject_team_id,p_subject_tournament_id,p_subject_match_id,trim(p_category),trim(p_description)
  ) returning id into v_id;
  perform private.write_audit_event(
    'MODERATION_CASE_CREATED',
    case when p_subject_match_id is not null then 'match_incident' else 'moderation_case' end,
    v_id,
    jsonb_build_object('subject_match_id',p_subject_match_id,'category',trim(p_category))
  );
  return v_id;
end;
$$;

revoke all on function public.create_moderation_case(uuid,uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.create_moderation_case(uuid,uuid,uuid,uuid,text,text) to authenticated;
