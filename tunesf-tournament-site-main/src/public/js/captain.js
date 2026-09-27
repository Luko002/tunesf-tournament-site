/* Remove former sample tournament, dispute, and score controls before auth settles. */
if(document.querySelector('.dgrid'))document.querySelector('.dgrid').innerHTML='<div class="dcard" style="grid-column:1/-1"><div class="dh">Team workspace</div><div class="db"><div class="workspace-state workspace-loading" role="status"><span class="workspace-state-icon"><i data-lucide="loader-circle"></i></span><div><b>Loading your team access</b><p>Checking your teams, roster and upcoming matches.</p></div></div></div></div>';
/* Team workspace: captain authority is scoped by team membership, never by a global role. */
Auth.ready.then(async()=>{
  if(!Auth.is()){
    location.replace('login.html?next='+encodeURIComponent('captain.html'));
    return;
  }
  const panel=document.querySelector('.dgrid');
  if(!panel)return;
  const isPlayer=Auth.user.roles.includes('PLAYER');
  panel.innerHTML=`
    <section class="dcard team-create-card" style="grid-column:1/-1">
      <details><summary class="dh"><i data-lucide="plus"></i>Create a new team</summary>
      <div class="db">
        <p style="color:var(--dim);margin-bottom:16px">The creator becomes captain of this team.</p>
        ${isPlayer?`<form id="teamCreateForm" class="team-create-form">
          <label><span>Team name</span><input name="name" minlength="2" maxlength="80" required placeholder="e.g. Tunisian squad"></label>
          <label><span>Short tag</span><input name="tag" minlength="2" maxlength="8" required placeholder="e.g. TNS"></label>
          <label><span>Game</span><select name="game" required><option value="">Choose a game</option><option value="cs2">Counter-Strike 2</option><option value="val">VALORANT</option><option value="lol">League of Legends</option><option value="rl">Rocket League</option><option value="mlbb">Mobile Legends: Bang Bang</option><option value="eafc">EA SPORTS FC</option><option value="efootball">eFootball</option></select></label>
          <label><span>Region</span><input name="region" maxlength="100" placeholder="e.g. Tunis"></label>
          <label><span>Team logo (optional, JPG/PNG/WebP up to 5 MB)</span><input name="logo" type="file" accept="image/jpeg,image/png,image/webp"></label>
          <button class="btn btn-gold btn-sm" type="submit"><i data-lucide="plus"></i>Create team</button>
        </form>`:`<p class="team-empty">Your account does not have a PLAYER account role. Ask a federation administrator to review your account.</p>`}
      </div></details>
    </section>
    <div id="teamCards" class="team-cards rv workspace-reveal" style="grid-column:1/-1"><div class="team-empty workspace-state workspace-loading" role="status"><span class="workspace-state-icon"><i data-lucide="loader-circle"></i></span><div><b>Loading your teams</b><p>Roster, invitations and match details will appear here.</p></div></div></div>`;
  icons();

  const gameName={cs2:'Counter-Strike 2',val:'VALORANT',lol:'League of Legends',rl:'Rocket League',mlbb:'Mobile Legends: Bang Bang',eafc:'EA SPORTS FC',efootball:'eFootball'};
  const fmtDate=value=>new Intl.DateTimeFormat(undefined,{dateStyle:'medium'}).format(new Date(value));
  const cards=$('#teamCards');
  let teams=[];
  let selectedTeamId='',selectedTab='overview';
  const selectedGames=new Map();
  const showError=(title,error)=>toast('err',title,error?.message||'Please try again.');
  function applyPreviewWriteState(){
    if(!READ_ONLY_PREVIEW)return;
    const selectors='form#teamCreateForm,form[data-submit-score],form[data-open-dispute],form[data-invite-form],[data-team-logo-input],[data-remove-team-logo],[data-delete-team],[data-member-role],[data-change-member],[data-remove-member],[data-team-checkin],[data-review-request],[data-read-message],[data-revoke],[data-game-member]';
    panel.querySelectorAll(selectors).forEach(control=>{
      if(control.matches('form'))control.querySelectorAll('input,select,textarea,button').forEach(input=>input.disabled=true);
      else control.disabled=true;
      control.setAttribute('title','Changes are disabled in this production-connected preview.');
    });
    if(!panel.querySelector('[data-preview-write-note]')){
      const note=document.createElement('p');note.className='team-empty preview-write-note';note.dataset.previewWriteNote='';note.setAttribute('role','note');
      note.textContent='Team changes are disabled in this production-connected preview. You can still review rosters, matches, invitations, and messages.';
      panel.prepend(note);
    }
  }

  async function loadTeams(){
    cards.innerHTML='<div class="team-empty">Loading your teams…</div>';
    const [membershipResult,organizationResult]=await Promise.all([
      SUPA.client.from('team_members').select('team_id').eq('user_id',Auth.user.id).eq('role','captain').eq('status','active'),
      SUPA.client.rpc('list_organizations_for_current_user')
    ]);
    const {data:membershipRows,error:membershipError}=membershipResult;
    if(membershipError)throw membershipError;
    const {data:organizations,error:organizationsError}=organizationResult;
    if(organizationsError)throw organizationsError;
    const organizationIds=[...new Set((organizations||[]).filter(org=>org.owner_id===Auth.user.id||(org.my_capabilities||[]).includes('manage_teams')).map(org=>org.id))];
    const organizationTeams=organizationIds.length?await SUPA.client.from('teams').select('id').in('organization_id',organizationIds):{data:[],error:null};
    if(organizationTeams.error)throw organizationTeams.error;
    const ids=[...new Set([...(membershipRows||[]).map(row=>row.team_id),...(organizationTeams.data||[]).map(row=>row.id)])];
    if(!ids.length){teams=[];cards.innerHTML='<div class="team-empty workspace-state"><span class="workspace-state-icon"><i data-lucide="users-round"></i></span><div><b>No teams yet</b><p>Create a team above to start building your roster.</p></div></div>';icons();return;}
    const {data,error}=await SUPA.client.from('teams').select('id,name,tag,game,region,created_at,logo_path,captain_id,organization_id').in('id',ids).order('created_at',{ascending:false});
    if(error)throw error;
    await applyOrganizationTeamLogos(data||[]);
    teams=data||[];
    if(!teams.length){cards.innerHTML='<div class="team-empty workspace-state"><span class="workspace-state-icon"><i data-lucide="search-x"></i></span><div><b>No team records found</b><p>There are no available team records for this account.</p></div></div>';icons();return;}
    const {data:registrations,error:registrationError}=await SUPA.client.from('tournament_registrations')
      .select('id,tournament_id,team_id,status').in('team_id',ids).order('created_at',{ascending:false});
    if(registrationError)throw registrationError;
    const registrationIds=[...new Set((registrations||[]).map(row=>row.id))];
    let events=[],matches=[],submissions=[],disputes=[];
    if(registrationIds.length){
      const [eventResult,matchResult]=await Promise.all([
        SUPA.client.from('tournaments').select('id,name,status,starts_at,check_in_minutes,best_of').in('id',[...new Set(registrations.map(r=>r.tournament_id))]),
        SUPA.client.from('tournament_matches').select('id,tournament_id,home_registration_id,away_registration_id,status,home_score,away_score,scheduled_at').or(`home_registration_id.in.(${registrationIds.join(',')}),away_registration_id.in.(${registrationIds.join(',')})`).order('scheduled_at',{ascending:true,nullsFirst:false})
      ]);
      if(eventResult.error)throw eventResult.error;if(matchResult.error)throw matchResult.error;
      events=eventResult.data||[];matches=matchResult.data||[];
      const matchIds=matches.map(row=>row.id);
      if(matchIds.length){
        const [submissionResult,disputeResult]=await Promise.all([
          SUPA.client.from('match_result_submissions').select('id,match_id,registration_id,status,home_score,away_score').in('match_id',matchIds),
          SUPA.client.from('match_disputes').select('id,match_id,status,opened_by').in('match_id',matchIds)
        ]);
        if(submissionResult.error)throw submissionResult.error;if(disputeResult.error)throw disputeResult.error;
        submissions=submissionResult.data||[];disputes=disputeResult.data||[];
      }
    }
    const eventById=new Map(events.map(row=>[row.id,row]));
    const results=await Promise.all(teams.map(async team=>{
      const [rosterResult,invitesResult,gamesResult,gameRosterResult,inboxResult]=await Promise.all([
        SUPA.client.rpc('list_team_roster',{p_team_id:team.id}),
        SUPA.client.rpc('list_team_invitations',{p_team_id:team.id}),
        SUPA.client.from('team_game_rosters').select('game').eq('team_id',team.id),
        SUPA.client.rpc('list_public_team_rosters',{p_team_id:team.id}),
        SUPA.client.rpc('get_team_captain_inbox',{p_team_id:team.id})
      ]);
      return {team,roster:rosterResult.data||[],rosterError:rosterResult.error,invites:invitesResult.data||[],invitesError:invitesResult.error,games:gamesResult.data||[],gamesError:gamesResult.error,gameRoster:gameRosterResult.data||[],gameRosterError:gameRosterResult.error,inbox:inboxResult.data||[],inboxError:inboxResult.error};
    }));
    const memberIds=[...new Set(results.flatMap(({roster})=>roster.map(row=>row.user_id)))];
    const {data:profiles,error:profileError}=memberIds.length?await SUPA.client.from('public_profiles').select('id,discord_username,avatar_path').in('id',memberIds):{data:[],error:null};
    if(profileError)throw profileError;
    const profileById=new Map((profiles||[]).map(profile=>[profile.id,profile]));
    if(!teams.some(team=>team.id===selectedTeamId))selectedTeamId=teams[0].id;
    const tabs=[['overview','Overview'],['players','Players'],['games','Game rosters'],['matches','Matches'],['inbox','Inbox'],['invitations','Invitations']];
    cards.innerHTML=`<label class="team-picker">Manage team<select id="captainTeamSelect" aria-label="Choose a team">${teams.map(team=>`<option value="${esc(team.id)}"${team.id===selectedTeamId?' selected':''}>${esc(team.name)} (${esc(team.tag)})</option>`).join('')}</select></label>`+results.map(({team,roster,rosterError,invites,invitesError,games,gamesError,gameRoster,gameRosterError,inbox,inboxError})=>{
      const active=roster.filter(row=>row.status==='active');
      const pending=invites.filter(inv=>!inv.revoked_at&&!inv.accepted_at&&new Date(inv.expires_at)>new Date());
      const rosterHtml=rosterError?'<p class="team-empty">Could not load this roster.</p>':active.length?`<ul class="team-roster">${active.map(row=>{
        const label=row.username||row.player_name||'Player';
        const self=row.user_id===Auth.user.id;
        const memberRole=row.member_role||'player';
        const controls=memberRole==='captain'?'<i data-lucide="crown" aria-label="Team captain"></i>':`<div class="team-member-actions"><select aria-label="Roster role" data-member-role="${esc(row.user_id)}"><option value="player"${memberRole==='player'?' selected':''}>Player</option><option value="substitute"${memberRole==='substitute'?' selected':''}>Substitute</option></select><button class="btn btn-line btn-sm" type="button" data-change-member="${esc(row.user_id)}" data-team="${esc(team.id)}">Save</button><button class="btn btn-line btn-sm" type="button" data-remove-member="${esc(row.user_id)}" data-team="${esc(team.id)}">Remove</button></div>`;
        const profile=profileById.get(row.user_id);
        return `<li>${identityImage(profile?.avatar_path,label,32,'player')}<span><b>${esc(label)}${self?' · You':''}</b><small>${esc(memberRole)}${profile?.discord_username?` · Discord @${esc(profile.discord_username)}`:''}${row.joined_at?' · Joined '+esc(fmtDate(row.joined_at)):''}</small></span>${controls}</li>`;
      }).join('')}</ul>`:'<p class="team-empty">No active roster members yet.</p>';
      const teamEvents=(registrations||[]).filter(row=>row.team_id===team.id);
      const org=organizations.find(row=>row.id===team.organization_id);
      const canDelete=team.captain_id===Auth.user.id||org?.owner_id===Auth.user.id;
      const teamRegistrationIds=new Set(teamEvents.map(row=>row.id));
      const teamMatches=matches.filter(match=>teamRegistrationIds.has(match.home_registration_id)||teamRegistrationIds.has(match.away_registration_id));
      const matchAttention=teamMatches.filter(match=>match.status==='disputed'||match.status==='ready'&&match.scheduled_at&&new Date(match.scheduled_at).getTime()<=Date.now()).length;
      const eventHtml=teamEvents.length?teamEvents.map(reg=>{
        const event=eventById.get(reg.tournament_id);if(!event)return '';
        const start=event.starts_at?new Date(event.starts_at):null,checkInOpen=!start||(Date.now()>=start.getTime()-Number(event.check_in_minutes||60)*60000&&Date.now()<=start.getTime());
        const checkin=reg.status==='approved'&&['registration_closed','in_progress'].includes(event.status)
          ?checkInOpen?`<button class="btn btn-line btn-sm" type="button" data-team-checkin="${esc(reg.id)}">Check in</button>`:`<small>${start&&Date.now()<start.getTime()-Number(event.check_in_minutes||60)*60000?'Check-in opens '+esc(new Date(start.getTime()-Number(event.check_in_minutes||60)*60000).toLocaleString()):'Check-in window is closed'}</small>`:'';
        const eventMatches=matches.filter(m=>m.home_registration_id===reg.id||m.away_registration_id===reg.id);
        const matchHtml=eventMatches.map(match=>{
          const overdue=match.status==='ready'&&match.scheduled_at&&new Date(match.scheduled_at).getTime()<=Date.now();
          const mine=submissions.find(s=>s.match_id===match.id&&s.registration_id===reg.id&&s.status==='pending');
          const accepted=submissions.find(s=>s.match_id===match.id&&s.registration_id===reg.id&&s.status==='accepted');
          const dispute=disputes.find(d=>d.match_id===match.id);
          const winsNeeded={BO1:1,BO3:2,BO5:3,BO7:4}[event.best_of]||2;
          const scoreForm=['live','result_pending'].includes(match.status)&&!mine&&!accepted
            ?`<form class="team-score-form event-actions" data-submit-score="${esc(match.id)}"><label>Home wins<input name="home_score" type="number" min="0" max="${winsNeeded}" required></label><label>Away wins<input name="away_score" type="number" min="0" max="${winsNeeded}" required></label><label><span>Evidence (optional, up to 5 files / 20 MB each)</span><input name="evidence" type="file" accept="image/jpeg,image/png,image/webp,video/mp4" multiple></label><small>Enter series wins. First to ${winsNeeded} wins takes the series.</small><button class="btn btn-gold btn-sm" type="submit">Submit score</button></form>`
            :mine?'<small>Your score is awaiting the other team and referee.</small>':accepted?'<small>Your score was reviewed by the referee.</small>':'';
          const disputeForm=!dispute&&['live','result_pending','completed'].includes(match.status)
            ?`<form class="team-dispute-form" data-open-dispute="${esc(match.id)}"><label><span>Dispute reason</span><input name="reason" minlength="5" maxlength="3000" required></label><button class="btn btn-line btn-sm" type="submit">Open dispute</button></form>`
            :dispute?`<small>Dispute ${esc(dispute.status.replaceAll('_',' '))}</small>`:'';
          return `<li class="event-reg"><div><b>Match ${esc(match.id.slice(0,8))} · ${overdue?'RESCHEDULE NEEDED':esc(match.status.replaceAll('_',' '))}</b><small>${overdue?'Scheduled time passed · ask the organizer to confirm a new time.':match.home_score===null?'Score pending':`${match.home_score} - ${match.away_score}`}</small>${scoreForm}${disputeForm}</div></li>`;
        }).join('');
        return `<li class="event-reg"><span><b>${esc(event.name)}</b><small>${esc(reg.status.replaceAll('_',' '))}${event.starts_at?' · '+esc(new Date(event.starts_at).toLocaleString()):''}</small></span>${checkin}</li>${matchHtml}`;
      }).join(''):'<li class="team-empty">This team has no tournament registrations.</li>';
      const pendingItems=invitesError?'<li class="team-empty">Could not load invitations.</li>':pending.length?pending.map(inv=>`<li data-pending-invitation="${esc(inv.invitation_id)}"><span><b>${esc(inv.member_role)}</b><small>Expires ${esc(fmtDate(inv.expires_at))}</small></span><button class="btn btn-line btn-sm" data-revoke="${esc(inv.invitation_id)}" data-team="${esc(team.id)}">Revoke</button></li>`).join(''):'<li class="team-empty">No pending invitations.</li>';
      const availableGames=[team.game];
      if(!availableGames.includes(selectedGames.get(team.id)))selectedGames.set(team.id,team.game);
      const gameRosterHtml=gameRosterError||gamesError?'<p class="team-empty">Could not load game rosters.</p>':games.filter(({game})=>game===team.game).map(({game})=>{
        const assigned=gameRoster.filter(row=>row.game===game);
        return `<div class="club-roster" data-game-panel="${esc(game)}"${game!==selectedGames.get(team.id)?' hidden':''}><b>${esc(gameName[game]||game)} <small>${assigned.length} players</small></b><div class="captain-game-assign">${active.map(member=>`<label><input type="checkbox" data-game-member="${esc(member.user_id)}" data-game="${esc(game)}" data-team="${esc(team.id)}"${assigned.some(row=>row.user_id===member.user_id)?' checked':''}>${esc(member.username||member.player_name||'Player')}</label>`).join('')}</div></div>`;
      }).join('')||'<p class="team-empty">Enable at least one game roster.</p>';
      const inboxHtml=inboxError?'<p class="team-empty">Could not load captain messages.</p>':inbox.length?`<div class="captain-inbox-list">${inbox.map(item=>`<article class="captain-inbox-item"><small>${item.item_type==='join_request'?'Join request':'Message'} · ${esc(item.username||'Player')} · ${esc(fmtDate(item.created_at))}${item.game?' · '+esc(gameName[item.game]||item.game):''}</small><p>${esc(item.message)}</p>${item.item_type==='join_request'&&item.status==='pending'?`<button class="btn btn-gold btn-sm" type="button" data-review-request="${esc(item.item_id)}" data-status="accepted">Accept</button><button class="btn btn-line btn-sm" type="button" data-review-request="${esc(item.item_id)}" data-status="declined">Decline</button>`:''}${item.item_type==='message'&&!item.read_at?`<button class="btn btn-line btn-sm" type="button" data-read-message="${esc(item.item_id)}">Mark read</button>`:''}</article>`).join('')}</div>`:'<p class="team-empty">No messages or join requests yet.</p>';
      const inboxAttention=inbox.filter(item=>item.item_type==='join_request'&&item.status==='pending'||item.item_type==='message'&&!item.read_at).length;
      const attention=inboxAttention+matchAttention;
      return `<article class="dcard team-card" data-team-card="${esc(team.id)}"${team.id!==selectedTeamId?' hidden':''}>
        <div class="dh">${identityImage(team.logo_path,team.name,36,'team')}${esc(team.name)}<span class="mono-r">${esc(team.tag)}</span></div>
        <div class="db"><div class="team-meta"><span>${esc(gameName[team.game]||team.game)}</span><span>${esc(team.region||'Region not set')}</span></div>
          <div class="profile-image-editor">${identityImage(team.logo_path,team.name,64,'team')}${team.organization_id?`<span>This team uses its organization’s logo.</span>`:`<label><span>Team logo (JPG/PNG/WebP, up to 5 MB)</span><input type="file" accept="image/jpeg,image/png,image/webp" data-team-logo-input="${esc(team.id)}"></label><button class="btn btn-line btn-sm" type="button" data-remove-team-logo="${esc(team.id)}"${team.team_logo_path?'':' hidden'}>Remove logo</button>`}<a class="btn btn-line btn-sm" href="team.html?id=${encodeURIComponent(team.id)}">Public team profile</a></div>
          <nav class="workspace-tabs" aria-label="Team sections">${tabs.map(([key,label])=>`<button type="button" data-workspace-tab="${key}" aria-pressed="${key===selectedTab}" class="${key===selectedTab?'active':''}">${label}${key==='inbox'&&inboxAttention?` <span aria-label="${inboxAttention} unread messages or pending join requests">${inboxAttention}</span>`:''}</button>`).join('')}</nav>
          <section data-workspace-panel="overview"${selectedTab!=='overview'?' hidden':''}><div class="team-snapshot"><div><b>${active.length}</b><small>Active members</small></div><div><b>${gameRoster.filter(row=>row.game===team.game).length}</b><small>Game players</small></div><div><b>${teamEvents.length}</b><small>Tournaments</small></div><div><b>${attention}</b><small>Need attention</small></div></div><p class="team-empty">This team represents ${esc(gameName[team.game]||team.game)}. Its captain can manage this game's roster, matches, and messages. Organization owners can assign the captain and create other game teams.</p>${canDelete?`<section class="team-danger-zone" aria-labelledby="deleteTeamHeading-${esc(team.id)}"><div><b id="deleteTeamHeading-${esc(team.id)}">Delete this team</b><small>Removes this team and its roster. Tournament registrations and match history are preserved, so teams with tournament history cannot be deleted.</small></div><button class="btn btn-line btn-sm team-danger-action" type="button" data-delete-team="${esc(team.id)}"${teamEvents.length?' disabled aria-describedby="deleteTeamHeading-'+esc(team.id)+'" title="This team has tournament records and cannot be deleted."':''}>Delete team</button></section>`:''}</section>
          <section data-workspace-panel="players"${selectedTab!=='players'?' hidden':''}><h3 class="team-section-title">Active players <span>${active.length}</span></h3>${rosterHtml}</section>
          <section data-workspace-panel="games"${selectedTab!=='games'?' hidden':''}><h3 class="team-section-title">${esc(gameName[team.game]||team.game)} roster</h3><p style="color:var(--dim)">Every game has its own team and captain. Ask the organization owner to create another game team.</p>${gameRosterHtml}</section>
          <section data-workspace-panel="matches"${selectedTab!=='matches'?' hidden':''}><h3 class="team-section-title">Tournament participation <span>${teamEvents.length}</span></h3><ul class="team-invites">${eventHtml}</ul></section>
          <section data-workspace-panel="inbox"${selectedTab!=='inbox'?' hidden':''}><h3 class="team-section-title">Player messages <span>${inboxAttention}</span></h3>${inboxHtml}</section>
          <section data-workspace-panel="invitations"${selectedTab!=='invitations'?' hidden':''}><h3 class="team-section-title">Invite players</h3>
          <form class="invite-create-form" data-invite-form="${esc(team.id)}">
            <label><span>Invite as</span><select name="member_role"><option value="player">Player</option><option value="substitute">Substitute</option></select></label>
            <button class="btn btn-line btn-sm" type="submit"><i data-lucide="link"></i>Create invite link</button>
          </form>
          <div class="invite-link-output" data-invite-output="${esc(team.id)}" hidden></div>
          <h3 class="team-section-title">Pending invitations <span data-pending-count="${esc(team.id)}">${pending.length}</span></h3><ul class="team-invites" data-invites="${esc(team.id)}">${pendingItems}</ul></section>
        </div>
      </article>`;
    }).join('');
    applyPreviewWriteState();
    icons();
  }

  const createForm=$('#teamCreateForm');
  panel.addEventListener('change',event=>{
    const logoInput=event.target.closest('[data-team-logo-input]');
    if(READ_ONLY_PREVIEW&&logoInput)return;
    if(logoInput){void (async()=>{const file=logoInput.files?.[0];if(!file)return;logoInput.disabled=true;try{const team=teams.find(row=>row.id===logoInput.dataset.teamLogoInput);const path=await uploadPublicImage(file,`teams/${team.id}`);const {error}=await SUPA.client.rpc('set_team_logo_path',{p_team_id:team.id,p_logo_path:path});if(error){await removePublicImage(path);throw error;}await removePublicImage(team.team_logo_path||team.logo_path);toast('ok','Team logo saved','It now appears on the team profile, standings, and event pages.');await loadTeams();}catch(error){showError('Could not save team logo',error);}finally{logoInput.disabled=false;logoInput.value='';}})();return;}
    if(event.target.id==='captainTeamSelect'){
      selectedTeamId=event.target.value;
      cards.querySelectorAll('[data-team-card]').forEach(card=>card.hidden=card.dataset.teamCard!==selectedTeamId);
      cards.querySelector(`[data-team-card="${CSS.escape(selectedTeamId)}"] [data-workspace-tab="${selectedTab}"]`)?.click();
    }
  });
  panel.addEventListener('click',event=>{
    const button=event.target.closest('[data-remove-team-logo]');if(!button)return;
    if(READ_ONLY_PREVIEW)return;
    void (async()=>{button.disabled=true;try{const team=teams.find(row=>row.id===button.dataset.removeTeamLogo);const {error}=await SUPA.client.rpc('set_team_logo_path',{p_team_id:team.id,p_logo_path:null});if(error)throw error;await removePublicImage(team.team_logo_path||team.logo_path);toast('ok','Team logo removed','The team initials will be shown instead.');await loadTeams();}catch(error){showError('Could not remove team logo',error);}finally{button.disabled=false;}})();
  });
  createForm?.addEventListener('submit',async event=>{
    event.preventDefault();
    if(READ_ONLY_PREVIEW)return;
    const button=createForm.querySelector('button[type="submit"]');
    button.disabled=true;
    const values=Object.fromEntries(new FormData(createForm));
    try{
      const {data:teamId,error}=await SUPA.client.rpc('create_team',{
        p_name:String(values.name).trim(),p_tag:String(values.tag).trim().toUpperCase(),
        p_game:values.game,p_region:String(values.region||'').trim()
      });
      if(error)throw error;
      const logo=values.logo;
      if(logo?.size){try{const path=await uploadPublicImage(logo,`teams/${teamId}`);const {error:logoError}=await SUPA.client.rpc('set_team_logo_path',{p_team_id:teamId,p_logo_path:path});if(logoError){await removePublicImage(path);throw logoError;}}catch(logoError){toast('info','Team created, logo not saved',logoError.message||'You can add the logo later from Team management.');}}
      createForm.reset();
      toast('ok','Team created','You are now captain of this team.');
      try{await loadTeams();}catch(refreshError){showError('Team created, but the workspace did not refresh',refreshError);}
    }catch(error){showError('Could not create team',error);}
    finally{button.disabled=false;}
  });

  panel.addEventListener('submit',async event=>{
    const scoreForm=event.target.closest('[data-submit-score]');
    if(scoreForm){
      event.preventDefault();
      if(READ_ONLY_PREVIEW)return;
      const button=scoreForm.querySelector('button[type="submit"]');button.disabled=true;
      const values=new FormData(scoreForm);
      const files=[...(scoreForm.elements.evidence?.files||[])];
      const keys=[];
      try{
        if(files.length>5)throw new Error('Attach no more than five evidence files.');
        const allowed=new Set(['image/jpeg','image/png','image/webp','video/mp4']);
        if(files.some(file=>!allowed.has(file.type)||file.size<1||file.size>20*1024*1024))throw new Error('Evidence must be a non-empty JPEG, PNG, WebP, or MP4 file under 20 MB.');
        for(const file of files){
          const ext={"image/jpeg":"jpg","image/png":"png","image/webp":"webp","video/mp4":"mp4"}[file.type];
          const key=`${scoreForm.dataset.submitScore}/${Auth.user.id}/${crypto.randomUUID().replaceAll('-','')}.${ext}`;
          const {error:uploadError}=await SUPA.client.storage.from('match-evidence').upload(key,file,{cacheControl:'3600',contentType:file.type,upsert:false});
          if(uploadError)throw uploadError;keys.push(key);
        }
        const {error}=await SUPA.client.rpc('submit_match_result',{p_match_id:scoreForm.dataset.submitScore,p_home_score:Number(values.get('home_score')),p_away_score:Number(values.get('away_score')),p_evidence_object_keys:keys});
        if(error)throw error;
        toast('ok','Score submitted','The result is awaiting confirmation and referee review.');
        try{await loadTeams();}catch(refreshError){showError('Score submitted, but the workspace did not refresh',refreshError);}
      }catch(error){if(keys.length)await SUPA.client.storage.from('match-evidence').remove(keys).catch(()=>{});showError('Could not submit score',error);button.disabled=false;}
      return;
    }
    const disputeForm=event.target.closest('[data-open-dispute]');
    if(disputeForm){
      event.preventDefault();
      if(READ_ONLY_PREVIEW)return;
      const button=disputeForm.querySelector('button[type="submit"]');button.disabled=true;
      try{
        const {error}=await SUPA.client.rpc('open_match_dispute',{p_match_id:disputeForm.dataset.openDispute,p_reason:String(new FormData(disputeForm).get('reason')||'').trim()});
        if(error)throw error;
        toast('ok','Dispute opened','A tournament official can now review the issue.');
        try{await loadTeams();}catch(refreshError){showError('Dispute opened, but the workspace did not refresh',refreshError);}
      }catch(error){showError('Could not open dispute',error);button.disabled=false;}
      return;
    }
    const form=event.target.closest('[data-invite-form]');
    if(!form)return;
    event.preventDefault();
    if(READ_ONLY_PREVIEW)return;
    const teamId=form.dataset.inviteForm, button=form.querySelector('button[type="submit"]');
    button.disabled=true;
    try{
      const role=new FormData(form).get('member_role');
      const {data,error}=await SUPA.client.rpc('create_team_invitation',{p_team_id:teamId,p_member_role:role});
      if(error)throw error;
      const result=Array.isArray(data)?data[0]:data;
      if(!result?.token)throw new Error('The invitation service did not return a link token.');
      const link=new URL('join-team.html',location.href);link.searchParams.set('token',result.token);
      const output=panel.querySelector(`[data-invite-output="${CSS.escape(teamId)}"]`);
      output.hidden=false;
      output.innerHTML=`<label><span>Single-use invite link · expires ${esc(fmtDate(result.expires_at))}</span><input readonly value="${esc(link.href)}"></label><button class="btn btn-gold btn-sm" type="button" data-copy="${esc(teamId)}"><i data-lucide="copy"></i>Copy link</button>`;
      output.dataset.link=link.href;
      const list=panel.querySelector(`[data-invites="${CSS.escape(teamId)}"]`);
      if(list){
        const empty=list.querySelector('.team-empty');if(empty)empty.remove();
        const item=document.createElement('li');item.dataset.pendingInvitation=result.invitation_id;
        item.innerHTML=`<span><b>${esc(role)}</b><small>Expires ${esc(fmtDate(result.expires_at))}</small></span><button class="btn btn-line btn-sm" data-revoke="${esc(result.invitation_id)}" data-team="${esc(teamId)}">Revoke</button>`;
        list.prepend(item);
        const count=panel.querySelector(`[data-pending-count="${CSS.escape(teamId)}"]`);
        if(count)count.textContent=String(Number(count.textContent||0)+1);
      }
      toast('ok','Invite link ready','Copy it and send it directly to the player.');
      icons();
    }catch(error){showError('Could not create invitation',error);}
    finally{button.disabled=false;}
  });

  panel.addEventListener('click',async event=>{
    const tab=event.target.closest('[data-workspace-tab]');
    if(tab){
      selectedTab=tab.dataset.workspaceTab;
      const card=tab.closest('[data-team-card]');
      card.querySelectorAll('[data-workspace-tab]').forEach(button=>{button.classList.toggle('active',button===tab);button.setAttribute('aria-pressed',String(button===tab));});
      card.querySelectorAll('[data-workspace-panel]').forEach(section=>section.hidden=section.dataset.workspacePanel!==selectedTab);
      return;
    }
    const gameTab=event.target.closest('[data-game-tab]');
    if(gameTab){
      const card=gameTab.closest('[data-team-card]');
      selectedGames.set(card.dataset.teamCard,gameTab.dataset.gameTab);
      card.querySelectorAll('[data-game-tab]').forEach(button=>{button.classList.toggle('active',button===gameTab);button.setAttribute('aria-pressed',String(button===gameTab));});
      card.querySelectorAll('[data-game-panel]').forEach(section=>section.hidden=section.dataset.gamePanel!==gameTab.dataset.gameTab);
      return;
    }
    const deleteTeam=event.target.closest('[data-delete-team]');
    if(deleteTeam){
      if(READ_ONLY_PREVIEW)return;
      const team=teams.find(row=>row.id===deleteTeam.dataset.deleteTeam);
      if(!team||!window.confirm(`Permanently delete ${team.name} (${team.tag}) and its roster? This cannot be undone. Teams with tournament registrations or match history cannot be deleted.`))return;
      deleteTeam.disabled=true;
      try{
        const {error}=await SUPA.client.rpc('delete_team',{p_team_id:team.id});
        if(error)throw error;
        toast('ok','Team deleted','The team profile and roster were removed. Tournament records are preserved.');
        await loadTeams();
      }catch(error){showError('Could not delete team',error);deleteTeam.disabled=false;}
      return;
    }
    const review=event.target.closest('[data-review-request]');
    if(review){
      if(READ_ONLY_PREVIEW)return;
      review.disabled=true;
      try{
        const {error}=await SUPA.client.rpc('review_team_join_request',{p_request_id:review.dataset.reviewRequest,p_status:review.dataset.status});
        if(error)throw error;
        toast('ok',review.dataset.status==='accepted'?'Player joined':'Request declined',review.dataset.status==='accepted'?'The player was added to the requested game roster.':'The player request was declined.');
        try{await loadTeams();}catch(refreshError){showError('Request updated, but the workspace did not refresh',refreshError);}
      }catch(error){showError('Could not review request',error);review.disabled=false;}
      return;
    }
    const read=event.target.closest('[data-read-message]');
    if(read){
      if(READ_ONLY_PREVIEW)return;
      read.disabled=true;
      try{const {error}=await SUPA.client.rpc('mark_team_message_read',{p_message_id:read.dataset.readMessage});if(error)throw error;await loadTeams();}
      catch(error){showError('Could not update message',error);read.disabled=false;}
      return;
    }
    const checkin=event.target.closest('[data-team-checkin]');
    if(checkin){
      if(READ_ONLY_PREVIEW)return;
      checkin.disabled=true;
      try{
        const {error}=await SUPA.client.rpc('check_in_team',{p_registration_id:checkin.dataset.teamCheckin});
        if(error)throw error;
        toast('ok','Team checked in','Your approved roster is checked in for this tournament.');
        try{await loadTeams();}catch(refreshError){showError('Team checked in, but the workspace did not refresh',refreshError);}
      }catch(error){showError('Could not check in team',error);checkin.disabled=false;}
      return;
    }
    const copy=event.target.closest('[data-copy]');
    if(copy){
      const output=panel.querySelector(`[data-invite-output="${CSS.escape(copy.dataset.copy)}"]`);
      const link=output?.dataset.link;
      if(!link)return;
      try{await navigator.clipboard.writeText(link);toast('ok','Invite link copied','Send the link to the intended player.');}
      catch{const input=output.querySelector('input');input?.select();toast('info','Copy the selected link','Clipboard access was unavailable.');}
      return;
    }
    const change=event.target.closest('[data-change-member]');
    if(change){
      if(READ_ONLY_PREVIEW)return;
      const userId=change.dataset.changeMember, teamId=change.dataset.team;
      const role=panel.querySelector(`[data-member-role="${CSS.escape(userId)}"]`)?.value;
      if(!role)return;
      change.disabled=true;
      try{
        const {error}=await SUPA.client.rpc('change_member_role',{p_team_id:teamId,p_user_id:userId,p_member_role:role});
        if(error)throw error;
        toast('ok','Roster updated','The team role was changed.');
        try{await loadTeams();}catch(refreshError){showError('Roster changed, but the workspace did not refresh',refreshError);}
      }catch(error){showError('Could not update roster role',error);change.disabled=false;}
      return;
    }
    const remove=event.target.closest('[data-remove-member]');
    if(remove){
      if(READ_ONLY_PREVIEW)return;
      const userId=remove.dataset.removeMember, teamId=remove.dataset.team;
      if(!window.confirm('Remove this player from the team roster?'))return;
      remove.disabled=true;
      try{
        const {error}=await SUPA.client.rpc('remove_team_member',{p_team_id:teamId,p_user_id:userId});
        if(error)throw error;
        toast('ok','Player removed','The roster has been updated.');
        try{await loadTeams();}catch(refreshError){showError('Player removed, but the workspace did not refresh',refreshError);}
      }catch(error){showError('Could not remove player',error);remove.disabled=false;}
      return;
    }
    const revoke=event.target.closest('[data-revoke]');
    if(revoke){
      if(READ_ONLY_PREVIEW)return;
      revoke.disabled=true;
      try{
        const {error}=await SUPA.client.rpc('revoke_team_invitation',{p_invitation_id:revoke.dataset.revoke});
        if(error)throw error;
        toast('ok','Invitation revoked','That link can no longer be used.');
        try{await loadTeams();}catch(refreshError){showError('Invitation revoked, but the workspace did not refresh',refreshError);}
      }catch(error){showError('Could not revoke invitation',error);revoke.disabled=false;}
    }
  });

  panel.addEventListener('change',async event=>{
    if(event.target.closest('[data-team-logo-input]'))return;
    const input=event.target.closest('[data-game-member]');if(!input)return;
    if(READ_ONLY_PREVIEW)return;
    input.disabled=true;
    try{
      const {error}=await SUPA.client.rpc('set_team_game_member',{p_team_id:input.dataset.team,p_game:input.dataset.game,p_user_id:input.dataset.gameMember,p_active:input.checked});
      if(error)throw error;
      toast('ok','Game roster updated','The player assignment has been saved.');
      try{await loadTeams();}catch(refreshError){showError('Game roster saved, but the workspace did not refresh',refreshError);}
    }catch(error){input.checked=!input.checked;showError('Could not update game roster',error);}
    finally{input.disabled=false;}
  });

  try{await loadTeams();}
  catch(error){
    console.error('Captain team workspace failed to load:',error);
    const message=error?.message||'A network or service error prevented the team data from loading.';
    const permissionIssue=/permission denied|row-level security|not allowed/i.test(message);
    const guidance=permissionIssue?'Your account or database policy does not currently allow this request. Contact a TUNESF administrator to review access.':'Check your connection or try again in a moment.';
    cards.innerHTML=`<div class="team-empty workspace-state workspace-error" role="alert"><span class="workspace-state-icon"><i data-lucide="triangle-alert"></i></span><div class="workspace-state-copy"><b>We couldn’t load your teams</b><p>${esc(message)}</p><span>${guidance} Your team data has not been changed.</span><button class="btn btn-line btn-sm" type="button" id="retryTeamLoad"><i data-lucide="refresh-cw"></i>Try again</button></div></div>`;
    $('#retryTeamLoad')?.addEventListener('click',async event=>{const button=event.currentTarget;button.disabled=true;button.innerHTML='<i data-lucide="loader-circle"></i>Trying again';icons();cards.classList.remove('on');try{await loadTeams();}catch(retryError){console.error('Captain team workspace retry failed:',retryError);const copy=cards.querySelector('.workspace-state-copy p');if(copy)copy.textContent=retryError?.message||'The connection is still unavailable. Please try again.';const retryGuidance=cards.querySelector('.workspace-state-copy>span');if(retryGuidance)retryGuidance.textContent=/permission denied|row-level security|not allowed/i.test(retryError?.message||'')?'Your account or database policy does not currently allow this request. Contact a TUNESF administrator to review access.':'Check your connection or try again in a moment. Your team data has not been changed.';}finally{const retry=cards.querySelector('#retryTeamLoad');if(retry){retry.disabled=false;retry.innerHTML='<i data-lucide="refresh-cw"></i>Try again';icons();cards.classList.add('on');}}});
    icons();showError('Team workspace unavailable',error);
  }
  buildConsoleStrip();
  icons();
}).catch(error=>{console.error('Captain workspace startup failed:',error);const panel=document.querySelector('.dgrid');if(panel)panel.innerHTML=`<div class="team-empty workspace-state workspace-error" role="alert"><span class="workspace-state-icon"><i data-lucide="triangle-alert"></i></span><div class="workspace-state-copy"><b>Team workspace unavailable</b><p>${esc(error?.message||'Account access could not be initialized.')}</p><a class="btn btn-line btn-sm" href="captain.html"><i data-lucide="refresh-cw"></i>Reload workspace</a></div></div>`;icons();toast('err','Team workspace unavailable',error?.message||'Please reload and try again.');});
