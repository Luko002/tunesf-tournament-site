/* Tournament details, published stages, schedules, and standings belong to this event page. */
const header=$('#eventHeader'),content=$('#eventContent');
const pageParams=new URLSearchParams(location.search),id=pageParams.get('id');
const legacyHashViews={eventLiveHub:'live',eventOverview:'overview',eventParticipants:'teams',eventOfficials:'teams',eventBrackets:'schedule',eventRules:'rules',eventPrizes:'rules'};
const requestedView=pageParams.get('view');
const activeView=['live','overview','teams','schedule','rules'].includes(requestedView)?requestedView:legacyHashViews[location.hash.slice(1)]||'live';
const eventPageUrl=(view,hash='')=>`tournament.html?id=${encodeURIComponent(id)}&view=${encodeURIComponent(view)}${hash?`#${hash}`:''}`;
const eventPageNav=[['live','Live event','radio'],['overview','Overview','clipboard-list'],['teams','Teams','users'],['schedule','Bracket & schedule','git-fork'],['rules','Rules & prizes','book-open']];
const fail=message=>{header.innerHTML='<div class="eyebrow">Tournament</div><h1 class="ph-title">Details unavailable</h1>';content.innerHTML=`<article class="dcard event-card"><div class="db"><p>${esc(message)}</p><a class="btn btn-line btn-sm" href="tournaments.html">Browse tournaments</a></div></article>`;};
if(!id){fail('Choose a tournament from the discovery page.');}
else (async()=>{
  try{
    await Auth.ready;
    const {data:t,error}=await SUPA.client.from('tournament_directory').select('*').eq('id',id).maybeSingle();
    if(error)throw error;if(!t){fail('This tournament is unavailable or has not been published.');return;}
    let coverUrl='';
    if(t.cover_image_path){
      const {data:cover,error:coverError}=await SUPA.client.storage.from('tournament-covers').createSignedUrl(t.cover_image_path,3600);
      if(coverError)console.warn('Tournament cover could not be loaded:',coverError.message);else coverUrl=cover?.signedUrl||'';
    }
    $('#eventCrumb').textContent=t.name;
    document.title=`${t.name} · ${eventPageNav.find(([view])=>view===activeView)?.[1]||'Tournament'} · TUNESF`;
    const date=value=>value?new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)):'To be announced';
    const count=Number(t.registered_teams)||0,capacity=Number(t.max_teams)||0,now=Date.now();
    const effectiveStatus=t.status==='registration_open'&&t.registration_opens_at&&new Date(t.registration_opens_at).getTime()>now?'registration_scheduled'
      :t.status==='registration_open'&&(t.registration_closes_at||t.starts_at)&&new Date(t.registration_closes_at||t.starts_at).getTime()<=now?'registration_closed':t.status;
    const eventStats=[['REGISTRATION',effectiveStatus.replaceAll('_',' ')],['APPROVED TEAMS',capacity?`${count} / ${capacity}`:String(count)],['STARTS',date(t.starts_at)],['PRIZE POOL',`${fmt(t.prize_pool)} ${t.currency||'TND'}`]];
    header.innerHTML=`${coverUrl?`<img class="event-cover" src="${esc(coverUrl)}" alt="${esc(t.name)} tournament cover">`:''}<div class="event-kickers"><span class="eyebrow">${esc(GAMES[t.game]?.label||t.game)}</span><span class="event-status-pill" data-status="${esc(effectiveStatus)}"><i data-lucide="radio"></i>${esc(effectiveStatus.replaceAll('_',' '))}</span></div><h1 class="ph-title">${esc(t.name)}</h1><p class="lead">${esc(t.description||'The organizer has not added event details yet.')}</p><div class="event-hero-stats">${eventStats.map(([label,value])=>`<div><small>${label}</small><b>${esc(value)}</b></div>`).join('')}</div><div class="hero-cta">${effectiveStatus==='registration_open'?`<label id="eventTeamWrap" hidden><span>Choose team</span><select id="eventTeam"${READ_ONLY_PREVIEW?' disabled':''}></select></label><button class="btn btn-gold" id="eventRegister" type="button"${READ_ONLY_PREVIEW?' disabled aria-describedby="eventRegisterReadonly" title="Registration is disabled in this production-connected preview."':''}><i data-lucide="user-plus"></i>Register a team</button>${READ_ONLY_PREVIEW?'<p class="preview-write-note event-register-readonly-note" id="eventRegisterReadonly" role="note">Team registration is disabled in this production-connected preview. Open a writable staging site to submit a team entry.</p>':''}`:''}</div><nav class="event-journey" aria-label="Tournament event pages">${eventPageNav.map(([view,label,icon])=>`<a href="${eventPageUrl(view)}"${activeView===view?' aria-current="page"':''}><i data-lucide="${icon}" aria-hidden="true"></i>${label}</a>`).join('')}<a href="broadcast.html?id=${encodeURIComponent(t.id)}" target="_blank" rel="noopener"><i data-lucide="monitor-play" aria-hidden="true"></i>Broadcast</a></nav>`;

    const canManageEvent=Auth.has('MANAGE_SCHEDULE');
    const [regResult,stageResult,prizeResult,adminRegResult,adminStageResult]=await Promise.all([
      SUPA.client.rpc('list_public_tournament_registrations',{p_tournament_id:t.id}),
      SUPA.client.from('tournament_stages').select('id,name,format,status,stage_number').eq('tournament_id',t.id).in('status',['published','in_progress','completed']).order('stage_number'),
      SUPA.client.from('tournament_prizes').select('place,label,amount,currency').eq('tournament_id',t.id).order('place'),
      canManageEvent?SUPA.client.from('tournament_registrations').select('id,team_id,status').eq('tournament_id',t.id).in('status',['approved','checked_in']).order('created_at'):Promise.resolve({data:[],error:null}),
      canManageEvent?SUPA.client.from('tournament_stages').select('id,name,format,status,stage_number').eq('tournament_id',t.id).order('stage_number'):Promise.resolve({data:[],error:null})
    ]);
    if(regResult.error)throw regResult.error;if(stageResult.error)throw stageResult.error;if(prizeResult.error)throw prizeResult.error;if(adminRegResult.error)throw adminRegResult.error;if(adminStageResult.error)throw adminStageResult.error;
    let regs=regResult.data||[];let stages=stageResult.data||[],stageIds=stages.map(s=>s.id);let adminRegistrations=adminRegResult.data||[],adminStages=adminStageResult.data||[];const regIds=regs.map(r=>r.id);
    const teamIds=[...new Set([...regs,...adminRegistrations].map(r=>r.team_id))];
    const [teamResult,matchResult]=await Promise.all([
      teamIds.length?SUPA.client.from('teams').select('id,name,tag,logo_path').in('id',teamIds):Promise.resolve({data:[],error:null}),
      stageIds.length?SUPA.client.from('tournament_matches').select('id,stage_id,round_number,position,bracket_side,home_registration_id,away_registration_id,winner_registration_id,home_expected,away_expected,home_score,away_score,status,scheduled_at,completed_at').in('stage_id',stageIds).order('round_number').order('position'):Promise.resolve({data:[],error:null})
    ]);
    if(teamResult.error)throw teamResult.error;if(matchResult.error)throw matchResult.error;
    await applyOrganizationTeamLogos(teamResult.data||[]);
    const teamMap=new Map((teamResult.data||[]).map(row=>[row.id,row]));
    const regTeam=new Map([...regs,...adminRegistrations].map(row=>[row.id,row.team_id]));
    adminRegistrations=adminRegistrations.map(row=>({...row,team:teamMap.get(row.team_id)}));
    const stageMatches=new Map(stages.map(stage=>[stage.id,(matchResult.data||[]).filter(match=>match.stage_id===stage.id)]));
    const displayedRoundByMatch=new Map();
    const stageStandings=new Map();
    for(const stage of stages.filter(row=>row.format==='round_robin')){
      const {data,error}=await SUPA.client.from('tournament_standings').select('registration_id,played,wins,draws,losses,points,score_for,score_against,rank').eq('stage_id',stage.id).order('rank');
      if(error)throw error;stageStandings.set(stage.id,data||[]);
    }

    const {data:assignedReferees,error:refereeError}=await SUPA.client.rpc('list_tournament_referee_names',{p_tournament_id:t.id});
    if(refereeError)throw refereeError;
    const officialMap=new Map();
    for(const ref of assignedReferees||[]){
      const name=String(ref.username||ref.player_name||'Assigned referee').trim();
      const key=name.toLocaleLowerCase();
      if(!officialMap.has(key))officialMap.set(key,{name,tournamentReferee:true,matches:[]});
      else officialMap.get(key).tournamentReferee=true;
    }
    let allMatches=matchResult.data||[];
    if(Auth.is()&&allMatches.length){
      const {data:officials,error:officialError}=await SUPA.client.from('match_officials').select('match_id,user_id').in('match_id',allMatches.map(m=>m.id));
      if(officialError)throw officialError;
      const userIds=[...new Set((officials||[]).map(row=>row.user_id))];
      const {data:profiles,error:profileError}=userIds.length?await SUPA.client.from('public_profiles').select('id,username,player_name').in('id',userIds):{data:[],error:null};
      if(profileError)throw profileError;
      const profileMap=new Map((profiles||[]).map(row=>[row.id,row.username||row.player_name||'Assigned referee']));
      const matchMap=new Map(allMatches.map(match=>[match.id,match]));
      for(const row of officials||[]){
        const match=matchMap.get(row.match_id);
        if(!match)continue;
        const name=String(profileMap.get(row.user_id)||'Assigned referee').trim();
        const key=name.toLocaleLowerCase();
        if(!officialMap.has(key))officialMap.set(key,{name,tournamentReferee:false,matches:[]});
        const entry=officialMap.get(key);
        if(!entry.matches.some(item=>item.id===match.id))entry.matches.push(match);
      }
    }
    const refereeMarkup=officialMap.size?`<ul class="event-official-list">${[...officialMap.values()].map(official=>{
      const matches=official.matches.sort((a,b)=>a.round_number-b.round_number||a.position-b.position);
      const role=official.tournamentReferee?'Tournament referee':'Match official';
      const assignments=matches.length?`<details class="event-official-assignments"><summary>${matches.length} match${matches.length===1?'':'es'} assigned</summary><ul>${matches.map(match=>`<li><a href="${eventPageUrl('schedule','eventBrackets')}">${esc(stages.find(stage=>stage.id===match.stage_id)?.name||'Tournament')} · Round ${esc(match.round_number)} · Match ${esc(match.position)} <i data-lucide="arrow-right" aria-hidden="true"></i></a></li>`).join('')}</ul></details>`:'';
      return `<li class="event-official"><span class="event-official-mark" aria-hidden="true"><i data-lucide="shield-check"></i></span><span class="event-official-info"><b>${esc(official.name)}</b><small>${role}</small>${assignments}</span></li>`;
    }).join('')}</ul>`:'<p class="team-empty">No referee has been assigned to this tournament yet.</p>';

    const teamFor=registrationId=>teamMap.get(regTeam.get(registrationId));
    const stageFor=stageId=>stages.find(stage=>stage.id===stageId);
    const matchLabel=match=>`${stageFor(match.stage_id)?.name||'Tournament'} - ${displayedRoundByMatch.get(match.id)||`Round ${match.round_number}`} - Match ${match.position}`;
    const matchStatusLabel=status=>({live:'Live',paused:'Paused',result_pending:'Result review',disputed:'Disputed',pending:'Scheduled',ready:'Ready',completed:'Final',forfeit:'Forfeit',cancelled:'Cancelled'}[status]||String(status||'Unknown').replaceAll('_',' '));
    const schedulePassed=match=>['pending','ready'].includes(match.status)&&match.scheduled_at&&new Date(match.scheduled_at).getTime()<=Date.now();
    const publicMatchStatus=match=>schedulePassed(match)?'Schedule update needed':matchStatusLabel(match.status);
    const publicMatchStatusKey=match=>schedulePassed(match)?'overdue':match.status;
    const matchCard=(match,kind)=>{
      const home=teamFor(match.home_registration_id),away=teamFor(match.away_registration_id);
      const timePassed=kind==='upcoming'&&match.scheduled_at&&new Date(match.scheduled_at).getTime()<=Date.now();
      const status=timePassed?'Schedule update needed':matchStatusLabel(match.status);
      const matchTime=kind==='result'?(match.completed_at||match.scheduled_at):match.scheduled_at;
      const time=timePassed?`Scheduled ${date(matchTime)} · awaiting reschedule`:matchTime?date(matchTime):'Time to be announced';
      const score=match.status==='forfeit'?'W/O':`${match.home_score??'—'} <i>:</i> ${match.away_score??'—'}`;
      const calendarAction=kind==='upcoming'&&match.scheduled_at&&!timePassed?`<button class="event-calendar-add" type="button" data-add-calendar="${esc(match.id)}"><i data-lucide="calendar-plus"></i>Add to calendar</button>`:'';
      const resultAction=kind==='result'?`<button class="event-result-share" type="button" data-share-result="${esc(match.id)}"><i data-lucide="share-2"></i>Share result card</button>`:'';
      return `<article class="event-hub-match" data-kind="${kind}"${timePassed?' data-overdue="true"':''}><div class="event-hub-match-meta"><span>${esc(matchLabel(match))}</span><b data-status="${timePassed?'overdue':esc(match.status)}">${esc(status)}</b></div><div class="event-hub-score"><span>${identityImage(home?.logo_path,home?.name||'Team',30,'team')}<b>${esc(home?.name||'TBD')}</b></span><strong>${score}</strong><span>${identityImage(away?.logo_path,away?.name||'Team',30,'team')}<b>${esc(away?.name||'TBD')}</b></span></div><small>${esc(time)}</small><div class="event-hub-match-actions"><a href="${eventPageUrl('schedule','eventBrackets')}" aria-label="View ${esc(matchLabel(match))} in the event schedule">View schedule <i data-lucide="arrow-right"></i></a>${calendarAction}${resultAction}</div></article>`;
    };
    const renderEventHub=(matches,updated=new Date())=>{
      const liveMatches=matches.filter(match=>['live','paused','result_pending','disputed'].includes(match.status));
      const playedMatches=matches.filter(match=>['completed','forfeit'].includes(match.status));
      const hasPassedStart=match=>match.scheduled_at&&new Date(match.scheduled_at).getTime()<=Date.now();
      const upcomingMatches=matches.filter(match=>['pending','ready'].includes(match.status)&&match.home_registration_id&&match.away_registration_id)
        .sort((a,b)=>{
          const timeFor=match=>!match.scheduled_at?Number.MAX_SAFE_INTEGER:hasPassedStart(match)?Number.MAX_SAFE_INTEGER+1:new Date(match.scheduled_at).getTime();
          return timeFor(a)-timeFor(b);
        });
      const nextMatch=upcomingMatches[0]||null;
      const recentResults=[...playedMatches].sort((a,b)=>{
        const aTime=a.completed_at?new Date(a.completed_at).getTime():a.scheduled_at?new Date(a.scheduled_at).getTime():0,bTime=b.completed_at?new Date(b.completed_at).getTime():b.scheduled_at?new Date(b.scheduled_at).getTime():0;
        return bTime-aTime||b.round_number-a.round_number||b.position-a.position;
      });
      const liveHeading=liveMatches.length?'Live & in review':'No matches live right now';
      const liveCopy=liveMatches.length?'Follow current scores, pauses, and result reviews.':'Check the next scheduled fixtures or recent approved results below.';
      const liveCards=liveMatches.length?liveMatches.map(match=>matchCard(match,'live')).join(''):'<p class="event-hub-empty">The event is ready for its next match. This board will show live scores when a match begins.</p>';
      const expandableCards=(items,kind)=>items.map((match,index)=>{
        const card=matchCard(match,kind);
        return index<3?card:card.replace('<article class="event-hub-match"','<article hidden class="event-hub-match"');
      }).join('');
      const upcomingCards=upcomingMatches.length?expandableCards(upcomingMatches,'upcoming'):'<p class="event-hub-empty">No upcoming fixtures have been scheduled yet.</p>';
      const resultCards=recentResults.length?expandableCards(recentResults,'result'):'<p class="event-hub-empty">Approved match results will appear here.</p>';
      const upcomingMore=upcomingMatches.length>3?`<button class="event-hub-more" type="button" data-event-show-more="upcoming" aria-controls="eventUpcomingMatches">Show all ${upcomingMatches.length} upcoming matches <i data-lucide="arrow-down"></i></button>`:'';
      const timedUpcomingCount=upcomingMatches.filter(match=>match.scheduled_at&&!hasPassedStart(match)).length;
      const upcomingActions=`<div class="event-hub-section-actions"><a href="${eventPageUrl('schedule','eventBrackets')}">Full schedule <i data-lucide="arrow-right"></i></a>${timedUpcomingCount?`<button class="event-calendar-download" type="button" data-download-event-calendar title="Includes ${timedUpcomingCount} scheduled ${timedUpcomingCount===1?'fixture':'fixtures'}; fixtures without a published start time are omitted."><i data-lucide="calendar-plus"></i>Calendar <b>${timedUpcomingCount}</b></button>`:''}</div>`;
      const resultsMore=recentResults.length>3?`<button class="event-hub-more" type="button" data-event-show-more="results" aria-controls="eventRecentResults">Show all ${recentResults.length} results <i data-lucide="arrow-down"></i></button>`:'';
      const matchFilters=`<div class="event-hub-filters" role="group" aria-label="Filter event matches"><span>SHOW</span><button type="button" data-event-filter="all" aria-pressed="true">All <b>${liveMatches.length+upcomingMatches.length+playedMatches.length}</b></button><button type="button" data-event-filter="live" aria-pressed="false">Live / review <b>${liveMatches.length}</b></button><button type="button" data-event-filter="upcoming" aria-pressed="false">Upcoming <b>${upcomingMatches.length}</b></button><button type="button" data-event-filter="results" aria-pressed="false">Results <b>${playedMatches.length}</b></button></div>`;
      const statusLegend=`<ul class="event-status-legend" aria-label="Match status legend"><li><span class="event-status-key is-live"></span>In progress</li><li><span class="event-status-key is-upcoming"></span>Upcoming</li><li><span class="event-status-key is-final"></span>Final</li><li><span class="event-status-key is-review"></span>Paused / review</li></ul>`;
      const standingsStage=stages.find(stage=>stage.format==='round_robin');
      const quickStandings=standingsStage?stageStandings.get(standingsStage.id)||[]:[];
      const standingsCard=standingsStage?`<section class="event-hub-section event-hub-standings-card"><div class="event-hub-section-title"><div><h3>Standings snapshot</h3><small>${esc(standingsStage.name)}</small></div><div class="event-standings-actions"><a href="${eventPageUrl('schedule','eventBrackets')}">Full table <i data-lucide="arrow-right"></i></a>${quickStandings.length?`<button class="event-share-standings" type="button" data-share-standings="${esc(standingsStage.id)}"><i data-lucide="share-2"></i>Share table</button>`:''}</div></div>${quickStandings.length?`<div class="event-quick-standings" role="table" aria-label="Top tournament standings"><div class="event-quick-head" role="row"><span role="columnheader">#</span><span role="columnheader">Team</span><span role="columnheader">W–D–L</span><span role="columnheader">PTS</span></div>${quickStandings.slice(0,4).map(row=>{const team=teamFor(row.registration_id),leader=row.rank===1;return `<div class="event-quick-row${leader?' is-leader':''}" role="row"><b class="event-quick-rank" role="cell" aria-label="Rank ${row.rank}${leader?', currently leading':''}">${leader?'<i data-lucide="crown" aria-hidden="true"></i>':''}${row.rank}</b><span class="event-quick-team" role="cell">${identityImage(team?.logo_path,team?.name||'Team',24,'team')}<button type="button" class="event-quick-team-pick" data-team-spotlight="${esc(row.registration_id)}" aria-controls="eventTeamSpotlight" aria-expanded="false" aria-label="Show ${esc(team?.name||'team')} match details">${esc(team?.name||'Team unavailable')}</button></span><span class="event-quick-record" role="cell">${row.wins}–${row.draws}–${row.losses}</span><b class="event-quick-points" role="cell">${row.points}</b></div>`}).join('')}</div><div class="event-team-spotlight" id="eventTeamSpotlight" aria-live="polite"><p>Select a team to see its record and fixtures.</p></div>`:'<p class="event-quick-empty">Standings will appear after the first result is approved.</p>'}</section>`:'';
      const updatedAt=new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit'}).format(updated);
      const nextMatchCard=nextMatch?`<a class="event-next-match" data-event-match-section="upcoming" href="${eventPageUrl('schedule','eventBrackets')}"><span class="event-next-icon"><i data-lucide="calendar-clock"></i></span><span class="event-next-copy"><small>${hasPassedStart(nextMatch)?'SCHEDULE UPDATE NEEDED':'NEXT MATCH'} · ${esc(matchLabel(nextMatch))}</small><b>${esc(teamFor(nextMatch.home_registration_id)?.name||'TBD')} <i>vs</i> ${esc(teamFor(nextMatch.away_registration_id)?.name||'TBD')}</b><span>${hasPassedStart(nextMatch)?`Scheduled start passed · ${esc(date(nextMatch.scheduled_at))}`:nextMatch.scheduled_at?esc(date(nextMatch.scheduled_at)):'Start time not announced'}</span></span><strong class="event-next-countdown" data-countdown="${nextMatch.scheduled_at?esc(nextMatch.scheduled_at):''}" role="timer" aria-live="off">${nextMatch.scheduled_at?'Loading countdown':'Awaiting schedule'}</strong></a>`:`<div class="event-next-match is-empty" data-event-match-section="upcoming"><span class="event-next-icon"><i data-lucide="calendar-clock"></i></span><span class="event-next-copy"><small>NEXT MATCH</small><b>No fixture is ready yet</b><span>Published fixtures will appear here.</span></span></div>`;
      return `<section class="event-hub" id="eventLiveHub" aria-labelledby="eventHubTitle" data-active-filter="all"><div class="event-hub-head"><div><span class="event-hub-kicker"><i data-lucide="radio"></i> PUBLIC EVENT CENTER</span><h2 id="eventHubTitle">Follow the tournament</h2><p>${esc(liveCopy)}</p></div><div class="event-hub-actions"><button class="btn btn-line btn-sm" id="printEventSheet" type="button"><i data-lucide="printer"></i>Print match sheet</button><a class="btn btn-gold btn-sm" href="broadcast.html?id=${encodeURIComponent(t.id)}" target="_blank" rel="noopener"><i data-lucide="monitor-play"></i>Broadcast view</a><button class="btn btn-line btn-sm" id="shareEventHub" type="button"><i data-lucide="share-2"></i>Share event</button><button class="btn btn-line btn-sm" id="refreshEventHub" type="button"><i data-lucide="refresh-cw"></i>Refresh</button></div></div>${nextMatchCard}<div class="event-hub-stats" aria-label="Event match summary"><div><b>${liveMatches.length}</b><small>Live / in review</small></div><div><b>${upcomingMatches.length}</b><small>Upcoming matches</small></div><div><b>${playedMatches.length}</b><small>Results recorded</small></div><span id="eventHubUpdated" role="status" aria-live="polite">Updated ${esc(updatedAt)}</span></div>${matchFilters}${statusLegend}<span id="eventFilterStatus" class="event-filter-status" role="status" aria-live="polite">Showing all match updates</span><section class="event-hub-section" data-event-match-section="live"><div class="event-hub-section-title"><h3>${esc(liveHeading)}</h3><span class="event-hub-live-dot${liveMatches.length?' is-live':''}">${liveMatches.length?'LIVE':'EVENT BOARD'}</span></div><div class="event-hub-matches">${liveCards}</div></section><div class="event-hub-columns${standingsStage?' has-standings':''}"><section class="event-hub-section" data-event-match-section="upcoming"><div class="event-hub-section-title"><h3>Up next</h3>${upcomingActions}</div><div class="event-hub-matches" id="eventUpcomingMatches">${upcomingCards}</div>${upcomingMore}</section><section class="event-hub-section" data-event-match-section="results"><div class="event-hub-section-title"><h3>Recent results</h3><a href="${eventPageUrl('schedule','eventBrackets')}">Full results <i data-lucide="arrow-right"></i></a></div><div class="event-hub-matches" id="eventRecentResults">${resultCards}</div>${resultsMore}</section>${standingsCard}</div><div class="event-hub-footer"><span>Scores and standings follow published tournament records.</span><a href="${eventPageUrl('teams','eventParticipants')}">Meet the teams <i data-lucide="arrow-right"></i></a></div></section>`;
    };
    const sideHtml=(registrationId,expected,score,winner)=>{
      const team=teamFor(registrationId),label=team?`<span class="bracket-team-identity">${identityImage(team.logo_path,team.name,28,'team')}<span class="bracket-team-copy"><a href="team.html?id=${encodeURIComponent(team.id)}"><span class="bracket-team-name" dir="auto">${esc(team.name)}</span>${team.tag?`<small>${esc(team.tag)}</small>`:''}</a></span></span>`:expected?'Pending':'BYE';
      return `<div class="bracket-match-team${winner?' is-winner':''}"><span class="bracket-match-label">${label}</span><b>${score===null||score===undefined?'-':score}</b></div>`;
    };
    const matchHtml=match=>`<article class="bracket-match" data-status="${esc(publicMatchStatusKey(match))}"><div class="bracket-match-meta"><span>Match ${match.position}</span><b>${esc(publicMatchStatus(match))}</b></div>${sideHtml(match.home_registration_id,match.home_expected,match.home_score,match.winner_registration_id===match.home_registration_id&&match.winner_registration_id!==null)}${sideHtml(match.away_registration_id,match.away_expected,match.away_score,match.winner_registration_id===match.away_registration_id&&match.winner_registration_id!==null)}</article>`;
    const eliminationHtml=stage=>{
      const matches=stageMatches.get(stage.id)||[];
      if(!matches.length)return '<p class="team-empty">No matches have been published for this stage yet.</p>';
      const sides=stage.format==='double_elimination'?[['winners','Upper bracket'],['losers','Lower bracket'],['grand_final','Grand final']]:[['main',stage.format==='single_elimination'?'Single elimination':'Playoff bracket']];
      return sides.map(([side,title])=>{
        const group=matches.filter(match=>match.bracket_side===side&&!(match.status==='cancelled'&&!match.home_expected&&!match.away_expected));
        if(!group.length)return '';
        const rounds=[...new Set(group.map(match=>match.round_number))].sort((a,b)=>a-b);
        return `<section class="event-bracket-stage"><div class="dh"><i data-lucide="git-fork"></i>${title}<span class="bracket-stage-meta">${esc(stage.name)}</span></div>${rounds.length>1?'<p class="bracket-scroll-hint"><i data-lucide="move-horizontal" aria-hidden="true"></i> Scroll sideways to follow later rounds</p>':''}<div class="bracket-rail" tabindex="0" role="region" aria-label="${esc(title)} rounds"><div class="bracket-columns">${rounds.map(round=>`<div class="bracket-round"><h4>Round ${round}</h4>${group.filter(match=>match.round_number===round).map(matchHtml).join('')}</div>`).join('')}</div></div></section>`;
      }).join('');
    };
    const roundRobinHtml=stage=>{
      const standings=stageStandings.get(stage.id)||[],matches=stageMatches.get(stage.id)||[];
      const laterStages=stages.filter(other=>other.stage_number>stage.stage_number);
      const qualified=new Set(laterStages.flatMap(other=>(stageMatches.get(other.id)||[]).flatMap(match=>[match.home_registration_id,match.away_registration_id]).filter(Boolean)));
      const qualifierCount=Math.max(2,Math.min(64,Number(t.playoff_qualifier_count)||4));
      const rowQualifies=row=>laterStages.length?qualified.has(row.registration_id):t.format==='round_robin_playoffs'&&row.rank<=qualifierCount;
      const table=standings.length?`<p class="rr-scroll-hint">Scroll the table horizontally to see every standings column <i data-lucide="move-horizontal" aria-hidden="true"></i></p><div class="rr-table-wrap" tabindex="0" role="region" aria-label="Scrollable round-robin standings"><table class="rr-table"><thead><tr><th>#</th><th>Team</th><th>P</th><th>W</th><th>L</th><th>+/-</th><th>Pts</th><th>Qualification</th></tr></thead><tbody>${standings.map(row=>{const team=teamFor(row.registration_id),isQualified=rowQualifies(row),diff=row.score_for-row.score_against,qualification=isQualified?'<span class="rr-qualified-badge">QUALIFIED</span>':laterStages.length?'<span class="rr-out-badge">NOT QUALIFIED</span>':t.format==='round_robin_playoffs'?'<span class="rr-pending-badge">IN CONTENTION</span>':'<span class="rr-pending-badge">LEAGUE TABLE</span>';return `<tr class="${isQualified?'is-qualified':''}"${isQualified?' data-qualifies="true"':''}><td class="rr-rank">${row.rank}</td><td><span class="team-identity">${identityImage(team?.logo_path,team?.name||'Team',30,'team')}<a href="team.html?id=${encodeURIComponent(regTeam.get(row.registration_id)||'')}">${esc(team?.name||'Team unavailable')} <small>${esc(team?.tag||'')}</small></a></span></td><td>${row.played}</td><td>${row.wins}</td><td>${row.losses}</td><td class="rr-diff${diff>0?' is-positive':diff<0?' is-negative':''}">${diff>0?'+':''}${diff}</td><td><b>${row.points}</b></td><td>${qualification}</td></tr>`}).join('')}</tbody></table></div>`:'<p class="team-empty">Standings will fill in as match results are approved.</p>';
      const distinctRounds=[...new Set(matches.map(match=>match.round_number))];
      let rounds=[];
      if(distinctRounds.length>1){
        rounds=distinctRounds.sort((a,b)=>a-b).map(number=>({number,matches:matches.filter(match=>match.round_number===number)}));
      }else if(matches.length){
        const pairKey=(a,b)=>[a,b].sort().join(':');
        const byPair=new Map(matches.filter(match=>match.home_registration_id&&match.away_registration_id)
          .map(match=>[pairKey(match.home_registration_id,match.away_registration_id),match]));
        const slots=regs.map(reg=>reg.id);
        if(slots.length%2)slots.push(null);
        const rotation=[...slots],used=new Set();
        for(let index=0;index<rotation.length-1;index++){
          const roundMatches=[];
          for(let position=0;position<rotation.length/2;position++){
            const first=rotation[position],second=rotation[rotation.length-1-position];
            if(!first||!second)continue;
            const match=byPair.get(pairKey(first,second));
            if(match){roundMatches.push(match);used.add(match.id);}
          }
          if(roundMatches.length)rounds.push({number:index+1,matches:roundMatches});
          rotation.splice(1,0,rotation.pop());
        }
        const unassigned=matches.filter(match=>!used.has(match.id));
        if(unassigned.length)rounds.push({number:'Other',matches:unassigned});
      }
      for(const round of rounds)for(const match of round.matches)displayedRoundByMatch.set(match.id,typeof round.number==='number'?`Round ${round.number}`:round.number);
      const teamMark=team=>identityImage(team?.logo_path,team?.name||'Team',30,'team');
      const nextFixture=[...matches].filter(match=>['pending','ready'].includes(match.status)&&match.home_registration_id&&match.away_registration_id)
        .sort((a,b)=>(a.scheduled_at?new Date(a.scheduled_at).getTime():Infinity)-(b.scheduled_at?new Date(b.scheduled_at).getTime():Infinity))[0];
      const nextRoundIndex=nextFixture?rounds.findIndex(round=>round.matches.some(match=>match.id===nextFixture.id)):-1;
      const unfinishedRoundIndex=rounds.findIndex(round=>round.matches.some(match=>!['completed','forfeit','cancelled'].includes(match.status)));
      const openRoundIndex=nextRoundIndex>=0?nextRoundIndex:unfinishedRoundIndex>=0?unfinishedRoundIndex:rounds.length-1;
      const fixtures=rounds.length?`<div class="rr-round-picker" role="tablist" aria-label="Round robin rounds">${rounds.map((round,index)=>`<button type="button" role="tab" id="rrRoundTab${stage.stage_number}-${index}" aria-controls="rrRoundPanel${stage.stage_number}-${index}" aria-selected="${index===openRoundIndex}" tabindex="${index===openRoundIndex?'0':'-1'}" data-rr-round="${stage.stage_number}" data-round-index="${index}" class="${index===openRoundIndex?'active':''}">${typeof round.number==='number'?`R${round.number}`:esc(round.number)}</button>`).join('')}</div><div class="rr-round-panels">${rounds.map((round,index)=>`<section class="rr-round-panel" role="tabpanel" id="rrRoundPanel${stage.stage_number}-${index}" aria-labelledby="rrRoundTab${stage.stage_number}-${index}"${index===openRoundIndex?'':' hidden'}><header><b>ROUND ${typeof round.number==='number'?round.number:esc(round.number)}</b><span>${round.matches.length} fixture${round.matches.length===1?'':'s'}</span></header><div class="rr-fixtures">${round.matches.map(match=>{const home=teamFor(match.home_registration_id),away=teamFor(match.away_registration_id);return `<article class="rr-fixture" data-status="${esc(publicMatchStatusKey(match))}"><small>Match ${match.position} | ${esc(publicMatchStatus(match))}${match.scheduled_at?` | ${esc(date(match.scheduled_at))}`:''}</small><div class="rr-fixture-teams"><span class="rr-fixture-team">${teamMark(home)}<span dir="auto">${esc(home?.name||'TBD')}</span></span><span class="rr-score" dir="ltr">${match.home_score??'-'} : ${match.away_score??'-'}</span><span class="rr-fixture-team rr-fixture-away"><span dir="auto">${esc(away?.name||'TBD')}</span>${teamMark(away)}</span></div></article>`}).join('')}</div></section>`).join('')}</div>`:'<p class="team-empty">No round-robin matches are published yet.</p>';
      return `<section class="event-bracket-stage rr-stage"><div class="dh"><i data-lucide="list-ordered"></i>${esc(stage.name)}<span class="bracket-stage-meta">Round robin · ${standings.length} teams</span></div>${t.format==='round_robin_playoffs'?`<p class="rr-qualifier-note"><i data-lucide="trophy" aria-hidden="true"></i>Top ${laterStages.length?(qualified.size||qualifierCount):qualifierCount} teams qualify for the playoffs; ${Number(t.playoff_bye_count)||0} top seed${Number(t.playoff_bye_count)===1?'':'s'} get a first-round bye</p>`:''}<div class="rr-layout"><section class="rr-standings-card"><h3>STANDINGS</h3>${table}</section><section class="rr-schedule-card"><h3>ROUNDS</h3>${fixtures}</section></div></section>`;
    };

    const playoffHtml=()=>{
      const stage=stages.find(row=>row.stage_number>1);if(!stage)return `<section class="playoff-empty"><span class="event-hub-kicker"><i data-lucide="git-fork"></i>PLAYOFFS</span><h3>The playoff bracket will appear here</h3><p>The organizer can publish the top ${Math.max(2,Number(t.playoff_qualifier_count)||4)} seeds before round robin finishes. ${Number(t.playoff_bye_count)||0} receive a first-round bye.</p></section>`;
      const matches=(stageMatches.get(stage.id)||[]).filter(match=>match.bracket_side==='main'&&match.status!=='cancelled');if(!matches.length)return '<p class="team-empty">No playoff matches have been published yet.</p>';
      const rounds=[...new Set(matches.map(match=>match.round_number))].sort((a,b)=>a-b),lastRound=rounds.at(-1),matchCount=round=>matches.filter(match=>match.round_number===round).length;
      const roundName=round=>round===lastRound?'Grand final':matchCount(round)===2?'Semifinals':matchCount(round)===4?'Quarterfinals':matchCount(round)===8?'Round of 16':`Round ${round}`;
      const final=matches.find(match=>match.round_number===lastRound),championId=final?.winner_registration_id,champion=championId?teamFor(championId):null;
      const actualQualifierCount=new Set(matches.filter(match=>match.round_number===rounds[0]).flatMap(match=>[match.home_registration_id,match.away_registration_id]).filter(Boolean)).size||Number(t.playoff_qualifier_count)||4;
      const bracketRounds=rounds.map((round,index)=>`<section class="playoff-round"><header><h3>${esc(roundName(round))}</h3><span>${esc(t.best_of||'BO3')}</span></header><div class="playoff-round-matches" data-match-count="${matchCount(round)}">${matches.filter(match=>match.round_number===round).sort((a,b)=>a.position-b.position).map(match=>{
        const home=teamFor(match.home_registration_id),away=teamFor(match.away_registration_id),finished=['completed','forfeit'].includes(match.status),winner=match.winner_registration_id;
        const side=(team,score,isWinner)=>`<div class="playoff-team${isWinner?' is-winner':''}">${identityImage(team?.logo_path,team?.name||'Team',30,'team')}<span dir="auto">${esc(team?.name||'To be decided')}</span><b>${score??'—'}</b></div>`;
        return `<a class="playoff-match" href="match-room.html?id=${encodeURIComponent(match.id)}" data-status="${esc(publicMatchStatusKey(match))}"><div class="playoff-match-meta"><b>${esc(roundName(round).replace(/s$/,''))} ${match.position}</b><span data-status="${esc(publicMatchStatusKey(match))}">${finished?'FINAL':esc(publicMatchStatus(match))}</span></div>${side(home,match.home_score,winner===match.home_registration_id&&winner!==null)}${side(away,match.away_score,winner===match.away_registration_id&&winner!==null)}<footer>${match.scheduled_at?esc(date(match.scheduled_at)):'BO3'}<span>VIEW MATCH <i data-lucide="arrow-up-right"></i></span></footer></a>`;
      }).join('')}</div></section>`).join('');
      return `<section class="playoff-board"><div class="playoff-board-head"><div><span class="event-hub-kicker"><i data-lucide="trophy"></i>TOP ${actualQualifierCount} PLAYOFFS</span><h3>PLAYOFF BRACKET</h3></div><span class="playoff-format-badge">SINGLE ELIMINATION</span></div><div class="playoff-bracket-viewport" tabindex="0" role="region" aria-label="Playoff bracket rounds"><div class="playoff-bracket">${bracketRounds}<section class="playoff-champion"><span>CHAMPION</span><i data-lucide="trophy"></i>${champion?identityImage(champion.logo_path,champion.name,66,'team'):'<span class="playoff-champion-placeholder">?</span>'}<b>${esc(champion?.name||'To be decided')}</b><small>${champion?'EVENT WINNER':'AWAITING GRAND FINAL'}</small></section></div></div></section>`;
    };

    const prizes=prizeResult.data?.length?prizeResult.data.map(p=>`<li class="event-reg"><b>${esc(p.label||`Place ${p.place}`)}</b><span>${fmt(p.amount)} ${esc(p.currency)}</span></li>`).join(''):'<li class="team-empty">No prize schedule has been published.</li>';
    const participants=regs.length?regs.map(r=>{const team=teamFor(r.id),status=String(r.status||'unknown').toLowerCase(),search=`${team?.name||''} ${team?.tag||''}`.toLocaleLowerCase();return `<li class="event-reg event-participant" data-team-search="${esc(search)}"><span class="team-identity">${identityImage(team?.logo_path,team?.name||'Team',36,'team')}<span><b><a href="team.html?id=${encodeURIComponent(team?.id||'')}">${esc(team?.name||'Team unavailable')}</a></b><small>${esc(team?.tag||'Tournament participant')}</small></span></span><span class="participant-status" data-status="${esc(status)}">${esc(status.replaceAll('_',' '))}</span></li>`}).join(''):'<li class="team-empty">No approved teams yet.</li>';
    const ruleFacts=[['Format',String(t.format||'To be announced').replaceAll('_',' ')],...(t.format==='round_robin_playoffs'?[['Playoff qualifiers',`Top ${Number(t.playoff_qualifier_count)||4} teams`],['First-round byes',`${Number(t.playoff_bye_count)||0} top seeds`]]:[]),['Match length',t.best_of||'Best of 1'],['Region',t.region||'To be announced'],['Anti-cheat',t.anti_cheat_required?'Required':'Not required'],['Substitutes',String(Number(t.substitute_limit)||0)],['Check-in window',`${Number(t.check_in_minutes)||0} minutes`]];
    const rules=`<dl class="event-rule-facts">${ruleFacts.map(([label,value])=>`<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>${t.map_pool?.length?`<div class="event-map-pool"><h3>Map pool</h3><ul>${t.map_pool.map(map=>`<li>${esc(map)}</li>`).join('')}</ul></div>`:''}<div class="event-rule-note"><h3>Additional rules</h3><p class="tournament-rules-copy${t.rules?'':' is-empty'}">${esc(t.rules||'The organizer has not published additional rules.')}</p></div>`;
    let stageMarkup=stages.length?stages.map(stage=>stage.format==='round_robin'?roundRobinHtml(stage):eliminationHtml(stage)).join(''):'<p class="team-empty">The organizer has not published a bracket for this tournament yet.</p>';
    const stageHeading=t.format==='round_robin'?'Round robin table & schedule':t.format==='round_robin_playoffs'?'Group stage & playoffs':'Tournament bracket';
    const renderEventBrackets=()=>{
      if(t.format!=='round_robin_playoffs')return `<div class="dh"><i data-lucide="git-fork"></i>${esc(stageHeading)}</div><div class="db">${stageMarkup}${canManageEvent?renderCompetitionAdminControls():''}</div>`;
      const regularStages=stages.filter(stage=>stage.format==='round_robin');
      const regular=regularStages.length?regularStages.map(roundRobinHtml).join(''):'<p class="team-empty">The round robin stage has not been published yet.</p>';
      const selected=stages.some(stage=>stage.stage_number>1)?'playoffs':'regular';
      return `<div class="dh"><i data-lucide="git-fork"></i>Round robin &amp; playoffs</div><div class="db"><nav class="competition-view-tabs" role="tablist" aria-label="Competition phase"><button type="button" role="tab" aria-selected="${selected==='regular'}" tabindex="${selected==='regular'?'0':'-1'}" aria-controls="competitionRegular" id="competitionRegularTab" data-competition-view="regular" class="${selected==='regular'?'active':''}">Regular season</button><button type="button" role="tab" aria-selected="${selected==='playoffs'}" tabindex="${selected==='playoffs'?'0':'-1'}" aria-controls="competitionPlayoffs" id="competitionPlayoffsTab" data-competition-view="playoffs" class="${selected==='playoffs'?'active':''}">Playoffs</button></nav><section id="competitionRegular" role="tabpanel" aria-labelledby="competitionRegularTab"${selected==='regular'?'':' hidden'}>${regular}</section><section id="competitionPlayoffs" role="tabpanel" aria-labelledby="competitionPlayoffsTab"${selected==='playoffs'?'':' hidden'}>${playoffHtml()}</section>${canManageEvent?renderCompetitionAdminControls():''}</div>`;
    };
    const playoffSeedOrders=new Map();
    const renderCompetitionAdminControls=()=>{
      if(!canManageEvent)return '';
      const registrations=adminRegistrations;
      const rrStages=adminStages.filter(stage=>stage.format==='round_robin');
      if(t.format!=='round_robin_playoffs'&&!rrStages.length)return '';
      const rrStage=rrStages.find(stage=>stage.stage_number===1)||rrStages[0];
      const playoffStage=adminStages.find(stage=>stage.stage_number>1);
      const eventInProgress=effectiveStatus==='in_progress';
      const canPrepare=eventInProgress&&rrStage&&['published','in_progress','completed'].includes(rrStage.status);
      const q=Math.max(2,Math.min(64,Number(t.playoff_qualifier_count)||4));
      const byes=Math.max(0,Number(t.playoff_bye_count)||0);
      const standings=stageStandings.get(rrStage?.id)||[];
      const sorted=[...standings].sort((a,b)=>a.rank-b.rank||a.registration_id.localeCompare(b.registration_id));
      const inputs=registrations.map(reg=>{
        const row=standings.find(item=>item.registration_id===reg.id)||{played:0,wins:0,draws:0,losses:0,points:0,score_for:0,score_against:0};
        return `<form class="event-standing-row" data-page-standing data-stage="${esc(rrStage?.id||'')}" data-registration="${esc(reg.id)}"><b>${esc(reg.team?.name||'Team unavailable')} <small>Rank ${row.rank||'—'}</small></b>${[['played','Played'],['wins','Wins'],['draws','Draws'],['losses','Losses'],['points','Points'],['score_for','For'],['score_against','Against']].map(([key,label])=>`<label>${label}<input type="number" name="${key}" min="${key==='points'?-10000:0}" max="${key==='points'?10000:100000}" value="${row[key]??0}" required${READ_ONLY_PREVIEW?' disabled':''}></label>`).join('')}<span><button type="button" class="btn btn-gold btn-sm" data-competition-action="save-standing"${READ_ONLY_PREVIEW?' disabled title="Changes are disabled in this production preview."':''}>Save</button><button type="button" class="btn btn-line btn-sm" data-competition-action="reset-standing"${READ_ONLY_PREVIEW?' disabled title="Changes are disabled in this production preview."':''}>Reset</button></span></form>`;
      }).join('');
      let playoff='';
      if(t.format==='round_robin_playoffs'&&canPrepare){
        if(!playoffStage){
          playoff=registrations.length>=q?`<div class="event-playoff-config"><span><b>TOP ${q}</b><small>QUALIFIERS FROM CURRENT STANDINGS</small></span><span><b>${byes} BYE${byes===1?'':'S'}</b><small>TOP SEEDS SKIP THE OPENING ROUND</small></span></div><div class="event-playoff-prepare"><button class="btn btn-gold btn-sm" type="button" data-competition-action="prepare-playoffs"${READ_ONLY_PREVIEW?' disabled aria-describedby="eventPlayoffPrepareNotice" title="Disabled because this local preview is connected to production."':''}>Prepare playoff draft</button>${READ_ONLY_PREVIEW?'<span class="event-playoff-prepare-hint" id="eventPlayoffPrepareNotice">Disabled in this production-connected preview; draft changes require a writable staging site.</span>':''}</div>`:`<p class="team-empty">Approve ${q} teams before preparing the playoff.</p>`;
          playoff+=`<p class="team-empty">You can prepare the playoff while round robin continues.</p>`;
        }else if(playoffStage.status==='draft'){
          const draft=sorted.slice(0,q).map(row=>row.registration_id);
          let order=playoffSeedOrders.get(t.id)||draft;
          order=order.filter(registrationId=>draft.includes(registrationId));for(const registrationId of draft)if(!order.includes(registrationId))order.push(registrationId);
          playoffSeedOrders.set(t.id,order);
          const list=order.map((registrationId,index)=>{const reg=registrations.find(item=>item.id===registrationId);return `<li><span><b>Seed ${index+1}</b> ${esc(reg?.team?.name||'Team unavailable')}${index<byes?'<small class="event-seed-bye">SEMIFINAL BYE</small>':''}</span><span><button type="button" class="btn btn-line btn-sm" aria-label="Move ${esc(reg?.team?.name||'team')} up" data-competition-action="seed-up" data-registration="${esc(registrationId)}"${index===0?' disabled':''}>↑</button><button type="button" class="btn btn-line btn-sm" aria-label="Move ${esc(reg?.team?.name||'team')} down" data-competition-action="seed-down" data-registration="${esc(registrationId)}"${index===order.length-1?' disabled':''}>↓</button></span></li>`}).join('');
          playoff=`<div class="event-playoff-config"><span><b>TOP ${q}</b><small>QUALIFIERS FROM CURRENT STANDINGS</small></span><span><b>${byes} BYE${byes===1?'':'S'}</b><small>TOP SEEDS SKIP THE OPENING ROUND</small></span></div><h3 class="team-section-title">Playoff seed order <small>Adjust seeds; the top ${byes} enter the later round. Refresh after standings changes.</small></h3><ol class="event-seed-list">${list}</ol><div class="event-actions"><button type="button" class="btn btn-line btn-sm" data-competition-action="prepare-playoffs"${READ_ONLY_PREVIEW?' disabled title="Changes are disabled in this production preview."':''}>Refresh from standings</button><button type="button" class="btn btn-gold btn-sm" data-competition-action="publish-playoffs"${READ_ONLY_PREVIEW?' disabled title="Changes are disabled in this production preview."':''}>Publish playoff bracket</button></div>`;
        }else playoff=`<p class="team-empty">The playoff bracket is published and appears in the Playoffs tab.</p>`;
      }else if(t.format==='round_robin_playoffs')playoff=`<p class="team-empty">${!rrStage?'Publish the round-robin stage first.':effectiveStatus!=='in_progress'?'Start the tournament before preparing playoffs.':'The playoff draft is not available yet.'} You can prepare playoffs before every round-robin match is complete.</p>`;
      return `<section class="event-admin-tools event-page-admin" aria-label="Organizer competition controls"><div class="event-page-admin-head"><div><span class="event-hub-kicker"><i data-lucide="settings-2"></i> ORGANIZER TOOLS</span><h3>Competition controls</h3><p>Manage standings and prepare or seed playoffs without leaving this page.</p></div><span class="event-page-admin-role">${esc(Auth.highestRole().replaceAll('_',' '))}</span></div>${READ_ONLY_PREVIEW?'<p class="team-empty event-page-admin-readonly" id="eventCompetitionReadonlyNotice" role="note">Playoff draft and publish actions are turned off here because this local preview is connected to production data. Use an isolated staging environment to try those changes safely.</p>':''}${rrStage?`<details class="event-page-admin-section"><summary>Edit ${esc(rrStage.name)} standings <span>${registrations.length} teams · edits recalculate qualification</span></summary><p class="team-empty">Manual standings are saved independently from match results and persist after refresh. Played must equal wins + draws + losses.</p><div class="event-standings-scroll">${inputs}</div></details>`:''}${t.format==='round_robin_playoffs'?`<details class="event-page-admin-section" open><summary>Playoff setup <span>${playoffStage?.status==='published'?'Published':playoffStage?.status==='draft'?'Draft ready':READ_ONLY_PREVIEW&&canPrepare?'Preview only':canPrepare?'Ready to prepare':'Waiting for stage start'}</span></summary>${playoff}</details>`:''}<div id="competitionAdminStatus" class="event-page-admin-status" role="status" aria-live="polite"></div></section>`;
    };
    const bindCompetitionAdminActions=()=>{
      const root=$('#eventBrackets');if(!root||!canManageEvent)return;
      const notice=(message,error=false,busy=false)=>{const node=$('#competitionAdminStatus');if(node){node.textContent=message;node.dataset.state=error?'error':'success';node.setAttribute('aria-busy',String(busy));}};
      root.onclick=async event=>{
        const button=event.target.closest('[data-competition-action]');if(!button||!root.contains(button))return;
        const action=button.dataset.competitionAction;button.disabled=true;button.setAttribute('aria-busy','true');notice(action==='prepare-playoffs'?'Preparing playoff draft from the latest standings…':action==='publish-playoffs'?'Publishing the seeded playoff bracket…':'Saving competition changes…',false,true);
        try{
          if(READ_ONLY_PREVIEW&&['save-standing','reset-standing','prepare-playoffs','publish-playoffs'].includes(action))throw new Error('This browser preview is connected to production with changes disabled. Open the configured staging app to save tournament changes.');
          let result;
          if(action==='save-standing'||action==='reset-standing'){
            const form=button.closest('[data-page-standing]');const values=Object.fromEntries(new FormData(form).entries());
            result=action==='save-standing'
              ?await SUPA.client.rpc('set_tournament_standing',{p_stage_id:form.dataset.stage,p_registration_id:form.dataset.registration,p_played:Number(values.played),p_wins:Number(values.wins),p_draws:Number(values.draws),p_losses:Number(values.losses),p_points:Number(values.points),p_score_for:Number(values.score_for),p_score_against:Number(values.score_against)})
              :await SUPA.client.rpc('reset_tournament_standing',{p_stage_id:form.dataset.stage,p_registration_id:form.dataset.registration});
          }else if(action==='prepare-playoffs')result=await SUPA.client.rpc('prepare_playoff_stage',{p_tournament_id:t.id});
          else if(action==='seed-up'||action==='seed-down'){
            const order=playoffSeedOrders.get(t.id)||[],at=order.indexOf(button.dataset.registration),next=at+(action==='seed-up'?-1:1);
            if(at<0||next<0||next>=order.length)throw new Error('Seed order is out of date. Refresh from standings.');
            [order[at],order[next]]=[order[next],order[at]];playoffSeedOrders.set(t.id,order);
            root.innerHTML=renderEventBrackets();icons();bindCompetitionAdminActions();return;
          }else if(action==='publish-playoffs'){
            const order=playoffSeedOrders.get(t.id)||[];if(order.length<2)throw new Error('The seed list is incomplete. Refresh the draft first.');
            if(!window.confirm(`Publish the ${order.length}-team playoff bracket now? The round robin may continue.`)){button.disabled=false;button.removeAttribute('aria-busy');notice('Playoff publishing cancelled.');return;}
            result=await SUPA.client.rpc('publish_playoff_stage',{p_tournament_id:t.id,p_seeded_registration_ids:order});
          }
          if(result?.error)throw result.error;
          notice(action==='save-standing'?'Standings saved.':action==='reset-standing'?'Standing restored from match results.':action==='publish-playoffs'?'Playoff bracket published.':'Playoff draft refreshed.');
          await refreshCompetitionAdminData();
        }catch(error){notice(error.message||'The action could not be completed.',true);button.disabled=false;button.removeAttribute('aria-busy');}
      };
    };
    const refreshCompetitionAdminData=async()=>{
      const [stageResult,regResult]=await Promise.all([
        SUPA.client.from('tournament_stages').select('id,name,format,status,stage_number').eq('tournament_id',t.id).order('stage_number'),
        SUPA.client.from('tournament_registrations').select('id,team_id,status').eq('tournament_id',t.id).in('status',['approved','checked_in']).order('created_at')
      ]);
      if(stageResult.error)throw stageResult.error;if(regResult.error)throw regResult.error;
      adminStages=stageResult.data||[];adminRegistrations=(regResult.data||[]).map(row=>({...row,team:teamMap.get(row.team_id)}));
      const rrIds=adminStages.filter(stage=>stage.format==='round_robin').map(stage=>stage.id);
      const {data:rows,error}=rrIds.length?await SUPA.client.from('tournament_standings').select('registration_id,played,wins,draws,losses,points,score_for,score_against,rank,stage_id').in('stage_id',rrIds).order('rank'):{data:[],error:null};
      if(error)throw error;stageStandings.clear();
      for(const stage of adminStages.filter(row=>row.format==='round_robin'))stageStandings.set(stage.id,(rows||[]).filter(row=>row.stage_id===stage.id));
      const publicStages=adminStages.filter(stage=>['published','in_progress','completed'].includes(stage.status));
      stages=publicStages;stageIds=stages.map(stage=>stage.id);
      const [publicRegistrations,matchResult]=await Promise.all([
        SUPA.client.rpc('list_public_tournament_registrations',{p_tournament_id:t.id}),
        stageIds.length?SUPA.client.from('tournament_matches').select('id,stage_id,round_number,position,bracket_side,home_registration_id,away_registration_id,winner_registration_id,home_expected,away_expected,home_score,away_score,status,scheduled_at,completed_at').in('stage_id',stageIds).order('round_number').order('position'):{data:[],error:null}
      ]);
      if(publicRegistrations.error)throw publicRegistrations.error;if(matchResult.error)throw matchResult.error;
      regs=publicRegistrations.data||[];for(const row of regs)regTeam.set(row.id,row.team_id);
      allMatches=matchResult.data||[];stageMatches.clear();for(const stage of stages)stageMatches.set(stage.id,allMatches.filter(row=>row.stage_id===stage.id));
      stageMarkup=stages.length?stages.map(stage=>stage.format==='round_robin'?roundRobinHtml(stage):eliminationHtml(stage)).join(''):'<p class="team-empty">The organizer has not published a bracket for this tournament yet.</p>';
      const bracket=$('#eventBrackets');if(bracket){bracket.innerHTML=renderEventBrackets();icons();bindCompetitionAdminActions();}
    };
    const overviewFacts=[['Event status',effectiveStatus.replaceAll('_',' ')],['Registration opens',date(t.registration_opens_at)],['Registration closes',date(t.registration_closes_at)],['Event starts',date(t.starts_at)],['Roster size',Number(t.roster_size)||'TBA']];
    const teamFill=capacity?Math.min(100,Math.round(count/capacity*100)):0;
    const overviewMarkup=`<div class="event-overview-grid">${overviewFacts.map(([label,value],index)=>`<div class="event-overview-fact"><small>${label}</small><b${index===0?` data-status="${esc(effectiveStatus)}"`:''}>${esc(value)}</b></div>`).join('')}<div class="event-overview-fact event-overview-capacity"><small>Approved teams</small><b>${count}${capacity?` of ${capacity}`:''}</b>${capacity?`<div class="event-overview-meter" role="progressbar" aria-label="Approved team slots filled" aria-valuemin="0" aria-valuemax="${capacity}" aria-valuenow="${Math.min(count,capacity)}"><span style="width:${teamFill}%"></span></div>`:''}</div></div>`;
    const pageHeading=(eyebrow,title,description)=>`<header class="event-page-title"><span>${eyebrow}</span><h2>${title}</h2><p>${description}</p></header>`;
    const overviewSection=`${pageHeading('EVENT DETAILS','Tournament overview','Key dates, registration status, and team capacity in one place.')}<article class="dcard event-card" id="eventOverview"><div class="dh"><i data-lucide="calendar-days"></i>Event overview</div><div class="db">${overviewMarkup}</div></article>`;
    const participantsSection=`<article class="dcard event-card" id="eventParticipants"><div class="dh"><i data-lucide="users"></i>Participating teams <span class="mono-r">${count}${capacity?` / ${capacity} SLOTS`:''}</span></div><div class="db">${regs.length?`<div class="event-participant-tools"><label class="event-participant-search"><i data-lucide="search" aria-hidden="true"></i><input id="participantSearch" type="search" placeholder="Find a team" autocomplete="off" aria-label="Search participating teams" aria-controls="participantList"></label><span id="participantSearchStatus" role="status" aria-live="polite">Showing all ${regs.length} teams</span></div>`:''}<ul class="team-invites" id="participantList">${participants}${regs.length?'<li class="team-empty participant-no-results" hidden><span>No teams match that search.</span><button class="event-participant-clear" id="clearParticipantSearch" type="button">Clear search</button></li>':''}</ul></div></article>`;
    const officialsSection=`<article class="dcard event-card" id="eventOfficials"><div class="dh"><i data-lucide="shield-check"></i>Referees &amp; match officials</div><div class="db">${refereeMarkup}</div></article>`;
    const rulesSection=`<article class="dcard event-card" id="eventRules"><div class="dh"><i data-lucide="book-open-check"></i>Rules &amp; eligibility</div><div class="db">${rules}</div></article>`;
    const prizesSection=`<article class="dcard event-card" id="eventPrizes"><div class="dh"><i data-lucide="award"></i>Prize schedule</div><div class="db"><ul class="team-invites">${prizes}</ul><p class="team-empty">Advertised prize pool: ${fmt(t.prize_pool)} ${esc(t.currency)}</p></div></article>`;
    const eventViewContent={
      live:renderEventHub(allMatches),
      overview:overviewSection,
      teams:`${pageHeading('EVENT ROSTER','Teams & officials','Meet the approved teams and see who is officiating the event.')}${participantsSection}${officialsSection}`,
      schedule:`${pageHeading('COMPETITION','Bracket & schedule','Follow the standings and browse the fixture list by round.')}<article class="dcard event-card" id="eventBrackets">${renderEventBrackets()}</article>`,
      rules:`${pageHeading('EVENT INFORMATION','Rules & prizes','Review eligibility requirements, match settings, and published awards.')}${rulesSection}${prizesSection}`
    };
    content.innerHTML=eventViewContent[activeView]||eventViewContent.live;
    const participantSearch=$('#participantSearch');
    if(participantSearch){
      const teamRows=$$('#participantList .event-participant'),noResults=$('#participantList .participant-no-results'),resultStatus=$('#participantSearchStatus');
      participantSearch.addEventListener('input',()=>{
        const query=participantSearch.value.trim().toLocaleLowerCase();let visible=0;
        for(const row of teamRows){const matches=row.dataset.teamSearch.includes(query);row.hidden=!matches;if(matches)visible++;}
        noResults.hidden=visible>0;resultStatus.textContent=query?`Showing ${visible} of ${teamRows.length} teams`:`Showing all ${teamRows.length} teams`;
      });
      $('#clearParticipantSearch')?.addEventListener('click',()=>{
        participantSearch.value='';participantSearch.dispatchEvent(new Event('input',{bubbles:true}));participantSearch.focus();
      });
    }

    let eventHubRefreshing=false;
    const bindEventHubActions=()=>{
      $('#printEventSheet')?.addEventListener('click',()=>{
        const ordered=[...allMatches].sort((a,b)=>{
          const aTime=a.scheduled_at?new Date(a.scheduled_at).getTime():Infinity,bTime=b.scheduled_at?new Date(b.scheduled_at).getTime():Infinity;
          return aTime-bTime||(stageFor(a.stage_id)?.stage_number||0)-(stageFor(b.stage_id)?.stage_number||0)||a.round_number-b.round_number||a.position-b.position;
        });
        const groups=new Map();
        for(const match of ordered){const key=match.scheduled_at?new Intl.DateTimeFormat(undefined,{weekday:'long',month:'long',day:'numeric',year:'numeric'}).format(new Date(match.scheduled_at)):'Time to be announced';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(match);}
        const matchRows=matches=>matches.map(match=>{
          const home=teamFor(match.home_registration_id),away=teamFor(match.away_registration_id);
          const score=match.status==='forfeit'?'Forfeit':`${match.home_score??'—'} : ${match.away_score??'—'}`;
          const kickoff=match.scheduled_at?new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit'}).format(new Date(match.scheduled_at)):'TBA';
          return `<tr><td>${esc(kickoff)}</td><td>${esc(matchLabel(match))}</td><td><b>${esc(home?.name||'TBD')} <i>vs</i> ${esc(away?.name||'TBD')}</b><small>${esc(score)}</small></td><td>${esc(match.status.replaceAll('_',' '))}</td><td class="sheet-notes"></td></tr>`;
        }).join('');
        const sheet=document.createElement('section');sheet.id='eventPrintSheet';sheet.innerHTML=`<header><div class="sheet-brand">TUNESF <span>TOURNAMENT MATCH SHEET</span></div><h1>${esc(t.name)}</h1><p>${esc(GAMES[t.game]?.label||t.game||'Esports')} · ${esc(t.region||'Region not specified')} · Printed ${esc(new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date()))}</p></header>${[...groups].map(([day,matches])=>`<section class="sheet-day"><h2>${esc(day)}</h2><table><thead><tr><th>TIME</th><th>ROUND</th><th>MATCH / SCORE</th><th>STATUS</th><th>NOTES</th></tr></thead><tbody>${matchRows(matches)}</tbody></table></section>`).join('')||'<p>No matches have been published yet.</p>'}<footer>Official event schedule · Times shown in your local timezone · TUNESF</footer>`;
        content.append(sheet);document.body.dataset.printingEvent='true';
        const cleanup=()=>{delete document.body.dataset.printingEvent;sheet.remove();};
        window.addEventListener('afterprint',cleanup,{once:true});
        requestAnimationFrame(()=>window.print());
      });
      $('[data-download-event-calendar]')?.addEventListener('click',()=>{
        const matches=allMatches.filter(match=>['pending','ready'].includes(match.status)&&match.scheduled_at&&new Date(match.scheduled_at).getTime()>Date.now()&&match.home_registration_id&&match.away_registration_id);
        if(!matches.length){toast('err','No scheduled fixtures','A calendar is available once match start times are published.');return;}
        const toUtc=value=>new Date(value).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
        const escapeIcs=value=>String(value??'').replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/([,;])/g,'\\$1');
        const stamp=toUtc(new Date());
        const events=matches.map(match=>{
          const home=teamFor(match.home_registration_id),away=teamFor(match.away_registration_id);
          const summary=`${home?.name||'TBD'} vs ${away?.name||'TBD'} · ${t.name}`;
          const details=[matchLabel(match),GAMES[t.game]?.label||t.game,'Follow the event: '+location.href].filter(Boolean).join('\n');
          return ['BEGIN:VEVENT',`UID:${match.id}@tunesf.tn`,`DTSTAMP:${stamp}`,`DTSTART:${toUtc(match.scheduled_at)}`,`SUMMARY:${escapeIcs(summary)}`,`DESCRIPTION:${escapeIcs(details)}`,`LOCATION:${escapeIcs(t.region||'')}`,'END:VEVENT'].join('\r\n');
        });
        const ics=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//TUNESF//Tournament Schedule//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH',...events,'END:VCALENDAR'].join('\r\n');
        const blob=new Blob([ics],{type:'text/calendar;charset=utf-8'}),url=URL.createObjectURL(blob),download=document.createElement('a');
        const slug=String(t.name).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'tournament';
        download.href=url;download.download=`${slug}-schedule.ics`;document.body.append(download);download.click();download.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);
        toast('ok','Event calendar downloaded',`${matches.length} scheduled ${matches.length===1?'fixture':'fixtures'} included. Unscheduled fixtures were skipped.`);
      });
      $('#eventLiveHub [data-event-filter]')?.closest('.event-hub-filters')?.addEventListener('click',event=>{
        const button=event.target.closest('[data-event-filter]');if(!button)return;
        const filter=button.dataset.eventFilter,hub=$('#eventLiveHub');if(!hub)return;
        hub.dataset.activeFilter=filter;
        hub.querySelectorAll('[data-event-filter]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));
        hub.querySelectorAll('[data-event-match-section]').forEach(section=>{section.hidden=filter!=='all'&&section.dataset.eventMatchSection!==filter;});
        const status=$('#eventFilterStatus');if(status){
          const count=Number(button.querySelector('b')?.textContent)||0;
          const label=filter==='live'?'live or review':filter==='upcoming'?'upcoming':filter==='results'?'completed result':'';
          const noun=filter==='results'?(count===1?'completed result':'completed results'):`${label} ${count===1?'match':'matches'}`;
          status.textContent=filter==='all'?'Showing all match updates':count===0?`No ${label} matches right now`:`Showing ${count} ${noun}`;
        }
      });
      $$('[data-event-show-more]').forEach(button=>button.addEventListener('click',()=>{
        const kind=button.dataset.eventShowMore,container=kind==='upcoming'?'#eventUpcomingMatches':'#eventRecentResults';
        const hiddenCards=$$(`${container} .event-hub-match[hidden]`);if(!hiddenCards.length)return;
        hiddenCards.forEach(card=>{card.hidden=false;});
        const total=$$(`${container} .event-hub-match`).length;
        const label=kind==='upcoming'?'upcoming matches':'results';
        button.remove();
        const status=$('#eventFilterStatus');if(status)status.textContent=`Showing all ${total} ${label}`;
      }));
      $('#shareEventHub')?.addEventListener('click',async()=>{
        try{
          if(navigator.share)await navigator.share({title:t.name,text:`Follow ${t.name} on TUNESF`,url:location.href});
          else {await navigator.clipboard.writeText(location.href);toast('ok','Event link copied','Share this page with players and spectators.');}
        }catch(error){if(error.name!=='AbortError')toast('err','Could not share event','Copy the page address to share it.');}
      });
      $('#refreshEventHub')?.addEventListener('click',()=>refreshEventHubData());
    };
    const makeResultCard=async match=>{
      if(document.fonts?.ready)await document.fonts.ready;
      const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=630;
      const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Image creation is unavailable in this browser.');
      const home=teamFor(match.home_registration_id),away=teamFor(match.away_registration_id);
      const homeName=home?.name||'Team unavailable',awayName=away?.name||'Team unavailable';
      const homeTag=home?.tag||'',awayTag=away?.tag||'';
      const initials=name=>String(name).trim().split(/\s+/).slice(0,2).map(part=>part[0]||'').join('').toUpperCase()||'?';
      const ellipsis=(text,maxWidth,font)=>{ctx.font=font;let value=String(text||'');while(value.length&&ctx.measureText(value).width>maxWidth)value=value.slice(0,-1);return value===text?value:`${value.trimEnd()}…`;};
      const fillFit=(text,x,y,maxWidth,size,color,align='left')=>{let fontSize=size;let font=`700 ${fontSize}px "Chakra Petch",sans-serif`;while(fontSize>18&&(()=>{ctx.font=font;return ctx.measureText(text).width>maxWidth})()){fontSize-=2;font=`700 ${fontSize}px "Chakra Petch",sans-serif`;}ctx.font=font;ctx.fillStyle=color;ctx.textAlign=align;ctx.fillText(ellipsis(text,maxWidth,font),x,y);};
      const background=ctx.createLinearGradient(0,0,1200,630);background.addColorStop(0,'#121720');background.addColorStop(.56,'#0b0e14');background.addColorStop(1,'#15120a');ctx.fillStyle=background;ctx.fillRect(0,0,1200,630);
      ctx.fillStyle='rgba(245,180,0,.055)';ctx.beginPath();ctx.arc(1100,40,310,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle='rgba(220,228,240,.055)';ctx.lineWidth=1;for(let x=0;x<1200;x+=28){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,630);ctx.stroke();}
      ctx.fillStyle='#f5b400';ctx.fillRect(0,0,10,630);ctx.fillRect(58,68,42,42);ctx.fillStyle='#0b0e14';ctx.font='700 16px "Chakra Petch",sans-serif';ctx.textAlign='center';ctx.fillText('T',79,96);
      ctx.textAlign='left';ctx.fillStyle='#f4f6fa';ctx.font='700 25px "Chakra Petch",sans-serif';ctx.fillText('TUNESF',116,87);ctx.fillStyle='#8993a2';ctx.font='500 10px "IBM Plex Mono",monospace';ctx.fillText('TUNISIAN ESPORTS FEDERATION',117,106);
      ctx.fillStyle='#39d98a';ctx.fillRect(980,72,160,34);ctx.fillStyle='#07120d';ctx.textAlign='center';ctx.font='600 11px "IBM Plex Mono",monospace';ctx.fillText(match.status==='forfeit'?'OFFICIAL · FORFEIT':'OFFICIAL RESULT',1060,93);
      const game=GAMES[t.game]?.label||t.game||'Esports';ctx.textAlign='left';ctx.fillStyle='#f5b400';ctx.font='600 11px "IBM Plex Mono",monospace';ctx.fillText(String(game).toUpperCase(),60,157);
      fillFit(t.name||'Tournament',60,197,1080,34,'#f4f6fa');
      const eventMatch=matchLabel(match).toUpperCase();ctx.fillStyle='#8993a2';ctx.font='500 11px "IBM Plex Mono",monospace';ctx.fillText(ellipsis(eventMatch,1080,'500 11px "IBM Plex Mono",monospace'),60,222);
      const centerY=365;
      for(const [name,x] of [[homeName,290],[awayName,910]]){ctx.beginPath();ctx.arc(x,centerY-27,47,0,Math.PI*2);ctx.fillStyle='rgba(245,180,0,.1)';ctx.fill();ctx.strokeStyle='rgba(245,180,0,.45)';ctx.lineWidth=2;ctx.stroke();ctx.fillStyle='#f5b400';ctx.font='700 24px "Chakra Petch",sans-serif';ctx.textAlign='center';ctx.fillText(initials(name),x,centerY-19);}
      fillFit(homeName,290,centerY+57,360,31,'#f4f6fa','center');fillFit(awayName,910,centerY+57,360,31,'#f4f6fa','center');
      ctx.fillStyle='#8993a2';ctx.font='500 10px "IBM Plex Mono",monospace';ctx.textAlign='center';ctx.fillText(ellipsis(homeTag,280,'500 10px "IBM Plex Mono",monospace'),290,centerY+81);ctx.fillText(ellipsis(awayTag,280,'500 10px "IBM Plex Mono",monospace'),910,centerY+81);
      ctx.fillStyle='#f4f6fa';ctx.font='700 72px "IBM Plex Mono",monospace';ctx.textAlign='center';ctx.fillText(match.status==='forfeit'?'W/O':String(match.home_score??'—'),565,centerY+3);ctx.fillStyle='#f5b400';ctx.font='600 38px "IBM Plex Mono",monospace';ctx.fillText(match.status==='forfeit'?'':'—',600,centerY+1);ctx.fillStyle='#f4f6fa';ctx.font='700 72px "IBM Plex Mono",monospace';ctx.fillText(match.status==='forfeit'?'':String(match.away_score??'—'),635,centerY+3);
      ctx.fillStyle='#8993a2';ctx.font='600 9px "IBM Plex Mono",monospace';ctx.fillText(match.status==='forfeit'?'FORFEIT RESULT':String(t.best_of||'MATCH RESULT').toUpperCase(),600,centerY+31);
      ctx.strokeStyle='rgba(220,228,240,.16)';ctx.beginPath();ctx.moveTo(60,530);ctx.lineTo(1140,530);ctx.stroke();
      ctx.textAlign='left';ctx.fillStyle='#8993a2';ctx.font='500 10px "IBM Plex Mono",monospace';ctx.fillText(new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(match.completed_at||match.scheduled_at||Date.now())).toUpperCase(),60,560);
      ctx.textAlign='right';ctx.fillStyle='#f5b400';ctx.font='600 10px "IBM Plex Mono",monospace';ctx.fillText('FAIR PLAY · VERIFIED RESULTS · TUNESF.TN',1140,560);
      return await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('The result card could not be generated.')),'image/png'));
    };
    const makeStandingsCard=async stageId=>{
      if(document.fonts?.ready)await document.fonts.ready;
      const stage=stageFor(stageId),rows=(stageStandings.get(stageId)||[]).slice(0,10);
      if(!stage||!rows.length)throw new Error('No standings have been published for this stage yet.');
      const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=310+rows.length*54;
      const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Image creation is unavailable in this browser.');
      const background=ctx.createLinearGradient(0,0,1200,canvas.height);background.addColorStop(0,'#121720');background.addColorStop(.55,'#0b0e14');background.addColorStop(1,'#15120a');ctx.fillStyle=background;ctx.fillRect(0,0,1200,canvas.height);
      ctx.fillStyle='rgba(245,180,0,.06)';ctx.beginPath();ctx.arc(1130,24,300,0,Math.PI*2);ctx.fill();ctx.fillStyle='#f5b400';ctx.fillRect(0,0,9,canvas.height);
      ctx.fillStyle='#f5b400';ctx.fillRect(56,50,42,42);ctx.fillStyle='#0b0e14';ctx.font='700 16px "Chakra Petch",sans-serif';ctx.textAlign='center';ctx.fillText('T',77,78);
      ctx.textAlign='left';ctx.fillStyle='#f4f6fa';ctx.font='700 24px "Chakra Petch",sans-serif';ctx.fillText('TUNESF',114,70);ctx.fillStyle='#8993a2';ctx.font='500 9px "IBM Plex Mono",monospace';ctx.fillText('TUNISIAN ESPORTS FEDERATION',115,87);
      ctx.textAlign='right';ctx.fillStyle='#39d98a';ctx.font='600 10px "IBM Plex Mono",monospace';ctx.fillText('PUBLISHED STANDINGS',1140,70);
      const writeFit=(text,x,y,width,size,color,align='left')=>{let fontSize=size;ctx.textAlign=align;ctx.fillStyle=color;do{ctx.font=`700 ${fontSize}px "Chakra Petch",sans-serif`;if(ctx.measureText(text).width<=width||fontSize<=16)break;fontSize-=2;}while(fontSize>16);let value=String(text);while(value.length&&ctx.measureText(value).width>width)value=value.slice(0,-1);ctx.fillText(value===text?value:`${value.trimEnd()}…`,x,y);};
      writeFit(t.name||'Tournament',56,142,1080,30,'#f4f6fa');
      ctx.textAlign='left';ctx.fillStyle='#f5b400';ctx.font='600 11px "IBM Plex Mono",monospace';ctx.fillText(String(stage.name).toUpperCase(),57,168);
      ctx.fillStyle='#8993a2';ctx.textAlign='right';ctx.font='500 9px "IBM Plex Mono",monospace';ctx.fillText(`${GAMES[t.game]?.label||t.game||'ESPORTS'} · UPDATED ${new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date()).toUpperCase()}`,1140,168);
      const top=205;ctx.fillStyle='rgba(245,180,0,.13)';ctx.fillRect(56,top,1088,35);ctx.font='600 9px "IBM Plex Mono",monospace';ctx.fillStyle='#f5b400';
      for(const [label,x,align] of [['#',82,'center'],['TEAM',132,'left'],['W–D–L',810,'center'],['DIFF',962,'center'],['PTS',1095,'center']]){ctx.textAlign=align;ctx.fillText(label,x,top+22);}
      rows.forEach((row,index)=>{
        const y=top+35+index*54;ctx.fillStyle=index%2?'rgba(255,255,255,.025)':'rgba(255,255,255,.055)';ctx.fillRect(56,y,1088,54);
        ctx.fillStyle=row.rank===1?'#f5b400':'#aeb7c4';ctx.textAlign='center';ctx.font='700 15px "IBM Plex Mono",monospace';ctx.fillText(String(row.rank),82,y+32);
        const team=teamFor(row.registration_id);writeFit(team?.name||'Team unavailable',132,y+31,590,17,'#f4f6fa');
        ctx.font='600 11px "IBM Plex Mono",monospace';ctx.textAlign='center';ctx.fillStyle='#c6ccd5';ctx.fillText(`${row.wins}–${row.draws}–${row.losses}`,810,y+31);
        const diff=row.score_for-row.score_against;ctx.fillStyle=diff>0?'#39d98a':diff<0?'#ff727f':'#8993a2';ctx.fillText(`${diff>0?'+':''}${diff}`,962,y+31);
        ctx.fillStyle='#f5b400';ctx.font='700 14px "IBM Plex Mono",monospace';ctx.fillText(String(row.points),1095,y+31);
        ctx.strokeStyle='rgba(220,228,240,.08)';ctx.beginPath();ctx.moveTo(56,y+54);ctx.lineTo(1144,y+54);ctx.stroke();
      });
      const footerY=top+35+rows.length*54+25;ctx.textAlign='left';ctx.fillStyle='#8993a2';ctx.font='500 9px "IBM Plex Mono",monospace';ctx.fillText(rows.length<(stageStandings.get(stageId)||[]).length?'TOP 10 · VIEW THE EVENT PAGE FOR THE FULL TABLE':'OFFICIAL STAGE TABLE · FAIR PLAY · TUNESF.TN',58,footerY);
      return await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('The standings card could not be generated.')),'image/png'));
    };
    const renderTeamSpotlight=registrationId=>{
      const standingsStageId=stages.find(stage=>stage.format==='round_robin')?.id;
      const standing=(stageStandings.get(standingsStageId)||[]).find(row=>row.registration_id===registrationId);
      const team=teamFor(registrationId);
      const teamMatches=allMatches.filter(match=>match.home_registration_id===registrationId||match.away_registration_id===registrationId);
      const next=teamMatches.filter(match=>['pending','ready'].includes(match.status)).sort((a,b)=>(a.scheduled_at?new Date(a.scheduled_at).getTime():Infinity)-(b.scheduled_at?new Date(b.scheduled_at).getTime():Infinity))[0];
      const last=teamMatches.filter(match=>['completed','forfeit'].includes(match.status)).sort((a,b)=>new Date(b.completed_at||b.scheduled_at||0)-new Date(a.completed_at||a.scheduled_at||0))[0];
      const fixture=match=>{const home=teamFor(match.home_registration_id),away=teamFor(match.away_registration_id);return `<div class="event-team-fixture"><span>${esc(home?.name||'TBD')} <i>vs</i> ${esc(away?.name||'TBD')}</span><b>${match.status==='forfeit'?'Forfeit':`${match.home_score??'—'} : ${match.away_score??'—'}`}</b><small>${esc(matchLabel(match))} · ${esc(match.scheduled_at?date(match.scheduled_at):match.completed_at?date(match.completed_at):match.status.replaceAll('_',' '))}</small></div>`;};
      return `<div class="event-team-spotlight-head"><span>${identityImage(team?.logo_path,team?.name||'Team',28,'team')}<b>${esc(team?.name||'Team unavailable')}</b></span>${team?`<a href="team.html?id=${encodeURIComponent(team.id)}">Team profile <i data-lucide="arrow-up-right"></i></a>`:''}</div>${standing?`<div class="event-team-record"><span><b>${standing.played}</b><small>PLAYED</small></span><span><b>${standing.wins}–${standing.draws}–${standing.losses}</b><small>W–D–L</small></span><span><b>${standing.points}</b><small>POINTS</small></span></div>`:''}<div class="event-team-fixtures">${next?`<section><small>UP NEXT</small>${fixture(next)}</section>`:'<p>No upcoming fixtures for this team.</p>'}${last?`<section><small>LAST RESULT</small>${fixture(last)}</section>`:''}</div>`;
    };
    content.addEventListener('click',async event=>{
      const competitionTab=event.target.closest('[data-competition-view]');
      if(competitionTab){
        const view=competitionTab.dataset.competitionView;
        content.querySelectorAll('[data-competition-view]').forEach(tab=>{const active=tab===competitionTab;tab.classList.toggle('active',active);tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;});
        content.querySelector('#competitionRegular').hidden=view!=='regular';content.querySelector('#competitionPlayoffs').hidden=view!=='playoffs';return;
      }
      const roundTab=event.target.closest('[data-rr-round]');
      if(roundTab){
        const stage=roundTab.dataset.rrRound,index=roundTab.dataset.roundIndex,container=roundTab.closest('.rr-schedule-card');
        container.querySelectorAll('[data-rr-round]').forEach(tab=>{const active=tab===roundTab;tab.classList.toggle('active',active);tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;});
        container.querySelectorAll('.rr-round-panel').forEach((panel,panelIndex)=>panel.hidden=String(panelIndex)!==index);return;
      }
      const standingsButton=event.target.closest('[data-share-standings]');
      if(standingsButton){
        const stage=stageFor(standingsButton.dataset.shareStandings);standingsButton.disabled=true;standingsButton.setAttribute('aria-busy','true');
        try{
          const blob=await makeStandingsCard(standingsButton.dataset.shareStandings);
          const slug=String(t.name).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'tournament';
          const file=new File([blob],`tunesf-${slug}-standings.png`,{type:'image/png'});
          if(navigator.share&&navigator.canShare?.({files:[file]}))await navigator.share({files:[file],title:`${t.name} · ${stage?.name||'Standings'}`,text:`Current published standings for ${t.name}`});
          else {const url=URL.createObjectURL(blob),download=document.createElement('a');download.href=url;download.download=file.name;document.body.append(download);download.click();download.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);toast('ok','Standings image downloaded','It is ready to share with teams and spectators.');}
        }catch(error){if(error.name!=='AbortError')toast('err','Could not create standings image',error.message||'Please try again.');}
        finally{standingsButton.disabled=false;standingsButton.removeAttribute('aria-busy');}
        return;
      }
      const calendarButton=event.target.closest('[data-add-calendar]');
      if(calendarButton){
        const match=allMatches.find(row=>row.id===calendarButton.dataset.addCalendar);
        if(!match?.scheduled_at||new Date(match.scheduled_at).getTime()<=Date.now())return;
        const home=teamFor(match.home_registration_id),away=teamFor(match.away_registration_id);
        const toUtc=value=>new Date(value).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
        const escapeIcs=value=>String(value??'').replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/([,;])/g,'\\$1');
        const summary=`${home?.name||'TBD'} vs ${away?.name||'TBD'} · ${t.name}`;
        const details=[matchLabel(match),GAMES[t.game]?.label||t.game,'Follow the event: '+location.href].filter(Boolean).join('\n');
        const ics=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//TUNESF//Tournament Match//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH','BEGIN:VEVENT',`UID:${match.id}@tunesf.tn`,`DTSTAMP:${toUtc(new Date())}`,`DTSTART:${toUtc(match.scheduled_at)}`,`SUMMARY:${escapeIcs(summary)}`,`DESCRIPTION:${escapeIcs(details)}`,`LOCATION:${escapeIcs(t.region||'')}`,'END:VEVENT','END:VCALENDAR'].join('\r\n');
        const blob=new Blob([ics],{type:'text/calendar;charset=utf-8'}),url=URL.createObjectURL(blob),download=document.createElement('a');
        const slug=String(t.name).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'tournament';
        download.href=url;download.download=`${slug}-round-${match.round_number}-match-${match.position}.ics`;document.body.append(download);download.click();download.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);
        toast('ok','Calendar event saved','The match time is converted to your calendar’s local time.');return;
      }
      const teamButton=event.target.closest('[data-team-spotlight]');
      if(teamButton){
        content.querySelectorAll('[data-team-spotlight]').forEach(button=>button.setAttribute('aria-expanded',String(button===teamButton)));
        const panel=$('#eventTeamSpotlight');if(panel)panel.innerHTML=renderTeamSpotlight(teamButton.dataset.teamSpotlight);
        icons();return;
      }
      const button=event.target.closest('[data-share-result]');if(!button)return;
      const match=allMatches.find(row=>row.id===button.dataset.shareResult);if(!match||!['completed','forfeit'].includes(match.status))return;
      button.disabled=true;button.setAttribute('aria-busy','true');
      try{
        const blob=await makeResultCard(match),fileName=`tunesf-${String(t.name).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')}-round-${match.round_number}-match-${match.position}.png`;
        const file=new File([blob],fileName,{type:'image/png'});
        if(navigator.share&&navigator.canShare?.({files:[file]}))await navigator.share({files:[file],title:`${t.name} · ${teamFor(match.home_registration_id)?.name||'Team'} ${match.home_score??'—'}–${match.away_score??'—'} ${teamFor(match.away_registration_id)?.name||'Team'}`,text:`Official result from ${t.name}`});
        else {const url=URL.createObjectURL(blob),download=document.createElement('a');download.href=url;download.download=fileName;download.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('ok','Result card downloaded','You can now post it to your team or event channels.');}
      }catch(error){if(error.name!=='AbortError')toast('err','Could not create result card',error.message||'Please try again.');}
      finally{button.disabled=false;button.removeAttribute('aria-busy');}
    });
    content.addEventListener('keydown',event=>{
      const tab=event.target.closest('[data-competition-view],[data-rr-round]');if(!tab)return;
      const list=tab.closest('[role="tablist"]');if(!list)return;
      const tabs=[...list.querySelectorAll('[role="tab"]')];if(tabs.length<2)return;
      let index=tabs.indexOf(tab),next=index;
      if(event.key==='ArrowRight')next=(index+1)%tabs.length;
      else if(event.key==='ArrowLeft')next=(index-1+tabs.length)%tabs.length;
      else if(event.key==='Home')next=0;
      else if(event.key==='End')next=tabs.length-1;
      else return;
      event.preventDefault();tabs[next].focus();tabs[next].click();
    });
    const refreshEventHubData=async()=>{
      if(activeView!=='live'||eventHubRefreshing||document.hidden)return;
      eventHubRefreshing=true;
      const button=$('#refreshEventHub');if(button){button.disabled=true;button.setAttribute('aria-busy','true');}
      try{
        const oldStageSignature=JSON.stringify(stages.map(stage=>[stage.id,stage.name,stage.format,stage.status,stage.stage_number]));
        const {data:latestStages,error:stageError}=await SUPA.client.from('tournament_stages').select('id,name,format,status,stage_number').eq('tournament_id',t.id).in('status',['published','in_progress','completed']).order('stage_number');
        if(stageError)throw stageError;
        stages=latestStages||[];stageIds=stages.map(stage=>stage.id);
        const {data,error}=stageIds.length?await SUPA.client.from('tournament_matches').select('id,stage_id,round_number,position,bracket_side,home_registration_id,away_registration_id,winner_registration_id,home_expected,away_expected,home_score,away_score,status,scheduled_at,completed_at').in('stage_id',stageIds).order('round_number').order('position'):{data:[],error:null};
        if(error)throw error;
        const nextMatches=data||[];
        const signature=rows=>JSON.stringify(rows.map(match=>[match.id,match.home_registration_id,match.away_registration_id,match.winner_registration_id,match.home_score,match.away_score,match.status,match.scheduled_at,match.completed_at]));
        const changed=oldStageSignature!==JSON.stringify(stages.map(stage=>[stage.id,stage.name,stage.format,stage.status,stage.stage_number]))||signature(nextMatches)!==signature(allMatches);
        if(changed){
          const freshStandings=await Promise.all(stages.filter(stage=>stage.format==='round_robin').map(async stage=>{
            const {data:rows,error:standingsError}=await SUPA.client.from('tournament_standings').select('registration_id,played,wins,draws,losses,points,score_for,score_against,rank').eq('stage_id',stage.id).order('rank');
            if(standingsError)throw standingsError;return [stage.id,rows||[]];
          }));
          allMatches=nextMatches;
          stageMatches.clear();
          for(const stage of stages)stageMatches.set(stage.id,allMatches.filter(match=>match.stage_id===stage.id));
          stageStandings.clear();for(const [stageId,rows] of freshStandings)stageStandings.set(stageId,rows);
          stageMarkup=stages.length?stages.map(stage=>stage.format==='round_robin'?roundRobinHtml(stage):eliminationHtml(stage)).join(''):'<p class="team-empty">The organizer has not published a bracket for this tournament yet.</p>';
          $('#eventLiveHub').outerHTML=renderEventHub(allMatches);
          const bracketContainer=$('#eventBrackets');if(bracketContainer)bracketContainer.innerHTML=renderEventBrackets();
          icons();bindEventHubActions();
        }
        const updated=$('#eventHubUpdated');if(updated)updated.textContent=`Updated ${new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit'}).format(new Date())}`;
      }catch(error){
        console.warn('Public event updates could not be refreshed:',error);
        const updated=$('#eventHubUpdated');if(updated)updated.textContent='Update unavailable · showing last data';
      }finally{
        eventHubRefreshing=false;
        const currentButton=$('#refreshEventHub');if(currentButton){currentButton.disabled=false;currentButton.removeAttribute('aria-busy');}
      }
    };
    const updateNextMatchCountdown=()=>{
      const countdown=$('#eventLiveHub [data-countdown]');if(!countdown)return;
      const startsAt=new Date(countdown.dataset.countdown).getTime();if(!Number.isFinite(startsAt))return;
      const remaining=startsAt-Date.now();
      if(remaining<=0){countdown.textContent='Scheduled time passed';countdown.dataset.state='passed';return;}
      const totalMinutes=Math.ceil(remaining/60000),days=Math.floor(totalMinutes/1440),hours=Math.floor(totalMinutes%1440/60),minutes=totalMinutes%60;
      countdown.textContent=days?`${days}d ${String(hours).padStart(2,'0')}h`:`${hours}h ${String(minutes).padStart(2,'0')}m`;
      countdown.dataset.state=remaining<3600000?'soon':'upcoming';
    };
    bindEventHubActions();
    updateNextMatchCountdown();
    setInterval(updateNextMatchCountdown,30000);
    setInterval(()=>{if(!document.hidden)refreshEventHubData();},30000);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshEventHubData();});

    $('#eventRegister')?.addEventListener('click',async event=>{
      if(READ_ONLY_PREVIEW)return;
      const button=event.currentTarget;button.disabled=true;
      try{
        if(!Auth.is()){location.href=`login.html?next=${encodeURIComponent(`tournament.html?id=${t.id}`)}&need=PLAYER`;return;}
        const {data:members,error:memberError}=await SUPA.client.from('team_members').select('team_id').eq('user_id',Auth.user.id).eq('role','captain').eq('status','active');
        if(memberError)throw memberError;
        const ids=[...new Set((members||[]).map(m=>m.team_id))];
        if(!ids.length)throw new Error('An active team captain is required to register.');
        const {data:eligible,error:teamError}=await SUPA.client.from('teams').select('id,name,tag').in('id',ids).eq('game',t.game);
        if(teamError)throw teamError;if(!eligible?.length)throw new Error('Your captain teams must play this tournament’s game.');
        if(eligible.length>1){
          const wrap=$('#eventTeamWrap'),select=$('#eventTeam');
          if(wrap.hidden){select.innerHTML=eligible.map(team=>`<option value="${esc(team.id)}">${esc(team.name)} (${esc(team.tag)})</option>`).join('');wrap.hidden=false;button.textContent='Submit selected team';button.disabled=false;return;}
        }
        const team=eligible.length===1?eligible[0]:eligible.find(x=>x.id===$('#eventTeam').value);
        if(!team)throw new Error('Choose an eligible team before registering.');
        const {error}=await SUPA.client.rpc('register_team',{p_tournament_id:t.id,p_team_id:team.id});if(error)throw error;
        toast('ok','Registration submitted','The organizer will review this registration.');button.textContent='Registration submitted';
      }catch(error){toast('err','Could not register team',error.message||'Please try again.');button.disabled=false;}
    });
    const backToTop=$('#eventBackToTop');
    const syncBackToTop=()=>{if(backToTop)backToTop.hidden=!matchMedia('(max-width: 520px)').matches&&scrollY<500;};
    backToTop?.addEventListener('click',()=>scrollTo({top:0,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'}));
    addEventListener('scroll',syncBackToTop,{passive:true});
    syncBackToTop();
    icons();
    if(location.hash){
      requestAnimationFrame(()=>requestAnimationFrame(()=>{
        const target=document.getElementById(location.hash.slice(1));
        if(target&&content.contains(target))target.scrollIntoView({block:'start'});
      }));
    }
  }catch(error){fail(error.message||'Please try again.');}
})();

