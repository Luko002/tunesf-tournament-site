const params=new URLSearchParams(location.search),tournamentId=params.get('id');
const board=document.querySelector('#broadcastContent'),updatedLabel=document.querySelector('#broadcastUpdated');
const readableDate=value=>value?new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)):'Time to be announced';
const stageLabel=stage=>stage?`${stage.name} · Round`:'Match';
let refreshInProgress=false,lastRenderSignature='';

function emptyState(title,message){
  board.setAttribute('aria-busy','false');
  board.innerHTML=`<section class="broadcast-error"><h1>${esc(title)}</h1><p>${esc(message)}</p><a href="tournaments.html">Browse tournaments</a></section>`;
}

function renderBoard(tournament,stages,matches,teams,registrationTeams,standings){
  const stageById=new Map(stages.map(stage=>[stage.id,stage]));
  const teamFor=registrationId=>teams.get(registrationTeams.get(registrationId));
  const live=matches.filter(match=>['live','paused','result_pending','disputed'].includes(match.status));
  const completed=matches.filter(match=>['completed','forfeit'].includes(match.status));
  const upcoming=matches.filter(match=>['pending','ready'].includes(match.status)&&match.home_registration_id&&match.away_registration_id)
    .sort((a,b)=>(a.scheduled_at?new Date(a.scheduled_at).getTime():Infinity)-(b.scheduled_at?new Date(b.scheduled_at).getTime():Infinity));
  const results=[...completed].sort((a,b)=>{
    const aTime=a.completed_at?new Date(a.completed_at).getTime():a.scheduled_at?new Date(a.scheduled_at).getTime():0;
    const bTime=b.completed_at?new Date(b.completed_at).getTime():b.scheduled_at?new Date(b.scheduled_at).getTime():0;
    return bTime-aTime||b.round_number-a.round_number||b.position-a.position;
  }).slice(0,4);
  const featured=live[0]||upcoming[0]||results[0]||null;
  const featuredStatus=featured?.status||'pending';
  const home=featured?teamFor(featured.home_registration_id):null,away=featured?teamFor(featured.away_registration_id):null;
  const eventPage=`tournament.html?id=${encodeURIComponent(tournament.id)}`;
  document.title=`${tournament.name} · TUNESF Broadcast`;
  document.querySelector('#eventPageLink').href=eventPage;
  const matchTitle=featured?`${stageById.get(featured.stage_id)?.name||'Tournament'} · Round ${featured.round_number} · Match ${featured.position}`:'No published matches';
  const score=(match,value)=>match?.[value]??'—';
  const statusLabel=status=>status==='live'?'LIVE':status==='paused'?'PAUSED':status==='result_pending'?'RESULT IN REVIEW':status==='disputed'?'UNDER REVIEW':status==='completed'?'FINAL':status==='forfeit'?'FORFEIT':status==='ready'?'READY':'UP NEXT';
  const teamBadge=team=>team?`<small>${esc(team.tag||'')}</small>`:'<small>TO BE DECIDED</small>';
  const liveRail=live.length>1?`<div class="broadcast-live-list" aria-label="Other live matches">${live.slice(1).map(match=>{const a=teamFor(match.home_registration_id),b=teamFor(match.away_registration_id);return `<div class="broadcast-live-chip">${esc(a?.name||'TBD')} ${match.home_score??'—'}–${match.away_score??'—'} ${esc(b?.name||'TBD')} <b>LIVE</b></div>`}).join('')}</div>`:'';
  const standingsStage=stages.filter(stage=>stage.format==='round_robin').sort((a,b)=>a.stage_number-b.stage_number)[0];
  const tableRows=standingsStage?(standings.get(standingsStage.id)||[]):[];
  const standingsPanel=standingsStage?`<section class="broadcast-panel"><div class="broadcast-panel-head"><h2>Group standings</h2><span>${esc(standingsStage.name)}</span></div>${tableRows.length?`<table class="broadcast-standings"><thead><tr><th>#</th><th>Team</th><th>W</th><th>L</th><th>Pts</th></tr></thead><tbody>${tableRows.slice(0,8).map(row=>{const team=teamFor(row.registration_id);return `<tr><td>${row.rank}</td><td><span class="broadcast-rank-team">${identityImage(team?.logo_path,team?.name||'Team',26,'team')}<b>${esc(team?.name||'Team')}</b></span></td><td>${row.wins}</td><td>${row.losses}</td><td><b>${row.points}</b></td></tr>`}).join('')}</tbody></table>`:'<p class="broadcast-empty">Standings will appear after a result is approved.</p>'}</section>`:`<section class="broadcast-panel"><div class="broadcast-panel-head"><h2>Tournament snapshot</h2><span>${esc(String(tournament.format||'Tournament').replaceAll('_',' '))}</span></div><div class="broadcast-snapshot"><b>${completed.length}</b><span>Matches with official results</span><b>${upcoming.length}</b><span>Upcoming fixtures</span><b>${live.length}</b><span>Live or under review</span></div></section>`;
  const fixture=(match,isResult=false)=>{const h=teamFor(match.home_registration_id),a=teamFor(match.away_registration_id),stage=stageById.get(match.stage_id);return `<article class="broadcast-fixture"><div class="broadcast-fixture-meta"><span>${esc(stageLabel(stage))} ${match.round_number} · Match ${match.position}</span><span>${esc(statusLabel(match.status))}</span></div><span class="broadcast-fixture-team">${identityImage(h?.logo_path,h?.name||'Team',28,'team')}<b>${esc(h?.name||'TBD')}</b></span><strong class="broadcast-fixture-score">${match.home_score??'—'} : ${match.away_score??'—'}</strong><span class="broadcast-fixture-team">${identityImage(a?.logo_path,a?.name||'Team',28,'team')}<b>${esc(a?.name||'TBD')}</b></span><div class="broadcast-fixture-meta"><span>${isResult?'Completed':'Scheduled'}</span><span>${esc(readableDate(isResult?(match.completed_at||match.scheduled_at):match.scheduled_at))}</span></div></article>`};
  const listMatches=results.length?results.slice(0,2).concat(upcoming.filter(match=>match.id!==featured?.id).slice(0,4)):upcoming.filter(match=>match.id!==featured?.id).slice(0,6);
  const listLabel=results.length?'Recent results & upcoming':'Upcoming fixtures';
  const gameLabel=GAMES[tournament.game]?.label||tournament.game||'Esports';
  const dateLine=tournament.starts_at?readableDate(tournament.starts_at):tournament.region||'Official tournament';
  board.setAttribute('aria-busy','false');
  board.innerHTML=`<section class="broadcast-heading"><div class="broadcast-heading-main"><div class="broadcast-eyebrow"><i data-lucide="radio"></i>${esc(gameLabel)} · OFFICIAL EVENT FEED</div><h1>${esc(tournament.name)}</h1><p>${esc(tournament.region||'TUNESF competition')} · ${esc(dateLine)}</p></div><div class="broadcast-facts"><span>EVENT STATUS <b>${esc(String(tournament.status||'').replaceAll('_',' '))}</b></span><span>PRIZE POOL <b>${fmt(tournament.prize_pool)} ${esc(tournament.currency||'TND')}</b></span></div></section><section class="broadcast-feature" data-status="${esc(featuredStatus)}" aria-label="Featured match"><div class="broadcast-feature-top"><span>${esc(matchTitle)}</span><b class="broadcast-state" data-status="${esc(featuredStatus)}">${esc(statusLabel(featuredStatus))}</b></div>${featured?`<div class="broadcast-score"><div class="broadcast-side">${identityImage(home?.logo_path,home?.name||'Team',100,'team')}<b>${esc(home?.name||'To be decided')}</b>${teamBadge(home)}</div><div class="broadcast-center"><strong>${score(featured,'home_score')}<i>:</i>${score(featured,'away_score')}</strong><span>${esc(featured.best_of||tournament.best_of||'MATCH SCORE')}</span><small>${esc(featured.scheduled_at?readableDate(featured.scheduled_at):'')}</small></div><div class="broadcast-side">${identityImage(away?.logo_path,away?.name||'Team',100,'team')}<b>${esc(away?.name||'To be decided')}</b>${teamBadge(away)}</div></div>`:'<p class="broadcast-empty">The organizer has not published any fixtures yet.</p>'}<div class="broadcast-feature-bottom"><span>${live.length?`${live.length} match${live.length===1?'':'es'} live or in review`:'LIVE EVENT BOARD'}</span><span>UPDATED <b>${esc(readableDate(new Date().toISOString()))}</b></span></div>${liveRail}</section><div class="broadcast-columns">${standingsPanel}<section class="broadcast-panel"><div class="broadcast-panel-head"><h2>${esc(listLabel)}</h2><span>${listMatches.length} matches</span></div><div class="broadcast-matches">${listMatches.length?listMatches.map(match=>fixture(match,completed.includes(match))).join(''):'<p class="broadcast-empty">No fixtures or results have been published yet.</p>'}</div></section></div><div class="broadcast-bottom"><span>Read-only public scoreboard · refreshes automatically</span><a href="${esc(eventPage)}#eventBrackets">Open full bracket, schedule &amp; event details →</a></div>`;
  if(window.lucide)lucide.createIcons();
}

