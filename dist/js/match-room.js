/* Match room: participant-scoped rosters and persistent match chat. */
const host=$('#matchRoom'),matchId=new URLSearchParams(location.search).get('id');
const gameName=game=>GAMES[game]?.label||String(game||'Tournament').toUpperCase();
const roomError=message=>{host.innerHTML=`<article class="dcard room-error"><div class="dh"><i data-lucide="shield-alert"></i>Match room unavailable</div><div class="db"><p>${esc(message)}</p><a class="btn btn-line btn-sm" href="index.html">Return home</a></div></article>`;icons();};

Auth.ready.then(async()=>{
  if(!Auth.is()){location.replace(`login.html?next=${encodeURIComponent(`match-room.html?id=${matchId||''}`)}`);return;}
  if(!matchId){roomError('Open this room from a scheduled match.');return;}

  let room=null,chatBusy=false,lastMessageIds='';
  const loadRoom=async()=>{
    const {data,error}=await SUPA.client.rpc('get_match_room',{p_match_id:matchId});
    if(error)throw error;
    room=data;
    const sides=room.teams||[];
    const home=sides.find(team=>team.side==='home'),away=sides.find(team=>team.side==='away');
    const label=String(room.status||'scheduled').replaceAll('_',' ');
    const ownsTeam=team=>team?.captain_id===Auth.user.id||(team?.roster||[]).some(member=>member.user_id===Auth.user.id);
    const activeStep=room.status==='live'?3:room.status==='ready'&&home?.confirmed&&away?.confirmed?2:0;
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
    const stepMarkup=['Roster','Map veto','Ready','Live'].map((name,index)=>`<span class="room-step${index===activeStep?' active':''}"><i>${index+1}</i>${name}</span>`).join('');
    host.innerHTML=`<section class="dcard room-main"><div class="dh"><i data-lucide="swords"></i><span>${esc(String(room.stage_name||'Match').toUpperCase())} · ROUND ${room.round_number} · MATCH ${room.position}</span><span class="bracket-stage-meta">${esc(label)}</span></div><div class="room-score"><div class="room-side"><span class="room-team-mark">${esc((home?.tag||home?.name||'T').slice(0,3).toUpperCase())}</span><span class="room-side-text"><b class="room-side-name">${esc(home?.name||'TBD')}</b><small class="room-side-tag">${ownsTeam(home)?'YOUR TEAM':'OPPONENT'} · ${esc(home?.tag||'')}</small></span></div><div class="room-score-center"><strong>${room.home_score??0}<span style="display:inline;color:var(--faint)"> : </span>${room.away_score??0}</strong><span>${room.scheduled_at?esc(new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(room.scheduled_at))):room.started_at?'Match started':'Time to be announced'}</span></div><div class="room-side room-side-away"><span class="room-side-text"><b class="room-side-name">${esc(away?.name||'TBD')}</b><small class="room-side-tag">${ownsTeam(away)?'YOUR TEAM':'OPPONENT'} · ${esc(away?.tag||'')}</small></span><span class="room-team-mark">${esc((away?.tag||away?.name||'T').slice(0,3).toUpperCase())}</span></div></div><div class="room-steps" aria-label="Match progress">${stepMarkup}</div><div class="room-rosters"><h2 class="room-roster-heading">Pre-match · Team roster confirmation</h2><div class="room-roster-grid">${teamMarkup(home)}${teamMarkup(away)}</div></div></section><aside class="dcard room-chat"><div class="dh"><span><i data-lucide="radio"></i>Match chat</span><small class="room-chat-caption">MATCH PARTICIPANTS</small></div><div class="room-chat-messages" id="roomMessages" aria-live="polite"><p class="room-chat-empty">Loading match chat…</p></div><form class="room-chat-form" id="roomChatForm"><textarea id="roomChatInput" maxlength="1000" aria-label="Message the match room" placeholder="Message the room…" required></textarea><button type="submit" aria-label="Send message"><i data-lucide="send"></i></button></form><p class="room-chat-note">Messages are visible to this match’s teams, assigned referee, and event staff.</p></aside>`;
    host.querySelectorAll('[data-confirm-roster]').forEach(button=>button.addEventListener('click',async()=>{
      button.disabled=true;
      try{
        const {error}=await SUPA.client.rpc('confirm_match_roster',{p_match_id:matchId});if(error)throw error;
        toast('ok','Roster confirmed','Your match roster is now locked in.');await loadRoom();
      }catch(error){toast('err','Could not confirm roster',error.message||'Please try again.');button.disabled=false;}
    }));
    $('#roomChatForm').addEventListener('submit',async event=>{
      event.preventDefault();const input=$('#roomChatInput'),body=input.value.trim();
      if(!body)return;
      const button=event.submitter;button.disabled=true;
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
  try{await loadRoom();await loadMessages(true);setInterval(()=>loadMessages(false),3500);}
  catch(error){roomError(error.message||'You need to be part of this match to open its room.');}
}).catch(error=>roomError(error.message||'Please sign in and try again.'));
