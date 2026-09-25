/* Referee controls operate only on matches assigned to the signed-in official. */
Auth.ready.then(async()=>{
  if(!requirePerm('REFEREE_MATCHES'))return;
  buildConsoleStrip();
  const panel=document.querySelector('.dgrid2');if(!panel)return;
  const date=value=>value?new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)):'Unscheduled';
  panel.innerHTML='<div id="refereeQueue" class="team-empty" style="grid-column:1/-1">Loading assigned matches...</div>';
  const queue=$('#refereeQueue');
  async function render(){
    queue.innerHTML='Loading assigned matches...';
    const [assignmentResult,staffResult]=await Promise.all([
      SUPA.client.from('match_officials').select('match_id').eq('user_id',Auth.user.id),
      SUPA.client.from('tournament_staff').select('tournament_id').eq('user_id',Auth.user.id).contains('capabilities',['referee'])
    ]);
    if(assignmentResult.error)throw assignmentResult.error;if(staffResult.error)throw staffResult.error;
    const ids=[...new Set((assignmentResult.data||[]).map(a=>a.match_id))];
    const tournamentIds=[...new Set((staffResult.data||[]).map(s=>s.tournament_id))];
    if(!ids.length&&!tournamentIds.length){queue.innerHTML='<div class="dcard" style="grid-column:1/-1"><div class="dh"><i data-lucide="gavel"></i>Referee assignments</div><div class="db"><p class="team-empty">You have no assigned matches or tournaments.</p></div></div>';icons();return;}
    const columns='id,tournament_id,home_registration_id,away_registration_id,status,home_score,away_score,scheduled_at,round_number';
    const [matchResult,eventMatchResult]=await Promise.all([
      ids.length?SUPA.client.from('tournament_matches').select(columns).in('id',ids):{data:[],error:null},
      tournamentIds.length?SUPA.client.from('tournament_matches').select(columns).in('tournament_id',tournamentIds):{data:[],error:null}
    ]);
    if(matchResult.error)throw matchResult.error;if(eventMatchResult.error)throw eventMatchResult.error;
    const matches=[...new Map([...(matchResult.data||[]),...(eventMatchResult.data||[])].map(m=>[m.id,m])).values()]
      .sort((a,b)=>(a.scheduled_at||'').localeCompare(b.scheduled_at||''));
    const allIds=matches.map(m=>m.id);
    if(!allIds.length){
      const {data:tournaments,error}=tournamentIds.length
        ?await SUPA.client.from('tournaments').select('id,name,game,starts_at').in('id',tournamentIds)
        :{data:[],error:null};
      if(error)throw error;
      queue.innerHTML=tournaments?.length?tournaments.map(tournament=>`<article class="dcard event-card"><div class="dh"><i data-lucide="gavel"></i>${esc(tournament.name)}<span class="mono-r">TOURNAMENT REFEREE</span></div><div class="db"><div class="team-meta"><span>${esc(GAMES[tournament.game]?.label||tournament.game)}</span><span>${esc(date(tournament.starts_at))}</span></div><p class="team-empty">You are assigned to this tournament. Matches will appear here after the organizer publishes them.</p><a class="btn btn-line btn-sm" href="tournament.html?id=${encodeURIComponent(tournament.id)}">Open tournament</a></div></article>`).join(''):'<div class="dcard" style="grid-column:1/-1"><div class="dh"><i data-lucide="gavel"></i>Referee assignments</div><div class="db"><p class="team-empty">Your match assignments have no published matches yet.</p></div></div>';
      icons();return;
    }
    const [submissionResult,evidenceResult]=await Promise.all([
      SUPA.client.from('match_result_submissions').select('id,match_id,registration_id,home_score,away_score,status,created_at').in('match_id',allIds).order('created_at',{ascending:false}),
      SUPA.client.from('match_evidence').select('id,match_id,object_key,mime_type,byte_size,created_at').in('match_id',allIds).order('created_at',{ascending:false})
    ]);
    if(submissionResult.error)throw submissionResult.error;if(evidenceResult.error)throw evidenceResult.error;
    const evidenceRows=await Promise.all((evidenceResult.data||[]).map(async row=>{
      const {data,error}=await SUPA.client.storage.from('match-evidence').createSignedUrl(row.object_key,120);
      if(error)throw error;return {...row,url:data.signedUrl};
    }));
    const matchTournamentIds=[...new Set(matches.map(m=>m.tournament_id))];
    const registrationIds=[...new Set(matches.flatMap(m=>[m.home_registration_id,m.away_registration_id]).filter(Boolean))];
    const [tournaments,registrations]=await Promise.all([
      matchTournamentIds.length?SUPA.client.from('tournaments').select('id,name,game,best_of').in('id',matchTournamentIds):{data:[],error:null},
      registrationIds.length?SUPA.client.from('tournament_registrations').select('id,team_id').in('id',registrationIds):{data:[],error:null}
    ]);
    if(tournaments.error)throw tournaments.error;if(registrations.error)throw registrations.error;
    const teamIds=[...new Set((registrations.data||[]).map(r=>r.team_id))];
    const teams=teamIds.length?await SUPA.client.from('teams').select('id,name,tag').in('id',teamIds):{data:[],error:null};if(teams.error)throw teams.error;
    const tMap=new Map((tournaments.data||[]).map(t=>[t.id,t])),rMap=new Map((registrations.data||[]).map(r=>[r.id,r.team_id])),teamMap=new Map((teams.data||[]).map(t=>[t.id,t]));
    const label=id=>{const team=teamMap.get(rMap.get(id));return team?`${esc(team.name)} (${esc(team.tag)})`:'Team pending';};
    queue.innerHTML=matches.map(match=>{
      const tournament=tMap.get(match.tournament_id),subs=(submissionResult.data||[]).filter(s=>s.match_id===match.id&&s.status==='pending');
      const evidence=evidenceRows.filter(row=>row.match_id===match.id);
      const action={ready:'start',live:'pause',paused:'resume'}[match.status];
      const actionButton=action?`<button class="btn btn-line btn-sm" type="button" data-referee-action="${action}" data-match="${esc(match.id)}">${action[0].toUpperCase()+action.slice(1)} match</button>`:'';
      const incidentLink=`<a class="btn btn-line btn-sm" href="moderation.html?incident_match=${encodeURIComponent(match.id)}">File match incident</a>`;
      const results=subs.length?`<h3 class="team-section-title">Pending score confirmations <span>${subs.length}</span></h3><ul class="team-invites">${subs.map(s=>`<li class="event-reg"><span><b>${label(match.home_registration_id)} ${s.home_score} - ${s.away_score} ${label(match.away_registration_id)}</b><small>Submitted ${esc(date(s.created_at))}</small></span><span class="event-actions"><button class="btn btn-gold btn-sm" type="button" data-review-result="accept" data-submission="${esc(s.id)}">Approve</button><button class="btn btn-line btn-sm" type="button" data-review-result="reject" data-submission="${esc(s.id)}">Reject</button></span></li>`).join('')}</ul>`:'<p class="team-empty">No pending score confirmation.</p>';
      const evidenceHtml=evidence.length?`<h3 class="team-section-title">Match evidence <span>${evidence.length}</span></h3><ul class="team-invites">${evidence.map(row=>`<li class="event-reg"><span><b>${esc(row.mime_type)}</b><small>${fmt(row.byte_size)} bytes · ${esc(date(row.created_at))}</small></span><a class="btn btn-line btn-sm" href="${esc(row.url)}" target="_blank" rel="noopener noreferrer">Open evidence</a></li>`).join('')}</ul>`:'<p class="team-empty">No evidence attached.</p>';
      const scoreForm=match.home_registration_id&&match.away_registration_id&&['ready','live','paused','result_pending','completed'].includes(match.status)?`<form class="event-op-form" data-referee-result="${esc(match.id)}"><label>Home wins<input type="number" name="home_score" min="0" max="4" value="${match.home_score??''}" required></label><label>Away wins<input type="number" name="away_score" min="0" max="4" value="${match.away_score??''}" required></label><label class="event-op-reason">Reason for official result<input name="reason" minlength="5" maxlength="500" placeholder="e.g. Verified final series score" required></label><button class="btn btn-gold btn-sm" type="submit">${match.status==='completed'?'Correct result':'Record result'}</button></form>`:'';
      return `<article class="dcard event-card"><div class="dh"><i data-lucide="gavel"></i>${esc(tournament?.name||'Tournament')}<span class="mono-r">${esc(match.status.replaceAll('_',' ').toUpperCase())}</span></div><div class="db"><div class="team-meta"><span>${esc(GAMES[tournament?.game]?.label||tournament?.game||'Game unavailable')}</span><span>Round ${match.round_number}</span><span>${esc(tournament?.best_of||'Series format unavailable')}</span><span>${esc(date(match.scheduled_at))}</span></div><h3 class="team-section-title">${label(match.home_registration_id)} vs ${label(match.away_registration_id)}</h3><div class="event-actions">${actionButton}<a class="btn btn-line btn-sm" href="match-room.html?id=${encodeURIComponent(match.id)}">Open match room</a>${incidentLink}</div>${evidenceHtml}${results}${scoreForm}</div></article>`;
    }).join('');icons();
  }
  panel.addEventListener('click',async event=>{
    const action=event.target.closest('[data-referee-action]');
    const review=event.target.closest('[data-review-result]');const button=action||review;if(!button)return;button.disabled=true;
    try{
      const result=action
        ?await SUPA.client.rpc('referee_match',{p_match_id:action.dataset.match,p_action:action.dataset.refereeAction,p_note:''})
        :await SUPA.client.rpc('review_match_result',{p_submission_id:review.dataset.submission,p_decision:review.dataset.reviewResult,p_note:''});
      if(result.error)throw result.error;toast('ok','Match updated','The action was recorded in the competition audit trail.');await render();
    }catch(error){toast('err','Referee action failed',error.message||'Please check the assignment and try again.');button.disabled=false;}
  });
  panel.addEventListener('submit',async event=>{
    const form=event.target.closest('[data-referee-result]');if(!form)return;
    event.preventDefault();if(!form.reportValidity()||!window.confirm('Record this official match score? The bracket or standings may advance.'))return;
    const button=form.querySelector('button[type="submit"]'),values=new FormData(form);button.disabled=true;
    try{
      const {error}=await SUPA.client.rpc('record_official_match_result',{p_match_id:form.dataset.refereeResult,p_home_score:Number(values.get('home_score')),p_away_score:Number(values.get('away_score')),p_reason:String(values.get('reason')||'').trim()});
      if(error)throw error;toast('ok','Official result saved','The bracket or standings have been updated.');await render();
    }catch(error){toast('err','Could not save result',error.message||'Please try again.');button.disabled=false;}
  });
  try{await render();}catch(error){queue.innerHTML='<div class="dcard" style="grid-column:1/-1"><div class="dh">Referee queue unavailable</div><div class="db"><p>'+esc(error.message||'Please reload and try again.')+'</p></div></div>';}
  icons();
}).catch(error=>toast('err','Referee workspace unavailable',error?.message||'Please reload and try again.'));
