/* Tournament lifecycle actions are scoped and written through database RPCs. */
Auth.ready.then(async()=>{
  if(!requirePerm('MANAGE_SCHEDULE'))return;
  buildConsoleStrip();
  const host=$('#eventList');
  const setError=error=>{host.innerHTML=`<div class="dcard" style="grid-column:1/-1"><div class="dh">Could not load tournament operations</div><div class="db"><p>${esc(error?.message||'Please try again.')}</p></div></div>`;};
  const date=value=>value?new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)):'Date to be announced';
  async function details(event){
    const [regResult,stageResult]=await Promise.all([
      SUPA.client.from('tournament_registrations').select('id,team_id,status,created_at').eq('tournament_id',event.id).order('created_at'),
      SUPA.client.from('tournament_stages').select('id,name,format,status,stage_number').eq('tournament_id',event.id).order('stage_number')
    ]);
    if(regResult.error)throw regResult.error;if(stageResult.error)throw stageResult.error;
    const regs=regResult.data||[],ids=[...new Set(regs.map(row=>row.team_id))];
    let teams=[];
    if(ids.length){const result=await SUPA.client.from('teams').select('id,name,tag').in('id',ids);if(result.error)throw result.error;teams=result.data||[];}
    const byTeam=new Map(teams.map(team=>[team.id,team]));
    return {event,regs:regs.map(row=>({...row,team:byTeam.get(row.team_id)})),stages:stageResult.data||[]};
  }
  async function render(){
    host.innerHTML='<div class="team-empty">Loading your tournaments…</div>';
    const {data,error}=await SUPA.client.from('tournaments').select('id,name,game,format,status,starts_at,registration_closes_at,max_teams').order('created_at',{ascending:false}).limit(100);
    if(error)throw error;
    const items=await Promise.all((data||[]).map(details));
    if(!items.length){host.innerHTML='<div class="dcard" style="grid-column:1/-1"><div class="dh"><i data-lucide="clipboard-list"></i>Your tournament assignments</div><div class="db"><p class="team-empty">No tournaments are assigned to you. Create an event or ask an organizer to add you to its staff.</p><a class="btn btn-line btn-sm" href="organize.html" style="margin-top:14px">Create a tournament</a></div></div>';icons();return;}
    host.innerHTML=items.map(({event,regs,stages})=>{
      const approved=regs.filter(r=>['approved','checked_in'].includes(r.status));
      const hasPublished=stages.some(s=>s.status==='published');
      const pending=regs.filter(r=>r.status==='pending');
      const regRows=regs.length?regs.map(r=>`<li class="event-reg"><span><b>${esc(r.team?.name||'Team unavailable')} <small>${esc(r.team?.tag||'')}</small></b><small>${esc(r.status.replaceAll('_',' '))}</small></span>${r.status==='pending'&&event.status==='registration_open'?`<span class="event-actions"><button class="btn btn-line btn-sm" data-event-action="review_registration" data-event="${esc(event.id)}" data-registration="${esc(r.id)}" data-status="approved">Approve</button><button class="btn btn-line btn-sm" data-event-action="review_registration" data-event="${esc(event.id)}" data-registration="${esc(r.id)}" data-status="rejected">Decline</button></span>`:''}</li>`).join(''):'<li class="team-empty">No team registrations yet.</li>';
      const actions=[];
      if(event.status==='draft')actions.push('<button class="btn btn-gold btn-sm" data-event-action="transition" data-event="'+esc(event.id)+'" data-status="registration_open">Open registration</button>');
      if(event.status==='registration_open'&&pending.length===0)actions.push('<button class="btn btn-line btn-sm" data-event-action="transition" data-event="'+esc(event.id)+'" data-status="registration_closed">Close registration</button>');
      if(event.status==='registration_open'&&pending.length>0)actions.push(`<p class="team-empty">Review all ${pending.length} pending registration${pending.length===1?'':'s'} before closing registration.</p>`);
      if(event.status==='registration_closed'&&pending.length>0)actions.push(`<p class="team-empty">${pending.length} registration${pending.length===1?' is':'s are'} still pending. Decisions are locked after registration closes.</p>`);
      if(event.status==='registration_closed'&&!hasPublished&&approved.length>=2){
        const supportedDouble=event.format!=='double_elimination'||(approved.length>=4&&(approved.length&(approved.length-1))===0);
        if(supportedDouble)actions.push('<button class="btn btn-gold btn-sm" data-event-action="generate_bracket" data-event="'+esc(event.id)+'">Publish bracket</button>');
        else actions.push('<p class="team-empty">Double elimination currently requires 4 or more approved teams in a power-of-two field. Adjust registrations or choose another format before publishing.</p>');
      }
      if(event.status==='registration_closed'&&hasPublished)actions.push('<button class="btn btn-gold btn-sm" data-event-action="transition" data-event="'+esc(event.id)+'" data-status="in_progress">Start tournament</button>');
      const rrDone=event.format==='round_robin_playoffs'&&stages.some(s=>s.stage_number===1&&s.format==='round_robin'&&s.status==='completed');
      const playoffsExist=stages.some(s=>s.stage_number>1);
      if(event.status==='in_progress'&&rrDone&&!playoffsExist){
        const options=[2,4,8,16,32,64].filter(n=>n<=approved.length).map(n=>`<option value="${n}"${n===Math.min(4,2**Math.floor(Math.log2(approved.length)))?' selected':''}>Top ${n}</option>`).join('');
        actions.push(`<label class="event-qualifiers">Playoff qualifiers <select data-qualifiers="${esc(event.id)}">${options}</select></label><button class="btn btn-gold btn-sm" data-event-action="generate_playoff_stage" data-event="${esc(event.id)}">Generate playoff stage</button>`);
      }
      if(event.status==='in_progress')actions.push('<button class="btn btn-line btn-sm" data-event-action="transition" data-event="'+esc(event.id)+'" data-status="completed">Complete tournament</button>');
      return `<article class="dcard event-card" data-event-card="${esc(event.id)}"><div class="dh"><i data-lucide="trophy"></i>${esc(event.name)}<span class="mono-r">${esc(event.status.replaceAll('_',' ').toUpperCase())}</span></div><div class="db"><div class="team-meta"><span>${esc(GAMES[event.game]?.label||event.game)}</span><span>${esc(String(event.format).replaceAll('_',' '))}</span><span>Starts ${esc(date(event.starts_at))}</span><span>${approved.length}/${regs.length} approved</span></div><h3 class="team-section-title">Team registrations <span>${pending.length} pending</span></h3><ul class="team-invites">${regRows}</ul>${stages.length?`<p class="team-empty">Stages: ${stages.map(s=>`${esc(s.name)} · ${esc(s.format.replaceAll('_',' '))} · ${esc(s.status)}`).join(' / ')}</p>`:''}<div class="event-actions">${actions.join('')}</div></div></article>`;
    }).join('');
    icons();
  }
  host.addEventListener('click',async event=>{
    const button=event.target.closest('[data-event-action]');if(!button)return;
    button.disabled=true;const id=button.dataset.event,action=button.dataset.eventAction;
    try{
      let result;
      if(action==='review_registration')result=await SUPA.client.rpc('review_registration',{p_registration_id:button.dataset.registration,p_new_status:button.dataset.status});
      else if(action==='transition')result=await SUPA.client.rpc('transition_tournament',{p_tournament_id:id,p_new_status:button.dataset.status});
      else if(action==='generate_bracket'){
        const {data:rows,error}=await SUPA.client.from('tournament_registrations').select('id').eq('tournament_id',id).in('status',['approved','checked_in']).order('created_at');
        if(error)throw error;
        result=await SUPA.client.rpc('generate_bracket',{p_tournament_id:id,p_seeded_registration_ids:(rows||[]).map(r=>r.id)});
      }
      else if(action==='generate_playoff_stage'){
        const qualifiers=host.querySelector(`[data-qualifiers="${CSS.escape(id)}"]`);
        result=await SUPA.client.rpc('generate_playoff_stage',{p_tournament_id:id,p_qualifier_count:Number(qualifiers?.value||4)});
      }
      if(result?.error)throw result.error;
      toast('ok','Tournament updated','The database accepted the action and the workspace is refreshing.');
      await render();
    }catch(error){toast('err','Tournament action failed',error.message||'Please check your assignment and try again.');button.disabled=false;}
  });
  try{await render();}catch(error){setError(error);}
}).catch(error=>toast('err','Tournament operations unavailable',error.message||'Please reload and try again.'));
