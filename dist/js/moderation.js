/* Reports and moderation decisions are persisted and authorized in Supabase. */
Auth.ready.then(async()=>{
  const panel=document.querySelector('.dgrid2');
  if(!panel)return;
  document.querySelector('.kpis')?.remove();
  if(!Auth.is()){
    panel.innerHTML='<div class="dcard" style="grid-column:1/-1"><div class="dh">Sign in to report a concern</div><div class="db"><p>Reports are tied to your account so the moderation team can follow up.</p><a class="btn btn-gold btn-sm" href="login.html?next=moderation.html" style="margin-top:12px">Sign in</a></div></div>';
    return;
  }
  const isModerator=Auth.has('REVIEW_REPORTS');
  buildConsoleStrip();
  panel.innerHTML=`<section class="dcard" style="grid-column:1/-1"><div class="dh"><i data-lucide="flag"></i>Submit a report</div><div class="db">
    <form id="caseCreateForm" class="team-create-form">
      <label><span>What are you reporting?</span><select name="subject_type"><option value="user">User</option><option value="team">Team</option><option value="tournament">Tournament</option><option value="match">Match incident</option></select></label>
      <label><span>Record UUID</span><input name="subject_id" required pattern="[0-9a-fA-F-]{36}" placeholder="Paste the record or match ID"></label>
      <label><span>Category</span><select name="category" required><option value="conduct">Unsportsmanlike conduct</option><option value="cheating">Cheating concern</option><option value="harassment">Harassment</option><option value="impersonation">Impersonation</option><option value="other">Other</option></select></label>
      <label><span>What happened?</span><textarea name="description" required minlength="5" maxlength="5000"></textarea></label>
      <button class="btn btn-gold btn-sm" type="submit">Submit report</button>
    </form>
  </div></section>
  ${isModerator?'<section class="dcard" style="grid-column:1/-1"><div class="dh"><i data-lucide="shield-check"></i>Moderation queue</div><div class="db"><p class="team-empty">Only cases visible to your moderation assignment appear here.</p></div><ul id="caseQueue" class="team-invites"></ul></section>':''}
  <section class="dcard" style="grid-column:1/-1"><div class="dh"><i data-lucide="history"></i>Your submitted reports</div><div class="db" id="myReports" aria-live="polite"><p class="team-empty">Loading reports...</p></div></section>`;
  icons();
  const queue=$('#caseQueue'),reports=$('#myReports');
  const incidentMatch=new URLSearchParams(location.search).get('incident_match');
  if(incidentMatch){$('#caseCreateForm [name="subject_type"]').value='match';$('#caseCreateForm [name="subject_id"]').value=incidentMatch;}
  const fail=(title,error)=>toast('err',title,error?.message||'Please try again.');
  const date=value=>value?new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)):'Date unavailable';
  async function render(){
    if(reports)reports.innerHTML='<p class="team-empty">Loading reports...</p>';
    const {data,error}=await SUPA.client.from('moderation_cases').select('id,reporter_id,subject_user_id,subject_team_id,subject_tournament_id,subject_match_id,category,description,status,assigned_to,decision,decision_note,created_at').order('created_at',{ascending:false}).limit(100);
    if(error)throw error;
    const rows=data||[],mine=rows.filter(row=>row.reporter_id===Auth.user.id);
    reports.innerHTML=mine.length?`<ul class="team-invites">${mine.map(row=>`<li class="event-reg"><span><b>${esc(row.category)} · ${esc(row.status.replaceAll('_',' '))}</b><small>${esc(date(row.created_at))}${row.decision?' · '+esc(row.decision):''}</small></span><small>${esc(row.description)}</small></li>`).join('')}</ul>`:'<p class="team-empty">You have not submitted any reports.</p>';
    if(queue){
      const open=rows.filter(row=>!['resolved','dismissed'].includes(row.status));
      queue.innerHTML=open.length?open.map(row=>{
        const subject=row.subject_user_id?`User ${row.subject_user_id}`:row.subject_team_id?`Team ${row.subject_team_id}`:row.subject_tournament_id?`Tournament ${row.subject_tournament_id}`:`Match ${row.subject_match_id}`;
        const owns=row.assigned_to===Auth.user.id;
        const controls=owns?`<form class="case-review-form" data-review-case="${esc(row.id)}"><label><span>Decision</span><input name="decision" minlength="2" maxlength="100" required placeholder="Finding or action"></label><label><span>Decision notes</span><textarea name="note" maxlength="3000"></textarea></label><div class="event-actions"><button class="btn btn-gold btn-sm" name="status" value="resolved">Resolve</button><button class="btn btn-line btn-sm" name="status" value="dismissed">Dismiss</button></div></form>`:
          row.assigned_to?'<small>Assigned to another reviewer.</small>':`<button class="btn btn-line btn-sm" type="button" data-claim-case="${esc(row.id)}">Take case</button>`;
        return `<li class="event-reg case-row"><div><b>${esc(row.category)} · ${esc(subject)}</b><small>${esc(row.status.replaceAll('_',' '))} · Submitted ${esc(date(row.created_at))}</small><p>${esc(row.description)}</p></div>${controls}</li>`;
      }).join(''):'<li class="team-empty">No open reports.</li>';
    }
    icons();
  }
  $('#caseCreateForm').addEventListener('submit',async event=>{
    event.preventDefault();const form=event.currentTarget,button=form.querySelector('button[type="submit"]');button.disabled=true;
    const values=new FormData(form),type=values.get('subject_type'),id=String(values.get('subject_id')).trim();
    try{
      const {error}=await SUPA.client.rpc('create_moderation_case',{
        p_subject_user_id:type==='user'?id:null,p_subject_team_id:type==='team'?id:null,
        p_subject_tournament_id:type==='tournament'?id:null,p_subject_match_id:type==='match'?id:null,
        p_category:values.get('category'),p_description:String(values.get('description')).trim()
      });
      if(error)throw error;form.reset();toast('ok','Report submitted','The case was recorded for authorized review.');await render();
    }catch(error){fail('Could not submit report',error);}finally{button.disabled=false;}
  });
  panel.addEventListener('click',async event=>{
    const button=event.target.closest('[data-claim-case]');if(!button)return;button.disabled=true;
    try{const {error}=await SUPA.client.rpc('assign_moderation_case',{p_case_id:button.dataset.claimCase,p_reviewer_id:Auth.user.id});if(error)throw error;toast('ok','Case assigned','You are now the reviewer.');await render();}
    catch(error){fail('Could not take case',error);button.disabled=false;}
  });
  panel.addEventListener('submit',async event=>{
    const form=event.target.closest('[data-review-case]');if(!form)return;event.preventDefault();
    const button=event.submitter;if(!button)return;button.disabled=true;const values=new FormData(form);
    try{
      const {error}=await SUPA.client.rpc('review_moderation_case',{p_case_id:form.dataset.reviewCase,p_new_status:button.value,p_decision:String(values.get('decision')).trim(),p_decision_note:String(values.get('note')||'').trim()});
      if(error)throw error;toast('ok','Case updated','The decision was saved to the moderation audit trail.');await render();
    }catch(error){fail('Could not update case',error);button.disabled=false;}
  });
  try{await render();}catch(error){reports.innerHTML='<p class="team-empty">Reports could not be loaded.</p>';if(queue)queue.innerHTML='<li class="team-empty">Moderation queue could not be loaded.</li>';fail('Moderation workspace unavailable',error);}
}).catch(error=>toast('err','Moderation workspace unavailable',error?.message||'Please reload and try again.'));
