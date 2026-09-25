/* Remove former sample matches and rosters before auth or data requests settle. */
document.querySelector('.dgrid')?.replaceChildren();
/* Player workspace uses only current-account membership and roster RPC data. */
Auth.ready.then(async()=>{
  if(!requirePerm('PLAYER_ZONE'))return;
  const wrap=document.querySelector('main .sec.tight .wrap');
  if(!wrap)return;
  wrap.innerHTML=`<div class="console-strip" id="consoleStrip"></div>
    <section class="dcard event-card personal-match-schedule"><div class="dh"><i data-lucide="calendar-clock"></i>My match schedule</div><div class="db" id="playerMatches" aria-live="polite"><p class="team-empty">Loading your matches…</p></div></section>
    <div class="player-section-heading"><h2>My teams</h2><a class="btn btn-gold btn-sm" href="captain.html"><i data-lucide="users-round"></i>Create or manage a team</a></div>
    <section class="player-team-list" id="playerTeams" aria-live="polite"><div class="team-empty">Loading your teams…</div></section>
    <details class="dcard player-profile"><summary class="dh"><i data-lucide="user-round"></i>Player profile</summary><div class="db"><p class="team-empty">Your Discord name appears on your team rosters.</p><form id="playerDiscordForm" class="club-contact"><label><span>Discord username</span><input name="discord_username" minlength="2" maxlength="64" value="${esc(Auth.user.discordUsername||'')}" placeholder="Your Discord username" required></label><button class="btn btn-line btn-sm" type="submit">Save Discord</button></form></div></details>`;
  const list=$('#playerTeams');
  const matchHost=$('#playerMatches');
  wrap.querySelector('#playerDiscordForm').addEventListener('submit',async event=>{
    event.preventDefault();
    const form=event.currentTarget,button=form.querySelector('button[type="submit"]'),discordUsername=String(new FormData(form).get('discord_username')||'').trim();
    if(discordUsername.length<2||discordUsername.length>64){toast('err','Discord username required','Enter 2–64 characters.');return;}
    button.disabled=true;
    try{
      const {error}=await SUPA.client.from('profiles').update({discord_username:discordUsername}).eq('id',Auth.user.id);
      if(error)throw error;
      Auth.user.discordUsername=discordUsername;
      toast('ok','Discord username saved','Your team rosters now show this contact name.');
      await render();
    }catch(error){toast('err','Could not save Discord username',error.message||'Please try again.');}
    finally{button.disabled=false;}
  });
  const renderMatches=async()=>{
    const {data,error}=await SUPA.client.rpc('get_my_team_matches');if(error)throw error;
    const rows=data||[],now=Date.now();
    rows.sort((a,b)=>{
      const priority=m=>m.match_status==='live'?0:m.match_status==='paused'?1:m.match_status==='ready'&&m.scheduled_at&&new Date(m.scheduled_at)>now?2:3;
      return priority(a)-priority(b)||(a.scheduled_at?new Date(a.scheduled_at).getTime():Infinity)-(b.scheduled_at?new Date(b.scheduled_at).getTime():Infinity);
    });
    if(!rows.length){matchHost.innerHTML='<p class="team-empty">Your scheduled matches will appear here when your team is entered in a published bracket.</p>';return;}
    const label={live:'LIVE',paused:'PAUSED',ready:'UPCOMING',result_pending:'RESULT REVIEW',disputed:'DISPUTE REVIEW'};
    matchHost.innerHTML=`<div class="personal-match-grid">${rows.map(match=>{
      const live=match.match_status==='live',scheduled=match.match_status==='ready'&&match.scheduled_at;
      const center=live?`${match.your_score??0} : ${match.opponent_score??0}`:scheduled?`<span data-player-match-timer="${esc(match.scheduled_at)}"></span>`:'Schedule pending';
      return `<article class="personal-match-card"><div class="personal-match-top"><b>${esc(match.tournament_name)}</b><span class="badge ${live?'live':''}">${label[match.match_status]||esc(match.match_status)}</span></div><div class="personal-match-vs"><span><b>${esc(match.your_team_name||'Your team')}</b><small>${esc(match.your_team_tag||'')}</small></span><strong>${center}</strong><span><b>${esc(match.opponent_team_name||'Opponent TBD')}</b><small>${esc(match.opponent_team_tag||'')}</small></span></div><div class="personal-match-foot"><span>${esc(match.stage_name)} · Round ${match.round_number}</span><span>${scheduled?esc(new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(match.scheduled_at))):''}</span></div><a class="btn btn-gold btn-sm" href="match-room.html?id=${encodeURIComponent(match.match_id)}">Open match room</a></article>`;
    }).join('')}</div>`;
  };
  const updateMatchTimers=()=>matchHost.querySelectorAll('[data-player-match-timer]').forEach(el=>{
    const seconds=Math.max(0,Math.floor((new Date(el.dataset.playerMatchTimer)-Date.now())/1000));
    el.textContent=seconds?`${Math.floor(seconds/3600)}:${String(Math.floor(seconds%3600/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`:'Starting now';
  });
  const render=async()=>{
    list.innerHTML='<div class="team-empty">Loading your teams…</div>';
    const {data:memberships,error}=await SUPA.client.from('team_members').select('team_id,role,status')
      .eq('user_id',Auth.user.id).eq('status','active');
    if(error)throw error;
    const ids=[...new Set((memberships||[]).map(row=>row.team_id))];
    if(!ids.length){list.innerHTML='<div class="dcard"><div class="dh"><i data-lucide="users-round"></i>No teams yet</div><div class="db"><p class="team-empty">Accept a captain’s invitation link to join a team, or create your own team.</p></div></div>';icons();return;}
    const {data:teams, error:teamsError}=await SUPA.client.from('teams')
      .select('id,name,tag,game,region').in('id',ids);
    if(teamsError)throw teamsError;
    const byTeam=new Map((memberships||[]).map(row=>[row.team_id,row]));
    const rosters=await Promise.all((teams||[]).map(async team=>{
      const {data,error}=await SUPA.client.rpc('list_team_roster',{p_team_id:team.id});
      return {team,membership:byTeam.get(team.id),roster:data||[],error};
    }));
    const memberIds=[...new Set(rosters.flatMap(({roster})=>roster.map(row=>row.user_id)))];
    const {data:profiles,error:profileError}=memberIds.length?await SUPA.client.from('public_profiles').select('id,discord_username').in('id',memberIds):{data:[],error:null};
    if(profileError)throw profileError;
    const discordById=new Map((profiles||[]).map(profile=>[profile.id,profile.discord_username]));
    list.innerHTML=rosters.map(({team,membership,roster,error})=>{
      const members=error?'<p class="team-empty">Roster details are unavailable.</p>':`<ul class="team-roster">${roster.map(row=>`<li><span><b>${esc(row.username||row.player_name||'Player')}${row.user_id===Auth.user.id?' · You':''}</b><small>${esc(row.member_role||'player')}${discordById.get(row.user_id)?` · Discord @${esc(discordById.get(row.user_id))}`:''}</small></span>${row.member_role==='captain'?'<i data-lucide="crown" aria-label="Team captain"></i>':''}</li>`).join('')}</ul>`;
      const role=membership?.role||'player';
      return `<article class="dcard team-card"><div class="dh"><i data-lucide="users-round"></i>${esc(team.name)}<span class="mono-r">${esc(team.tag)}</span></div><div class="db">
        <div class="team-meta"><span>${esc(team.game.toUpperCase())}</span><span>${esc(team.region||'Region not set')}</span><span>Your role: ${esc(role)}</span></div>
        <h3 class="team-section-title">Team roster <span>${error?'':roster.length}</span></h3>${members}
        ${role==='captain'?'<a class="btn btn-line btn-sm" href="captain.html" style="margin-top:14px">Manage team</a>':`<button class="btn btn-line btn-sm" type="button" data-leave-team="${esc(team.id)}" style="margin-top:14px">Leave team</button>`}
      </div></article>`;
    }).join('');
    icons();
  };
  list.addEventListener('click',async event=>{
    const button=event.target.closest('[data-leave-team]');
    if(!button||!window.confirm('Leave this team? You may need a new invitation to rejoin.'))return;
    button.disabled=true;
    try{
      const {error}=await SUPA.client.rpc('leave_team',{p_team_id:button.dataset.leaveTeam});
      if(error)throw error;
      toast('ok','You left the team','Your membership has been updated.');
      try{await render();}catch(refreshError){toast('err','Membership changed, but the page did not refresh',refreshError.message||'Reload to see the updated roster.');}
    }catch(error){toast('err','Could not leave team',error.message||'Please try again.');button.disabled=false;}
  });
  buildConsoleStrip();
  try{await render();}catch(error){list.innerHTML='<div class="team-empty">Your team list could not be loaded.</div>';toast('err','Player workspace unavailable',error.message||'Please reload and try again.');}
  try{await renderMatches();}catch(error){matchHost.innerHTML='<p class="team-empty">Your matches could not be loaded. Please refresh this page.</p>';}
  updateMatchTimers();setInterval(updateMatchTimers,1000);
  setInterval(()=>renderMatches().catch(error=>console.warn('Match schedule refresh failed:',error)),30000);
  icons();
}).catch(error=>toast('err','Player workspace unavailable',error.message||'Please reload and try again.'));
