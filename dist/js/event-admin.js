/* Tournament lifecycle actions are scoped and written through database RPCs. */
Auth.ready.then(async()=>{
  if(!requirePerm('MANAGE_SCHEDULE'))return;
  buildConsoleStrip();
  const host=$('#eventList');
  const seedOrders=new Map();
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
    const stages=stageResult.data||[];
    const [standingsResult,refereeResult]=await Promise.all([
      stages.some(stage=>stage.format==='round_robin')
        ?SUPA.client.from('tournament_standings').select('stage_id,registration_id,played,wins,draws,losses,points,score_for,score_against,rank').in('stage_id',stages.filter(stage=>stage.format==='round_robin').map(stage=>stage.id))
        :{data:[],error:null},
      SUPA.client.rpc('list_tournament_referees',{p_tournament_id:event.id})
    ]);
    if(standingsResult.error)throw standingsResult.error;if(refereeResult.error)throw refereeResult.error;
    return {event,regs:regs.map(row=>({...row,team:byTeam.get(row.team_id)})),stages,
      standings:standingsResult.data||[],referees:refereeResult.data||[]};
  }
  async function render(){
    host.innerHTML='<div class="team-empty">Loading your tournaments…</div>';
    const {data,error}=await SUPA.client.rpc('list_my_tournament_operations');
    if(error)throw error;
    const items=await Promise.all((data||[]).map(details));
    if(!items.length){host.innerHTML='<div class="dcard" style="grid-column:1/-1"><div class="dh"><i data-lucide="clipboard-list"></i>Your tournament assignments</div><div class="db"><p class="team-empty">No tournaments are assigned to you. Create an event or ask an organizer to add you to its staff.</p><a class="btn btn-line btn-sm" href="organize.html" style="margin-top:14px">Create a tournament</a></div></div>';icons();return;}
    host.innerHTML=items.map(({event,regs,stages,standings,referees})=>{
      const approved=regs.filter(r=>['approved','checked_in'].includes(r.status));
      const hasPublished=stages.some(s=>s.status==='published');
      const pending=regs.filter(r=>r.status==='pending');
      const eligible=approved.map(row=>row.id);
      if(!seedOrders.has(event.id))seedOrders.set(event.id,eligible);
      const seedOrder=seedOrders.get(event.id).filter(id=>eligible.includes(id));
      for(const id of eligible)if(!seedOrder.includes(id))seedOrder.push(id);
      seedOrders.set(event.id,seedOrder);
      const regRows=regs.length?regs.map(r=>`<li class="event-reg"><span><b>${esc(r.team?.name||'Team unavailable')} <small>${esc(r.team?.tag||'')}</small></b><small>${esc(r.status.replaceAll('_',' '))}</small></span>${r.status==='pending'&&event.status==='registration_open'?`<span class="event-actions"><button class="btn btn-line btn-sm" data-event-action="review_registration" data-event="${esc(event.id)}" data-registration="${esc(r.id)}" data-status="approved">Approve</button><button class="btn btn-line btn-sm" data-event-action="review_registration" data-event="${esc(event.id)}" data-registration="${esc(r.id)}" data-status="rejected">Decline</button></span>`:''}</li>`).join(''):'<li class="team-empty">No team registrations yet.</li>';
      const actions=[];
      if(event.status==='draft')actions.push('<button class="btn btn-gold btn-sm" data-event-action="transition" data-event="'+esc(event.id)+'" data-status="registration_open">Open registration</button>');
      if(event.status==='registration_open'&&pending.length===0&&approved.length>=2)actions.push('<button class="btn btn-line btn-sm" data-event-action="transition" data-event="'+esc(event.id)+'" data-status="registration_closed">Close registration</button>');
      if(event.status==='registration_open'&&pending.length===0&&approved.length<2)actions.push(`<p class="team-empty">Keep registration open until at least two teams are approved; then you can close signups and publish the bracket.</p>`);
      if(event.status==='registration_open'&&pending.length>0)actions.push(`<p class="team-empty">Review all ${pending.length} pending registration${pending.length===1?'':'s'} before closing registration.</p>`);
      if(event.status==='registration_closed'&&pending.length>0)actions.push(`<p class="team-empty">${pending.length} registration${pending.length===1?' is':'s are'} still pending. Decisions are locked after registration closes.</p>`);
      if(event.status==='registration_closed'&&!hasPublished&&approved.length<2){
        const canReopen=!event.registration_closes_at||new Date(event.registration_closes_at)>new Date();
        actions.push(`<p class="team-empty">A bracket needs at least two approved teams. This event has ${approved.length}; ${canReopen?'reopen registration to accept more teams.':'the registration deadline has passed.'}</p>`);
        if(canReopen)actions.push('<button class="btn btn-line btn-sm" data-event-action="reopen_registration" data-event="'+esc(event.id)+'">Reopen registration</button>');
      }
      if(event.status==='registration_closed'&&!hasPublished&&approved.length>=2){
        const supportedDouble=event.format!=='double_elimination'||(approved.length>=4&&(approved.length&(approved.length-1))===0);
        if(supportedDouble)actions.push('<button class="btn btn-gold btn-sm" data-event-action="generate_bracket" data-event="'+esc(event.id)+'">Publish bracket with these seeds</button>');
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
      const seedRows=event.status==='registration_closed'&&!hasPublished&&approved.length>=2?`<section class="event-admin-tools"><h3 class="team-section-title">Bracket seed order <small>Move teams before publishing</small></h3><ol class="event-seed-list">${seedOrder.map((registrationId,index)=>{const row=approved.find(r=>r.id===registrationId);return `<li><span><b>Seed ${index+1}</b> ${esc(row?.team?.name||'Team unavailable')}</span><span><button class="btn btn-line btn-sm" type="button" aria-label="Move ${esc(row?.team?.name||'team')} up" data-event-action="seed_move" data-event="${esc(event.id)}" data-registration="${esc(registrationId)}" data-direction="-1"${index===0?' disabled':''}>↑</button><button class="btn btn-line btn-sm" type="button" aria-label="Move ${esc(row?.team?.name||'team')} down" data-event-action="seed_move" data-event="${esc(event.id)}" data-registration="${esc(registrationId)}" data-direction="1"${index===seedOrder.length-1?' disabled':''}>↓</button></span></li>`;}).join('')}</ol></section>`:'';
      const refereeOptions=referees.map(ref=>`<option value="${esc(ref.user_id)}"${ref.assigned?' selected':''}>${esc(ref.username||ref.player_name||'Referee')}</option>`).join('');
      const refereeControl=`<section class="event-admin-tools"><h3 class="team-section-title">Tournament referee</h3><p class="team-empty">One referee can oversee every match in this tournament.</p><div class="event-actions"><select aria-label="Tournament referee" data-referee-select="${esc(event.id)}"><option value="">${refereeOptions?'No referee assigned':'No referee accounts available'}</option>${refereeOptions}</select><button class="btn btn-line btn-sm" type="button" data-event-action="save_referee" data-event="${esc(event.id)}"${referees.length?'':' disabled'}>Save referee</button>${referees.some(ref=>ref.assigned)?`<button class="btn btn-line btn-sm" type="button" data-event-action="clear_referee" data-event="${esc(event.id)}">Remove referee</button>`:''}</div></section>`;
      const standingsControls=stages.filter(stage=>stage.format==='round_robin').map(stage=>{
        const rows=approved.map(reg=>{
          const current=standings.find(row=>row.stage_id===stage.id&&row.registration_id===reg.id)||{played:0,wins:0,draws:0,losses:0,points:0,score_for:0,score_against:0};
          return `<form class="event-standing-row" data-standing-form data-stage="${esc(stage.id)}" data-registration="${esc(reg.id)}"><b>${esc(reg.team?.name||'Team unavailable')} <small>Rank ${current.rank||'—'}</small></b>${[['played','Played'],['wins','Wins'],['draws','Draws'],['losses','Losses'],['points','Points'],['score_for','For'],['score_against','Against']].map(([key,label])=>`<label>${label}<input type="number" name="${key}" min="${key==='points'?-10000:0}" max="${key==='points'?10000:100000}" value="${current[key]??0}" required></label>`).join('')}<span><button class="btn btn-gold btn-sm" type="button" data-event-action="save_standing" data-event="${esc(event.id)}">Save</button><button class="btn btn-line btn-sm" type="button" data-event-action="reset_standing" data-event="${esc(event.id)}">Reset</button></span></form>`;
        }).join('');
        return `<section class="event-admin-tools"><h3 class="team-section-title">${esc(stage.name)} standings <small>Manual changes are saved and remain after match updates. Rank recalculates from points and score difference.</small></h3>${rows||'<p class="team-empty">No approved teams to show.</p>'}</section>`;
      }).join('');
      return `<article class="dcard event-card" data-event-card="${esc(event.id)}"><div class="dh"><i data-lucide="trophy"></i>${esc(event.name)}<span class="mono-r">${esc(event.status.replaceAll('_',' ').toUpperCase())}</span></div><div class="db"><div class="team-meta"><span>${esc(GAMES[event.game]?.label||event.game)}</span><span>${esc(String(event.format).replaceAll('_',' '))}</span><span>Starts ${esc(date(event.starts_at))}</span><span>${approved.length}/${regs.length} approved</span></div><h3 class="team-section-title">Team registrations <span>${pending.length} pending</span></h3><ul class="team-invites">${regRows}</ul>${seedRows}${standingsControls}${refereeControl}${stages.length?`<p class="team-empty">Stages: ${stages.map(s=>`${esc(s.name)} · ${esc(s.format.replaceAll('_',' '))} · ${esc(s.status)}`).join(' / ')}</p>`:''}<div class="event-actions">${actions.join('')}</div></div></article>`;
    }).join('');
    icons();
  }
  host.addEventListener('click',async event=>{
    const button=event.target.closest('[data-event-action]');if(!button)return;
    button.disabled=true;const id=button.dataset.event,action=button.dataset.eventAction;
    try{
      let result;
      if(action==='seed_move'){
        const order=seedOrders.get(id)||[],at=order.indexOf(button.dataset.registration),next=at+Number(button.dataset.direction);
        if(at>=0&&next>=0&&next<order.length){[order[at],order[next]]=[order[next],order[at]];seedOrders.set(id,order);await render();return;}
      }
      else if(action==='save_referee'||action==='clear_referee'){
        const select=host.querySelector(`[data-referee-select="${CSS.escape(id)}"]`);
        result=await SUPA.client.rpc('set_tournament_referee',{p_tournament_id:id,p_user_id:action==='clear_referee'?null:(select?.value||null)});
      }
      else if(action==='save_standing'||action==='reset_standing'){
        const form=button.closest('[data-standing-form]');if(!form)throw new Error('Standings row is missing. Reload and try again.');
        const values=Object.fromEntries(new FormData(form).entries());
        result=action==='save_standing'
          ?await SUPA.client.rpc('set_tournament_standing',{p_stage_id:form.dataset.stage,p_registration_id:form.dataset.registration,
            p_played:Number(values.played),p_wins:Number(values.wins),p_draws:Number(values.draws),p_losses:Number(values.losses),
            p_points:Number(values.points),p_score_for:Number(values.score_for),p_score_against:Number(values.score_against)})
          :await SUPA.client.rpc('reset_tournament_standing',{p_stage_id:form.dataset.stage,p_registration_id:form.dataset.registration});
      }
      else if(action==='review_registration')result=await SUPA.client.rpc('review_registration',{p_registration_id:button.dataset.registration,p_new_status:button.dataset.status});
      else if(action==='transition')result=await SUPA.client.rpc('transition_tournament',{p_tournament_id:id,p_new_status:button.dataset.status});
      else if(action==='generate_bracket'){
        const {data:rows,error}=await SUPA.client.from('tournament_registrations').select('id').eq('tournament_id',id).in('status',['approved','checked_in']).order('created_at');
        if(error)throw error;
        const databaseIds=(rows||[]).map(r=>r.id),requested=seedOrders.get(id)||databaseIds;
        const ordered=[...requested.filter(seed=>databaseIds.includes(seed)),...databaseIds.filter(seed=>!requested.includes(seed))];
        result=await SUPA.client.rpc('generate_bracket',{p_tournament_id:id,p_seeded_registration_ids:ordered});
      }
      else if(action==='generate_playoff_stage'){
        const qualifiers=host.querySelector(`[data-qualifiers="${CSS.escape(id)}"]`);
        result=await SUPA.client.rpc('generate_playoff_stage',{p_tournament_id:id,p_qualifier_count:Number(qualifiers?.value||4)});
      }
      else if(action==='reopen_registration')result=await SUPA.client.rpc('reopen_tournament_registration',{p_tournament_id:id});
      if(result?.error)throw result.error;
      toast('ok','Tournament updated','The database accepted the action and the workspace is refreshing.');
      await render();
    }catch(error){toast('err','Tournament action failed',error.message||'Please check your assignment and try again.');button.disabled=false;}
  });
  try{await render();}catch(error){setError(error);}
}).catch(error=>toast('err','Tournament operations unavailable',error.message||'Please reload and try again.'));
