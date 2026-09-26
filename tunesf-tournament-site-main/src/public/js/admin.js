/* Administrative metrics, role changes, and audit reads use existing RLS scopes. */
Auth.ready.then(async()=>{
  if(!requirePerm('BAN_USERS'))return;
  const wrap=document.querySelector('main .sec.tight .wrap');if(!wrap)return;
  const canAssign=Auth.has('MANAGE_PERMISSIONS'),canAudit=Auth.has('AUDIT_LOGS');
  wrap.innerHTML=`<div class="console-strip" id="consoleStrip"></div><div id="adminWorkspace" class="dgrid2" style="margin-top:22px" aria-live="polite"></div>`;
  buildConsoleStrip();
  const workspace=$('#adminWorkspace');
  const globalRoles=['REFEREE','MODERATOR','TOURNAMENT_ADMIN','PLATFORM_ADMIN','SUPER_ADMIN'];
  const sections=[`<section class="dcard" style="grid-column:1/-1"><div class="dh"><i data-lucide="activity"></i>Platform analytics<span class="mono-r" id="adminMetricsUpdated">Loading…</span></div><div class="db"><div id="adminMetrics" class="kpis" aria-live="polite"></div><div id="adminAnalyticsCharts" class="analytics-grid" aria-live="polite"></div><button class="btn btn-line btn-sm" id="refreshAdminMetrics" type="button">Refresh analytics</button></div></section>`];
  if(Auth.has('MANAGE_SCHEDULE'))sections.push(`<section class="dcard"><div class="dh"><i data-lucide="git-fork"></i>Tournament operations</div><div class="db"><p>Review entries, publish a bracket once at least two teams are approved, and start the tournament.</p><a class="btn btn-gold btn-sm" href="event-admin.html">Manage tournaments &amp; brackets</a></div></section>`);
  if(canAssign)sections.push(`<section class="dcard"><div class="dh"><i data-lucide="users"></i>Global role assignments</div><div class="db">
    <form id="roleGrantForm" class="team-create-form"><label><span>User UUID</span><input name="user_id" required pattern="[0-9a-fA-F-]{36}" placeholder="Supabase account ID"></label><label><span>Role</span><select name="role">${globalRoles.map(r=>`<option>${r}</option>`).join('')}</select></label><button class="btn btn-gold btn-sm" type="submit">Grant role</button></form>
    <div class="tablewrap"><table><thead><tr><th>User ID</th><th>Role</th><th>Granted</th><th></th></tr></thead><tbody id="adminRoles"></tbody></table></div>
  </div></section>`);
  if(canAudit)sections.push(`<section class="dcard"><div class="dh"><i data-lucide="history"></i>Audit events</div><div class="db"><div id="adminAudit" class="team-empty">Loading audit events...</div></div></section>`);
  if(!canAssign&&!canAudit)sections.push('<section class="dcard"><div class="dh">Administration</div><div class="db"><p>You do not have permission to manage global roles or view audit events.</p></div></section>');
  workspace.innerHTML=sections.join('');icons();
  const report=(title,error)=>toast('err',title,error?.message||'Please try again.');
  async function loadMetrics(){
    const host=$('#adminMetrics'),charts=$('#adminAnalyticsCharts'),updated=$('#adminMetricsUpdated');
    if(!host)return;
    updated.textContent='Loading…';
    host.innerHTML='<div class="team-empty">Loading platform totals…</div>';if(charts)charts.innerHTML='';
    const {data,error}=await SUPA.client.rpc('get_admin_analytics');if(error)throw error;
    const totals=data?.totals||{},metrics=[['Total users','users'],['Teams','teams'],['Tournaments','tournaments'],['Active tournaments','active_tournaments'],['Completed matches','completed_matches'],['Registered players','registered_players']];
    host.innerHTML=metrics.map(([label,key])=>`<div class="kpi"><b>${fmt(totals[key])}</b><span>${esc(label)}</span></div>`).join('');
    const gameLabel=key=>GAMES[key]?.label||key;
    const chart=(title,items,labelKey='month')=>{
      const rows=items||[],max=Math.max(1,...rows.map(row=>Number(row.value??row.registrations)||0));
      return `<section class="analytics-chart"><h3>${esc(title)}</h3>${rows.length?`<ol>${rows.map(row=>{const value=Number(row.value??row.registrations)||0,label=labelKey==='game'?gameLabel(row.game):row.month;return `<li><span title="${esc(label)}">${esc(label)}</span><i><b style="width:${Math.round(value/max*100)}%"></b></i><strong>${fmt(value)}</strong></li>`}).join('')}</ol>`:'<p class="team-empty">No data yet.</p>'}</section>`;
    };
    if(charts)charts.innerHTML=chart('User growth',data.user_growth)+chart('Tournament participation',data.tournament_participation)+chart('Completed matches',data.completed_matches)+chart('Popular games',data.popular_games,'game');
    updated.textContent=`Updated ${new Intl.DateTimeFormat(undefined,{timeStyle:'short'}).format(new Date())}`;icons();
  }
  async function loadRoles(){
    if(!canAssign)return;
    const body=$('#adminRoles');body.innerHTML='<tr><td colspan="4">Loading role assignments...</td></tr>';
    const {data,error}=await SUPA.client.from('user_roles').select('user_id,role_key,granted_at').order('granted_at',{ascending:false}).limit(200);
    if(error)throw error;
    body.innerHTML=(data||[]).map(row=>`<tr><td><code>${esc(row.user_id)}</code></td><td>${esc(row.role_key)}</td><td>${esc(new Intl.DateTimeFormat(undefined,{dateStyle:'medium'}).format(new Date(row.granted_at)))}</td><td><button class="btn btn-line btn-sm" type="button" data-revoke-role="${esc(row.user_id)}" data-role="${esc(row.role_key)}">Revoke</button></td></tr>`).join('')||'<tr><td colspan="4">No global role assignments are recorded.</td></tr>';
  }
  async function loadAudit(){
    if(!canAudit)return;
    const host=$('#adminAudit');host.textContent='Loading audit events...';
    const {data,error}=await SUPA.client.from('audit_events').select('id,actor_id,action,entity_type,entity_id,details,created_at').order('created_at',{ascending:false}).limit(50);
    if(error)throw error;
    host.innerHTML=data?.length?`<ul class="team-invites">${data.map(row=>`<li class="event-reg"><span><b>${esc(row.action)} · ${esc(row.entity_type)}</b><small>${esc(row.actor_id||'System')} · ${esc(row.entity_id||'')} · ${esc(new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(row.created_at)))}</small><small>${esc(JSON.stringify(row.details||{}))}</small></span></li>`).join('')}</ul>`:'<p class="team-empty">No audit events have been recorded yet.</p>';
  }
  $('#refreshAdminMetrics')?.addEventListener('click',()=>loadMetrics().catch(error=>report('Metrics unavailable',error)));
  $('#roleGrantForm')?.addEventListener('submit',async event=>{
    event.preventDefault();const form=event.currentTarget,button=form.querySelector('button[type="submit"]');button.disabled=true;
    const values=new FormData(form);
    try{const {error}=await SUPA.client.rpc('assign_role',{target:String(values.get('user_id')).trim(),requested_role:values.get('role')});if(error)throw error;toast('ok','Role assigned','The role change was recorded in the audit trail.');await loadRoles();await loadAudit();}
    catch(error){report('Could not assign role',error);}finally{button.disabled=false;}
  });
  workspace.addEventListener('click',async event=>{
    const button=event.target.closest('[data-revoke-role]');if(!button)return;
    if(!confirm(`Revoke ${button.dataset.role} from this account?`))return;button.disabled=true;
    try{const {error}=await SUPA.client.rpc('revoke_role',{target:button.dataset.revokeRole,requested_role:button.dataset.role});if(error)throw error;toast('ok','Role revoked','The role change was recorded in the audit trail.');await loadRoles();await loadAudit();}
    catch(error){report('Could not revoke role',error);button.disabled=false;}
  });
  const results=await Promise.allSettled([loadMetrics(),loadRoles(),loadAudit()]);
  for(const result of results)if(result.status==='rejected')report('Administration data unavailable',result.reason);
}).catch(error=>toast('err','Administration unavailable',error?.message||'Please reload and try again.'));