async function loadEvent(){
  if(!tournamentId){emptyState('Choose a tournament','Open the tournament page and choose “Broadcast view” to display its scoreboard.');return;}
  if(refreshInProgress)return;
  refreshInProgress=true;
  try{
    await Auth.ready;
    if(!SUPA.client)throw new Error('Tournament data is unavailable right now.');
    const {data:tournament,error:tournamentError}=await SUPA.client.from('tournament_directory').select('id,name,game,status,starts_at,region,prize_pool,currency,best_of,format').eq('id',tournamentId).maybeSingle();
    if(tournamentError)throw tournamentError;
    if(!tournament){emptyState('Event unavailable','This event may be private, unpublished, or no longer available.');return;}
    const [{data:registrations,error:registrationError},{data:stages,error:stageError}]=await Promise.all([
      SUPA.client.rpc('list_public_tournament_registrations',{p_tournament_id:tournamentId}),
      SUPA.client.from('tournament_stages').select('id,name,format,status,stage_number').eq('tournament_id',tournamentId).in('status',['published','in_progress','completed']).order('stage_number')
    ]);
    if(registrationError)throw registrationError;if(stageError)throw stageError;
    const stageRows=stages||[],stageIds=stageRows.map(stage=>stage.id),registrationRows=registrations||[];
    const teamIds=[...new Set(registrationRows.map(row=>row.team_id))];
    const [teamResult,matchResult]=await Promise.all([
      teamIds.length?SUPA.client.from('teams').select('id,name,tag,logo_path').in('id',teamIds):Promise.resolve({data:[],error:null}),
      stageIds.length?SUPA.client.from('tournament_matches').select('id,stage_id,round_number,position,home_registration_id,away_registration_id,home_score,away_score,status,scheduled_at,completed_at').in('stage_id',stageIds).order('round_number').order('position'):Promise.resolve({data:[],error:null})
    ]);
    if(teamResult.error)throw teamResult.error;if(matchResult.error)throw matchResult.error;
    await applyOrganizationTeamLogos(teamResult.data||[]);
    const teamMap=new Map((teamResult.data||[]).map(team=>[team.id,team]));
    const regTeamMap=new Map(registrationRows.map(row=>[row.id,row.team_id]));
    const standings=new Map();
    await Promise.all(stageRows.filter(stage=>stage.format==='round_robin').map(async stage=>{
      const {data,error}=await SUPA.client.from('tournament_standings').select('registration_id,wins,losses,points,rank').eq('stage_id',stage.id).order('rank');
      if(error)throw error;standings.set(stage.id,data||[]);
    }));
    const matches=matchResult.data||[];
    const signature=JSON.stringify({tournament:[tournament.name,tournament.game,tournament.status,tournament.starts_at,tournament.region,tournament.prize_pool],stages:stageRows.map(stage=>[stage.id,stage.name,stage.format,stage.status,stage.stage_number]),matches:matches.map(match=>[match.id,match.home_registration_id,match.away_registration_id,match.home_score,match.away_score,match.status,match.scheduled_at,match.completed_at]),standings:[...standings]});
    if(signature!==lastRenderSignature){renderBoard(tournament,stageRows,matches,teamMap,regTeamMap,standings);lastRenderSignature=signature;}
    updatedLabel.textContent=`Updated ${new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit'}).format(new Date())}`;
    updatedLabel.dataset.state='ok';
    board.setAttribute('aria-busy','false');
  }catch(error){
    console.warn('Broadcast view could not load:',error);
    if(!board.querySelector('.broadcast-feature'))emptyState('Scoreboard unavailable',error.message||'Please try again in a moment.');
    updatedLabel.textContent='Feed update unavailable';updatedLabel.dataset.state='error';
  }finally{refreshInProgress=false;}
}

async function toggleFullscreen(){
  try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch(error){console.warn('Full screen is unavailable:',error);}
}
document.querySelector('#fullscreenToggle').addEventListener('click',toggleFullscreen);
document.addEventListener('keydown',event=>{if(event.key.toLowerCase()==='f'&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)){event.preventDefault();toggleFullscreen();}});
document.addEventListener('fullscreenchange',()=>{
  const active=Boolean(document.fullscreenElement),button=document.querySelector('#fullscreenToggle');
  button.querySelector('span').textContent=active?'Exit full screen':'Full screen';
  button.querySelector('i')?.setAttribute('data-lucide',active?'minimize':'maximize');if(window.lucide)lucide.createIcons();
});
loadEvent();
setInterval(()=>{if(!document.hidden)loadEvent();},30000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)loadEvent();});

