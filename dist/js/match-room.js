/* Match room: participant-scoped rosters and persistent match chat. */
const host=$('#matchRoom'),matchId=new URLSearchParams(location.search).get('id');
const gameName=game=>GAMES[game]?.label||String(game||'Tournament').toUpperCase();
const roomError=message=>{host.innerHTML=`<article class="dcard room-error"><div class="dh"><i data-lucide="shield-alert"></i>Match room unavailable</div><div class="db"><p>${esc(message)}</p><a class="btn btn-line btn-sm" href="index.html">Return home</a></div></article>`;icons();};

Auth.ready.then(async()=>{
  if(!Auth.is()){location.replace(`login.html?next=${encodeURIComponent(`match-room.html?id=${matchId||''}`)}`);return;}
  if(!matchId){roomError('Open this room from a scheduled match.');return;}

  let room=null,chatBusy=false,lastMessageIds='',latestResultSignature='',latestReadinessSignature='',selectedStep=null,lastActiveStep=-1;
  const signatureFor=(match,reports,readiness)=>JSON.stringify({status:match.status,scheduled_at:match.scheduled_at,home_score:match.home_score,away_score:match.away_score,teams:(match.teams||[]).map(team=>[team.team_id,team.confirmed]),veto:match.veto||[],reports,readiness});
  const loadRoom=async()=>{
    const {data,error}=await SUPA.client.rpc('get_match_room',{p_match_id:matchId});
    if(error)throw error;
    room=data;
    const {data:readyRows,error:readyError}=await SUPA.client.rpc('get_match_readiness',{p_match_id:matchId});
    if(readyError)throw readyError;
    const readiness=readyRows||[];
    latestReadinessSignature=JSON.stringify(readiness.map(row=>[row.team_id,row.user_id]));
    const sides=room.teams||[];
    const home=sides.find(team=>team.side==='home'),away=sides.find(team=>team.side==='away');
    const label=String(room.status||'scheduled').replaceAll('_',' ');
    const ownsTeam=team=>team?.captain_id===Auth.user.id||(team?.roster||[]).some(member=>member.user_id===Auth.user.id);
    const mapPool=room.map_pool||[],vetoes=room.veto||[];
    const bestOf=Number(String(room.best_of||'').match(/\d+/)?.[0]||1);
    const bansRequired=Math.max(0,mapPool.length-bestOf),picksRequired=Math.max(0,bestOf-1);
    const bans=vetoes.filter(item=>item.action_type==='ban'),picks=vetoes.filter(item=>item.action_type==='pick').sort((a,b)=>a.map_number-b.map_number);
    const decider=vetoes.find(item=>item.action_type==='decider');
    const isValorant=room.game==='val';
    const openSidePick=isValorant&&picks.find(item=>!item.side_choice);
    const vetoComplete=!!decider&&(!isValorant||!!decider.side_choice);
    const bothConfirmed=!!home?.confirmed&&!!away?.confirmed;
    const readyIds=new Set(readiness.map(row=>`${row.team_id}:${row.user_id}`));
    const isReady=(team,member)=>readyIds.has(`${team?.team_id}:${member.user_id}`);
    const activeRoster=team=>(team?.roster||[]).filter(member=>member.role!=='substitute');
    const bothReady=[home,away].every(team=>team?.confirmed&&activeRoster(team).length>0&&activeRoster(team).every(member=>isReady(team,member)));
    const matchStarted=['live','paused','result_pending','disputed','completed','forfeit'].includes(room.status);
    const activeStep=!bothConfirmed?0:mapPool.length>=2&&!vetoComplete?1:!bothReady&&!matchStarted?2:3;
    if(selectedStep===null||activeStep!==lastActiveStep)selectedStep=activeStep;
    lastActiveStep=activeStep;
    const [matchResult,reportResult,evidenceResult]=await Promise.all([
      SUPA.client.from('tournament_matches').select('home_registration_id,away_registration_id').eq('id',matchId).single(),
      SUPA.client.from('match_result_submissions').select('id,registration_id,submitted_by,home_score,away_score,status,created_at').eq('match_id',matchId).order('created_at'),
      SUPA.client.from('match_evidence').select('id,submitted_by,object_key,mime_type,byte_size,created_at').eq('match_id',matchId).order('created_at')
    ]);
    if(matchResult.error)throw matchResult.error;if(reportResult.error)throw reportResult.error;if(evidenceResult.error)throw evidenceResult.error;
    const homeRegistration=matchResult.data.home_registration_id,awayRegistration=matchResult.data.away_registration_id;
    const reports=reportResult.data||[],evidence=evidenceResult.data||[];
    latestResultSignature=JSON.stringify(reports.map(row=>[row.id,row.status,row.home_score,row.away_score]));
    const reporterIds=[...new Set([...reports.map(row=>row.submitted_by),...evidence.map(row=>row.submitted_by)])];
    const {data:reporterProfiles,error:reporterError}=reporterIds.length
      ?await SUPA.client.from('public_profiles').select('id,username,player_name').in('id',reporterIds)
      :{data:[],error:null};
    if(reporterError)throw reporterError;
    const reporterNames=new Map((reporterProfiles||[]).map(profile=>[profile.id,profile.username||profile.player_name||'Player']));
    const evidenceFiles=await Promise.all(evidence.map(async row=>{
      const {data,error}=await SUPA.client.storage.from('match-evidence').createSignedUrl(row.object_key,120);
      return error?{...row,url:'',error:error.message}:{...row,url:data?.signedUrl||'',error:''};
    }));
    $('#roomTitle').textContent=room.tournament_name||'Match Room';
    $('#roomSubhead').textContent=`${room.stage_name||'Tournament'} · Round ${room.round_number} · Match ${room.position} · ${gameName(room.game)}`;
    const teamMarkup=team=>{
      if(!team?.team_id)return '<article class="room-roster-card"><p class="team-empty">Team not assigned</p></article>';
      const isCaptain=team.captain_id===Auth.user.id;
      const roster=team.roster||[];
      const members=roster.length?roster.map(member=>`<li><i data-lucide="check"></i><span>${esc(member.name||'Player')}${member.role==='captain'?' · Captain':member.role==='substitute'?' · Substitute':''}</span></li>`).join(''):'<li class="team-empty">No active players in this game roster.</li>';
      const status=team.confirmed?`Roster locked${team.confirmed_by_name?` · ${esc(team.confirmed_by_name)}`:''}`:isCaptain&&room.status==='ready'?'Awaiting your confirmation':'Awaiting captain confirmation';
      const action=team.confirmed?'':isCaptain&&room.status==='ready'?`<button class="btn btn-gold btn-sm room-confirm" type="button" data-confirm-roster="${esc(team.side)}"><i data-lucide="check"></i>Confirm roster</button>`:'';
      return `<article class="room-roster-card${team.confirmed?' is-confirmed':''}"><div class="room-roster-team"><span class="room-team-mark">${esc((team.tag||team.name||'T').slice(0,3).toUpperCase())}</span><b>${esc(team.name||'Team')}${isCaptain?' · You':''}</b></div><ul class="room-roster-list">${members}</ul><p class="room-roster-status">${status}</p>${action}</article>`;
    };
    const stepMarkup=['Roster',mapPool.length>=2?'Map veto':'No veto','Ready','Result'].map((name,index)=>`<button type="button" class="room-step${index===selectedStep?' active':''}${index===activeStep?' current':''}" data-room-step="${index}" aria-pressed="${index===selectedStep}"${index>activeStep||index===1&&mapPool.length<2?' disabled':''}><i>${index+1}</i>${name}</button>`).join('');
    const readyTeamMarkup=team=>{
      if(!team?.team_id)return '<article class="room-roster-card"><p class="team-empty">Team pending</p></article>';
      const members=activeRoster(team),confirmed=members.filter(member=>isReady(team,member));
      const isMe=members.some(member=>member.user_id===Auth.user.id);
      return `<article class="room-roster-card${members.length&&confirmed.length===members.length?' is-confirmed':''}"><div class="room-roster-team"><span class="room-team-mark">${esc((team.tag||team.name||'T').slice(0,3).toUpperCase())}</span><b>${esc(team.name||'Team')}</b></div><ul class="room-roster-list">${members.map(member=>`<li><i data-lucide="${isReady(team,member)?'check-circle':'circle'}"></i><span>${esc(member.name||'Player')}${member.user_id===Auth.user.id?' · You':''} · ${isReady(team,member)?'Ready':'Waiting'}</span></li>`).join('')||'<li class="team-empty">No active roster players.</li>'}</ul><p class="room-roster-status">${confirmed.length}/${members.length} players ready</p>${isMe&&!readyIds.has(`${team.team_id}:${Auth.user.id}`)&&room.status==='ready'?'<button class="btn btn-gold btn-sm room-confirm" type="button" data-confirm-ready>Confirm I am ready</button>':''}</article>`;
    };
    const readyMarkup=`<section class="room-ready"><h2 class="room-roster-heading">Player ready check</h2><p>Every active player on the locked rosters confirms readiness after the veto. The referee starts the match when both teams are ready.</p>${bothConfirmed&&(mapPool.length<2||vetoComplete)?`<div class="room-roster-grid">${readyTeamMarkup(home)}${readyTeamMarkup(away)}</div>`:'<p class="team-empty">Waiting for roster confirmation and map veto.</p>'}</section>`;
    const vetoMarkup=()=>{
      if(!bothConfirmed)return '';
      if(mapPool.length<2)return `<section class="room-veto"><h2 class="room-roster-heading">Map veto unavailable</h2><p class="room-veto-note">The tournament organizer needs to configure its map pool before teams can veto.</p></section>`;
      const homeFirst=home,awaySecond=away;
      const initialBans=isValorant&&[3,5].includes(bestOf)?Math.min(2,bansRequired):bansRequired;
      let action='',currentTeam=null,mapNumber=null,actionLabel='';
      if(bans.length<initialBans){action='ban';currentTeam=bans.length%2===0?homeFirst:awaySecond;actionLabel=`Ban ${bans.length+1} of ${bansRequired}`;}
      else if(openSidePick){action='side';currentTeam=openSidePick.team_id===home?.team_id?awaySecond:homeFirst;mapNumber=openSidePick.map_number;actionLabel=`Choose starting side · Map ${mapNumber}`;}
      else if(isValorant&&bestOf===3&&picks.length>=picksRequired&&bans.length<bansRequired){action='ban';currentTeam=(bans.length-initialBans)%2===0?homeFirst:awaySecond;actionLabel=`Ban ${bans.length+1} of ${bansRequired}`;}
      else if(picks.length<picksRequired){action='pick';currentTeam=picks.length%2===0?homeFirst:awaySecond;mapNumber=picks.length+1;actionLabel=`Pick Map ${mapNumber} of ${picksRequired}`;}
      else if(bans.length<bansRequired){action='ban';currentTeam=(isValorant&&bestOf===3?(bans.length-initialBans)%2:bans.length%2)===0?homeFirst:awaySecond;actionLabel=`Ban ${bans.length+1} of ${bansRequired}`;}
      else if(isValorant&&decider&&!decider.side_choice){action='decider_side';currentTeam=bestOf===3?homeFirst:awaySecond;mapNumber=bestOf;actionLabel=`Choose starting side · Map ${mapNumber}`;}
      const isYourTurn=currentTeam?.captain_id===Auth.user.id;
      const picked=new Map(picks.map(item=>[item.map_name,item]));
      const removed=new Map(vetoes.filter(item=>item.action_type==='ban').map(item=>[item.map_name,item]));
      const isAvailable=map=>!picked.has(map)&&!removed.has(map)&&(!decider||decider.map_name!==map);
      const turnText=action==='ban'?'ban a map':action==='pick'?`choose Map ${mapNumber}`:action==='side'?`choose the starting side for Map ${mapNumber}`:action==='decider_side'?`choose the starting side for Map ${mapNumber}`:'';
      const prompt=vetoComplete?'Veto complete · maps are locked in order.':!action?'Waiting for veto state…':isYourTurn?`Your turn · ${actionLabel} · choose below.`:`${currentTeam?.name||'The other team'} captain to ${turnText}.`;
      const orderCards=Array.from({length:bestOf},(_,index)=>{
        const mapNo=index+1,selection=picks.find(item=>Number(item.map_number)===mapNo)||(Number(decider?.map_number)===mapNo?decider:null);
        const team=selection?.action_type==='decider'?null:selection?.team_id===home?.team_id?home:away;
        const sideTeam=selection?.side_team_id===home?.team_id?home:selection?.side_team_id===away?.team_id?away:null;
        const state=selection?(selection.action_type==='decider'?'DECIDER · LAST MAP':`PICKED BY ${team?.team_id===home?.team_id?'TEAM A':'TEAM B'}`):'AWAITING PICK';
        const side=selection?.side_choice?`${sideTeam?.name||'Team'} chose ${selection.side_choice==='attack'?'attack':'defense'}`:selection&&isValorant?'Starting side pending':'';
        return `<article class="room-map-order${selection?' is-set':''}"><small>Map ${mapNo}</small><b>${esc(selection?.map_name||'To be decided')}</b><span>${esc(state)}</span>${side?`<em>${esc(side)}</em>`:''}</article>`;
      }).join('');
      const sideControls=(action==='side'||action==='decider_side')&&isYourTurn?`<div class="room-veto-sides"><button class="btn btn-line btn-sm" type="button" data-veto-action="${action}" data-veto-side="attack">Start Attack</button><button class="btn btn-line btn-sm" type="button" data-veto-action="${action}" data-veto-side="defense">Start Defense</button></div>`:'';
      const tiles=mapPool.map((map,index)=>{
        const ban=removed.get(map),pick=picked.get(map),isDecider=decider?.map_name===map;
        const eligible=(action==='ban'||action==='pick')&&isYourTurn&&!vetoComplete&&isAvailable(map);
        const state=ban?`Banned · action ${vetoes.findIndex(item=>item.map_name===map)+1}`:pick?`Map ${pick.map_number} · Team ${pick.team_id===home?.team_id?'A':'B'} pick`:isDecider?`Map ${decider.map_number} · decider`:eligible?(action==='ban'?'Click to ban':`Select for Map ${mapNumber}`):`Pool position ${index+1}`;
        return `<button type="button" class="room-veto-map${ban?' is-banned':''}${pick||isDecider?' is-picked':''}" data-veto-action="${action==='pick'?'pick':'ban'}" data-map-name="${esc(map)}" ${eligible?'':'disabled'}><b>${esc(map)}</b><small>${state}</small></button>`;
      }).join('');
      const timeline=vetoes.filter(item=>item.action_type!=='decider'||item.map_number).map((item,index)=>{
        const team=item.team_id===home?.team_id?'TEAM A':'TEAM B';
        const label=item.action_type==='ban'?`BAN ${bans.indexOf(item)+1}`:item.action_type==='pick'?`MAP ${item.map_number} PICK`:item.action_type==='decider'?`MAP ${item.map_number} · LAST MAP`:`STEP ${index+1}`;
        const side=item.side_choice?` · ${item.side_team_id===home?.team_id?'TEAM A':'TEAM B'} SIDE: ${item.side_choice.toUpperCase()}`:'';
        return `<li><small>${esc(label)}</small><b>${esc(item.map_name)}</b><span>${item.action_type==='decider'?'AUTO DECIDER':`BY ${team}`}${esc(side)}</span></li>`;
      }).join('');
      return `<section class="room-veto"><h2 class="room-roster-heading">${isValorant?'VALORANT MAP VETO':'MAP VETO'} · ${esc(room.best_of||`BO${bestOf}`)} · ${bansRequired} BANS · ${picksRequired} PICKS</h2><p class="room-veto-prompt${isYourTurn&&!vetoComplete?' is-your-turn':''}">${esc(prompt)}</p><div class="room-map-order-grid">${orderCards}</div>${sideControls}<h3 class="room-veto-subheading">Veto actions · in sequence</h3><ol class="room-veto-timeline">${timeline||'<li><span>Veto has not started.</span></li>'}</ol><h3 class="room-veto-subheading">Map pool · original order</h3><div class="room-veto-grid">${tiles}</div></section>`;
    };
    const myRegistration=ownsTeam(home)?homeRegistration:ownsTeam(away)?awayRegistration:null;
    const myReport=reports.filter(row=>row.registration_id===myRegistration&&['pending','accepted'].includes(row.status))
      .sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))[0];
    const reportRows=reports.map(row=>{
      const team=row.registration_id===homeRegistration?home:away;
      const opponentAgrees=reports.some(other=>other.registration_id!==row.registration_id&&other.status==='pending'&&other.home_score===row.home_score&&other.away_score===row.away_score);
      const state=row.status==='pending'?(opponentAgrees?'Awaiting referee review':'Awaiting opponent confirmation'):{accepted:'Confirmed',rejected:'Rejected'}[row.status]||row.status;
      return `<li class="event-reg"><span><b>${esc(team?.name||'Team')} · ${row.home_score}–${row.away_score}</b><small>Reported by ${esc(reporterNames.get(row.submitted_by)||'Player')} · ${esc(state)}</small></span></li>`;
    }).join('');
    const evidenceMarkup=evidenceFiles.map(row=>{
      const name=reporterNames.get(row.submitted_by)||'Player';
      const preview=row.url&&row.mime_type.startsWith('image/')?`<img src="${esc(row.url)}" alt="Match result screenshot uploaded by ${esc(name)}" loading="lazy">`:'';
      return `<a class="room-evidence-item" ${row.url?`href="${esc(row.url)}" target="_blank" rel="noopener noreferrer"`:'aria-disabled="true"'}>${preview}<span>${esc(name)} · ${esc(row.mime_type)} · ${fmt(row.byte_size)} bytes</span></a>`;
    }).join('');
    const preMatchComplete=bothConfirmed&&(mapPool.length<2||vetoComplete)&&(bothReady||matchStarted);
    const resultFormVisible=preMatchComplete&&['live','result_pending'].includes(room.status)&&myRegistration&&!myReport;
    const resultMessage=!preMatchComplete?'Result reporting opens after both rosters, map veto, and player ready checks are complete.'
      :room.status==='ready'?'Waiting for the referee to start the match before results can be submitted.'
      :myReport?.status==='pending'?'Your team’s score report is waiting for the opponent to confirm it before referee review.'
      :myReport?.status==='accepted'?'Your team’s score report has been confirmed.'
      :room.status==='disputed'?'An official is reviewing the score dispute.'
      :room.status==='completed'||room.status==='forfeit'?'This match result is closed.'
      :!myRegistration?'Only a player or captain on a participating team can report the result.'
      :!['live','result_pending'].includes(room.status)?'Result reporting is available while the match is live.':'You can report your team’s score below.';
    const resultMarkup=`<section class="room-result"><h2 class="room-roster-heading">Match result</h2><p class="room-result-note">A team captain or active team player can report the series score. Add a screenshot as evidence.</p>${reportRows?`<ul class="team-invites room-result-reports">${reportRows}</ul>`:''}${evidenceMarkup?`<div class="room-evidence-grid">${evidenceMarkup}</div>`:''}${resultFormVisible?`<form class="room-result-form" id="roomResultForm"><label>Home team wins<input name="home_score" type="number" min="0" max="${Math.ceil(bestOf/2)}" required></label><label>Away team wins<input name="away_score" type="number" min="0" max="${Math.ceil(bestOf/2)}" required></label><label class="room-result-upload"><span>Screenshot or evidence · up to 5 files, 20 MB each</span><input name="evidence" type="file" accept="image/jpeg,image/png,image/webp,video/mp4" multiple></label><small>Enter series wins. First to ${Math.ceil(bestOf/2)} wins takes the series. A referee reviews the report.</small><button class="btn btn-gold btn-sm" type="submit">Submit result</button></form>`:`<p class="team-empty room-result-state">${esc(resultMessage)}</p>`}${evidenceMarkup||reportRows?'':`<p class="team-empty room-result-state">No score reports or screenshots yet.</p>`}</section>`;
    host.innerHTML=`<section class="dcard room-main"><div class="dh"><i data-lucide="swords"></i><span>${esc(String(room.stage_name||'Match').toUpperCase())} · ROUND ${room.round_number} · MATCH ${room.position}</span><span class="bracket-stage-meta">${esc(label)}</span></div><div class="room-score"><div class="room-side"><span class="room-team-mark">${esc((home?.tag||home?.name||'T').slice(0,3).toUpperCase())}</span><span class="room-side-text"><b class="room-side-name">${esc(home?.name||'TBD')}</b><small class="room-side-tag">${ownsTeam(home)?'YOUR TEAM':'OPPONENT'} · ${esc(home?.tag||'')}</small></span></div><div class="room-score-center"><strong>${room.home_score??0}<span style="display:inline;color:var(--faint)"> : </span>${room.away_score??0}</strong><span>${room.scheduled_at?esc(new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(room.scheduled_at))):room.started_at?'Match started':'Time to be announced'}</span></div><div class="room-side room-side-away"><span class="room-side-text"><b class="room-side-name">${esc(away?.name||'TBD')}</b><small class="room-side-tag">${ownsTeam(away)?'YOUR TEAM':'OPPONENT'} · ${esc(away?.tag||'')}</small></span><span class="room-team-mark">${esc((away?.tag||away?.name||'T').slice(0,3).toUpperCase())}</span></div></div><div class="room-steps" aria-label="Match progress">${stepMarkup}</div><div class="room-rosters"><h2 class="room-roster-heading">Pre-match · Team roster confirmation</h2><div class="room-roster-grid">${teamMarkup(home)}${teamMarkup(away)}</div>${vetoMarkup()}${readyMarkup}${resultMarkup}</div></section><aside class="dcard room-chat"><div class="dh"><span><i data-lucide="radio"></i>Match chat</span><small class="room-chat-caption">MATCH PARTICIPANTS</small></div><div class="room-chat-messages" id="roomMessages" aria-live="polite"><p class="room-chat-empty">Loading match chat…</p></div><form class="room-chat-form" id="roomChatForm"><textarea id="roomChatInput" maxlength="1000" aria-label="Message the match room" placeholder="Message the room…" required></textarea><button type="submit" aria-label="Send message"><i data-lucide="send"></i></button></form><p class="room-chat-note">Messages are visible to this match’s teams, assigned referee, and event staff.</p></aside>`;
    const progress=host.querySelector('.room-steps'),body=host.querySelector('.room-rosters');
    const rosterPanel=document.createElement('section');
    rosterPanel.dataset.roomPanel='0';
    rosterPanel.append(body.querySelector(':scope > .room-roster-heading'),body.querySelector(':scope > .room-roster-grid'));
    body.prepend(rosterPanel);
    let vetoPanel=body.querySelector(':scope > .room-veto');
    if(!vetoPanel){vetoPanel=document.createElement('section');vetoPanel.className='room-veto';vetoPanel.innerHTML='<h2 class="room-roster-heading">Map veto</h2><p class="team-empty">Both captains must confirm their rosters first.</p>';body.append(vetoPanel);}
    vetoPanel.dataset.roomPanel='1';
    body.querySelector(':scope > .room-ready').dataset.roomPanel='2';
    body.querySelector(':scope > .room-result').dataset.roomPanel='3';
    const showStep=step=>{
      selectedStep=step;
      body.querySelectorAll('[data-room-panel]').forEach(panel=>panel.hidden=Number(panel.dataset.roomPanel)!==step);
      progress.querySelectorAll('[data-room-step]').forEach(button=>{button.classList.toggle('active',Number(button.dataset.roomStep)===step);button.setAttribute('aria-pressed',String(Number(button.dataset.roomStep)===step));});
    };
    progress.addEventListener('click',event=>{const button=event.target.closest('[data-room-step]');if(button&&!button.disabled)showStep(Number(button.dataset.roomStep));});
    showStep(selectedStep);
    host.querySelectorAll('[data-confirm-roster]').forEach(button=>button.addEventListener('click',async()=>{
      button.disabled=true;
      try{
        const {error}=await SUPA.client.rpc('confirm_match_roster',{p_match_id:matchId});if(error)throw error;
        toast('ok','Roster confirmed','Your match roster is now locked in.');await loadRoom();await loadMessages(true);
      }catch(error){toast('err','Could not confirm roster',error.message||'Please try again.');button.disabled=false;}
    }));
    host.querySelectorAll('[data-veto-action][data-map-name]').forEach(button=>button.addEventListener('click',async()=>{
      button.disabled=true;
      const action=button.dataset.vetoAction,mapName=button.dataset.mapName||null;
      try{
        const {error}=await SUPA.client.rpc('submit_match_veto_action',{p_match_id:matchId,p_action:action,p_map_name:mapName,p_side:null});if(error)throw error;
        toast('ok',action==='ban'?'Map banned':`Map ${picks.length+1} selected`,mapName||'Veto updated.');await loadRoom();await loadMessages(true);
      }catch(error){toast('err','Veto action failed',error.message||'Please try again.');button.disabled=false;}
    }));
    host.querySelectorAll('[data-veto-side]').forEach(button=>button.addEventListener('click',async()=>{
      button.disabled=true;
      const action=button.dataset.vetoAction;
      try{
        const {error}=await SUPA.client.rpc('submit_match_veto_action',{p_match_id:matchId,p_action:action,p_map_name:null,p_side:button.dataset.vetoSide});if(error)throw error;
        toast('ok','Starting side saved',`Map side set to ${button.dataset.vetoSide}.`);await loadRoom();await loadMessages(true);
      }catch(error){toast('err','Could not set starting side',error.message||'Please try again.');button.disabled=false;}
    }));
    host.querySelectorAll('[data-confirm-ready]').forEach(button=>button.addEventListener('click',async()=>{
      button.disabled=true;
      try{
        const {error}=await SUPA.client.rpc('confirm_match_player_ready',{p_match_id:matchId});if(error)throw error;
        toast('ok','You are ready','Your team and the referee can see your confirmation.');await loadRoom();await loadMessages(true);
      }catch(error){toast('err','Could not confirm readiness',error.message||'Please try again.');button.disabled=false;}
    }));
    $('#roomResultForm')?.addEventListener('submit',async event=>{
      event.preventDefault();
      const form=event.currentTarget,button=form.querySelector('button[type="submit"]');button.disabled=true;
      const values=new FormData(form),files=[...(form.elements.evidence?.files||[])],keys=[];
      try{
        if(files.length>5)throw new Error('Attach no more than five evidence files.');
        const allowed=new Set(['image/jpeg','image/png','image/webp','video/mp4']);
        if(files.some(file=>!allowed.has(file.type)||file.size<1||file.size>20*1024*1024))throw new Error('Evidence must be a non-empty JPEG, PNG, WebP, or MP4 file under 20 MB.');
        for(const file of files){
          const ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','video/mp4':'mp4'}[file.type];
          const key=`${matchId}/${Auth.user.id}/${crypto.randomUUID().replaceAll('-','')}.${ext}`;
          const {error}=await SUPA.client.storage.from('match-evidence').upload(key,file,{cacheControl:'3600',contentType:file.type,upsert:false});
          if(error)throw error;keys.push(key);
        }
        const {error}=await SUPA.client.rpc('submit_match_result',{p_match_id:matchId,p_home_score:Number(values.get('home_score')),p_away_score:Number(values.get('away_score')),p_evidence_object_keys:keys});
        if(error)throw error;
        toast('ok','Result submitted','Your team’s result is waiting for referee review.');
        await loadRoom();await loadMessages(true);
        roomSignature=signatureFor(room,latestResultSignature,latestReadinessSignature);
      }catch(error){if(keys.length)await SUPA.client.storage.from('match-evidence').remove(keys).catch(()=>{});toast('err','Could not submit result',error.message||'Please try again.');button.disabled=false;}
    });
    $('#roomChatForm').addEventListener('submit',async event=>{
      event.preventDefault();const input=$('#roomChatInput'),body=input.value.trim();
      if(!body)return;
      const button=event.currentTarget.querySelector('button[type="submit"]');button.disabled=true;
      try{
        const {error}=await SUPA.client.from('match_chat_messages').insert({match_id:matchId,sender_id:Auth.user.id,body});if(error)throw error;
        input.value='';await loadMessages(true);
      }catch(error){toast('err','Message not sent',error.message||'Please try again.');}
      finally{button.disabled=false;}
    });
    icons();
  };
  const loadMessages=async force=>{
    if(chatBusy)return;chatBusy=true;
    try{
      const {data,error}=await SUPA.client.from('match_chat_messages').select('id,sender_id,body,created_at')
        .eq('match_id',matchId).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(100);
      if(error)throw error;
      const messages=(data||[]).reverse(),signature=messages.map(message=>message.id).join(',');
      const pane=$('#roomMessages');if(!pane)return;
      if(!force&&signature===lastMessageIds&&!pane.dataset.failed)return;
      const wasNearBottom=pane.scrollHeight-pane.scrollTop-pane.clientHeight<64;
      const userIds=[...new Set(messages.map(message=>message.sender_id))];
      const {data:profiles,error:profileError}=userIds.length?await SUPA.client.from('public_profiles').select('id,username,player_name').in('id',userIds):{data:[],error:null};
      if(profileError)throw profileError;
      const names=new Map((profiles||[]).map(profile=>[profile.id,profile.username||profile.player_name||'Player']));
      pane.innerHTML=messages.length?messages.map(message=>`<article class="room-chat-message"><b>${esc(names.get(message.sender_id)||'Player')}</b><time>${esc(new Intl.DateTimeFormat(undefined,{timeStyle:'short'}).format(new Date(message.created_at)))}</time><p>${esc(message.body)}</p></article>`).join(''):'<p class="room-chat-empty">No messages yet. Use this chat to coordinate your match.</p>';
      delete pane.dataset.failed;
      if(wasNearBottom||!lastMessageIds)pane.scrollTop=pane.scrollHeight;
      lastMessageIds=signature;
    }catch(error){
      const pane=$('#roomMessages');if(pane&&(!pane.dataset.failed||force)){pane.innerHTML=`<p class="room-chat-empty">Match chat could not be loaded. ${esc(error.message||'Refresh and try again.')}</p>`;pane.dataset.failed='true';}
      if(!lastMessageIds)console.warn('Match chat unavailable:',error);
    }finally{chatBusy=false;}
  };
  let roomSignature='';
  const refreshRoom=async()=>{
    const {data,error}=await SUPA.client.rpc('get_match_room',{p_match_id:matchId});if(error)throw error;
    const [{data:reports,error:reportError},{data:readiness,error:readyError}]=await Promise.all([
      SUPA.client.from('match_result_submissions').select('id,status,home_score,away_score').eq('match_id',matchId).order('created_at'),
      SUPA.client.rpc('get_match_readiness',{p_match_id:matchId})
    ]);
    if(reportError)throw reportError;
    if(readyError)throw readyError;
    const signature=signatureFor(data,JSON.stringify((reports||[]).map(row=>[row.id,row.status,row.home_score,row.away_score])),JSON.stringify((readiness||[]).map(row=>[row.team_id,row.user_id])));
    if(signature===roomSignature)return;
    const input=$('#roomChatInput'),draft=input?.value||'',focused=document.activeElement===input;
    await loadRoom();await loadMessages(true);
    const refreshedInput=$('#roomChatInput');if(refreshedInput){refreshedInput.value=draft;if(focused)refreshedInput.focus();}
    roomSignature=signatureFor(room,latestResultSignature,latestReadinessSignature);
  };
  try{await loadRoom();roomSignature=signatureFor(room,latestResultSignature,latestReadinessSignature);await loadMessages(true);let polling=false;setInterval(async()=>{if(polling)return;polling=true;try{await refreshRoom();await loadMessages(false);}catch(error){console.warn('Match room refresh failed:',error);}finally{polling=false;}},3500);}
  catch(error){roomError(error.message||'You need to be part of this match to open its room.');}
}).catch(error=>roomError(error.message||'Please sign in and try again.'));
