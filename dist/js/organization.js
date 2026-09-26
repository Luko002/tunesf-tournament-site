/* Organization records and assignments are read from Supabase and changed through scoped RPCs. */
Auth.ready.then(async()=>{
  if(!Auth.is()){location.replace('login.html?next='+encodeURIComponent('organization.html'));return;}
  const isSuperAdmin=Auth.user.roles.includes('SUPER_ADMIN');
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
    <label class="team-picker" id="organizationSearchWrap" hidden>Find an organization<input id="organizationSearch" type="search" placeholder="Search federation organizations"></label>
    <section id="organizationList" class="player-team-list" aria-live="polite" style="margin-top:18px"><div class="team-empty">Loading your organizations...</div></section>`;
  const list=$('#organizationList');
  $('#organizationCreateForm').closest('.dcard').hidden=!isSuperAdmin;
  $('#organizationSearchWrap').hidden=!isSuperAdmin;
  const fail=(title,error)=>toast('err',title,error?.message||'Please try again.');
  const capabilityLabels={manage_org:'Manage organization settings',manage_staff:'Manage staff',manage_teams:'Manage organization teams',create_tournaments:'Create organization tournaments',manage_prizes:'Manage prizes'};
  const capabilityDescriptions={manage_org:'Edit organization details',manage_staff:'Add and update organization staff',manage_teams:'Create game teams and assign captains',create_tournaments:'Host tournaments for this organization',manage_prizes:'Manage tournament prizes'};
  async function render(){
    list.innerHTML='<div class="team-empty">Loading your organizations...</div>';
    const {data:organizations,error}=await SUPA.client.rpc('list_organizations_for_current_user');
    if(error)throw error;
    const organizationRows=organizations||[];
    const myCaps=new Map(organizationRows.map(org=>[org.id,org.my_capabilities||[]]));
    if(!organizationRows.length){list.innerHTML='<div class="dcard"><div class="dh">Your organizations</div><div class="db"><p class="team-empty">You do not belong to an organization yet. Create one above or ask an organization owner to add your account.</p></div></div>';return;}
    const cards=await Promise.all(organizationRows.map(async org=>{
      const canManageTeams=isSuperAdmin||org.owner_id===Auth.user.id||(myCaps.get(org.id)||[]).includes('manage_teams');
      const canStaff=isSuperAdmin||org.owner_id===Auth.user.id||(myCaps.get(org.id)||[]).includes('manage_staff');
      const [teams,members]=await Promise.all([
        SUPA.client.from('teams').select('id,name,tag,game,region,captain_id,logo_path').eq('organization_id',org.id).order('name'),
        canStaff?SUPA.client.rpc('list_organization_staff',{p_organization_id:org.id}):Promise.resolve({data:[],error:null})
      ]);
      if(teams.error)throw teams.error;if(members.error)throw members.error;
      const captains=canManageTeams?await SUPA.client.rpc('list_organization_player_accounts',{p_organization_id:org.id}):{data:[],error:null};
      if(captains.error)throw captains.error;
      const captainOptions=(captains.data||[]).map(p=>`<option value="${esc(p.user_id)}">${esc(p.username||p.player_name||p.user_id)}</option>`).join('');
      const teamRows=(teams.data||[]).map(t=>`<li class="event-reg"><div class="team-identity">${identityImage(t.logo_path,t.name,36,'team')}<div><b>${esc(t.name)} <small>${esc(t.tag)}</small></b><small>${esc(GAMES[t.game]?.label||t.game)} · ${esc(t.region||'Region not set')}</small>${canManageTeams?`<form class="organization-captain-form" data-org-captain="${esc(t.id)}"><label><span>Game captain</span><select name="captain_id" required><option value="">Choose a player</option>${(captains.data||[]).map(p=>`<option value="${esc(p.user_id)}"${p.user_id===t.captain_id?' selected':''}>${esc(p.username||p.player_name||p.user_id)}</option>`).join('')}</select></label><button class="btn btn-line btn-sm" type="submit">Save captain</button></form>`:''}</div></div></li>`).join('')||'<li class="team-empty">No game teams yet. Add the first roster below.</li>';
      const memberRows=(members.data||[]).map(m=>{
        const name=m.player_name||m.username||'Account';
        const permissions=(m.capabilities||[]).map(c=>`<span>${esc(capabilityLabels[c]||c)}</span>`).join('')||'<span class="org-no-access">No permissions</span>';
        return `<li class="organization-staff-row"><div class="org-member-name"><i>${esc(name.slice(0,1).toUpperCase())}</i><span><b>${esc(name)}</b><small>${m.username?`@${esc(m.username)}`:'Username not set'}</small></span></div><span class="org-role-pill">${esc(m.role)}</span><div class="org-permission-pills">${permissions}</div><details class="org-account-id"><summary>Account ID</summary><code>${esc(m.user_id)}</code></details></li>`;
      }).join('')||'<li class="team-empty">No staff assignments yet.</li>';
      const caps=Object.entries(capabilityLabels).map(([cap,label],i)=>`<label class="org-capability"><input type="checkbox" name="capabilities" value="${cap}"${i===1?' checked':''}><span><b>${label}</b><small>${capabilityDescriptions[cap]}</small></span></label>`).join('');
      return `<article class="dcard team-card org-card" data-organization-card data-org-name="${esc(org.name.toLowerCase())}"><div class="dh org-card-title"><i data-lucide="landmark"></i><span>${esc(org.name)}</span><span class="mono-r">${esc(org.slug)}</span></div><div class="db org-card-body">
        <div class="org-summary"><div class="org-facts"><span>${esc(org.region||'Region not set')}</span><span>${org.owner_id===Auth.user.id?'Owner':esc(org.my_role||'Member')}</span><span>Owner: @${esc(org.owner_username||org.owner_player_name||'Unknown')}</span></div><p>${esc(org.description||'No description provided.')}</p></div>
        ${isSuperAdmin?`<form class="org-owner-form" data-org-owner="${esc(org.id)}"><div class="org-section-heading"><b>Change organization owner</b><small>Assign ownership using a TUNESF username.</small></div><div class="org-owner-control"><label><span class="sr-only">Account username</span><input name="username" required minlength="2" maxlength="32" pattern="[A-Za-z0-9_.-]+" placeholder="Account username" aria-label="Account username"></label><button class="btn btn-line btn-sm" type="submit">Assign owner</button></div></form>`:''}
        <section class="org-team-section"><div class="org-section-heading"><div><b>Game teams and captains</b><small>Each captain manages only their game roster.</small></div><span class="org-count">${(teams.data||[]).length}</span></div><ul class="team-invites org-team-list">${teamRows}</ul></section>
        ${canManageTeams?`<form class="organization-game-team-form org-add-team-form" data-org-game-team="${esc(org.id)}"><div class="org-section-heading"><div><b>Add a game team</b><small>Create one roster for each game this club competes in.</small></div></div><div class="org-team-form-fields"><label><span>Team name</span><input name="name" required minlength="2" maxlength="80" value="${esc(org.name)}"></label><label><span>Short tag</span><input name="tag" required minlength="2" maxlength="8" placeholder="JSK"></label><label><span>Game</span><select name="game" required><option value="">Choose a game</option>${Object.entries(GAMES).map(([key,g])=>`<option value="${esc(key)}">${esc(g.label)}</option>`).join('')}</select></label><label><span>Region</span><input name="region" maxlength="100" value="${esc(org.region||'')}" placeholder="Tunisia"></label><label class="org-captain-field"><span>Game captain</span><select name="captain_id" required><option value="">Choose a player</option>${captainOptions}</select></label></div><button class="btn btn-gold btn-sm" type="submit">Create game team</button></form>`:''}
        ${canStaff?`<section class="organization-staff"><h3 class="team-section-title">Staff access <span>${(members.data||[]).length}</span></h3><ul class="organization-staff-list">${memberRows}</ul>
          <form class="organization-staff-form" data-org-staff="${esc(org.id)}"><div class="org-staff-form-head"><div><b>Add or update a person</b><small>Use the username on their TUNESF account.</small></div><span>Admin and Staff are labels. Permissions define access. Team and staff permissions are active; tournament and prize permissions are not yet connected to organizer actions.</span></div><div class="org-staff-form-fields"><label><span>Username</span><input name="username" required minlength="2" maxlength="32" pattern="[A-Za-z0-9_.-]+" placeholder="player_username"></label><label><span>Organization role</span><select name="role"><option value="staff">Staff</option><option value="admin">Admin</option></select></label></div><fieldset class="org-capability-grid"><legend>Choose permissions</legend>${caps}</fieldset><button class="btn btn-gold btn-sm" type="submit">Save staff access</button></form></section>`:''}
      </div></article>`;
    }));
    list.innerHTML=cards.join('');icons();filterOrganizations();
  }
  function filterOrganizations(){const term=($('#organizationSearch')?.value||'').trim().toLowerCase();list.querySelectorAll('[data-organization-card]').forEach(card=>card.hidden=!card.dataset.orgName.includes(term));}
  $('#organizationCreateForm').addEventListener('submit',async event=>{
    event.preventDefault();const form=event.currentTarget,button=form.querySelector('button[type="submit"]');button.disabled=true;
    const values=Object.fromEntries(new FormData(form));
    try{
      const {error}=await SUPA.client.rpc('create_organization',{p_name:String(values.name).trim(),p_slug:String(values.slug).trim().toLowerCase(),p_description:String(values.description||'').trim(),p_region:String(values.region||'').trim()});
      if(error)throw error;form.reset();toast('ok','Organization created','You are its owner and can create staff assignments.');await render();
    }catch(error){fail('Could not create organization',error);}finally{button.disabled=false;}
  });
  list.addEventListener('submit',async event=>{
    const ownerForm=event.target.closest('[data-org-owner]');
    if(ownerForm){event.preventDefault();const button=ownerForm.querySelector('button[type="submit"]');button.disabled=true;try{const {data,error}=await SUPA.client.rpc('set_organization_owner',{p_organization_id:ownerForm.dataset.orgOwner,p_username:String(new FormData(ownerForm).get('username')).trim()});if(error)throw error;toast('ok','Organization owner assigned',`@${data} now owns this organization.`);await render();}catch(error){fail('Could not assign organization owner',error);}finally{button.disabled=false;}return;}
    const gameTeam=event.target.closest('[data-org-game-team]');
    if(gameTeam){event.preventDefault();const button=gameTeam.querySelector('button[type="submit"]');button.disabled=true;const values=new FormData(gameTeam);try{const {error}=await SUPA.client.rpc('create_organization_game_team',{p_organization_id:gameTeam.dataset.orgGameTeam,p_name:String(values.get('name')).trim(),p_tag:String(values.get('tag')).trim().toUpperCase(),p_game:values.get('game'),p_region:String(values.get('region')||'').trim(),p_captain_id:values.get('captain_id')});if(error)throw error;toast('ok','Game team created','The assigned captain can now manage this game roster.');await render();}catch(error){fail('Could not create game team',error);}finally{button.disabled=false;}return;}
    const captain=event.target.closest('[data-org-captain]');
    if(captain){event.preventDefault();const button=captain.querySelector('button[type="submit"]');button.disabled=true;try{const {error}=await SUPA.client.rpc('set_organization_team_captain',{p_team_id:captain.dataset.orgCaptain,p_user_id:new FormData(captain).get('captain_id')});if(error)throw error;toast('ok','Game captain updated','Captain access applies only to this game team.');await render();}catch(error){fail('Could not update game captain',error);}finally{button.disabled=false;}return;}
    const form=event.target.closest('[data-org-staff]');if(!form)return;event.preventDefault();
    const button=form.querySelector('button[type="submit"]');button.disabled=true;
    const values=new FormData(form);
    try{
      const {error}=await SUPA.client.rpc('set_organization_member_by_username',{p_organization_id:form.dataset.orgStaff,p_username:String(values.get('username')).trim(),p_role:values.get('role'),p_capabilities:values.getAll('capabilities')});
      if(error)throw error;toast('ok','Organization staff saved','Access is scoped to this organization.');await render();
    }catch(error){fail('Could not update organization staff',error);}finally{button.disabled=false;}
  });
  $('#organizationSearch')?.addEventListener('input',filterOrganizations);
  buildConsoleStrip();
  try{await render();}catch(error){list.innerHTML='<div class="team-empty">Your organization records could not be loaded.</div>';fail('Organization workspace unavailable',error);}
}).catch(error=>toast('err','Organization workspace unavailable',error?.message||'Please reload and try again.'));
