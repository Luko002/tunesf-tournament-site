/* Administrative metrics, role changes, and audit reads use existing RLS scopes. */
Auth.ready.then(async()=>{
  if(!requirePerm('BAN_USERS'))return;
  const wrap=document.querySelector('main .sec.tight .wrap');if(!wrap)return;
  const canAssign=Auth.has('MANAGE_PERMISSIONS'),canAudit=Auth.has('AUDIT_LOGS'),isSuperAdmin=Auth.user.roles.includes('SUPER_ADMIN'),canReviewGameLinks=Auth.user.roles.some(role=>['SUPER_ADMIN','PLATFORM_ADMIN'].includes(role));
  buildConsoleStrip();
  const workspace=$('#adminWorkspace');
  workspace.classList.add('admin-workspace');
  const globalRoles=['REFEREE','MODERATOR','TOURNAMENT_ADMIN','PLATFORM_ADMIN','SUPER_ADMIN'];
  const tabs=[['analytics','activity','Platform analytics'],isSuperAdmin?['teams','shield','Team directory']:null,canReviewGameLinks?['game-links','badge-check','Game ID verification']:null,canAssign?['roles','users','Global role assignments']:null,canAudit?['audit','history','Audit events']:null].filter(Boolean);
  const sections=[`<nav class="admin-section-nav" aria-label="Admin sections"><span class="admin-section-label">ADMIN WORKSPACE</span><div class="admin-section-tabs" role="tablist" aria-label="Admin sections">${tabs.map(([key,icon,title])=>`<button type="button" class="admin-section-tab" role="tab" id="admin-tab-${key}" aria-controls="admin-panel-${key}" aria-selected="false" data-admin-view="${key}"><i data-lucide="${icon}"></i><span>${title}</span></button>`).join('')}</div></nav>`,`<section class="dcard admin-analytics-card" id="admin-panel-analytics" role="tabpanel" aria-labelledby="admin-tab-analytics" data-admin-panel="analytics"><div class="dh"><i data-lucide="activity"></i><span>Platform analytics</span><span class="mono-r" id="adminMetricsUpdated">Loading…</span></div><div class="db"><div id="adminMetrics" class="kpis" aria-live="polite"></div><div id="adminAnalyticsCharts" class="analytics-grid" aria-live="polite"></div><div class="admin-analytics-foot"><span><i data-lucide="database"></i> LIVE PLATFORM DATA</span><button class="btn btn-line btn-sm" id="refreshAdminMetrics" type="button"><i data-lucide="refresh-cw"></i> Refresh analytics</button></div></div></section>`];
  if(isSuperAdmin)sections.push(`<section class="dcard admin-team-management" id="admin-panel-teams" role="tabpanel" aria-labelledby="admin-tab-teams" data-admin-panel="teams"><div class="dh"><i data-lucide="shield"></i><span>Team directory</span><span class="mono-r">SUPER ADMIN</span></div><div class="db">${READ_ONLY_PREVIEW?'<p class="admin-readonly-note" role="note">Team changes are disabled in this local preview because it is connected to production. The directory is read-only.</p>':''}<p class="admin-team-policy">Select a team to update its name, organization, or logo. Teams with tournament history cannot be deleted.</p><label class="admin-team-search"><span>Find a team</span><input id="adminTeamSearch" type="search" placeholder="Search team, game, or organization" aria-controls="adminTeamList"></label><p id="adminTeamCount" class="admin-team-count" role="status" aria-live="polite">Loading teams…</p><ul id="adminTeamList" class="admin-team-list" aria-live="polite"><li class="team-empty">Loading teams…</li></ul></div></section>`);
  if(canReviewGameLinks)sections.push(`<section class="dcard" id="admin-panel-game-links" role="tabpanel" aria-labelledby="admin-tab-game-links" data-admin-panel="game-links"><div class="dh"><i data-lucide="badge-check"></i><span>Player game ID verification</span><span class="mono-r">PLATFORM ADMIN</span></div><div class="db">${READ_ONLY_PREVIEW?'<p class="admin-readonly-note" role="note">Verification changes are disabled in this preview.</p>':''}<p class="admin-team-policy">Review the submitted game ID against its proof link. Only approve when the profile clearly matches the player.</p><ul id="adminGameIdentityLinks" class="admin-team-list" aria-live="polite"><li class="team-empty">Loading submissions…</li></ul></div></section>`);
  if(canAssign)sections.push(`<section class="dcard admin-roles-card" id="admin-panel-roles" role="tabpanel" aria-labelledby="admin-tab-roles" data-admin-panel="roles"><div class="dh"><i data-lucide="users"></i><span>Global role assignments</span><span class="mono-r">ACCESS CONTROL</span></div><div class="db">${READ_ONLY_PREVIEW?'<p class="admin-readonly-note" id="adminRoleReadonly" role="note">Role changes are disabled in this local preview because it is connected to production. Use a writable staging environment to grant or revoke roles.</p>':''}
    <form id="roleGrantForm" class="team-create-form"${READ_ONLY_PREVIEW?' aria-describedby="adminRoleReadonly"':''}><label><span>Username</span><input name="username" required minlength="2" maxlength="32" placeholder="Enter exact username" autocomplete="off"${READ_ONLY_PREVIEW?' disabled':''}></label><label><span>Role</span><select name="role"${READ_ONLY_PREVIEW?' disabled':''}>${globalRoles.map(r=>`<option>${r}</option>`).join('')}</select></label><button class="btn btn-gold btn-sm" type="submit"${READ_ONLY_PREVIEW?' disabled aria-describedby="adminRoleReadonly"':''}>Grant role</button></form>
    <div class="admin-role-filterbar"><label><span>Search username or ID</span><input id="adminRoleSearch" type="search" placeholder="Search a username" aria-controls="adminRoles"></label><label><span>Role</span><select id="adminRoleFilter" aria-controls="adminRoles"><option value="">All roles</option>${globalRoles.map(role=>`<option value="${role}">${role.replaceAll('_',' ')}</option>`).join('')}</select></label><p id="adminRoleFilterStatus" role="status" aria-live="polite"></p></div>
    <div class="tablewrap"><table><thead><tr><th>User</th><th>Role</th><th>Granted</th><th></th></tr></thead><tbody id="adminRoles"></tbody></table></div>
  </div></section>`);
  if(canAudit)sections.push(`<section class="dcard admin-audit-card" id="admin-panel-audit" role="tabpanel" aria-labelledby="admin-tab-audit" data-admin-panel="audit"><div class="dh"><i data-lucide="history"></i><span>Audit events</span><span class="mono-r">LATEST 50</span></div><div class="db"><div id="adminAudit" class="team-empty">Loading audit events...</div></div></section>`);
  if(!canAssign&&!canAudit)sections.push('<section class="dcard"><div class="dh">Administration</div><div class="db"><p>You do not have permission to manage global roles or view audit events.</p></div></section>');
  workspace.innerHTML=sections.join('');icons();
  const allowedViews=new Set(tabs.map(([key])=>key));
  function showAdminView(view,updateHash=false){
    const selected=allowedViews.has(view)?view:'analytics';
    workspace.querySelectorAll('[data-admin-view]').forEach(button=>{const active=button.dataset.adminView===selected;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;});
    workspace.querySelectorAll('[data-admin-panel]').forEach(panel=>{panel.hidden=panel.dataset.adminPanel!==selected;});
    if(updateHash)history.replaceState(null,'',`${location.pathname}${location.search}#${selected}`);
  }
  showAdminView(location.hash.slice(1));
  workspace.querySelector('.admin-section-tabs')?.addEventListener('click',event=>{const button=event.target.closest('[data-admin-view]');if(button)showAdminView(button.dataset.adminView,true);});
  workspace.querySelector('.admin-section-tabs')?.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;const keys=tabs.map(([key])=>key),current=keys.indexOf(document.activeElement?.dataset.adminView);if(current<0)return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?keys.length-1:(current+(event.key==='ArrowRight'?1:-1)+keys.length)%keys.length;const button=workspace.querySelector(`[data-admin-view="${keys[next]}"]`);button.focus();showAdminView(keys[next],true);});
  window.addEventListener('hashchange',()=>showAdminView(location.hash.slice(1)));
  const report=(title,error)=>toast('err',title,error?.message||'Please try again.');
  async function loadGameIdentityLinks(){
    const host=$('#adminGameIdentityLinks');if(!host)return;
    const {data,error}=await SUPA.client.rpc('list_pending_player_game_identity_links');if(error)throw error;
    const labels={rl:'Rocket League',mlbb:'Mobile Legends: Bang Bang',eafc:'EA SPORTS FC',efootball:'eFootball'};
    host.innerHTML=data?.length?data.map(link=>`<li class="admin-game-identity-row"><div><b>${esc(labels[link.game_key]||link.game_key)} · ${esc(link.username)}</b><span>${esc(link.player_id)}${link.platform?` · ${esc(link.platform)}`:''}</span><small>Submitted ${esc(new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(link.submitted_at)))}</small><a href="${esc(link.proof_url)}" target="_blank" rel="noopener noreferrer">Open proof link <i data-lucide="external-link"></i></a></div><label><span>Review note</span><input type="text" maxlength="500" data-game-link-note="${esc(link.id)}" placeholder="Reason or note (optional)"></label><div><button class="btn btn-gold btn-sm" type="button" data-game-link-review="verified" data-game-link-id="${esc(link.id)}"${READ_ONLY_PREVIEW?' disabled':''}>Verify</button><button class="btn btn-line btn-sm" type="button" data-game-link-review="rejected" data-game-link-id="${esc(link.id)}"${READ_ONLY_PREVIEW?' disabled':''}>Request changes</button></div></li>`).join(''):'<li class="team-empty">No game IDs are waiting for review.</li>';
    icons();
  }
  let adminTeams=[],adminOrganizations=[];
  const expandedAdminTeamIds=new Set();
  function renderAdminTeams(){
    const host=$('#adminTeamList');if(!host)return;
    const query=String($('#adminTeamSearch')?.value||'').trim().toLocaleLowerCase();
    const filtered=adminTeams.filter(team=>`${team.name} ${team.tag} ${team.game} ${team.region||''} ${team.organization_name||'independent'}`.toLocaleLowerCase().includes(query));
    $('#adminTeamCount').textContent=`Showing ${filtered.length} of ${adminTeams.length} teams`;
    host.innerHTML=filtered.map(team=>`<li class="admin-team-item" data-admin-team-row>
      <details class="admin-team-details" data-admin-team-details="${esc(team.id)}"${expandedAdminTeamIds.has(team.id)?' open':''}>
        <summary class="admin-team-summary">
          <span class="admin-team-identity">${identityImage(team.logo_path,team.name,42)}<span class="admin-team-copy"><b>${esc(team.name)}</b><span>${esc(team.tag)} · ${esc(GAMES[team.game]?.label||team.game)}${team.region?` · ${esc(team.region)}`:''}</span></span></span>
          <span class="admin-team-affiliation" title="${esc(team.organization_name)}">${esc(team.organization_name)}</span>
          <span class="admin-team-edit-cue">Manage team</span>
        </summary>
        <div class="admin-team-editor">
          <div class="admin-team-editor-grid">
            <section class="admin-team-setting"><h3>Team name</h3><form class="admin-team-rename" data-admin-team-rename="${esc(team.id)}" data-original-name="${esc(team.name)}"><label><span class="sr-only">Team name</span><input name="name" value="${esc(team.name)}" minlength="2" maxlength="80" required${READ_ONLY_PREVIEW?' disabled':''}></label><button class="btn btn-line btn-sm" type="submit"${READ_ONLY_PREVIEW?' disabled title="Changes are disabled in this production-connected preview."':''}>Save name</button></form></section>
            <section class="admin-team-setting"><h3>Organization</h3><form class="admin-team-organization" data-admin-team-organization="${esc(team.id)}" data-original-organization="${esc(team.organization_id||'')}"><label><span class="sr-only">Organization</span><select name="organization_id"${READ_ONLY_PREVIEW?' disabled':''}><option value="">Independent team</option>${adminOrganizations.map(org=>`<option value="${esc(org.id)}"${team.organization_id===org.id?' selected':''}>${esc(org.name)}</option>`).join('')}</select></label><button class="btn btn-line btn-sm" type="submit"${READ_ONLY_PREVIEW?' disabled title="Changes are disabled in this production-connected preview."':''}>Save organization</button></form></section>
            <section class="admin-team-setting"><h3>Team logo</h3><div class="admin-team-photo">${team.organization_id?'<p>Uses its organization logo.</p>':`<label><span class="sr-only">Upload team logo</span><input type="file" data-admin-team-logo="${esc(team.id)}" accept="image/jpeg,image/png,image/webp"${READ_ONLY_PREVIEW?' disabled':''}></label>${team.team_logo_path?`<button class="btn btn-line btn-sm" type="button" data-admin-team-logo-remove="${esc(team.id)}" data-team-name="${esc(team.name)}"${READ_ONLY_PREVIEW?' disabled':''}>Remove logo</button>`:''}`}</div></section>
          </div>
          <div class="admin-team-danger"><span>Delete this team only if it has no tournament or match history.</span><button class="btn btn-line btn-sm team-danger-action" type="button" data-admin-team-delete="${esc(team.id)}" data-team-name="${esc(team.name)}"${READ_ONLY_PREVIEW?' disabled title="Changes are disabled in this production-connected preview."':''}>Delete team</button></div>
        </div>
      </details>
    </li>`).join('')||`<li class="team-empty">${adminTeams.length?'No teams match your search.':'No teams found.'}</li>`;
  }
  async function loadAdminTeams(){
    const host=$('#adminTeamList');if(!host)return;
    host.innerHTML='<li class="team-empty">Loading teams…</li>';
    const pageSize=1000,rows=[];
    for(let offset=0;;offset+=pageSize){
      const {data,error}=await SUPA.client.from('teams').select('id,name,tag,game,region,organization_id,logo_path').order('name').order('id').range(offset,offset+pageSize-1);
      if(error)throw error;
      rows.push(...(data||[]));
      if((data||[]).length<pageSize)break;
    }
    const {data:organizations,error:organizationError}=await SUPA.client.from('organizations').select('id,name').order('name');
    if(organizationError)throw organizationError;
    adminOrganizations=organizations||[];
    const organizationNames=new Map(adminOrganizations.map(org=>[org.id,org.name]));
    rows.forEach(team=>team.organization_name=team.organization_id?organizationNames.get(team.organization_id)||'Organization':'Independent team');
    await applyOrganizationTeamLogos(rows);adminTeams=rows;renderAdminTeams();
  }
  async function loadMetrics(){
    const host=$('#adminMetrics'),charts=$('#adminAnalyticsCharts'),updated=$('#adminMetricsUpdated');
    if(!host)return;
    updated.textContent='Loading…';
    host.innerHTML='<div class="team-empty">Loading platform totals…</div>';if(charts)charts.innerHTML='';
    const {data,error}=await SUPA.client.rpc('get_admin_analytics');if(error)throw error;
    const totals=data?.totals||{},metrics=[['Total users','users'],['Teams','teams'],['Tournaments','tournaments'],['Active tournaments','active_tournaments'],['Completed matches','completed_matches'],['Registered players','registered_players']];
    const metricIcons={users:'users',teams:'shield',tournaments:'trophy',active_tournaments:'radio',completed_matches:'swords',registered_players:'user-check'};
    host.innerHTML=metrics.map(([label,key])=>`<div class="kpi"><span class="kpi-icon"><i data-lucide="${metricIcons[key]||'activity'}"></i></span><b>${fmt(totals[key])}</b><span class="kpi-label">${esc(label)}</span></div>`).join('');
    const gameLabel=key=>GAMES[key]?.label||key;
    const chart=(title,items,labelKey='month')=>{
      const rows=items||[],max=Math.max(1,...rows.map(row=>Number(row.value??row.registrations)||0));
      return `<section class="analytics-chart"><h3>${esc(title)}</h3>${rows.length?`<ol>${rows.map(row=>{const value=Number(row.value??row.registrations)||0,label=labelKey==='game'?gameLabel(row.game):row.month;return `<li><span title="${esc(label)}">${esc(label)}</span><i><b style="width:${Math.round(value/max*100)}%"></b></i><strong>${fmt(value)}</strong></li>`}).join('')}</ol>`:'<p class="team-empty">No data yet.</p>'}</section>`;
    };
    if(charts)charts.innerHTML=chart('User growth',data.user_growth)+chart('Tournament participation',data.tournament_participation)+chart('Completed matches',data.completed_matches)+chart('Popular games',data.popular_games,'game');
    updated.textContent=`Updated ${new Intl.DateTimeFormat(undefined,{timeStyle:'short'}).format(new Date())}`;icons();
  }
  let roleUserNames=new Map();
  function filterRoleAssignments(){
    const body=$('#adminRoles');if(!body)return;
    const query=String($('#adminRoleSearch')?.value||'').trim().toLocaleLowerCase(),role=$('#adminRoleFilter')?.value||'';
    const rows=[...body.querySelectorAll('[data-role-row]')];let shown=0;
    for(const row of rows){const visible=(!query||`${row.dataset.userId} ${row.dataset.userName||''}`.toLocaleLowerCase().includes(query))&&(!role||row.dataset.role===role);row.hidden=!visible;if(visible)shown++;}
    let empty=body.querySelector('[data-role-empty]');
    if(!empty){empty=document.createElement('tr');empty.dataset.roleEmpty='';empty.innerHTML='<td colspan="4"></td>';body.append(empty);}
    empty.hidden=rows.length>0&&shown>0;
    empty.querySelector('td').textContent=rows.length?'No role assignments match these filters.':'No global role assignments are recorded.';
    const status=$('#adminRoleFilterStatus');if(status)status.textContent=rows.length?`Showing ${shown} of ${rows.length} role assignment${rows.length===1?'':'s'}`:'No role assignments';
  }
  $('#adminRoleSearch')?.addEventListener('input',filterRoleAssignments);
  $('#adminRoleFilter')?.addEventListener('change',filterRoleAssignments);
  $('#adminTeamSearch')?.addEventListener('input',renderAdminTeams);
  $('#adminTeamList')?.addEventListener('toggle',event=>{
    const details=event.target.closest('[data-admin-team-details]');if(!details)return;
    if(details.open)expandedAdminTeamIds.add(details.dataset.adminTeamDetails);
    else expandedAdminTeamIds.delete(details.dataset.adminTeamDetails);
  },true);
  async function loadRoles(){
    if(!canAssign)return;
    const body=$('#adminRoles');body.innerHTML='<tr><td colspan="4">Loading role assignments...</td></tr>';
    const {data,error}=await SUPA.client.from('user_roles').select('user_id,role_key,granted_at').order('granted_at',{ascending:false}).limit(200);
    if(error)throw error;
    const roleFilter=$('#adminRoleFilter'),selectedRole=roleFilter?.value||'';
    const assignmentRoles=[...new Set([...ROLE_ORDER,...globalRoles,...(data||[]).map(row=>row.role_key)])].sort();
    if(roleFilter){roleFilter.innerHTML=`<option value="">All roles</option>${assignmentRoles.map(role=>`<option value="${esc(role)}">${esc(role.replaceAll('_',' '))}</option>`).join('')}`;roleFilter.value=assignmentRoles.includes(selectedRole)?selectedRole:'';}
    const userIds=[...new Set((data||[]).map(row=>row.user_id))];
    const {data:profiles,error:profileError}=userIds.length?await SUPA.client.from('public_profiles').select('id,username,player_name').in('id',userIds):{data:[],error:null};
    if(profileError)throw profileError;
    roleUserNames=new Map((profiles||[]).map(profile=>[profile.id,profile.username||profile.player_name||'']));
    body.innerHTML=(data||[]).map(row=>`<tr data-role-row data-user-id="${esc(row.user_id)}" data-role="${esc(row.role_key)}" data-user-name="${esc(roleUserNames.get(row.user_id)||'')}"><td><span class="admin-role-user">${roleUserNames.get(row.user_id)?`<b>${esc(roleUserNames.get(row.user_id))}</b>`:'<b>Unknown user</b>'}<details class="admin-role-id"><summary>Account ID</summary><code>${esc(row.user_id)}</code></details></span></td><td>${esc(row.role_key)}</td><td>${esc(new Intl.DateTimeFormat(undefined,{dateStyle:'medium'}).format(new Date(row.granted_at)))}</td><td><button class="btn btn-line btn-sm" type="button" data-revoke-role="${esc(row.user_id)}" data-role="${esc(row.role_key)}"${READ_ONLY_PREVIEW?' disabled aria-describedby="adminRoleReadonly" title="Role changes are disabled in this production-connected preview."':''}>Revoke</button></td></tr>`).join('')||'<tr data-role-empty><td colspan="4">No global role assignments are recorded.</td></tr>';
    filterRoleAssignments();
  }
  async function loadAudit(){
    if(!canAudit)return;
    const host=$('#adminAudit');host.textContent='Loading audit events...';
    const {data,error}=await SUPA.client.from('audit_events').select('id,actor_id,action,entity_type,entity_id,details,created_at').order('created_at',{ascending:false}).limit(50);
    if(error)throw error;
    const humanize=value=>String(value||'').replaceAll('_',' ').toLocaleLowerCase().replace(/\b\p{L}/gu,letter=>letter.toLocaleUpperCase());
    const shortId=value=>value?`${String(value).slice(0,8)}…${String(value).slice(-4)}`:'';
    const detailValue=value=>value===null?'Not set':typeof value==='boolean'?value?'Yes':'No':Array.isArray(value)?value.join(', '):typeof value==='object'?JSON.stringify(value):String(value);
    host.innerHTML=data?.length?`<ul class="team-invites admin-audit-list">${data.map(row=>{const details=Object.entries(row.details||{}),actor=row.actor_id?`Account ${shortId(row.actor_id)}`:'System';return `<li class="event-reg"><div class="admin-audit-event"><b>${esc(humanize(row.action))} <span>· ${esc(humanize(row.entity_type))}</span></b><small>${esc(actor)}${row.entity_id?` · ${esc(humanize(row.entity_type))} ${esc(shortId(row.entity_id))}`:''} · ${esc(new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(row.created_at)))}</small>${details.length?`<details class="admin-audit-details"><summary>View ${details.length} detail${details.length===1?'':'s'}</summary><dl>${details.map(([key,value])=>`<div><dt>${esc(humanize(key))}</dt><dd>${esc(detailValue(value))}</dd></div>`).join('')}</dl></details>`:''}</div></li>`;}).join('')}</ul>`:'<p class="team-empty">No audit events have been recorded yet.</p>';
  }
  $('#refreshAdminMetrics')?.addEventListener('click',()=>loadMetrics().catch(error=>report('Metrics unavailable',error)));
  $('#roleGrantForm')?.addEventListener('submit',async event=>{
    event.preventDefault();const form=event.currentTarget,button=form.querySelector('button[type="submit"]');button.disabled=true;
    const values=new FormData(form);
    try{const username=String(values.get('username')||'').trim();const {data:profile,error:lookupError}=await SUPA.client.from('public_profiles').select('id,username').eq('username',username).maybeSingle();if(lookupError)throw lookupError;if(!profile)throw new Error(`No user found with username ${username}. Check the exact username and try again.`);const {error}=await SUPA.client.rpc('assign_role',{target:profile.id,requested_role:values.get('role')});if(error)throw error;toast('ok','Role assigned','The role change was recorded in the audit trail.');await loadRoles();await loadAudit();}
    catch(error){report('Could not assign role',error);}finally{button.disabled=false;}
  });
  workspace.addEventListener('submit',async event=>{
    const organizationForm=event.target.closest('[data-admin-team-organization]');
    if(organizationForm){
      event.preventDefault();if(READ_ONLY_PREVIEW)return;
      const team=adminTeams.find(row=>row.id===organizationForm.dataset.adminTeamOrganization);
      const organizationId=String(new FormData(organizationForm).get('organization_id')||''),oldId=organizationForm.dataset.originalOrganization||'';
      if(!team||organizationId===oldId){toast('info','Organization unchanged','Choose a different organization to move this team.');return;}
      const nextName=organizationId?adminOrganizations.find(org=>org.id===organizationId)?.name||'the selected organization':'Independent team';
      const currentName=team.organization_name||'Independent team';
      if(!window.confirm(`Move ${team.name} from ${currentName} to ${nextName}? The destination organization logo will appear on the team.`))return;
      const button=organizationForm.querySelector('button[type="submit"]');button.disabled=true;
      try{
        const {error}=await SUPA.client.rpc('set_team_organization_as_super_admin',{p_team_id:team.id,p_organization_id:organizationId||null});if(error)throw error;
        toast('ok','Team organization updated',`${team.name} is now under ${nextName}.`);await loadAdminTeams();await loadAudit();
      }catch(error){report('Could not change team organization',error);button.disabled=false;}
      return;
    }
    const form=event.target.closest('[data-admin-team-rename]');if(!form)return;
    event.preventDefault();if(READ_ONLY_PREVIEW)return;
    const name=String(new FormData(form).get('name')||'').trim(),oldName=form.dataset.originalName||'';
    if(name===oldName){toast('info','Name unchanged','Enter a different team name to save a change.');return;}
    if(!window.confirm(`Change the team name from “${oldName}” to “${name}”? This will update the name shown across team and tournament pages.`))return;
    const button=form.querySelector('button[type="submit"]');button.disabled=true;
    try{
      const {error}=await SUPA.client.rpc('rename_team_as_super_admin',{p_team_id:form.dataset.adminTeamRename,p_name:name});if(error)throw error;
      toast('ok','Team name updated',`The team is now called ${name}.`);await loadAdminTeams();await loadAudit();
    }catch(error){report('Could not rename team',error);button.disabled=false;}
  });
  workspace.addEventListener('change',async event=>{
    const input=event.target.closest('[data-admin-team-logo]');if(!input)return;
    const file=input.files?.[0];if(!file)return;
    if(READ_ONLY_PREVIEW){input.value='';return;}
    const team=adminTeams.find(row=>row.id===input.dataset.adminTeamLogo);if(!team){input.value='';return;}
    const oldPath=team.logo_path;input.disabled=true;
    let newPath=null;
    try{
      newPath=await uploadPublicImage(file,`teams/${team.id}`);
      const {error}=await SUPA.client.rpc('set_team_logo_path',{p_team_id:team.id,p_logo_path:newPath});if(error)throw error;
      if(oldPath)await removePublicImage(oldPath);
      toast('ok','Team logo updated',`${team.name}’s logo is now updated.`);await loadAdminTeams();await loadAudit();
    }catch(error){if(newPath)await removePublicImage(newPath);report('Could not update team logo',error);input.disabled=false;input.value='';}
  });
  workspace.addEventListener('click',async event=>{
    const gameLinkReview=event.target.closest('[data-game-link-review]');
    if(gameLinkReview){
      if(READ_ONLY_PREVIEW)return;
      const linkId=gameLinkReview.dataset.gameLinkId,status=gameLinkReview.dataset.gameLinkReview,note=workspace.querySelector(`[data-game-link-note="${CSS.escape(linkId)}"]`)?.value.trim()||null;
      if(status==='rejected'&&!note){toast('err','Add a review note','Tell the player what needs to change before requesting new proof.');return;}
      gameLinkReview.disabled=true;
      try{const {error}=await SUPA.client.rpc('review_player_game_identity_link',{p_link_id:linkId,p_status:status,p_review_note:note});if(error)throw error;toast('ok',status==='verified'?'Game ID verified':'Changes requested',status==='verified'?'The player link is now verified.':'The player can update the ID and submit new proof.');await loadGameIdentityLinks();}
      catch(error){report('Could not review game ID',error);gameLinkReview.disabled=false;}
      return;
    }
    const removeLogo=event.target.closest('[data-admin-team-logo-remove]');
    if(removeLogo){
      if(READ_ONLY_PREVIEW)return;
      const team=adminTeams.find(row=>row.id===removeLogo.dataset.adminTeamLogoRemove);if(!team?.logo_path)return;
      if(!window.confirm(`Remove the logo for ${team.name}?`))return;
      removeLogo.disabled=true;
      try{const oldPath=team.logo_path;const {error}=await SUPA.client.rpc('set_team_logo_path',{p_team_id:team.id,p_logo_path:null});if(error)throw error;await removePublicImage(oldPath);toast('ok','Team logo removed',`${team.name} will now show its initials.`);await loadAdminTeams();await loadAudit();}
      catch(error){report('Could not remove team logo',error);removeLogo.disabled=false;}
      return;
    }
    const deleteTeam=event.target.closest('[data-admin-team-delete]');
    if(deleteTeam){
      if(READ_ONLY_PREVIEW)return;
      const name=deleteTeam.dataset.teamName||'this team';
      if(!window.confirm(`Permanently delete ${name} and its roster? This cannot be undone. Teams with tournament registrations or match records cannot be deleted.`))return;
      deleteTeam.disabled=true;
      try{
        const {error}=await SUPA.client.rpc('delete_team',{p_team_id:deleteTeam.dataset.adminTeamDelete});if(error)throw error;
        toast('ok','Team deleted','The team profile and roster were removed. Tournament records are preserved.');await loadAdminTeams();await loadAudit();
      }catch(error){report('Could not delete team',error);deleteTeam.disabled=false;}
      return;
    }
    const button=event.target.closest('[data-revoke-role]');if(!button)return;
    if(!confirm(`Revoke ${button.dataset.role} from this account?`))return;button.disabled=true;
    try{const {error}=await SUPA.client.rpc('revoke_role',{target:button.dataset.revokeRole,requested_role:button.dataset.role});if(error)throw error;toast('ok','Role revoked','The role change was recorded in the audit trail.');await loadRoles();await loadAudit();}
    catch(error){report('Could not revoke role',error);button.disabled=false;}
  });
  const results=await Promise.allSettled([loadMetrics(),loadRoles(),loadAudit(),loadAdminTeams(),canReviewGameLinks?loadGameIdentityLinks():Promise.resolve()]);
  for(const result of results)if(result.status==='rejected')report('Administration data unavailable',result.reason);
}).catch(error=>toast('err','Administration unavailable',error?.message||'Please reload and try again.'));



