/* Organization records and assignments are read from Supabase and changed through scoped RPCs. */
Auth.ready.then(async()=>{
  if(!Auth.is()){location.replace('login.html?next='+encodeURIComponent('organization.html'));return;}
  const wrap=document.querySelector('main .sec.tight .wrap');
  if(!wrap)return;
  wrap.innerHTML=`<div class="console-strip" id="consoleStrip"></div>
    <section class="dcard" style="margin-top:22px"><div class="dh"><i data-lucide="landmark"></i>Create an organization</div><div class="db">
      <form id="organizationCreateForm" class="team-create-form">
        <label><span>Name</span><input name="name" minlength="2" maxlength="100" required></label>
        <label><span>Slug</span><input name="slug" minlength="2" maxlength="63" pattern="[a-z0-9][a-z0-9-]{1,62}" required placeholder="tunis-esports"></label>
        <label><span>Region</span><input name="region" maxlength="100" placeholder="Tunisia"></label>
        <label><span>Description</span><input name="description" maxlength="1000"></label>
        <button class="btn btn-gold btn-sm" type="submit">Create organization</button>
      </form>
    </div></section>
    <section id="organizationList" class="player-team-list" aria-live="polite" style="margin-top:18px"><div class="team-empty">Loading your organizations...</div></section>`;
  const list=$('#organizationList');
  const fail=(title,error)=>toast('err',title,error?.message||'Please try again.');
  const capabilityLabels={manage_org:'Manage organization settings',manage_staff:'Manage staff',manage_teams:'Manage organization teams',create_tournaments:'Create organization tournaments',manage_prizes:'Manage prizes'};
  async function render(){
    list.innerHTML='<div class="team-empty">Loading your organizations...</div>';
    const [owned,membershipResult]=await Promise.all([
      SUPA.client.from('organizations').select('id,owner_id,name,slug,description,region,created_at').eq('owner_id',Auth.user.id).order('name'),
      SUPA.client.from('organization_memberships').select('organization_id,role,capabilities').eq('user_id',Auth.user.id)
    ]);
    if(owned.error)throw owned.error;if(membershipResult.error)throw membershipResult.error;
    const myCaps=new Map((membershipResult.data||[]).map(m=>[m.organization_id,m.capabilities||[]]));
    const ids=[...new Set([...(owned.data||[]).map(o=>o.id),...(membershipResult.data||[]).map(m=>m.organization_id)])];
    if(!ids.length){list.innerHTML='<div class="dcard"><div class="dh">Your organizations</div><div class="db"><p class="team-empty">You do not belong to an organization yet. Create one above or ask an organization owner to add your account.</p></div></div>';return;}
    const {data:organizations,error}=await SUPA.client.from('organizations').select('id,owner_id,name,slug,description,region,created_at').in('id',ids).order('name');
    if(error)throw error;
    const cards=await Promise.all((organizations||[]).map(async org=>{
      const canManageTeams=org.owner_id===Auth.user.id||(myCaps.get(org.id)||[]).includes('manage_teams');
      const canStaff=org.owner_id===Auth.user.id||(myCaps.get(org.id)||[]).includes('manage_staff');
      const [teams,members]=await Promise.all([
        SUPA.client.from('teams').select('id,name,tag,game,region,captain_id').eq('organization_id',org.id).order('name'),
        canStaff?SUPA.client.from('organization_memberships').select('user_id,role,capabilities').eq('organization_id',org.id).order('created_at'):{data:[],error:null}
      ]);
      if(teams.error)throw teams.error;if(members.error)throw members.error;
      const captains=canManageTeams?await SUPA.client.rpc('list_organization_player_accounts',{p_organization_id:org.id}):{data:[],error:null};
      if(captains.error)throw captains.error;
      const captainOptions=(captains.data||[]).map(p=>`<option value="${esc(p.user_id)}">${esc(p.username||p.player_name||p.user_id)}</option>`).join('');
      const teamRows=(teams.data||[]).map(t=>`<li class="event-reg"><div><b>${esc(t.name)} <small>${esc(t.tag)}</small></b><small>${esc(GAMES[t.game]?.label||t.game)} · ${esc(t.region||'Region not set')}</small>${canManageTeams?`<form class="organization-captain-form" data-org-captain="${esc(t.id)}"><label><span>Game captain</span><select name="captain_id" required><option value="">Choose a player</option>${(captains.data||[]).map(p=>`<option value="${esc(p.user_id)}"${p.user_id===t.captain_id?' selected':''}>${esc(p.username||p.player_name||p.user_id)}</option>`).join('')}</select></label><button class="btn btn-line btn-sm" type="submit">Save captain</button></form>`:''}</div></li>`).join('')||'<li class="team-empty">No game teams yet. Add the first roster below.</li>';
      const memberRows=(members.data||[]).map(m=>`<li class="event-reg"><span><b>${esc(m.user_id)}</b><small>${esc(m.role)} · ${esc((m.capabilities||[]).map(c=>capabilityLabels[c]||c).join(', ')||'No capabilities')}</small></span></li>`).join('')||'<li class="team-empty">No staff assignments yet.</li>';
      const caps=Object.keys(capabilityLabels).map((cap,i)=>`<label><input type="checkbox" name="capabilities" value="${cap}"${i===1?' checked':''}> ${capabilityLabels[cap]}</label>`).join('');
      return `<article class="dcard team-card"><div class="dh"><i data-lucide="landmark"></i>${esc(org.name)}<span class="mono-r">${esc(org.slug)}</span></div><div class="db">
        <div class="team-meta"><span>${esc(org.region||'Region not set')}</span><span>${org.owner_id===Auth.user.id?'Owner':esc((membershipResult.data||[]).find(m=>m.organization_id===org.id)?.role||'Member')}</span></div>
        <p style="color:var(--dim)">${esc(org.description||'No description provided.')}</p>
        <h3 class="team-section-title">Game teams and captains <span>${(teams.data||[]).length}</span></h3><p style="color:var(--dim)">Create one team for each game. Its captain manages only that game roster.</p><ul class="team-invites">${teamRows}</ul>
        ${canManageTeams?`<form class="organization-game-team-form invite-create-form" data-org-game-team="${esc(org.id)}"><h3 class="team-section-title">Add a game team</h3><label><span>Team name</span><input name="name" required minlength="2" maxlength="80" value="${esc(org.name)}"></label><label><span>Short tag</span><input name="tag" required minlength="2" maxlength="8" placeholder="JSK"></label><label><span>Game</span><select name="game" required><option value="">Choose a game</option>${Object.entries(GAMES).map(([key,g])=>`<option value="${esc(key)}">${esc(g.label)}</option>`).join('')}</select></label><label><span>Region</span><input name="region" maxlength="100" value="${esc(org.region||'')}" placeholder="Region"></label><label><span>Game captain</span><select name="captain_id" required><option value="">Choose a player</option>${captainOptions}</select></label><button class="btn btn-gold btn-sm" type="submit">Create game team</button></form>`:''}
        ${canStaff?`<h3 class="team-section-title">Staff assignments <span>${(members.data||[]).length}</span></h3><ul class="team-invites">${memberRows}</ul>
          <form class="invite-create-form" data-org-staff="${esc(org.id)}"><label><span>Existing user UUID</span><input name="user_id" required pattern="[0-9a-fA-F-]{36}" placeholder="Supabase account ID"></label><label><span>Organization role</span><select name="role"><option value="staff">Staff</option><option value="admin">Admin</option></select></label><fieldset>${caps}</fieldset><button class="btn btn-line btn-sm" type="submit">Save staff access</button></form>`:''}
      </div></article>`;
    }));
    list.innerHTML=cards.join('');icons();
  }
  $('#organizationCreateForm').addEventListener('submit',async event=>{
    event.preventDefault();const form=event.currentTarget,button=form.querySelector('button[type="submit"]');button.disabled=true;
    const values=Object.fromEntries(new FormData(form));
    try{
      const {error}=await SUPA.client.rpc('create_organization',{p_name:String(values.name).trim(),p_slug:String(values.slug).trim().toLowerCase(),p_description:String(values.description||'').trim(),p_region:String(values.region||'').trim()});
      if(error)throw error;form.reset();toast('ok','Organization created','You are its owner and can create staff assignments.');await render();
    }catch(error){fail('Could not create organization',error);}finally{button.disabled=false;}
  });
  list.addEventListener('submit',async event=>{
    const gameTeam=event.target.closest('[data-org-game-team]');
    if(gameTeam){event.preventDefault();const button=gameTeam.querySelector('button[type="submit"]');button.disabled=true;const values=new FormData(gameTeam);try{const {error}=await SUPA.client.rpc('create_organization_game_team',{p_organization_id:gameTeam.dataset.orgGameTeam,p_name:String(values.get('name')).trim(),p_tag:String(values.get('tag')).trim().toUpperCase(),p_game:values.get('game'),p_region:String(values.get('region')||'').trim(),p_captain_id:values.get('captain_id')});if(error)throw error;toast('ok','Game team created','The assigned captain can now manage this game roster.');await render();}catch(error){fail('Could not create game team',error);}finally{button.disabled=false;}return;}
    const captain=event.target.closest('[data-org-captain]');
    if(captain){event.preventDefault();const button=captain.querySelector('button[type="submit"]');button.disabled=true;try{const {error}=await SUPA.client.rpc('set_organization_team_captain',{p_team_id:captain.dataset.orgCaptain,p_user_id:new FormData(captain).get('captain_id')});if(error)throw error;toast('ok','Game captain updated','Captain access applies only to this game team.');await render();}catch(error){fail('Could not update game captain',error);}finally{button.disabled=false;}return;}
    const form=event.target.closest('[data-org-staff]');if(!form)return;event.preventDefault();
    const button=form.querySelector('button[type="submit"]');button.disabled=true;
    const values=new FormData(form);
    try{
      const {error}=await SUPA.client.rpc('set_organization_member',{p_organization_id:form.dataset.orgStaff,p_user_id:String(values.get('user_id')).trim(),p_role:values.get('role'),p_capabilities:values.getAll('capabilities')});
      if(error)throw error;toast('ok','Organization staff saved','Access is scoped to this organization.');await render();
    }catch(error){fail('Could not update organization staff',error);}finally{button.disabled=false;}
  });
  buildConsoleStrip();
  try{await render();}catch(error){list.innerHTML='<div class="team-empty">Your organization records could not be loaded.</div>';fail('Organization workspace unavailable',error);}
}).catch(error=>toast('err','Organization workspace unavailable',error?.message||'Please reload and try again.'));
