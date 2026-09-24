/* Public brackets are rendered only from published database stages. */
const bracketWrap=document.querySelector('main .sec.tight .wrap');
if(bracketWrap)bracketWrap.innerHTML='<div class="console-strip" style="margin-bottom:18px"><label for="bracketEvent">Tournament</label><select id="bracketEvent"></select></div><div id="bracketRounds" class="dgrid" aria-live="polite"></div>';
const bracketEvent=$('#bracketEvent'),bracketRounds=$('#bracketRounds');
const bracketDate=value=>value?new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)):'Time to be announced';
function selectBracketTournament(id){
  const url=new URL(location.href);url.searchParams.set('tournament',id);history.replaceState(null,'',url);
}
async function renderBracket(tournamentId){
  bracketRounds.innerHTML='<div class="team-empty">Loading published rounds…</div>';
  const {data:stages,error:stageError}=await SUPA.client.from('tournament_stages').select('id,name,format,stage_number').eq('tournament_id',tournamentId).in('status',['published','in_progress','completed']).order('stage_number');
  if(stageError)throw stageError;
  if(!stages?.length){bracketRounds.innerHTML='<div class="dcard" style="grid-column:1/-1"><div class="db"><p>No bracket generated yet.</p></div></div>';return;}
  const {data:matches,error:matchError}=await SUPA.client.from('tournament_matches').select('id,stage_id,round_number,position,home_registration_id,away_registration_id,home_expected,away_expected,winner_registration_id,home_score,away_score,status,scheduled_at').in('stage_id',stages.map(s=>s.id)).order('round_number').order('position');
  if(matchError)throw matchError;
  const registrationIds=[...new Set((matches||[]).flatMap(m=>[m.home_registration_id,m.away_registration_id]).filter(Boolean))];
  const registrations=registrationIds.length?await SUPA.client.from('tournament_registrations').select('id,team_id').in('id',registrationIds):{data:[],error:null};
  if(registrations.error)throw registrations.error;
  const teamIds=[...new Set((registrations.data||[]).map(r=>r.team_id))];
  const teams=teamIds.length?await SUPA.client.from('teams').select('id,name,tag').in('id',teamIds):{data:[],error:null};
  if(teams.error)throw teams.error;
  const regMap=new Map((registrations.data||[]).map(r=>[r.id,r.team_id]));
  const teamMap=new Map((teams.data||[]).map(team=>[team.id,team]));
  const teamLabel=(id,expected)=>{if(!id)return expected?'Pending':'BYE';const team=teamMap.get(regMap.get(id));return team?`${esc(team.name)} <small>${esc(team.tag)}</small>`:'Pending';};
  bracketRounds.innerHTML=stages.map(stage=>{
    const stageMatches=(matches||[]).filter(m=>m.stage_id===stage.id&&!(m.status==='cancelled'&&!m.home_expected&&!m.away_expected));
    const rounds=[...new Set(stageMatches.map(m=>m.round_number))].sort((a,b)=>a-b);
    return `<section class="dcard event-card"><div class="dh"><i data-lucide="git-fork"></i>${esc(stage.name)}<span class="mono-r">${esc(stage.format.replaceAll('_',' '))}</span></div><div class="db">${rounds.map(round=>`<div class="team-section-title">Round ${round}</div><ul class="team-invites">${stageMatches.filter(m=>m.round_number===round).map(m=>{const bye=m.status==='completed'&&Boolean(m.home_registration_id)!==Boolean(m.away_registration_id);return `<li class="event-reg"><span><b>${teamLabel(m.home_registration_id,m.home_expected)} <small>vs</small> ${teamLabel(m.away_registration_id,m.away_expected)}</b><small>${bye?'Bye · advances':esc(m.status.replaceAll('_',' '))}${m.scheduled_at?' · '+esc(bracketDate(m.scheduled_at)):''}</small></span><b>${bye?'—':`${m.home_score===null?'—':m.home_score} : ${m.away_score===null?'—':m.away_score}`}</b></li>`;}).join('')}</ul>`).join('')}</div></section>`;
  }).join('');
  icons();
}
(async()=>{
  try{
    await Auth.ready;
    const {data,error}=await SUPA.client.from('tournament_directory').select('id,name,status').neq('status','draft').order('starts_at',{ascending:false,nullsFirst:false});
    if(error)throw error;
    const tournaments=data||[];
    const requested=new URLSearchParams(location.search).get('tournament');
    if(!tournaments.length){bracketRounds.innerHTML=requested?'<div class="dcard" style="grid-column:1/-1"><div class="dh">Tournament unavailable</div><div class="db"><p>This tournament is unavailable or has not been published.</p><a class="btn btn-line btn-sm" href="tournaments.html">Browse tournaments</a></div></div>':'<div class="dcard" style="grid-column:1/-1"><div class="dh"><i data-lucide="git-fork"></i>Tournament brackets</div><div class="db"><p style="color:var(--dim)">No tournaments yet, so no bracket has been generated.</p><a class="btn btn-line btn-sm" href="tournaments.html" style="margin-top:16px">Browse tournaments</a></div></div>';bracketEvent?.closest('.console-strip')?.remove();icons();return;}
    bracketEvent.innerHTML=tournaments.map(t=>`<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');
    if(requested&&!tournaments.some(t=>t.id===requested)){bracketEvent.closest('.console-strip')?.remove();bracketRounds.innerHTML='<div class="dcard" style="grid-column:1/-1"><div class="dh">Tournament unavailable</div><div class="db"><p>This tournament is unavailable or has not been published.</p><a class="btn btn-line btn-sm" href="tournaments.html">Browse tournaments</a></div></div>';return;}
    if(requested)bracketEvent.value=requested;else selectBracketTournament(bracketEvent.value);
    bracketEvent.addEventListener('change',()=>{selectBracketTournament(bracketEvent.value);renderBracket(bracketEvent.value).catch(e=>toast('err','Bracket unavailable',e.message||'Please reload.'));});
    await renderBracket(bracketEvent.value);
  }catch(error){bracketRounds.innerHTML=`<div class="dcard" style="grid-column:1/-1"><div class="dh">Brackets unavailable</div><div class="db"><p>${esc(error.message||'Please try again.')}</p></div></div>`;}
})();
