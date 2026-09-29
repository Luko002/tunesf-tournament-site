/* Organization records and assignments are read from Supabase and changed through scoped RPCs. */
Auth.ready.then(async()=>{
  if(!Auth.is()){location.replace('login.html?next='+encodeURIComponent('organization.html'));return;}
  const isSuperAdmin=Auth.user.roles.includes('SUPER_ADMIN');
  const wrap=document.querySelector('main .sec.tight .wrap');
  if(!wrap)return;
  wrap.innerHTML=`<div class="org-owner-dashboard">
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
    <section id="organizationList" class="player-team-list" aria-live="polite" style="margin-top:18px"><div class="team-empty">Loading your organizations...</div></section>
    </div>`;
  const list=$('#organizationList');
  $('#organizationCreateForm').closest('.dcard').hidden=!isSuperAdmin;
  $('#organizationSearchWrap').hidden=!isSuperAdmin;
  const fail=(title,error)=>toast('err',title,error?.message||'Please try again.');
  function applyPreviewWriteState(){
    if(!READ_ONLY_PREVIEW)return;
    [$('#organizationCreateForm'),list].filter(Boolean).forEach(root=>{
      const forms=[...(root.matches('form')?[root]:[]),...root.querySelectorAll('form')];
      forms.forEach(form=>form.querySelectorAll('input,select,textarea,button').forEach(control=>{
        control.disabled=true;control.title='Changes are disabled in this production-connected preview.';
      }));
      root.querySelectorAll('[data-org-delete-team]').forEach(control=>{
        control.disabled=true;control.title='Changes are disabled in this production-connected preview.';
      });
    });
    if(!wrap.querySelector('[data-preview-write-note]')){
      const note=document.createElement('p');note.className='team-empty preview-write-note';note.dataset.previewWriteNote='';note.setAttribute('role','note');
      note.textContent='Organization changes are disabled in this production-connected preview. You can still review teams, captains, and staff access.';
      const strip=$('#consoleStrip');if(strip)strip.insertAdjacentElement('afterend',note);else wrap.prepend(note);
    }
  }
  const capabilityLabels={manage_org:'Manage organization settings',manage_staff:'Manage staff',manage_teams:'Manage organization teams'};
  const capabilityDescriptions={manage_org:'Edit organization details',manage_staff:'Add and update organization staff',manage_teams:'Create game teams and assign captains'};
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
      await applyOrganizationTeamLogos(teams.data||[]);
      if(teams.error)throw teams.error;if(members.error)throw members.error;
      const captains=canManageTeams?await SUPA.client.rpc('list_organization_player_accounts',{p_organization_id:org.id}):{data:[],error:null};
      if(captains.error)throw captains.error;
      const playerChoices=(captains.data||[]).map(p=>({id:p.user_id,label:p.username?`@${p.username}${p.player_name?` · ${p.player_name}`:''}`:`${p.player_name||'Player'} · ${p.user_id.slice(0,6)}`,search:`@${p.username||''} ${p.player_name||''}`.toLocaleLowerCase()}));
      const captainPicker=(pickerId,selectedId='')=>{
        const selected=playerChoices.find(p=>p.id===selectedId);
        return `<div class="org-player-picker"><input type="search" id="${esc(pickerId)}-search" list="${esc(pickerId)}-players" data-player-picker-search required autocomplete="off" placeholder="Search players by name or username" value="${esc(selected?.label||'')}"><input type="hidden" name="captain_id" value="${esc(selectedId)}"><datalist id="${esc(pickerId)}-players">${playerChoices.map(p=>`<option value="${esc(p.label)}" data-user-id="${esc(p.id)}" data-player-search="${esc(p.search)}"></option>`).join('')}</datalist></div>`;
      };
      const teamRows=(teams.data||[]).map(t=>`<li class="event-reg org-team-row"><div class="team-identity">${identityImage(t.logo_path,t.name,36,'team')}<div><b>${esc(t.name)} <small>${esc(t.tag)}</small></b><small>${esc(GAMES[t.game]?.label||t.game)} · ${esc(t.region||'Region not set')}</small>${canManageTeams?`<form class="organization-captain-form" data-org-captain="${esc(t.id)}"><label><span>Game captain</span>${captainPicker(`team-${t.id}-captain`,t.captain_id)}</label><button class="btn btn-line btn-sm" type="submit">Save captain</button></form>`:''}${org.owner_id===Auth.user.id?`<button class="btn btn-line btn-sm team-danger-action" type="button" data-org-delete-team="${esc(t.id)}" data-org-team-name="${esc(t.name)}">Delete team</button>`:''}</div></div></li>`).join('')||'<li class="team-empty">No game teams yet. Add the first roster below.</li>';
      const memberRows=(members.data||[]).map(m=>{
        const name=m.player_name||m.username||'Account';
        const permissions=(m.capabilities||[]).map(c=>`<span>${esc(capabilityLabels[c]||c)}</span>`).join('')||'<span class="org-no-access">No permissions</span>';
        return `<li class="organization-staff-row"><div class="org-member-name"><i>${esc(name.slice(0,1).toUpperCase())}</i><span><b>${esc(name)}</b><small>${m.username?`@${esc(m.username)}`:'Username not set'}</small></span></div><span class="org-role-pill">${esc(m.role)}</span><div class="org-permission-pills">${permissions}</div><details class="org-account-id"><summary>Account ID</summary><code>${esc(m.user_id)}</code></details></li>`;
      }).join('')||'<li class="team-empty">No staff assignments yet.</li>';
      const assignableCapabilities=['manage_teams','manage_staff'];
      const caps=assignableCapabilities.map((cap,i)=>`<label class="org-capability"><input type="checkbox" name="capabilities" value="${cap}"${i===0?' checked':''}><span><b>${capabilityLabels[cap]}</b><small>${capabilityDescriptions[cap]}</small></span></label>`).join('');
      const teamCount=(teams.data||[]).length,staffCount=(members.data||[]).length;
      return `<article class="dcard team-card org-card" data-organization-card data-org-name="${esc(org.name.toLowerCase())}">
        <div class="dh org-card-title">${identityImage(FEDERATION_CLUB_LOGOS[org.slug]||'',org.name,42,'team')}<span>${esc(org.name)}</span><span class="mono-r">${esc(org.slug)}</span></div>
        <div class="db org-card-body">
          <div class="org-summary"><div class="org-facts"><span>${esc(org.region||'Region not set')}</span><span>${org.owner_id===Auth.user.id?'Owner':esc(org.my_role||'Member')}</span><span>Owner: @${esc(org.owner_username||org.owner_player_name||'Unknown')}</span></div><p>${esc(org.description||'No description provided.')}</p></div>
          ${isSuperAdmin?`<details class="org-owner-tools"><summary>Ownership settings</summary><form class="org-owner-form" data-org-owner="${esc(org.id)}"><div class="org-section-heading"><b>Change organization owner</b><small>Assign ownership using a TUNESF username.</small></div><div class="org-owner-control"><label><span class="sr-only">Account username</span><input name="username" required minlength="2" maxlength="32" pattern="[A-Za-z0-9_.-]+" placeholder="Account username" aria-label="Account username"></label><button class="btn btn-line btn-sm" type="submit">Assign owner</button></div></form></details>`:''}
          <section class="org-team-section">
            <div class="org-section-heading"><div><b>Game teams</b><small>Each game has its own roster and captain.</small></div><span class="org-count">${teamCount}</span></div>
            ${canManageTeams?`<details class="org-create-team"><summary><span><b>Create a game team</b><small>Set up a squad for one of your games.</small></span><i data-lucide="plus"></i></summary><form class="organization-game-team-form org-add-team-form" data-org-game-team="${esc(org.id)}"><div class="org-team-form-fields"><label><span>Game</span><select name="game" required><option value="">Choose a game</option>${Object.entries(GAMES).map(([key,g])=>`<option value="${esc(key)}">${esc(g.label)}</option>`).join('')}</select></label><label><span>Team name</span><input name="name" required minlength="2" maxlength="80" value="${esc(org.name)}"></label><label><span>Short tag</span><input name="tag" required minlength="2" maxlength="8" placeholder="JSK"></label><label><span>Game captain</span>${captainPicker(`org-${org.id}-captain`)}</label></div><details class="org-region-option"><summary>Regional details <small>Optional</small></summary><label><span>Team region</span><input name="region" maxlength="100" value="${esc(org.region||'')}" placeholder="Use organization region"></label></details><button class="btn btn-gold btn-sm" type="submit">Create game team</button></form></details>`:''}
            <ul class="team-invites org-team-list">${teamRows}</ul>
          </section>
          ${canStaff?`<details class="organization-staff"><summary><span>Staff access</span><small>${staffCount} ${staffCount===1?'person':'people'}</small></summary><div class="org-staff-panel"><ul class="organization-staff-list">${memberRows}</ul><form class="organization-staff-form" data-org-staff="${esc(org.id)}"><div class="org-staff-form-head"><div><b>Add or update staff access</b><small>Use the username on their TUNESF account.</small></div><span>Staff can help manage game teams and organization staff. Tournament and referee duties are managed separately.</span></div><div class="org-staff-form-fields"><label><span>Username</span><input name="username" required minlength="2" maxlength="32" pattern="[A-Za-z0-9_.-]+" placeholder="player_username"></label><label><span>Organization role</span><select name="role"><option value="staff">Staff</option><option value="admin">Admin</option></select><small class="org-role-note">Admins start with team and staff access. You can adjust permissions below.</small></label></div><fieldset class="org-capability-grid"><legend>Choose permissions</legend>${caps}</fieldset><button class="btn btn-gold btn-sm" type="submit">Save staff access</button></form></div></details>`:''}
        </div>
      </article>`;
    }));
    list.innerHTML=cards.join('');
    const searchEmpty=document.createElement('p');searchEmpty.id='organizationSearchEmpty';searchEmpty.className='team-empty';searchEmpty.setAttribute('role','status');searchEmpty.textContent='No organizations match your search. Try another name.';searchEmpty.hidden=true;list.prepend(searchEmpty);
    applyPreviewWriteState();icons();filterOrganizations();
  }
  function filterOrganizations(){const term=($('#organizationSearch')?.value||'').trim().toLowerCase(),cards=[...list.querySelectorAll('[data-organization-card]')];let visible=0;cards.forEach(card=>{const matches=card.dataset.orgName.includes(term);card.hidden=!matches;if(matches)visible++;});const empty=$('#organizationSearchEmpty');if(empty)empty.hidden=!term||visible>0;}
  $('#organizationCreateForm').addEventListener('submit',async event=>{
    event.preventDefault();if(READ_ONLY_PREVIEW)return;const form=event.currentTarget,button=form.querySelector('button[type="submit"]');button.disabled=true;
    const values=Object.fromEntries(new FormData(form));
    try{
      const {error}=await SUPA.client.rpc('create_organization',{p_name:String(values.name).trim(),p_slug:String(values.slug).trim().toLowerCase(),p_description:String(values.description||'').trim(),p_region:String(values.region||'').trim()});
      if(error)throw error;form.reset();toast('ok','Organization created','You are its owner and can create staff assignments.');await render();
    }catch(error){fail('Could not create organization',error);}finally{button.disabled=false;}
  });
  list.addEventListener('click',async event=>{
    const button=event.target.closest('[data-org-delete-team]');if(!button)return;
    if(READ_ONLY_PREVIEW)return;
    const teamName=button.dataset.orgTeamName||'this team';
    if(!window.confirm(`Permanently delete ${teamName} and its roster? This cannot be undone. Teams with tournament registrations or match history cannot be deleted.`))return;
    button.disabled=true;
    try{
      const {error}=await SUPA.client.rpc('delete_team',{p_team_id:button.dataset.orgDeleteTeam});if(error)throw error;
      toast('ok','Team deleted','The team profile and roster were removed. Tournament records are preserved.');await render();
    }catch(error){fail('Could not delete team',error);button.disabled=false;}
  });
  function syncCaptainPicker(input){
    const picker=input.closest('.org-player-picker'),hidden=picker?.querySelector('input[type="hidden"][name="captain_id"]'),datalist=input.list;
    const value=input.value.trim().toLocaleLowerCase(),options=[...(datalist?.options||[])];
    const selected=options.find(option=>option.value.trim().toLocaleLowerCase()===value);
    options.forEach(option=>{option.hidden=!!value&&!option.dataset.playerSearch.includes(value);});
    if(hidden)hidden.value=selected?.dataset.userId||'';
    input.setCustomValidity(input.value&&!selected?'Choose a player from the search suggestions.':'');
  }
  list.addEventListener('input',event=>{const input=event.target.closest('[data-player-picker-search]');if(input)syncCaptainPicker(input);});
  list.addEventListener('change',event=>{const input=event.target.closest('[data-player-picker-search]');if(input)syncCaptainPicker(input);});
  list.addEventListener('change',event=>{
    const role=event.target.closest('[data-org-staff] select[name="role"]');
    if(role?.value==='admin')role.form.querySelectorAll('input[name="capabilities"]').forEach(input=>input.checked=true);
  });
  list.addEventListener('submit',async event=>{
    if(READ_ONLY_PREVIEW){if(event.target.closest('form'))event.preventDefault();return;}
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
  $('#consoleStrip')?.remove();
  try{await render();}catch(error){list.innerHTML='<div class="team-empty">Your organization records could not be loaded.</div>';fail('Organization workspace unavailable',error);}
}).catch(error=>toast('err','Organization workspace unavailable',error?.message||'Please reload and try again.'));
