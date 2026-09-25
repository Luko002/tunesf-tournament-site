/* Remove former sample tournament, dispute, and score controls before auth settles. */
if(document.querySelector('.dgrid'))document.querySelector('.dgrid').innerHTML='<div class="dcard" style="grid-column:1/-1"><div class="dh">Team workspace</div><div class="db">Loading your team access…</div></div>';
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
    <section class="dcard" style="grid-column:1/-1">
      <div class="dh"><i data-lucide="users-round"></i>Team workspace</div>
      <div class="db">
        <p style="color:var(--dim);margin-bottom:16px">Create a team as a player. The creator becomes captain of that team only; team authority does not grant platform-wide permissions.</p>
        ${isPlayer?`<form id="teamCreateForm" class="team-create-form">
          <label><span>Team name</span><input name="name" minlength="2" maxlength="80" required placeholder="e.g. Tunisian squad"></label>
          <label><span>Short tag</span><input name="tag" minlength="2" maxlength="8" required placeholder="e.g. TNS"></label>
          <label><span>Game</span><select name="game" required><option value="">Choose a game</option><option value="cs2">Counter-Strike 2</option><option value="val">VALORANT</option><option value="lol">League of Legends</option><option value="rl">Rocket League</option><option value="eafc">EA SPORTS FC</option></select></label>
          <label><span>Region</span><input name="region" maxlength="100" placeholder="e.g. Tunis"></label>
          <button class="btn btn-gold btn-sm" type="submit"><i data-lucide="plus"></i>Create team</button>
        </form>`:`<p class="team-empty">Your account does not have a PLAYER account role. Ask a federation administrator to review your account.</p>`}
      </div>
    </section>
    <div id="teamCards" class="team-cards" style="grid-column:1/-1"><div class="team-empty">Loading your teams…</div></div>`;
  icons();

  const gameName={cs2:'Counter-Strike 2',val:'VALORANT',lol:'League of Legends',rl:'Rocket League',eafc:'EA SPORTS FC'};
  const fmtDate=value=>new Intl.DateTimeFormat(undefined,{dateStyle:'medium'}).format(new Date(value));
  const cards=$('#teamCards');
  let teams=[];
  const showError=(title,error)=>toast('err',title,error?.message||'Please try again.');

  async function loadTeams(){
    cards.innerHTML='<div class="team-empty">Loading your teams…</div>';
    const {data:membershipRows,error:membershipError}=await SUPA.client.from('team_members')
      .select('team_id').eq('user_id',Auth.user.id).eq('role','captain').eq('status','active');
    if(membershipError)throw membershipError;
    const ids=[...new Set((membershipRows||[]).map(row=>row.team_id))];
    if(!ids.length){teams=[];cards.innerHTML='<div class="team-empty">You do not captain a team yet. Create one above to get started.</div>';return;}
    const {data,error}=await SUPA.client.from('teams').select('id,name,tag,game,region,created_at').in('id',ids).order('created_at',{ascending:false});
    if(error)throw error;
    teams=data||[];
    if(!teams.length){cards.innerHTML='<div class="team-empty">No team records are available for this account.</div>';return;}
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
    const {data:profiles,error:profileError}=memberIds.length?await SUPA.client.from('public_profiles').select('id,discord_username').in('id',memberIds):{data:[],error:null};
    if(profileError)throw profileError;
    const discordById=new Map((profiles||[]).map(profile=>[profile.id,profile.discord_username]));
    cards.innerHTML=results.map(({team,roster,rosterError,invites,invitesError,games,gamesError,gameRoster,gameRosterError,inbox,inboxError})=>{
      const active=roster.filter(row=>row.status==='active');
      const pending=invites.filter(inv=>!inv.revoked_at&&!inv.accepted_at&&new Date(inv.expires_at)>new Date());
      const rosterHtml=rosterError?'<p class="team-empty">Could not load this roster.</p>':active.length?`<ul class="team-roster">${active.map(row=>{
        const label=row.username||row.player_name||'Player';
        const self=row.user_id===Auth.user.id;
        const memberRole=row.member_role||'player';
        const controls=memberRole==='captain'?'<i data-lucide="crown" aria-label="Team captain"></i>':`<div class="team-member-actions"><select aria-label="Roster role" data-member-role="${esc(row.user_id)}"><option value="player"${memberRole==='player'?' selected':''}>Player</option><option value="substitute"${memberRole==='substitute'?' selected':''}>Substitute</option></select><button class="btn btn-line btn-sm" type="button" data-change-member="${esc(row.user_id)}" data-team="${esc(team.id)}">Save</button><button class="btn btn-line btn-sm" type="button" data-remove-member="${esc(row.user_id)}" data-team="${esc(team.id)}">Remove</button></div>`;
        return `<li><span><b>${esc(label)}${self?' · You':''}</b><small>${esc(memberRole)}${discordById.get(row.user_id)?` · Discord @${esc(discordById.get(row.user_id))}`:''}${row.joined_at?' · Joined '+esc(fmtDate(row.joined_at)):''}</small></span>${controls}</li>`;
      }).join('')}</ul>`:'<p class="team-empty">No active roster members yet.</p>';
      const teamEvents=(registrations||[]).filter(row=>row.team_id===team.id);
      const eventHtml=teamEvents.length?teamEvents.map(reg=>{
        const event=eventById.get(reg.tournament_id);if(!event)return '';
        const start=event.starts_at?new Date(event.starts_at):null,checkInOpen=!start||(Date.now()>=start.getTime()-Number(event.check_in_minutes||60)*60000&&Date.now()<=start.getTime());
        const checkin=reg.status==='approved'&&['registration_closed','in_progress'].includes(event.status)
          ?checkInOpen?`<button class="btn btn-line btn-sm" type="button" data-team-checkin="${esc(reg.id)}">Check in</button>`:`<small>${start&&Date.now()<start.getTime()-Number(event.check_in_minutes||60)*60000?'Check-in opens '+esc(new Date(start.getTime()-Number(event.check_in_minutes||60)*60000).toLocaleString()):'Check-in window is closed'}</small>`:'';
        const eventMatches=matches.filter(m=>m.home_registration_id===reg.id||m.away_registration_id===reg.id);
        const matchHtml=eventMatches.map(match=>{
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
          return `<li class="event-reg"><div><b>Match ${esc(match.id.slice(0,8))} · ${esc(match.status.replaceAll('_',' '))}</b><small>${match.home_score===null?'Score pending':`${match.home_score} - ${match.away_score}`}</small>${scoreForm}${disputeForm}</div></li>`;
        }).join('');
        return `<li class="event-reg"><span><b>${esc(event.name)}</b><small>${esc(reg.status.replaceAll('_',' '))}${event.starts_at?' · '+esc(new Date(event.starts_at).toLocaleString()):''}</small></span>${checkin}</li>${matchHtml}`;
      }).join(''):'<li class="team-empty">This team has no tournament registrations.</li>';
      const pendingItems=invitesError?'<li class="team-empty">Could not load invitations.</li>':pending.length?pending.map(inv=>`<li data-pending-invitation="${esc(inv.invitation_id)}"><span><b>${esc(inv.member_role)}</b><small>Expires ${esc(fmtDate(inv.expires_at))}</small></span><button class="btn btn-line btn-sm" data-revoke="${esc(inv.invitation_id)}" data-team="${esc(team.id)}">Revoke</button></li>`).join(''):'<li class="team-empty">No pending invitations.</li>';
      const gameRosterHtml=gameRosterError||gamesError?'<p class="team-empty">Could not load game rosters.</p>':games.map(({game})=>{
        const assigned=gameRoster.filter(row=>row.game===game);
        return `<div class="club-roster"><b>${esc(gameName[game]||game)} <small>${assigned.length} players</small></b><div class="captain-game-assign">${active.map(member=>`<label><input type="checkbox" data-game-member="${esc(member.user_id)}" data-game="${esc(game)}" data-team="${esc(team.id)}"${assigned.some(row=>row.user_id===member.user_id)?' checked':''}>${esc(member.username||member.player_name||'Player')}</label>`).join('')}</div></div>`;
      }).join('')||'<p class="team-empty">Enable at least one game roster.</p>';
      const inboxHtml=inboxError?'<p class="team-empty">Could not load captain messages.</p>':inbox.length?`<div class="captain-inbox-list">${inbox.map(item=>`<article class="captain-inbox-item"><small>${item.item_type==='join_request'?'Join request':'Message'} · ${esc(item.username||'Player')} · ${esc(fmtDate(item.created_at))}${item.game?' · '+esc(gameName[item.game]||item.game):''}</small><p>${esc(item.message)}</p>${item.item_type==='join_request'&&item.status==='pending'?`<button class="btn btn-gold btn-sm" type="button" data-review-request="${esc(item.item_id)}" data-status="accepted">Accept</button><button class="btn btn-line btn-sm" type="button" data-review-request="${esc(item.item_id)}" data-status="declined">Decline</button>`:''}${item.item_type==='message'&&!item.read_at?`<button class="btn btn-line btn-sm" type="button" data-read-message="${esc(item.item_id)}">Mark read</button>`:''}</article>`).join('')}</div>`:'<p class="team-empty">No messages or join requests yet.</p>';
      return `<article class="dcard team-card" data-team-card="${esc(team.id)}">
        <div class="dh"><i data-lucide="shield"></i>${esc(team.name)}<span class="mono-r">${esc(team.tag)}</span></div>
        <div class="db"><div class="team-meta"><span>${esc(gameName[team.game]||team.game)}</span><span>${esc(team.region||'Region not set')}</span></div>
          <h3 class="team-section-title">Active roster <span>${active.length}</span></h3>${rosterHtml}
          <h3 class="team-section-title">Game rosters</h3>${gamesError?'':`<form class="captain-games-form" data-team-games="${esc(team.id)}">${Object.entries(gameName).map(([key,label])=>`<label><input type="checkbox" name="game" value="${esc(key)}"${games.some(g=>g.game===key)?' checked':''}${team.game===key?' disabled':''}>${esc(label)}${team.game===key?`<input type="hidden" name="game" value="${esc(key)}">`:''}</label>`).join('')}<button class="btn btn-line btn-sm" type="submit">Save games</button></form>`}${gameRosterHtml}
          <h3 class="team-section-title">Player messages <span>${inbox.filter(item=>item.item_type==='join_request'&&item.status==='pending').length+inbox.filter(item=>item.item_type==='message'&&!item.read_at).length}</span></h3>${inboxHtml}
          <h3 class="team-section-title">Tournament participation <span>${teamEvents.length}</span></h3><ul class="team-invites">${eventHtml}</ul>
          <form class="invite-create-form" data-invite-form="${esc(team.id)}">
            <label><span>Invite as</span><select name="member_role"><option value="player">Player</option><option value="substitute">Substitute</option></select></label>
            <button class="btn btn-line btn-sm" type="submit"><i data-lucide="link"></i>Create invite link</button>
          </form>
          <div class="invite-link-output" data-invite-output="${esc(team.id)}" hidden></div>
          <h3 class="team-section-title">Pending invitations <span data-pending-count="${esc(team.id)}">${pending.length}</span></h3><ul class="team-invites" data-invites="${esc(team.id)}">${pendingItems}</ul>
        </div>
      </article>`;
    }).join('');
    icons();
  }

  const createForm=$('#teamCreateForm');
  createForm?.addEventListener('submit',async event=>{
    event.preventDefault();
    const button=createForm.querySelector('button[type="submit"]');
    button.disabled=true;
    const values=Object.fromEntries(new FormData(createForm));
    try{
      const {data,error}=await SUPA.client.rpc('create_team',{
        p_name:String(values.name).trim(),p_tag:String(values.tag).trim().toUpperCase(),
        p_game:values.game,p_region:String(values.region||'').trim()
      });
      if(error)throw error;
      createForm.reset();
      toast('ok','Team created','You are now captain of this team.');
      try{await loadTeams();}catch(refreshError){showError('Team created, but the workspace did not refresh',refreshError);}
    }catch(error){showError('Could not create team',error);}
    finally{button.disabled=false;}
  });

  panel.addEventListener('submit',async event=>{
    const gamesForm=event.target.closest('[data-team-games]');
    if(gamesForm){
      event.preventDefault();
      const button=gamesForm.querySelector('button[type="submit"]');button.disabled=true;
      try{
        const {error}=await SUPA.client.rpc('set_team_games',{p_team_id:gamesForm.dataset.teamGames,p_games:[...new FormData(gamesForm).getAll('game').map(String)]});
        if(error)throw error;
        toast('ok','Game rosters saved','Assign players to each game roster below.');
        try{await loadTeams();}catch(refreshError){showError('Games saved, but the workspace did not refresh',refreshError);}
      }catch(error){showError('Could not save game rosters',error);button.disabled=false;}
      return;
    }
    const scoreForm=event.target.closest('[data-submit-score]');
    if(scoreForm){
      event.preventDefault();
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
    const review=event.target.closest('[data-review-request]');
    if(review){
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
      read.disabled=true;
      try{const {error}=await SUPA.client.rpc('mark_team_message_read',{p_message_id:read.dataset.readMessage});if(error)throw error;await loadTeams();}
      catch(error){showError('Could not update message',error);read.disabled=false;}
      return;
    }
    const checkin=event.target.closest('[data-team-checkin]');
    if(checkin){
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
    const input=event.target.closest('[data-game-member]');if(!input)return;
    input.disabled=true;
    try{
      const {error}=await SUPA.client.rpc('set_team_game_member',{p_team_id:input.dataset.team,p_game:input.dataset.game,p_user_id:input.dataset.gameMember,p_active:input.checked});
      if(error)throw error;
      toast('ok','Game roster updated','The player assignment has been saved.');
    }catch(error){input.checked=!input.checked;showError('Could not update game roster',error);}
    finally{input.disabled=false;}
  });

  try{await loadTeams();}
  catch(error){cards.innerHTML='<div class="team-empty">Your team workspace could not be loaded. Reload the page to try again.</div>';showError('Team workspace unavailable',error);}
  buildConsoleStrip();
  icons();
}).catch(error=>toast('err','Team workspace unavailable',error?.message||'Please reload and try again.'));
