/* Administrative metrics, role changes, and audit reads use existing RLS scopes. */
Auth.ready.then(async()=>{
  if(!requirePerm('BAN_USERS'))return;
  const wrap=document.querySelector('main .sec.tight .wrap');if(!wrap)return;
  const canAssign=Auth.has('MANAGE_PERMISSIONS'),canAudit=Auth.has('AUDIT_LOGS');
  wrap.innerHTML=`<div class="console-strip" id="consoleStrip"></div><div id="adminWorkspace" class="dgrid2" style="margin-top:22px" aria-live="polite"></div>`;
  buildConsoleStrip();
  const workspace=$('#adminWorkspace');
  const globalRoles=['REFEREE','MODERATOR','TOURNAMENT_ADMIN','PLATFORM_ADMIN','SUPER_ADMIN'];
  const sections=[`<section class="dcard" style="grid-column:1/-1"><div class="dh"><i data-lucide="activity"></i>Platform metrics<span class="mono-r" id="adminMetricsUpdated">Loading…</span></div><div class="db"><div id="adminMetrics" class="kpis" aria-live="polite"></div><button class="btn btn-line btn-sm" id="refreshAdminMetrics" type="button">Refresh metrics</button></div></section>`];
  if(Auth.has('MANAGE_SCHEDULE'))sections.push(`<section class="dcard"><div class="dh"><i data-lucide="git-fork"></i>Tournament operations</div><div class="db"><p>Review entries, publish a bracket once at least two teams are approved, and start the tournament.</p><a class="btn btn-gold btn-sm" href="event-admin.html">Manage tournaments &amp; brackets</a></div></section>`);
  if(canAssign)sections.push(`<section class="dcard"><div class="dh"><i data-lucide="users"></i>Global role assignments</div><div class="db">
    <form id="roleGrantForm" class="team-create-form"><label><span>User UUID</span><input name="user_id" required pattern="[0-9a-fA-F-]{36}" placeholder="Supabase account ID"></label><label><span>Role</span><select name="role">${globalRoles.map(r=>`<option>${r}</option>`).join('')}</select></label><button class="btn btn-gold btn-sm" type="submit">Grant role</button></form>
    <div class="tablewrap"><table><thead><tr><th>User ID</th><th>Role</th><th>Granted</th><th></th></tr></thead><tbody id="adminRoles"></tbody></table></div>
  </div></section>`);
  if(canAudit)sections.push(`<section class="dcard"><div class="dh"><i data-lucide="history"></i>Audit events</div><div class="db"><div id="adminAudit" class="team-empty">Loading audit events...</div></div></section>`);
  if(!canAssign&&!canAudit)sections.push('<section class="dcard"><div class="dh">Administration</div><div class="db"><p>You do not have permission to manage global roles or view audit events.</p></div></section>');
  workspace.innerHTML=sections.join('');icons();
  const report=(title,error)=>toast('err',title,error?.message||'Please try again.');
  const metricSources=[
    {label:'Public player profiles',table:'public_profiles',column:'id'},
    {label:'Teams',table:'teams',column:'id'},
    {label:'Published tournaments',table:'tournament_directory',column:'id',filter:q=>q.neq('status','draft')},
    {label:'Live matches',table:'tournament_matches',column:'id',filter:q=>q.eq('status','live')},
    {label:'Open disputes visible to you',table:'match_disputes',column:'id',filter:q=>q.in('status',['open','under_review'])},
    {label:'Open reports visible to you',table:'moderation_cases',column:'id',filter:q=>q.in('status',['open','under_review'])}
  ];
  async function loadMetrics(){
    const host=$('#adminMetrics'),updated=$('#adminMetricsUpdated');
    if(!host)return;
    updated.textContent='Loading…';
    host.innerHTML=metricSources.map((metric,index)=>`<div class="kpi"><b id="adminMetric${index}">…</b><span>${esc(metric.label)}</span></div>`).join('');
    const results=await Promise.allSettled(metricSources.map(metric=>{
      let query=SUPA.client.from(metric.table).select(metric.column,{count:'exact',head:true});
      if(metric.filter)query=metric.filter(query);
      return query;
    }));
    let failures=0;
    results.forEach((result,index)=>{
      const value=$(`#adminMetric${index}`);
      if(result.status==='fulfilled'&&!result.value.error)value.textContent=fmt(result.value.count);
      else{failures++;value.textContent='—';value.setAttribute('aria-label','Unavailable');}
    });
    updated.textContent=failures?`${failures} count${failures===1?'':'s'} unavailable`:`Updated ${new Intl.DateTimeFormat(undefined,{timeStyle:'short'}).format(new Date())}`;
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
