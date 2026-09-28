/* Remove former sample matches and rosters before auth or data requests settle. */
document.querySelector('.dgrid')?.replaceChildren();
/* Player workspace uses only current-account membership and roster RPC data. */
Auth.ready.then(async()=>{
  if(!requirePerm('PLAYER_ZONE'))return;
  const wrap=document.querySelector('main .sec.tight .wrap');
  if(!wrap)return;
  wrap.innerHTML=`<div class="player-dashboard-tabs" role="tablist" aria-label="Player dashboard sections"><button type="button" role="tab" id="playerTabGames" aria-controls="playerPanelGames" aria-selected="true" data-player-tab="games"><i data-lucide="gamepad-2"></i>My games</button><button type="button" role="tab" id="playerTabMatches" aria-controls="playerPanelMatches" aria-selected="false" data-player-tab="matches"><i data-lucide="calendar-clock"></i>Upcoming matches</button><button type="button" role="tab" id="playerTabTeams" aria-controls="playerPanelTeams" aria-selected="false" data-player-tab="teams"><i data-lucide="users-round"></i>My teams</button><button type="button" role="tab" id="playerTabConnections" aria-controls="playerPanelConnections" aria-selected="false" data-player-tab="connections"><i data-lucide="link-2"></i>Connections</button></div>
    <section class="player-tab-panel" role="tabpanel" id="playerPanelGames" aria-labelledby="playerTabGames" data-player-panel="games"><div class="player-game-chooser"><div class="player-tab-heading"><span class="player-section-kicker">YOUR GAMES</span><span id="playerGameCount">7</span></div><nav class="player-game-nav" id="playerGameList" aria-label="Choose a game"></nav></div><section class="player-game-dashboard" id="playerGameDashboard" aria-live="polite"><div class="player-dashboard-loading">Loading your game record…</div></section></section>
    <section class="player-tab-panel" role="tabpanel" id="playerPanelMatches" aria-labelledby="playerTabMatches" data-player-panel="matches" hidden><section class="dcard personal-match-schedule"><div class="dh"><i data-lucide="calendar-clock"></i><span id="playerMatchesHeading">Upcoming matches</span></div><div class="db" id="playerMatches" aria-live="polite"><p class="team-empty">Loading your matches…</p></div></section></section>
    <section class="player-tab-panel" role="tabpanel" id="playerPanelTeams" aria-labelledby="playerTabTeams" data-player-panel="teams" hidden><div class="player-section-heading"><div><span class="player-section-kicker">YOUR ROSTERS</span><h2 id="playerTeamsHeading">My teams</h2></div><a class="btn btn-line btn-sm" href="captain.html"><i data-lucide="users-round"></i>Team management</a></div>
    <details class="dcard player-team-create"><summary class="dh"><i data-lucide="plus"></i>Create a team</summary><div class="db"><p class="team-empty">Creating a team makes you its captain. Match its roster size to the tournament before registering.</p><form id="playerTeamCreateForm" class="team-create-form"><label><span>Team name</span><input name="name" minlength="2" maxlength="80" required placeholder="e.g. Tunisian squad"></label><label><span>Short tag</span><input name="tag" minlength="2" maxlength="8" required placeholder="TNS"></label><label><span>Game</span><select name="game" required><option value="">Choose a game</option><option value="cs2">Counter-Strike 2</option><option value="val">VALORANT</option><option value="lol">League of Legends</option><option value="rl">Rocket League</option><option value="mlbb">Mobile Legends: Bang Bang</option><option value="eafc">EA SPORTS FC</option><option value="efootball">eFootball</option></select></label><label><span>Region</span><input name="region" maxlength="100" placeholder="e.g. Tunis"></label><label><span>Team logo (optional, JPG/PNG/WebP up to 5 MB)</span><input name="logo" type="file" accept="image/jpeg,image/png,image/webp"></label><button class="btn btn-gold btn-sm" type="submit"><i data-lucide="plus"></i>Create team</button></form></div></details>
    <section class="player-team-list" id="playerTeams" aria-live="polite"><div class="team-empty">Loading your teams…</div></section></section>
    <section class="player-tab-panel" role="tabpanel" id="playerPanelConnections" aria-labelledby="playerTabConnections" data-player-panel="connections" hidden><section class="player-connections dcard"><div class="dh"><i data-lucide="link-2"></i><span>FACEIT · Counter-Strike 2</span></div><div class="db"><div class="player-connection-identity" id="faceitIdentity"><span class="player-connection-mark"><i data-lucide="crosshair"></i></span><span><b>FACEIT</b><small>Counter-Strike 2</small></span></div><div class="player-connection-rank" id="faceitRank" hidden></div><p class="player-connection-status" id="faceitStatus" aria-live="polite">Loading FACEIT connection…</p><button class="btn btn-gold btn-sm" type="button" id="faceitConnect"><i data-lucide="log-in"></i>Sign in with FACEIT</button><div class="player-connection-links"><label class="faceit-visibility"><input id="faceitVisible" type="checkbox"> Public profile</label><a id="faceitProfileLink" class="faceit-profile-link" target="_blank" rel="noopener noreferrer" hidden>FACEIT profile <i data-lucide="external-link"></i></a></div><span class="player-connection-updated" id="faceitUpdated"></span></div></section><section class="dcard player-game-links-card"><div class="dh"><i data-lucide="badge-check"></i><span>Manual game verification</span></div><div class="db"><p class="player-game-links-intro">Submit your in-game ID and a public profile or proof link. A TUNESF platform admin reviews it. This verifies your identity only; it does not import game stats.</p><div id="playerGameLinks" class="player-game-links-list" aria-live="polite"><p class="team-empty">Loading your game links…</p></div><form id="playerGameLinkForm" class="player-game-link-form"><label><span>Game</span><select name="game_key" required><option value="">Choose a game</option><option value="rl">Rocket League</option><option value="mlbb">Mobile Legends: Bang Bang</option><option value="eafc">EA SPORTS FC</option><option value="efootball">eFootball</option></select></label><label><span>In-game ID</span><input name="player_id" required minlength="2" maxlength="100" placeholder="Your player ID or username"></label><label><span>Platform or server (optional)</span><input name="platform" maxlength="40" placeholder="PC, PlayStation, Xbox, server…"></label><label><span>Public profile or proof URL</span><input name="proof_url" type="url" required maxlength="500" placeholder="https://…"><small>Use a link that lets a reviewer confirm the game ID. Don’t share passwords or private account links.</small></label><button class="btn btn-gold btn-sm" type="submit"${READ_ONLY_PREVIEW?' disabled':''}>Submit for verification</button></form></div></section></section>
    <details class="dcard player-profile"><summary class="dh"><i data-lucide="user-round"></i>Account &amp; profile settings</summary><div class="db"><div class="profile-image-editor">${identityImage(Auth.user.avatarPath,Auth.user.name,72,'player')}<label><span>Profile picture (JPG/PNG/WebP, up to 5 MB)</span><input id="playerAvatarInput" type="file" accept="image/jpeg,image/png,image/webp"></label><button class="btn btn-line btn-sm" id="removePlayerAvatar" type="button"${Auth.user.avatarPath?'':' hidden'}>Remove picture</button></div><p class="team-empty">Add a Discord contact name only if you want it shown on your team rosters.</p><form id="playerDiscordForm" class="club-contact"><label><span>Discord username (optional)</span><input name="discord_username" minlength="2" maxlength="64" value="${esc(Auth.user.discordUsername||'')}" placeholder="Leave blank to remove it"></label><button class="btn btn-line btn-sm" type="submit">Save profile</button></form></div></details>`;
  if(READ_ONLY_PREVIEW){
    const note=document.createElement('p');note.id='playerWorkspaceReadonly';note.className='admin-readonly-note';note.setAttribute('role','note');note.textContent='Profile, team, and membership changes are disabled in this local preview because it is connected to production. Use a writable staging environment to save changes.';
    wrap.prepend(note);
  wrap.querySelectorAll('#playerTeamCreateForm input,#playerTeamCreateForm select,#playerTeamCreateForm textarea,#playerTeamCreateForm button,#playerDiscordForm input,#playerDiscordForm button,#playerAvatarInput,#removePlayerAvatar,#faceitConnect,#faceitVisible,#playerGameLinkForm input,#playerGameLinkForm select,#playerGameLinkForm button').forEach(control=>{control.disabled=true;control.setAttribute('aria-describedby','playerWorkspaceReadonly');});
  }
  const list=$('#playerTeams');
  const matchHost=$('#playerMatches');
  const gameDashboard=$('#playerGameDashboard');
  const faceitConnect=$('#faceitConnect'),faceitVisible=$('#faceitVisible'),faceitStatus=$('#faceitStatus'),faceitUpdated=$('#faceitUpdated'),faceitIdentity=$('#faceitIdentity'),faceitProfileLink=$('#faceitProfileLink'),faceitRank=$('#faceitRank');
  const gameLinkList=$('#playerGameLinks'),gameLinkForm=$('#playerGameLinkForm');
  let faceitLink=null;
  const gameLabels={rl:'Rocket League',mlbb:'Mobile Legends: Bang Bang',eafc:'EA SPORTS FC',efootball:'eFootball'};
  const loadPlayerGameLinks=async()=>{
    const {data,error}=await SUPA.client.from('player_game_identity_links').select('id,game_key,player_id,platform,proof_url,status,review_note,submitted_at,reviewed_at').order('game_key');
    if(error)throw error;
    gameLinkList.innerHTML=data?.length?data.map(link=>`<article class="player-game-link-card"><div><b>${esc(gameLabels[link.game_key]||link.game_key)}</b><span class="player-game-link-status is-${esc(link.status)}">${link.status==='verified'?'Verified':link.status==='rejected'?'Needs changes':'Pending review'}</span><p>${esc(link.player_id)}${link.platform?` · ${esc(link.platform)}`:''}</p>${link.review_note?`<small>${esc(link.review_note)}</small>`:''}</div><a href="${esc(link.proof_url)}" target="_blank" rel="noopener noreferrer">View proof <i data-lucide="external-link"></i></a></article>`).join(''):'<p class="team-empty">No game IDs submitted yet.</p>';
    icons();
  };
  gameLinkForm.addEventListener('submit',async event=>{
    event.preventDefault();if(READ_ONLY_PREVIEW)return;
    const form=event.currentTarget,button=form.querySelector('button[type="submit"]'),values=new FormData(form);button.disabled=true;
    try{const {error}=await SUPA.client.rpc('submit_player_game_identity_link',{p_game_key:values.get('game_key'),p_player_id:String(values.get('player_id')||'').trim(),p_platform:String(values.get('platform')||'').trim()||null,p_proof_url:String(values.get('proof_url')||'').trim()});if(error)throw error;toast('ok','Game ID sent for review','Your link is pending verification by a TUNESF platform admin.');form.reset();await loadPlayerGameLinks();}
    catch(error){toast('err','Could not submit game ID',error.message||'Check the details and try again.');}
    finally{button.disabled=false;}
  });
  const loadFaceit=async()=>{
    const {data,error}=await SUPA.client.from('player_faceit_links').select('nickname,avatar,country,region,faceit_url,visible,verified,fetched_at,skill_level,faceit_elo,skill_level_label,lifetime_stats').eq('user_id',Auth.user.id).maybeSingle();
    if(error)throw error;faceitLink=data;
    faceitConnect.innerHTML=data?.verified?'<i data-lucide="refresh-cw"></i>Refresh FACEIT stats':'<i data-lucide="log-in"></i>Sign in with FACEIT';icons();
    const profileUrl=typeof data?.faceit_url==='string'&&/^https:\/\/(www\.)?faceit\.com\//i.test(data.faceit_url)?data.faceit_url:'';faceitProfileLink.href=profileUrl||'#';faceitProfileLink.hidden=!profileUrl;
    faceitVisible.checked=data?.visible??true;faceitVisible.disabled=READ_ONLY_PREVIEW||!data;
    if(data){
      faceitIdentity.innerHTML=`${data.avatar?`<img class="player-connection-avatar" src="${esc(data.avatar)}" alt="${esc(data.nickname)} avatar">`:'<span class="player-connection-mark"><i data-lucide="crosshair"></i></span>'}<span class="player-connection-user"><b>${esc(data.nickname)}${data.verified?' <i data-lucide="badge-check" aria-label="Verified"></i>':''}</b><small>${data.verified?'Connected to FACEIT':'FACEIT account'}</small></span>`;
      const raw=data.lifetime_stats&&typeof data.lifetime_stats==='object'?data.lifetime_stats:{};
      const stats=new Map(Object.entries(raw).map(([key,value])=>[key.toLowerCase().replace(/[^a-z0-9]/g,''),value]));
      const metric=(keys)=>{for(const key of keys){const value=stats.get(key.toLowerCase().replace(/[^a-z0-9]/g,''));if(value!==undefined&&value!==null&&value!=='')return String(value)}return null};
      const tiles=[['Matches played',metric(['Total Matches','Matches'])],['Win rate',metric(['Win Rate %','Win Rate'])],['Average K/D',metric(['Average K/D Ratio','K/D Ratio'])],['Headshots',metric(['Average Headshots %','Headshots %','Headshots'])]].filter(([,value])=>value!==null);
      faceitRank.innerHTML=data.skill_level?`<span>CS2 FACEIT LEVEL</span><b>${esc(data.skill_level)}</b>${data.faceit_elo?`<small>${Number(data.faceit_elo).toLocaleString()} ELO</small>`:''}`:'';faceitRank.hidden=!data.skill_level;
      faceitStatus.textContent=data.verified?(tiles.length?'Lifetime stats from FACEIT.':'Your FACEIT account is verified. Refresh to load CS2 stats.'):'Connect your FACEIT account to verify your profile.';
    }else{faceitIdentity.innerHTML='<span class="player-connection-mark"><i data-lucide="crosshair"></i></span><span><b>FACEIT</b><small>Counter-Strike 2</small></span>';faceitRank.hidden=true;faceitStatus.textContent='Sign in to FACEIT to connect your CS2 account.';}
    icons();faceitUpdated.textContent=data?.fetched_at?`Updated ${new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(data.fetched_at))}`:'';
  };
  faceitVisible.addEventListener('change',async()=>{
    if(READ_ONLY_PREVIEW||!faceitLink)return;faceitVisible.disabled=true;
    try{const {error}=await SUPA.client.rpc('set_faceit_link_visibility',{p_visible:faceitVisible.checked});if(error)throw error;toast('ok','FACEIT visibility saved',faceitVisible.checked?'Your FACEIT profile is visible on your public player page.':'Your FACEIT profile is hidden from public player pages.');await loadFaceit();}
    catch(error){faceitVisible.checked=faceitLink?.visible??true;toast('err','Could not update FACEIT visibility',error.message||'Please try again.');}
    finally{faceitVisible.disabled=READ_ONLY_PREVIEW||!faceitLink;}
  });
  faceitConnect.addEventListener('click',async()=>{
    if(READ_ONLY_PREVIEW)return;faceitConnect.disabled=true;faceitStatus.textContent='Connecting securely to FACEIT…';
    try{
      if(faceitLink?.verified){
        faceitStatus.textContent='Refreshing your FACEIT CS2 stats…';
        const {data,error}=await SUPA.client.functions.invoke('faceit-refresh',{body:{}});
        if(error){let message=error.message||'Could not refresh FACEIT stats.';try{const detail=await error.context?.json();if(detail?.error)message=detail.error;}catch{}throw new Error(message);}
        if(data?.error)throw new Error(data.error);
        await loadFaceit();toast('ok','FACEIT stats updated','Your CS2 level and lifetime stats are current.');return;
      }
      const {data,error}=await SUPA.client.functions.invoke('faceit-oauth',{body:{action:'start',return_to:`${location.pathname}${location.search}`}});
      if(error){let message=error.message||'Could not start FACEIT sign-in.';try{const detail=await error.context?.json();if(detail?.error)message=detail.error;}catch{}throw new Error(message);}
      if(!data?.url)throw new Error(data?.error||'FACEIT sign-in is not configured yet.');
      location.assign(data.url);
    }catch(error){faceitStatus.textContent=error.message||'Could not start FACEIT sign-in.';toast('err','FACEIT connection failed',faceitStatus.textContent);faceitConnect.disabled=false;}
  });
  const faceitResult=new URLSearchParams(location.search).get('faceit');
  if(faceitResult){const cleanUrl=new URL(location.href);cleanUrl.searchParams.delete('faceit');history.replaceState({},'',cleanUrl);if(faceitResult==='connected'){toast('ok','FACEIT account connected','Loading your CS2 profile and lifetime stats.');SUPA.client.functions.invoke('faceit-refresh',{body:{}}).then(async({data,error})=>{if(error||data?.error)throw error||new Error(data.error);await loadFaceit();toast('ok','FACEIT stats updated','Your CS2 level and lifetime stats are ready.');}).catch(error=>{faceitStatus.textContent=error.message||'FACEIT connected; stats could not be refreshed yet.';});}else if(faceitResult==='error'){toast('err','FACEIT connection failed',new URLSearchParams(location.search).get('reason')||'Try again.');}}
  const initialLinkLoads=await Promise.allSettled([loadFaceit(),loadPlayerGameLinks()]);
  if(initialLinkLoads[0].status==='rejected')faceitStatus.textContent=initialLinkLoads[0].reason?.message||'Could not load your FACEIT link.';
  if(initialLinkLoads[1].status==='rejected')gameLinkList.innerHTML='<p class="team-empty">Game ID links are unavailable right now.</p>';
  let activeGame='',activeTeamId='',dashboardTeams=[],dashboardStats=new Map();
  const gameList=$('#playerGameList');
  const dashboardTabs=wrap.querySelectorAll('[data-player-tab]');
  const showDashboardTab=tab=>{dashboardTabs.forEach(button=>{const selected=button.dataset.playerTab===tab;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;});wrap.querySelectorAll('[data-player-panel]').forEach(panel=>{panel.hidden=panel.dataset.playerPanel!==tab;});};
  dashboardTabs.forEach(button=>button.addEventListener('click',()=>showDashboardTab(button.dataset.playerTab)));
  dashboardTabs.forEach(button=>button.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();const tabs=[...dashboardTabs],next=(tabs.indexOf(button)+(event.key==='ArrowRight'?1:tabs.length-1))%tabs.length;tabs[next].focus();showDashboardTab(tabs[next].dataset.playerTab);}));
  const renderGameList=()=>{
    const keys=Object.keys(GAMES);
    $('#playerGameCount').textContent=String(keys.length).padStart(2,'0');
    gameList.innerHTML=keys.map(key=>{const count=dashboardTeams.filter(team=>team.game===key).length,game=GAMES[key];return `<button class="player-game-link${key===activeGame?' is-active':''}" type="button" data-sidebar-game="${esc(key)}" aria-current="${key===activeGame?'true':'false'}"><i data-lucide="${esc(game.icon||'gamepad-2')}"></i><span>${esc(game.label)}</span><small>${count?`${count} TEAM${count===1?'':'S'}`:'OPEN'}</small></button>`;}).join('');icons();
  };
  gameList.addEventListener('click',event=>{const button=event.target.closest('[data-sidebar-game]');if(!button)return;activeGame=button.dataset.sidebarGame;activeTeamId='';renderGameDashboard();renderGameList();renderMatches().catch(()=>{});});
  $('#playerTeamCreateForm').addEventListener('submit',async event=>{
    event.preventDefault();if(READ_ONLY_PREVIEW)return;
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
    event.preventDefault();if(READ_ONLY_PREVIEW)return;
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
    if(READ_ONLY_PREVIEW)return;const file=avatarInput.files?.[0];if(!file)return;avatarInput.disabled=true;
    try{const previous=Auth.user.avatarPath,path=await uploadPublicImage(file,'profiles');await saveAvatar(path);Auth.user.avatarPath=path;await removePublicImage(previous);toast('ok','Profile picture saved','Your picture now appears on your public player profile and team rosters.');await render();}
    catch(error){toast('err','Could not save profile picture',error.message||'Please try again.');}
    finally{avatarInput.disabled=false;avatarInput.value='';}
  });
  removeAvatar.addEventListener('click',async()=>{
    if(READ_ONLY_PREVIEW||!Auth.user.avatarPath)return;removeAvatar.disabled=true;
    try{const previous=Auth.user.avatarPath;await saveAvatar(null);Auth.user.avatarPath=null;await removePublicImage(previous);toast('ok','Profile picture removed','Your default player image is shown now.');await render();}
    catch(error){toast('err','Could not remove profile picture',error.message||'Please try again.');}
    finally{removeAvatar.disabled=false;}
  });
  const renderMatches=async()=>{
    const {data,error}=await SUPA.client.rpc('get_my_team_matches');if(error)throw error;
    const rows=(data||[]).filter(match=>(!activeGame||match.game===activeGame)&&(!activeTeamId||match.your_team_id===activeTeamId)),now=Date.now();
    $('#playerMatchesHeading').textContent=`${gameName(activeGame)} · Upcoming matches`;
    const identities=new Map();rows.forEach(match=>{if(match.your_team_id)identities.set(match.your_team_id,{id:match.your_team_id,logo_path:match.your_team_logo_path});if(match.opponent_team_id)identities.set(match.opponent_team_id,{id:match.opponent_team_id,logo_path:match.opponent_team_logo_path});});
    await applyOrganizationTeamLogos([...identities.values()]);
    rows.forEach(match=>{match.your_team_logo_path=identities.get(match.your_team_id)?.logo_path||match.your_team_logo_path;match.opponent_team_logo_path=identities.get(match.opponent_team_id)?.logo_path||match.opponent_team_logo_path;});
    rows.sort((a,b)=>{
      const priority=m=>m.match_status==='live'?0:m.match_status==='paused'?1:m.match_status==='ready'&&m.scheduled_at&&new Date(m.scheduled_at)>now?2:3;
      return priority(a)-priority(b)||(a.scheduled_at?new Date(a.scheduled_at).getTime():Infinity)-(b.scheduled_at?new Date(b.scheduled_at).getTime():Infinity);
    });
    if(!rows.length){matchHost.innerHTML='<p class="team-empty">No upcoming matches for this game yet. Published team fixtures will appear here.</p>';return;}
    const label={live:'LIVE',paused:'PAUSED',ready:'UPCOMING',result_pending:'RESULT REVIEW',disputed:'DISPUTE REVIEW'};
    matchHost.innerHTML=`<div class="personal-match-grid">${rows.map(match=>{
      const live=match.match_status==='live',scheduled=match.match_status==='ready'&&match.scheduled_at;
      const overdue=Boolean(scheduled&&new Date(match.scheduled_at).getTime()<=now);
      const status=overdue?'RESCHEDULE NEEDED':label[match.match_status]||String(match.match_status||'').replaceAll('_',' ');
      const center=live?`${match.your_score??0} : ${match.opponent_score??0}`:overdue?'Awaiting a new match time':scheduled?`<span data-player-match-timer="${esc(match.scheduled_at)}" role="timer" aria-live="off"></span>`:'Schedule pending';
      const scheduledLabel=scheduled?new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(match.scheduled_at)):'';
      return `<article class="personal-match-card"><div class="personal-match-top"><b>${esc(match.tournament_name)}</b><span class="badge ${live?'live':overdue?'needs-check':''}">${esc(status)}</span></div><div class="personal-match-vs"><span>${identityImage(match.your_team_logo_path,match.your_team_name||'Your team',32,'team')}<b>${esc(match.your_team_name||'Your team')}</b><small>${esc(match.your_team_tag||'')}</small></span><strong>${center}</strong><span>${identityImage(match.opponent_team_logo_path,match.opponent_team_name||'Opponent TBD',32,'team')}<b>${esc(match.opponent_team_name||'Opponent TBD')}</b><small>${esc(match.opponent_team_tag||'')}</small></span></div><div class="personal-match-foot"><span>${esc(match.stage_name)} · Round ${match.round_number}</span><span>${overdue&&scheduledLabel?`Was scheduled ${esc(scheduledLabel)}`:esc(scheduledLabel)}</span></div><a class="btn btn-gold btn-sm" href="match-room.html?id=${encodeURIComponent(match.match_id)}">Open match room</a></article>`;
    }).join('')}</div>`;
  };
  const updateMatchTimers=()=>matchHost.querySelectorAll('[data-player-match-timer]').forEach(el=>{
    const seconds=Math.max(0,Math.floor((new Date(el.dataset.playerMatchTimer)-Date.now())/1000));
    if(seconds){el.textContent=`${Math.floor(seconds/3600)}:${String(Math.floor(seconds%3600/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;return;}
    el.textContent='—';el.setAttribute('aria-live','polite');
    const badge=el.closest('.personal-match-card')?.querySelector('.personal-match-top .badge');
    if(badge){badge.textContent='RESCHEDULE NEEDED';badge.classList.add('needs-check');}
  });
  const gameName=key=>GAMES[key]?.label||key||'Game not set';
  function renderGameDashboard(){
    if(!gameDashboard)return;
    const availableGames=Object.keys(GAMES);
    if(!activeGame||!availableGames.includes(activeGame))activeGame=availableGames.includes(Auth.user.game)?Auth.user.game:availableGames[0]||'';
    const gameTeams=dashboardTeams.filter(team=>team.game===activeGame);
    if(!gameTeams.some(team=>team.id===activeTeamId))activeTeamId=gameTeams[0]?.id||'';
    const team=gameTeams.find(item=>item.id===activeTeamId),profile=team?dashboardStats.get(team.id):null;
    const stats=profile?.stats||{},recordMatches=(profile?.matches||[]).filter(match=>['completed','forfeit'].includes(match.status)).sort((a,b)=>new Date(b.scheduled_at||0)-new Date(a.scheduled_at||0));
    const hasStats=Boolean(profile?.stats),matchCount=hasStats?Number(stats.matches)||0:null,wins=hasStats?Number(stats.wins)||0:null,losses=hasStats?(Number.isFinite(Number(stats.losses))?Number(stats.losses):Math.max(0,matchCount-wins)):null,winRate=matchCount?Math.round(wins/matchCount*100):0;
    const teamPicker=gameTeams.length>1?`<label class="player-stat-team-picker"><span>Team</span><select id="playerStatTeam">${gameTeams.map(item=>`<option value="${esc(item.id)}"${item.id===activeTeamId?' selected':''}>${esc(item.name)}</option>`).join('')}</select></label>`:'';
    const history=recordMatches.length?`<div class="player-recent-results">${recordMatches.slice(0,5).map(match=>`<a class="player-result-row" href="tournament.html?id=${encodeURIComponent(match.tournament_id)}"><span class="player-result-mark ${match.won?'is-win':'is-loss'}">${match.won?'W':'L'}</span><span class="player-result-copy"><b>${esc(match.opponent||'Opponent')}</b><small>${esc(match.tournament||'Tournament')} · Round ${esc(match.round??'—')}</small></span><strong class="player-result-outcome">${match.won?'WIN':'LOSS'}</strong></a>`).join('')}</div>`:'<p class="player-stat-empty">No completed results for this game yet. Your record will appear here after a match is confirmed.</p>';
    const faceitStatsForGame=activeGame==='cs2'&&faceitLink?.verified&&faceitLink.lifetime_stats&&typeof faceitLink.lifetime_stats==='object'?Object.entries(faceitLink.lifetime_stats).filter(([,value])=>value!==null&&value!==undefined&&value!=='').slice(0,4):[];
    const externalStats=faceitStatsForGame.length?`<section class="player-game-external-stats"><div class="player-recent-head"><div><span class="player-dashboard-kicker">FACEIT · CS2</span><h3>Lifetime performance</h3></div>${faceitLink.skill_level?`<span>LEVEL ${esc(faceitLink.skill_level)}${faceitLink.faceit_elo?` · ${Number(faceitLink.faceit_elo).toLocaleString()} ELO`:''}</span>`:''}</div><div class="player-record-grid">${faceitStatsForGame.map(([label,value])=>`<article class="player-record-card"><span>${esc(label)}</span><b>${esc(value)}</b><small>FACEIT lifetime</small></article>`).join('')}</div></section>`:'';
    gameDashboard.innerHTML=`<div class="player-game-head"><div><span class="player-dashboard-kicker">YOUR GAME</span><h2>${esc(gameName(activeGame))}</h2><p>${team?`Team record · <b>${esc(team.name)}</b>`:'No team record yet for this game.'}</p></div>${teamPicker}</div><div class="player-record-grid"><article class="player-record-card player-record-feature"><span>Matches played</span><b>${matchCount??'—'}</b><small>${team?'Completed team matches':'No team matches yet'}</small></article><article class="player-record-card"><span>Wins</span><b>${wins??'—'}</b><small>${matchCount?`${winRate}% win rate`:'No results yet'}</small></article><article class="player-record-card"><span>Losses</span><b>${losses??'—'}</b><small>${team?'Confirmed results only':'No results yet'}</small></article><article class="player-record-card"><span>Win rate</span><b>${matchCount?`${winRate}%`:'—'}</b><small>${matchCount?'From completed matches':'No match stats yet'}</small></article></div>${externalStats}<section class="player-recent-card"><div class="player-recent-head"><div><span class="player-dashboard-kicker">RECENT FORM</span><h3>Recent results · ${esc(gameName(activeGame))}</h3></div><span>${recordMatches.length?`${Math.min(5,recordMatches.length)} shown`:'No results'}</span></div>${history}</section>`;
    list.querySelectorAll('[data-player-team-game]').forEach(card=>{card.hidden=Boolean(activeGame&&card.dataset.playerTeamGame!==activeGame);});
    renderGameList();
    $('#playerTeamsHeading').textContent=`My ${gameName(activeGame)} teams`;
    gameDashboard.querySelector('#playerStatTeam')?.addEventListener('change',event=>{activeTeamId=event.target.value;renderGameDashboard();renderMatches().catch(()=>{});});
  }
  const render=async()=>{
    list.innerHTML='<div class="team-empty">Loading your teams…</div>';
    const {data:memberships,error}=await SUPA.client.from('team_members').select('team_id,role,status')
      .eq('user_id',Auth.user.id).eq('status','active');
    if(error)throw error;
    const ids=[...new Set((memberships||[]).map(row=>row.team_id))];
    if(!ids.length){dashboardTeams=[];dashboardStats=new Map();renderGameDashboard();renderGameList();list.innerHTML='<div class="dcard"><div class="dh"><i data-lucide="users-round"></i>No teams yet</div><div class="db"><p class="team-empty">Accept a captain’s invitation link to join a team, or create your own team.</p></div></div>';icons();return;}
      const {data:teams, error:teamsError}=await SUPA.client.from('teams')
      .select('id,name,tag,game,region,logo_path').in('id',ids);
    if(teamsError)throw teamsError;
    await applyOrganizationTeamLogos(teams||[]);
    const byTeam=new Map((memberships||[]).map(row=>[row.team_id,row]));
    const rosters=await Promise.all((teams||[]).map(async team=>{
      const {data,error}=await SUPA.client.rpc('list_team_roster',{p_team_id:team.id});
      return {team,membership:byTeam.get(team.id),roster:data||[],error};
    }));
    const memberIds=[...new Set(rosters.flatMap(({roster})=>roster.map(row=>row.user_id)))];
    const {data:profiles,error:profileError}=memberIds.length?await SUPA.client.from('public_profiles').select('id,discord_username,avatar_path').in('id',memberIds):{data:[],error:null};
    if(profileError)throw profileError;
    const profileById=new Map((profiles||[]).map(profile=>[profile.id,profile]));
    dashboardTeams=teams||[];
    const teamProfiles=await Promise.all(dashboardTeams.map(async team=>{const {data,error}=await SUPA.client.rpc('get_public_team_profile',{p_team_id:team.id});return [team.id,error?null:data];}));
    dashboardStats=new Map(teamProfiles);
    list.innerHTML=rosters.map(({team,membership,roster,error})=>{
      const members=error?'<p class="team-empty">Roster details are unavailable.</p>':`<ul class="team-roster">${roster.map(row=>{const profile=profileById.get(row.user_id);return `<li>${identityImage(profile?.avatar_path,row.username||row.player_name||'Player',32,'player')}<span><b>${esc(row.username||row.player_name||'Player')}${row.user_id===Auth.user.id?' · You':''}</b><small>${esc(row.member_role||'player')}${profile?.discord_username?` · Discord @${esc(profile.discord_username)}`:''}</small></span>${row.member_role==='captain'?'<i data-lucide="crown" aria-label="Team captain"></i>':''}</li>`;}).join('')}</ul>`;
      const role=membership?.role||'player';
      return `<article class="dcard team-card" data-player-team-game="${esc(team.game)}"><div class="dh">${identityImage(team.logo_path,team.name,36,'team')}${esc(team.name)}<span class="mono-r">${esc(team.tag)}</span></div><div class="db">
        <div class="team-meta"><span>${esc(team.game.toUpperCase())}</span><span>${esc(team.region||'Region not set')}</span><span>Your role: ${esc(role)}</span></div>
        <h3 class="team-section-title">Team roster <span>${error?'':roster.length}</span></h3>${members}
        ${role==='captain'?'<a class="btn btn-line btn-sm" href="captain.html" style="margin-top:14px">Manage team</a>':`<button class="btn btn-line btn-sm" type="button" data-leave-team="${esc(team.id)}" style="margin-top:14px"${READ_ONLY_PREVIEW?' disabled aria-describedby="playerWorkspaceReadonly" title="Membership changes are disabled in this production-connected preview."':''}>Leave team</button>`}
      </div></article>`;
    }).join('');
    renderGameDashboard();
    icons();
  };
  list.addEventListener('click',async event=>{
    const button=event.target.closest('[data-leave-team]');
    if(!button||READ_ONLY_PREVIEW||!window.confirm('Leave this team? You may need a new invitation to rejoin.'))return;
    button.disabled=true;
    try{
      const {error}=await SUPA.client.rpc('leave_team',{p_team_id:button.dataset.leaveTeam});
      if(error)throw error;
      toast('ok','You left the team','Your membership has been updated.');
      try{await render();}catch(refreshError){toast('err','Membership changed, but the page did not refresh',refreshError.message||'Reload to see the updated roster.');}
    }catch(error){toast('err','Could not leave team',error.message||'Please try again.');button.disabled=false;}
  });
  try{await render();}catch(error){list.innerHTML='<div class="team-empty">Your team list could not be loaded.</div>';toast('err','Player workspace unavailable',error.message||'Please reload and try again.');}
  try{await renderMatches();}catch(error){matchHost.innerHTML='<p class="team-empty">Your matches could not be loaded. Please refresh this page.</p>';}
  updateMatchTimers();setInterval(updateMatchTimers,1000);
  setInterval(()=>renderMatches().catch(error=>console.warn('Match schedule refresh failed:',error)),30000);
  icons();
}).catch(error=>toast('err','Player workspace unavailable',error.message||'Please reload and try again.'));
