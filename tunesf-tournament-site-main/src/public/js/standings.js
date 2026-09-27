/* Standings are read from completed, approved match results. */
const standingsWrap=document.querySelector('main .sec.tight .wrap');
if(standingsWrap)standingsWrap.innerHTML='<div class="console-strip" style="margin-bottom:18px"><label for="standingEvent">Tournament</label><select id="standingEvent"></select><label for="standingStage">Stage</label><select id="standingStage"></select></div><div id="standingTable" aria-live="polite"></div>';
const standingEvent=$('#standingEvent'),standingStage=$('#standingStage'),standingTable=$('#standingTable');
async function renderStandings(stageId){
  standingTable.innerHTML='<div class="team-empty">Loading approved standings…</div>';
  const {data:rows,error}=await SUPA.client.from('tournament_standings').select('registration_id,played,wins,draws,losses,points,score_for,score_against,rank').eq('stage_id',stageId).order('rank');
  if(error)throw error;
  if(!rows?.length){
    const tournamentName=standingEvent.selectedOptions[0]?.dataset.name||'this tournament';
    standingTable.innerHTML=`<section class="dcard standings-empty" aria-labelledby="standingsEmptyTitle"><div class="dh"><i data-lucide="list-ordered" aria-hidden="true"></i>STANDINGS NOT STARTED</div><div class="db"><h2 id="standingsEmptyTitle">Nothing to rank yet</h2><p>${esc(tournamentName)} has no approved match results for this stage. Choose another tournament above, or follow this event’s fixtures while results come in.</p><a class="btn btn-line btn-sm" href="tournament.html?id=${encodeURIComponent(standingEvent.value)}&view=schedule#eventBrackets">View event schedule</a></div></section>`;icons();return;
  }
  const ids=[...new Set(rows.map(row=>row.registration_id))];
  const {data:registrations,error:regError}=await SUPA.client.from('tournament_registrations').select('id,team_id').in('id',ids);
  if(regError)throw regError;
  const teamIds=[...new Set((registrations||[]).map(r=>r.team_id))];
  const teamResult=teamIds.length?await SUPA.client.from('teams').select('id,name,tag,logo_path').in('id',teamIds):{data:[],error:null};
  if(teamResult.error)throw teamResult.error;
  const regMap=new Map((registrations||[]).map(r=>[r.id,r.team_id]));
  const teamMap=new Map((teamResult.data||[]).map(t=>[t.id,t]));
  standingTable.innerHTML=`<div class="tablewrap"><table><thead><tr><th>Rank</th><th>Team</th><th>Played</th><th>W</th><th>D</th><th>L</th><th>Score diff</th><th>Points</th></tr></thead><tbody>${rows.map(row=>{const team=teamMap.get(regMap.get(row.registration_id));return `<tr><td>${row.rank}</td><td><span class="team-identity">${identityImage(team?.logo_path,team?.name||'Team',34,'team')}<a href="team.html?id=${encodeURIComponent(regMap.get(row.registration_id)||'')}">${esc(team?.name||'Team unavailable')} <small>${esc(team?.tag||'')}</small></a></span></td><td>${row.played}</td><td>${row.wins}</td><td>${row.draws}</td><td>${row.losses}</td><td>${row.score_for-row.score_against}</td><td>${row.points}</td></tr>`;}).join('')}</tbody></table></div>`;
}
function selectStandingTournament(id){
  const url=new URL(location.href);url.searchParams.set('tournament',id);history.replaceState(null,'',url);
}
(async()=>{
  try{
    await Auth.ready;
    const {data,error}=await SUPA.client.from('tournament_directory').select('id,name,game,status,starts_at').neq('status','draft').order('starts_at',{ascending:false,nullsFirst:false});
    if(error)throw error;
    const requested=new URLSearchParams(location.search).get('tournament');
    if(!data?.length){standingTable.innerHTML=requested?'<div class="dcard"><div class="dh">Tournament unavailable</div><div class="db"><p>This tournament is unavailable or has not been published.</p><a class="btn btn-line btn-sm" href="tournaments.html">Browse tournaments</a></div></div>':'<div class="dcard"><div class="dh"><i data-lucide="list-ordered"></i>Tournament standings</div><div class="db"><p style="color:var(--dim)">No tournaments yet. Standings will appear after an event starts.</p><a class="btn btn-line btn-sm" href="tournaments.html" style="margin-top:16px">Browse tournaments</a></div></div>';standingEvent.closest('.console-strip')?.remove();icons();return;}
    const dateLabel=value=>value?new Intl.DateTimeFormat(undefined,{day:'numeric',month:'short',year:'numeric'}).format(new Date(value)):'Date TBA';
    standingEvent.innerHTML=data.map(t=>{
      const game=GAMES[t.game]?.label||String(t.game||'Game not set').toUpperCase();
      const status=String(t.status||'scheduled').replaceAll('_',' ');
      return `<option value="${esc(t.id)}" data-name="${esc(t.name)}">${esc(t.name)} · ${esc(game)} · ${esc(status)} · ${esc(dateLabel(t.starts_at))}</option>`;
    }).join('');
    if(requested&&!data.some(t=>t.id===requested)){standingEvent.closest('.console-strip')?.remove();standingTable.innerHTML='<div class="dcard"><div class="dh">Tournament unavailable</div><div class="db"><p>This tournament is unavailable or has not been published.</p><a class="btn btn-line btn-sm" href="tournaments.html">Browse tournaments</a></div></div>';return;}
    if(requested)standingEvent.value=requested;
    else{
      let preferredId='';
      const tournamentIds=data.map(t=>t.id);
      try{
        const {data:stages,error:stageError}=await SUPA.client.from('tournament_stages').select('id,tournament_id').in('tournament_id',tournamentIds).in('status',['published','in_progress','completed']);
        if(!stageError&&stages?.length){
          const stageIds=stages.map(stage=>stage.id);
          const {data:rows,error:standingsError}=await SUPA.client.from('tournament_standings').select('stage_id').in('stage_id',stageIds);
          if(!standingsError){
            const populatedStages=new Set((rows||[]).map(row=>row.stage_id));
            const populatedTournaments=new Set(stages.filter(stage=>populatedStages.has(stage.id)).map(stage=>stage.tournament_id));
            const statusPriority={in_progress:0,completed:1,registration_closed:2,registration_open:3};
            preferredId=data.filter(t=>populatedTournaments.has(t.id)).sort((a,b)=>(statusPriority[a.status]??4)-(statusPriority[b.status]??4)||new Date(b.starts_at||0)-new Date(a.starts_at||0))[0]?.id||'';
          }
        }
      }catch{}
      if(preferredId)standingEvent.value=preferredId;
      selectStandingTournament(standingEvent.value);
    }
    async function loadStages(){
      const {data:stages,error}=await SUPA.client.from('tournament_stages').select('id,name,status').eq('tournament_id',standingEvent.value).in('status',['published','in_progress','completed']).order('stage_number');
      if(error)throw error;
      standingStage.innerHTML=(stages||[]).map(s=>`<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
      if(!stages?.length){standingTable.innerHTML='<div class="dcard"><div class="db"><p>No published stage is available for this tournament.</p></div></div>';return;}
      await renderStandings(standingStage.value);
    }
    standingEvent.addEventListener('change',()=>{selectStandingTournament(standingEvent.value);loadStages().catch(e=>toast('err','Standings unavailable',e.message||'Please reload.'));});
    standingStage.addEventListener('change',()=>renderStandings(standingStage.value).catch(e=>toast('err','Standings unavailable',e.message||'Please reload.')));
    await loadStages();
  }catch(error){standingTable.innerHTML=`<div class="dcard"><div class="dh">Standings unavailable</div><div class="db"><p>${esc(error.message||'Please try again.')}</p></div></div>`;}
})();
