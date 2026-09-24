/* Remove former sample matches and rosters before auth or data requests settle. */
document.querySelector('.dgrid')?.replaceChildren();
/* Player workspace uses only current-account membership and roster RPC data. */
Auth.ready.then(async()=>{
  if(!requirePerm('PLAYER_ZONE'))return;
  const wrap=document.querySelector('main .sec.tight .wrap');
  if(!wrap)return;
  wrap.innerHTML=`<div class="console-strip" id="consoleStrip"></div>
    <div class="dcard" style="margin-top:22px"><div class="dh"><i data-lucide="user-round"></i>Player workspace</div><div class="db">
      <p style="color:var(--dim)">View the teams you belong to and the rosters you play with. Accept an invitation from its secure link.</p>
      <a class="btn btn-gold btn-sm" href="captain.html" style="margin-top:16px"><i data-lucide="users-round"></i>Create or manage a team</a>
    </div></div>
    <section class="player-team-list" id="playerTeams" aria-live="polite"><div class="team-empty">Loading your teams…</div></section>`;
  const list=$('#playerTeams');
  const render=async()=>{
    list.innerHTML='<div class="team-empty">Loading your teams…</div>';
    const {data:memberships,error}=await SUPA.client.from('team_members').select('team_id,role,status')
      .eq('user_id',Auth.user.id).eq('status','active');
    if(error)throw error;
    const ids=[...new Set((memberships||[]).map(row=>row.team_id))];
    if(!ids.length){list.innerHTML='<div class="dcard"><div class="dh"><i data-lucide="users-round"></i>Your teams</div><div class="db"><p class="team-empty">You are not on a team yet. Use a captain’s invitation link to join one.</p></div></div>';icons();return;}
    const {data:teams, error:teamsError}=await SUPA.client.from('teams')
      .select('id,name,tag,game,region').in('id',ids);
    if(teamsError)throw teamsError;
    const byTeam=new Map((memberships||[]).map(row=>[row.team_id,row]));
    const rosters=await Promise.all((teams||[]).map(async team=>{
      const {data,error}=await SUPA.client.rpc('list_team_roster',{p_team_id:team.id});
      return {team,membership:byTeam.get(team.id),roster:data||[],error};
    }));
    list.innerHTML=rosters.map(({team,membership,roster,error})=>{
      const members=error?'<p class="team-empty">Roster details are unavailable.</p>':`<ul class="team-roster">${roster.map(row=>`<li><span><b>${esc(row.username||row.player_name||'Player')}${row.user_id===Auth.user.id?' · You':''}</b><small>${esc(row.member_role||'player')}</small></span>${row.member_role==='captain'?'<i data-lucide="crown" aria-label="Team captain"></i>':''}</li>`).join('')}</ul>`;
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
  icons();
}).catch(error=>toast('err','Player workspace unavailable',error.message||'Please reload and try again.'));
