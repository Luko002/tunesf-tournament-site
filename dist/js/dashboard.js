/* Remove former sample matches and rosters before auth or data requests settle. */
document.querySelector('.dgrid')?.replaceChildren();
/* Player workspace uses only current-account membership and roster RPC data. */
Auth.ready.then(async()=>{
  if(!requirePerm('PLAYER_ZONE'))return;
  const wrap=document.querySelector('main .sec.tight .wrap');
  if(!wrap)return;
  wrap.innerHTML=`<div class="console-strip" id="consoleStrip"></div>
    <section class="dcard event-card personal-match-schedule"><div class="dh"><i data-lucide="calendar-clock"></i>My match schedule</div><div class="db" id="playerMatches" aria-live="polite"><p class="team-empty">Loading your matches…</p></div></section>
    <div class="player-section-heading"><h2>My teams</h2><a class="btn btn-line btn-sm" href="captain.html"><i data-lucide="users-round"></i>Team management</a></div>
    <details class="dcard player-team-create"><summary class="dh"><i data-lucide="plus"></i>Create a team</summary><div class="db"><p class="team-empty">Creating a team makes you its captain. Match its roster size to the tournament before registering.</p><form id="playerTeamCreateForm" class="team-create-form"><label><span>Team name</span><input name="name" minlength="2" maxlength="80" required placeholder="e.g. Tunisian squad"></label><label><span>Short tag</span><input name="tag" minlength="2" maxlength="8" required placeholder="TNS"></label><label><span>Game</span><select name="game" required><option value="">Choose a game</option><option value="cs2">Counter-Strike 2</option><option value="val">VALORANT</option><option value="lol">League of Legends</option><option value="rl">Rocket League</option><option value="mlbb">Mobile Legends: Bang Bang</option><option value="eafc">EA SPORTS FC</option><option value="efootball">eFootball</option></select></label><label><span>Region</span><input name="region" maxlength="100" placeholder="e.g. Tunis"></label><label><span>Team logo (optional, JPG/PNG/WebP up to 5 MB)</span><input name="logo" type="file" accept="image/jpeg,image/png,image/webp"></label><button class="btn btn-gold btn-sm" type="submit"><i data-lucide="plus"></i>Create team</button></form></div></details>
    <section class="player-team-list" id="playerTeams" aria-live="polite"><div class="team-empty">Loading your teams…</div></section>
    <details class="dcard player-profile"><summary class="dh"><i data-lucide="user-round"></i>Player profile</summary><div class="db"><div class="profile-image-editor">${identityImage(Auth.user.avatarPath,Auth.user.name,72,'player')}<label><span>Profile picture (JPG/PNG/WebP, up to 5 MB)</span><input id="playerAvatarInput" type="file" accept="image/jpeg,image/png,image/webp"></label><button class="btn btn-line btn-sm" id="removePlayerAvatar" type="button"${Auth.user.avatarPath?'':' hidden'}>Remove picture</button></div><p class="team-empty">Add a Discord contact name only if you want it shown on your team rosters.</p><form id="playerDiscordForm" class="club-contact"><label><span>Discord username (optional)</span><input name="discord_username" minlength="2" maxlength="64" value="${esc(Auth.user.discordUsername||'')}" placeholder="Leave blank to remove it"></label><button class="btn btn-line btn-sm" type="submit">Save profile</button></form></div></details>`;
  const list=$('#playerTeams');
  const matchHost=$('#playerMatches');
  $('#playerTeamCreateForm').addEventListener('submit',async event=>{
    event.preventDefault();
    const form=event.currentTarget,button=form.querySelector('button[type="submit"]'),values=Object.fromEntries(new FormData(form));
    button.disabled=true;
    try{
      const {data:teamId,error}=await SUPA.client.rpc('create_team',{p_name:String(values.name).trim(),p_tag:String(values.tag).trim().toUpperCase(),p_game:values.game,p_region:String(values.region||'').trim()});
      if(error)throw error;
      const logo=values.logo;
      if(logo?.size){try{const path=await uploadPublicImage(logo,`teams/${teamId}`);const {error:logoError}=await SUPA.client.rpc('set_team_logo_path',{p_team_id:teamId,p_logo_path:path});if(logoError){await removePublicImage(path);throw logoError;}}catch(logoError){toast('info','Team created, logo not saved',logoError.message||'You can add the logo later from Team management.');}}
      form.reset();toast('ok','Team created','You are now captain. Invite players before registering for a tournament.');
      await render();
    }catch(error){toast('err','Could not create team',error.message||'Please try again.');}
    finally{button.disabled=false;}
  });
  wrap.querySelector('#playerDiscordForm').addEventListener('submit',async event=>{
    event.preventDefault();
    const form=event.currentTarget,button=form.querySelector('button[type="submit"]'),discordUsername=String(new FormData(form).get('discord_username')||'').trim();
    if(discordUsername&& (discordUsername.length<2||discordUsername.length>64)){toast('err','Discord username invalid','Leave it blank or enter 2–64 characters.');return;}
    button.disabled=true;
    try{
      const {error}=await SUPA.client.from('profiles').update({discord_username:discordUsername||null}).eq('id',Auth.user.id);
      if(error)throw error;
      Auth.user.discordUsername=discordUsername;
      toast('ok','Player profile saved',discordUsername?'Your team rosters now show this contact name.':'Your Discord contact name was removed.');
      await render();
    }catch(error){toast('err','Could not save player profile',error.message||'Please try again.');}
    finally{button.disabled=false;}
  });
  const avatarInput=wrap.querySelector('#playerAvatarInput'),removeAvatar=wrap.querySelector('#removePlayerAvatar');
  const saveAvatar=async path=>{const {error}=await SUPA.client.rpc('set_player_avatar_path',{p_avatar_path:path});if(error)throw error;};
  avatarInput.addEventListener('change',async()=>{
    const file=avatarInput.files?.[0];if(!file)return;avatarInput.disabled=true;
    try{const previous=Auth.user.avatarPath,path=await uploadPublicImage(file,'profiles');await saveAvatar(path);Auth.user.avatarPath=path;await removePublicImage(previous);toast('ok','Profile picture saved','Your picture now appears on your public player profile and team rosters.');await render();}
    catch(error){toast('err','Could not save profile picture',error.message||'Please try again.');}
    finally{avatarInput.disabled=false;avatarInput.value='';}
  });
  removeAvatar.addEventListener('click',async()=>{
    if(!Auth.user.avatarPath)return;removeAvatar.disabled=true;
    try{const previous=Auth.user.avatarPath;await saveAvatar(null);Auth.user.avatarPath=null;await removePublicImage(previous);toast('ok','Profile picture removed','Your default player image is shown now.');await render();}
    catch(error){toast('err','Could not remove profile picture',error.message||'Please try again.');}
    finally{removeAvatar.disabled=false;}
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
      return `<article class="personal-match-card"><div class="personal-match-top"><b>${esc(match.tournament_name)}</b><span class="badge ${live?'live':''}">${label[match.match_status]||esc(match.match_status)}</span></div><div class="personal-match-vs"><span>${identityImage(match.your_team_logo_path,match.your_team_name||'Your team',32,'team')}<b>${esc(match.your_team_name||'Your team')}</b><small>${esc(match.your_team_tag||'')}</small></span><strong>${center}</strong><span>${identityImage(match.opponent_team_logo_path,match.opponent_team_name||'Opponent TBD',32,'team')}<b>${esc(match.opponent_team_name||'Opponent TBD')}</b><small>${esc(match.opponent_team_tag||'')}</small></span></div><div class="personal-match-foot"><span>${esc(match.stage_name)} · Round ${match.round_number}</span><span>${scheduled?esc(new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(match.scheduled_at))):''}</span></div><a class="btn btn-gold btn-sm" href="match-room.html?id=${encodeURIComponent(match.match_id)}">Open match room</a></article>`;
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
      .select('id,name,tag,game,region,logo_path').in('id',ids);
    if(teamsError)throw teamsError;
    const byTeam=new Map((memberships||[]).map(row=>[row.team_id,row]));
    const rosters=await Promise.all((teams||[]).map(async team=>{
      const {data,error}=await SUPA.client.rpc('list_team_roster',{p_team_id:team.id});
      return {team,membership:byTeam.get(team.id),roster:data||[],error};
    }));
    const memberIds=[...new Set(rosters.flatMap(({roster})=>roster.map(row=>row.user_id)))];
    const {data:profiles,error:profileError}=memberIds.length?await SUPA.client.from('public_profiles').select('id,discord_username,avatar_path').in('id',memberIds):{data:[],error:null};
    if(profileError)throw profileError;
    const profileById=new Map((profiles||[]).map(profile=>[profile.id,profile]));
    list.innerHTML=rosters.map(({team,membership,roster,error})=>{
      const members=error?'<p class="team-empty">Roster details are unavailable.</p>':`<ul class="team-roster">${roster.map(row=>{const profile=profileById.get(row.user_id);return `<li>${identityImage(profile?.avatar_path,row.username||row.player_name||'Player',32,'player')}<span><b>${esc(row.username||row.player_name||'Player')}${row.user_id===Auth.user.id?' · You':''}</b><small>${esc(row.member_role||'player')}${profile?.discord_username?` · Discord @${esc(profile.discord_username)}`:''}</small></span>${row.member_role==='captain'?'<i data-lucide="crown" aria-label="Team captain"></i>':''}</li>`;}).join('')}</ul>`;
      const role=membership?.role||'player';
      return `<article class="dcard team-card"><div class="dh">${identityImage(team.logo_path,team.name,36,'team')}${esc(team.name)}<span class="mono-r">${esc(team.tag)}</span></div><div class="db">
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
