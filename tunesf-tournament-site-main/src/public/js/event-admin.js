/* Tournament lifecycle actions are scoped and written through database RPCs. */
Auth.ready.then(async()=>{
  if(!requirePerm('MANAGE_SCHEDULE'))return;
  buildConsoleStrip();
  const host=$('#eventList');
  const seedOrders=new Map();
  const playoffSeedOrders=new Map();
  const selectedTabs=new Map();
  const searchInput=$('#eventSearch'),statusFilter=$('#eventStatusFilter'),resultsCount=$('#eventResultsCount'),filterEmpty=$('#eventFilterEmpty');
  function applyEventFilters(){
    const query=(searchInput?.value||'').trim().toLocaleLowerCase();
    const status=statusFilter?.value||'all';
    const cards=[...host.querySelectorAll('[data-event-card]')];let shown=0;
    cards.forEach(card=>{const matchesText=!query||card.textContent.toLocaleLowerCase().includes(query);const matchesStatus=status==='all'||card.dataset.eventStatus===status;const visible=matchesText&&matchesStatus;card.hidden=!visible;if(visible)shown++;});
    if(resultsCount)resultsCount.textContent=cards.length?`Showing ${shown} of ${cards.length} tournaments`:'No tournaments assigned';
    if(filterEmpty)filterEmpty.hidden=cards.length===0||shown>0;
  }
  function applyPreviewWriteState(){
    if(!READ_ONLY_PREVIEW)return;
    host.querySelectorAll('[data-event-action],form[data-standing-form],form[data-match-schedule],form[data-match-result],[data-referee-select]').forEach(control=>{
      if(control.matches('form'))control.querySelectorAll('input,select,textarea,button').forEach(input=>input.disabled=true);
      else control.disabled=true;
      control.setAttribute('title','Changes are disabled in this production-connected preview.');
    });
    host.querySelectorAll('[data-event-card]').forEach(card=>{
      if(card.querySelector('[data-preview-write-note]'))return;
      const note=document.createElement('p');note.className='team-empty preview-write-note';note.dataset.previewWriteNote='';note.setAttribute('role','note');
      note.textContent='Tournament changes are disabled in this production-connected preview. You can still review registrations, matches, standings, referee assignments, and seed order.';
      card.querySelector('.db')?.prepend(note);
    });
  }
  searchInput?.addEventListener('input',applyEventFilters);statusFilter?.addEventListener('change',applyEventFilters);
  const setError=error=>{host.innerHTML=`<div class="dcard" style="grid-column:1/-1"><div class="dh">Could not load tournament operations</div><div class="db"><p>${esc(error?.message||'Please try again.')}</p></div></div>`;};
  const date=value=>value?new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)):'Date to be announced';
  const localDateTime=value=>{if(!value)return '';const d=new Date(value);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);};
  async function details(event){
    const [regResult,stageResult,historyResult]=await Promise.all([
      SUPA.client.from('tournament_registrations').select('id,team_id,status,created_at').eq('tournament_id',event.id).order('created_at'),
      SUPA.client.from('tournament_stages').select('id,name,format,status,stage_number').eq('tournament_id',event.id).order('stage_number'),
      SUPA.client.rpc('list_tournament_registration_history',{p_tournament_id:event.id})
    ]);
    if(regResult.error)throw regResult.error;if(stageResult.error)throw stageResult.error;
    const regs=regResult.data||[],history=historyResult.data||[],historyUnavailable=Boolean(historyResult.error),ids=[...new Set(regs.map(row=>row.team_id))];
    let teams=[];
    if(ids.length){const result=await SUPA.client.from('teams').select('id,name,tag').in('id',ids);if(result.error)throw result.error;teams=result.data||[];}
    const byTeam=new Map(teams.map(team=>[team.id,team]));
    const stages=stageResult.data||[];
    const [standingsResult,refereeResult,matchResult]=await Promise.all([
      stages.some(stage=>stage.format==='round_robin')
        ?SUPA.client.from('tournament_standings').select('stage_id,registration_id,played,wins,draws,losses,points,score_for,score_against,rank').in('stage_id',stages.filter(stage=>stage.format==='round_robin').map(stage=>stage.id))
        :{data:[],error:null},
      SUPA.client.rpc('list_tournament_referees',{p_tournament_id:event.id}),
      stages.length?SUPA.client.from('tournament_matches').select('id,stage_id,round_number,position,home_registration_id,away_registration_id,status,scheduled_at,home_score,away_score').in('stage_id',stages.map(stage=>stage.id)).order('round_number').order('position'):{data:[],error:null}
    ]);
    if(standingsResult.error)throw standingsResult.error;if(refereeResult.error)throw refereeResult.error;if(matchResult.error)throw matchResult.error;
    return {event,historyUnavailable,regs:regs.map(row=>({...row,team:byTeam.get(row.team_id),history:history.filter(item=>item.registration_id===row.id)})),stages,
      standings:standingsResult.data||[],referees:refereeResult.data||[],matches:matchResult.data||[]};
  }
  async function render(){
    host.innerHTML='<div class="team-empty">Loading your tournaments…</div>';
    const {data,error}=await SUPA.client.rpc('list_my_tournament_operations');
    if(error)throw error;
    const items=await Promise.all((data||[]).map(details));
    if(!items.length){host.innerHTML='<div class="dcard" style="grid-column:1/-1"><div class="dh"><i data-lucide="clipboard-list"></i>Your tournament assignments</div><div class="db"><p class="team-empty">No tournaments are assigned to you. Create an event or ask an organizer to add you to its staff.</p><a class="btn btn-line btn-sm" href="organize.html" style="margin-top:14px">Create a tournament</a></div></div>';icons();return;}
    host.innerHTML=items.map(({event,regs,stages,standings,referees,matches,historyUnavailable})=>{
      const approved=regs.filter(r=>['approved','checked_in'].includes(r.status));
      const hasPublished=stages.some(s=>s.status==='published');
      const pending=regs.filter(r=>r.status==='pending');
      const eligible=approved.map(row=>row.id);
      if(!seedOrders.has(event.id))seedOrders.set(event.id,eligible);
      const seedOrder=seedOrders.get(event.id).filter(id=>eligible.includes(id));
      for(const id of eligible)if(!seedOrder.includes(id))seedOrder.push(id);
      seedOrders.set(event.id,seedOrder);
      const canReviewRegistrations=['registration_open','registration_closed'].includes(event.status)&&!hasPublished;
      const regRows=regs.length?regs.map(r=>`<li class="event-reg"><span><b>${esc(r.team?.name||'Team unavailable')} <small>${esc(r.team?.tag||'')}</small></b><small>${esc(r.status.replaceAll('_',' '))} · Applied ${esc(date(r.created_at))}</small>${historyUnavailable?'<small class="event-history-unavailable">Status history could not be loaded. Reload to try again.</small>':r.history.length?`<details class="registration-history"><summary>Status history (${r.history.length})</summary><ol>${r.history.map(item=>`<li><b>${esc(item.from_status?item.from_status.replaceAll('_',' ')+' → ':'')}${esc(item.to_status.replaceAll('_',' '))}</b><small>${esc(date(item.event_at))}${item.actor_name?' · '+esc(item.actor_name):' · System'}</small></li>`).join('')}</ol></details>`:''}</span>${r.status==='pending'&&canReviewRegistrations?`<span class="event-actions"><button class="btn btn-line btn-sm" data-event-action="review_registration" data-event="${esc(event.id)}" data-registration="${esc(r.id)}" data-status="approved">Approve</button><button class="btn btn-line btn-sm" data-event-action="review_registration" data-event="${esc(event.id)}" data-registration="${esc(r.id)}" data-status="rejected">Decline</button></span>`:''}</li>`).join(''):'<li class="team-empty">No team registrations yet.</li>';
      const actions=[];
      if(event.status==='draft')actions.push('<button class="btn btn-gold btn-sm" data-event-action="transition" data-event="'+esc(event.id)+'" data-status="registration_open">Open registration</button>');
      if(event.status==='registration_open'&&pending.length===0&&approved.length>=2)actions.push('<button class="btn btn-line btn-sm" data-event-action="transition" data-event="'+esc(event.id)+'" data-status="registration_closed">Close registration &amp; publish bracket</button>');
      if(event.status==='registration_open'&&pending.length===0&&approved.length<2)actions.push(`<p class="team-empty">Keep registration open until at least two teams are approved. Closing registration here publishes the bracket automatically; if the deadline closes it in the background, publish it here after resolving pending entries.</p>`);
      if(event.status==='registration_open'&&pending.length>0)actions.push(`<p class="team-empty">Review all ${pending.length} pending registration${pending.length===1?'':'s'} before closing registration.</p>`);
      if(event.status==='registration_closed'&&pending.length>0)actions.push(`<p class="team-empty">${pending.length} registration${pending.length===1?' is':'s are'} still pending. Review these entries before publishing the bracket; decisions remain available until a stage is published.</p>`);
      if(event.status==='registration_closed'&&!hasPublished&&approved.length<2){
        const canReopen=!event.registration_closes_at||new Date(event.registration_closes_at)>new Date();
        actions.push(`<p class="team-empty">A bracket needs at least two approved teams. This event has ${approved.length}; ${canReopen?'reopen registration to accept more teams.':'the registration deadline has passed.'}</p>`);
        if(canReopen)actions.push('<button class="btn btn-line btn-sm" data-event-action="reopen_registration" data-event="'+esc(event.id)+'">Reopen registration</button>');
      }
      if(event.status==='registration_closed'&&!hasPublished&&pending.length>0){
        actions.push('<p class="team-empty">Resolve every pending registration before publishing the bracket.</p>');
      }
      if(event.status==='registration_closed'&&!hasPublished&&pending.length===0&&approved.length>=2){
        const supportedDouble=event.format!=='double_elimination'||(approved.length>=4&&(approved.length&(approved.length-1))===0);
        if(supportedDouble)actions.push('<button class="btn btn-gold btn-sm" data-event-action="generate_bracket" data-event="'+esc(event.id)+'">Publish bracket with these seeds</button>');
        else actions.push('<p class="team-empty">Double elimination currently requires 4 or more approved teams in a power-of-two field. Adjust registrations or choose another format before publishing.</p>');
      }
      if(event.status==='registration_closed'&&hasPublished)actions.push('<button class="btn btn-gold btn-sm" data-event-action="transition" data-event="'+esc(event.id)+'" data-status="in_progress">Start tournament</button>');
      const rrStage=stages.find(s=>s.stage_number===1&&s.format==='round_robin');
      const playoffStage=stages.find(s=>s.stage_number>1);
      const canPreparePlayoffs=event.format==='round_robin_playoffs'&&event.status==='in_progress'&&rrStage&&['published','in_progress','completed'].includes(rrStage.status);
      const qualifierCount=Math.max(2,Number(event.playoff_qualifier_count)||4);
      const byeCount=Math.max(0,Number(event.playoff_bye_count)||0);
      const playoffDraftNoticeId=`playoffDraftReadOnlyNotice-${event.id}`;
      const playoffDraftReadOnly=READ_ONLY_PREVIEW?` disabled title="Changes are disabled in this production preview." aria-describedby="${esc(playoffDraftNoticeId)}"`:'';
      const playoffDraftReadOnlyNotice=canPreparePlayoffs&&READ_ONLY_PREVIEW?`<p id="${esc(playoffDraftNoticeId)}" class="team-empty preview-write-note" role="note">Playoff draft actions are unavailable in this production-connected preview. Open a writable staging environment to prepare, refresh, or publish this bracket.</p>`:'';
      const rrSeedings=standings.filter(row=>row.stage_id===rrStage?.id).sort((a,b)=>a.rank-b.rank||a.registration_id.localeCompare(b.registration_id));
      if(canPreparePlayoffs&&!playoffStage){
        if(approved.length>=qualifierCount)actions.push(`<div class="event-playoff-config"><span><b>TOP ${qualifierCount}</b><small>ADVANCE FROM THE CURRENT STANDINGS</small></span><span><b>${byeCount} BYE${byeCount===1?'':'S'}</b><small>TOP SEED${byeCount===1?'':'S'} SKIP THE OPENING ROUND</small></span></div>${playoffDraftReadOnlyNotice}<button class="btn btn-gold btn-sm" data-event-action="prepare_playoff_stage" data-event="${esc(event.id)}"${playoffDraftReadOnly}>Prepare playoff draft</button><p class="team-empty">The round robin can continue while the playoff draft is prepared.</p>`);
        else actions.push(`<p class="team-empty">The playoff is set for ${qualifierCount} qualifiers, but only ${approved.length} teams are approved. Approve enough teams before preparing it.</p>`);
      }
      if(canPreparePlayoffs&&playoffStage?.status==='draft'){
        const draftIds=rrSeedings.slice(0,qualifierCount).map(row=>row.registration_id);
        const seedOrder=playoffSeedOrders.get(event.id)||draftIds;
        const normalizedOrder=seedOrder.filter(registrationId=>draftIds.includes(registrationId));
        for(const registrationId of draftIds)if(!normalizedOrder.includes(registrationId))normalizedOrder.push(registrationId);
        playoffSeedOrders.set(event.id,normalizedOrder);
        const playoffSeedRows=normalizedOrder.map((registrationId,index)=>{const row=approved.find(r=>r.id===registrationId);return `<li><span><b>Seed ${index+1}</b> ${esc(row?.team?.name||'Team unavailable')}${index<byeCount?'<small class="event-seed-bye">FIRST-ROUND BYE</small>':''}</span><span><button class="btn btn-line btn-sm" type="button" aria-label="Move ${esc(row?.team?.name||'team')} up" data-event-action="playoff_seed_move" data-event="${esc(event.id)}" data-registration="${esc(registrationId)}" data-direction="-1"${index===0?' disabled':''}>↑</button><button class="btn btn-line btn-sm" type="button" aria-label="Move ${esc(row?.team?.name||'team')} down" data-event-action="playoff_seed_move" data-event="${esc(event.id)}" data-registration="${esc(registrationId)}" data-direction="1"${index===normalizedOrder.length-1?' disabled':''}>↓</button></span></li>`;}).join('');
        actions.push(`<section class="event-admin-tools event-playoff-seeds"><h3 class="team-section-title">Playoff seed order <small>Seeds 1–${byeCount} receive the opening-round bye. Change the order before publishing. Refresh after changing standings.</small></h3>${playoffDraftReadOnlyNotice}<ol class="event-seed-list">${playoffSeedRows}</ol><div class="event-actions"><button class="btn btn-line btn-sm" data-event-action="prepare_playoff_stage" data-event="${esc(event.id)}"${playoffDraftReadOnly}>Refresh seeds from standings</button><button class="btn btn-gold btn-sm" data-event-action="publish_playoff_stage" data-event="${esc(event.id)}"${playoffDraftReadOnly}>Publish playoff bracket</button></div></section>`);
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
      const registrationById=new Map(regs.map(reg=>[reg.id,reg]));
      const matchRows=matches.map(match=>{
        const home=registrationById.get(match.home_registration_id)?.team?.name||'Team pending';
        const away=registrationById.get(match.away_registration_id)?.team?.name||'Team pending';
        const stage=stages.find(row=>row.id===match.stage_id);
        const scheduledTimePassed=['pending','ready'].includes(match.status)&&match.scheduled_at&&new Date(match.scheduled_at).getTime()<Date.now();
        const matchStatusLabel=scheduledTimePassed?'reschedule needed':match.status.replaceAll('_',' ');
        const refereeAction={ready:scheduledTimePassed?null:'start',live:'pause',paused:'resume'}[match.status];
        const scoreEnabled=match.home_registration_id&&match.away_registration_id&&['ready','live','paused','result_pending','completed'].includes(match.status);
        return `<article class="event-op-match"><div class="event-op-match-head"><b>${esc(home)} <span>vs</span> ${esc(away)}</b><small>${esc(stage?.name||'Stage')} · Round ${match.round_number} · Match ${match.position} · ${esc(matchStatusLabel)}</small></div>${scheduledTimePassed?'<p class="event-match-time-warning" role="status">Scheduled time passed. Confirm a new time with both teams before starting this match.</p>':''}<div class="event-op-match-actions"><a class="btn btn-line btn-sm" href="match-room.html?id=${encodeURIComponent(match.id)}">Open match room</a>${refereeAction?`<button class="btn btn-line btn-sm" type="button" data-event-action="match_status" data-event="${esc(event.id)}" data-match="${esc(match.id)}" data-status="${refereeAction}">${refereeAction[0].toUpperCase()+refereeAction.slice(1)} match</button>`:''}</div>${['pending','ready'].includes(match.status)?`<form class="event-op-form" data-match-schedule="${esc(match.id)}"><label>Match time<input type="datetime-local" name="scheduled_at" value="${esc(localDateTime(match.scheduled_at))}" required></label><button class="btn btn-line btn-sm" type="button" data-event-action="schedule_match" data-event="${esc(event.id)}">Save time</button></form>`:`<p class="team-empty">${esc(date(match.scheduled_at))}</p>`}${scoreEnabled?`<form class="event-op-form" data-match-result="${esc(match.id)}"><label>Home wins<input type="number" name="home_score" min="0" max="4" value="${match.home_score??''}" required></label><label>Away wins<input type="number" name="away_score" min="0" max="4" value="${match.away_score??''}" required></label><label class="event-op-reason">Reason for official result<input name="reason" minlength="5" maxlength="500" placeholder="e.g. Referee verified the final score" required></label><button class="btn btn-gold btn-sm" type="button" data-event-action="record_result" data-event="${esc(event.id)}">${match.status==='completed'?'Correct result':'Mark match over &amp; save result'}</button></form>`:''}</article>`;
      }).join('')||'<p class="team-empty">Matches appear here after the bracket is published.</p>';
      const selected=selectedTabs.get(event.id)||(!matches.length?'registrations':'matches');
      const tabs=[['registrations','Registrations'],['matches',`Matches (${matches.length})`],['standings','Standings'],['officials','Referee'],['event','Event']];
      return `<article class="dcard event-card event-ops-card" data-event-card="${esc(event.id)}" data-event-status="${esc(event.status)}"><div class="dh"><i data-lucide="trophy"></i>${esc(event.name)}<span class="mono-r">${esc(event.status.replaceAll('_',' ').toUpperCase())}</span></div><div class="db"><div class="team-meta"><span>${esc(GAMES[event.game]?.label||event.game)}</span><span>${esc(String(event.format).replaceAll('_',' '))}</span><span>Starts ${esc(date(event.starts_at))}</span><span>${approved.length}/${regs.length} approved</span></div><nav class="event-ops-tabs" aria-label="Tournament operations sections">${tabs.map(([key,label])=>`<button type="button" data-ops-tab="${key}" aria-pressed="${key===selected}" class="${key===selected?'active':''}">${label}</button>`).join('')}</nav><section class="event-ops-panel" data-ops-panel="registrations"${selected!=='registrations'?' hidden':''}><h3 class="team-section-title">Team registrations <span>${pending.length} pending</span></h3><ul class="team-invites">${regRows}</ul>${seedRows}</section><section class="event-ops-panel" data-ops-panel="matches"${selected!=='matches'?' hidden':''}><h3 class="team-section-title">Match schedule and results <span>${matches.length}</span></h3>${matchRows}</section><section class="event-ops-panel" data-ops-panel="standings"${selected!=='standings'?' hidden':''}><div class="event-standings-scroll">${standingsControls||'<p class="team-empty">This tournament has no round robin stage.</p>'}</div></section><section class="event-ops-panel" data-ops-panel="officials"${selected!=='officials'?' hidden':''}>${refereeControl}</section><section class="event-ops-panel" data-ops-panel="event"${selected!=='event'?' hidden':''}>${stages.length?`<p class="team-empty">Stages: ${stages.map(s=>`${esc(s.name)} · ${esc(s.format.replaceAll('_',' '))} · ${esc(s.status)}`).join(' / ')}</p>`:''}<div class="event-actions">${actions.join('')}</div></section></div></article>`;
    }).join('');
    applyPreviewWriteState();
    applyEventFilters();
    icons();
  }
  host.addEventListener('click',async event=>{
    const tab=event.target.closest('[data-ops-tab]');
    if(tab){
      const card=tab.closest('[data-event-card]');selectedTabs.set(card.dataset.eventCard,tab.dataset.opsTab);
      card.querySelectorAll('[data-ops-tab]').forEach(button=>{button.classList.toggle('active',button===tab);button.setAttribute('aria-pressed',String(button===tab));});
      card.querySelectorAll('[data-ops-panel]').forEach(panel=>panel.hidden=panel.dataset.opsPanel!==tab.dataset.opsTab);
      return;
    }
    const button=event.target.closest('[data-event-action]');if(!button)return;
    if(READ_ONLY_PREVIEW)return;
    const matchForm=button.closest('[data-match-schedule],[data-match-result]');
    if(matchForm&&!matchForm.reportValidity())return;
    button.disabled=true;const id=button.dataset.event,action=button.dataset.eventAction;
    try{
      let result;
      if(action==='seed_move'){
        const order=seedOrders.get(id)||[],at=order.indexOf(button.dataset.registration),next=at+Number(button.dataset.direction);
        if(at>=0&&next>=0&&next<order.length){[order[at],order[next]]=[order[next],order[at]];seedOrders.set(id,order);await render();return;}
      }
      else if(action==='playoff_seed_move'){
        const order=playoffSeedOrders.get(id)||[],at=order.indexOf(button.dataset.registration),next=at+Number(button.dataset.direction);
        if(at>=0&&next>=0&&next<order.length){[order[at],order[next]]=[order[next],order[at]];playoffSeedOrders.set(id,order);await render();return;}
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
      else if(action==='schedule_match'){
        const form=button.closest('[data-match-schedule]');
        const scheduledAt=new Date(new FormData(form).get('scheduled_at'));
        if(!Number.isFinite(scheduledAt.getTime()))throw new Error('Choose a valid match time.');
        result=await SUPA.client.rpc('schedule_match',{p_match_id:form.dataset.matchSchedule,p_scheduled_at:scheduledAt.toISOString()});
      }
      else if(action==='record_result'){
        const form=button.closest('[data-match-result]'),values=new FormData(form);
        if(!window.confirm('Mark this match over with the entered official score? The bracket or standings may advance.')){button.disabled=false;return;}
        result=await SUPA.client.rpc('record_official_match_result',{p_match_id:form.dataset.matchResult,p_home_score:Number(values.get('home_score')),p_away_score:Number(values.get('away_score')),p_reason:String(values.get('reason')||'').trim()});
      }
      else if(action==='match_status')result=await SUPA.client.rpc('referee_match',{p_match_id:button.dataset.match,p_action:button.dataset.status,p_note:''});
      else if(action==='review_registration')result=await SUPA.client.rpc('review_registration',{p_registration_id:button.dataset.registration,p_new_status:button.dataset.status});
      else if(action==='transition')result=await SUPA.client.rpc('transition_tournament',{p_tournament_id:id,p_new_status:button.dataset.status});
      else if(action==='generate_bracket'){
        const {data:rows,error}=await SUPA.client.from('tournament_registrations').select('id').eq('tournament_id',id).in('status',['approved','checked_in']).order('created_at');
        if(error)throw error;
        const databaseIds=(rows||[]).map(r=>r.id),requested=seedOrders.get(id)||databaseIds;
        const ordered=[...requested.filter(seed=>databaseIds.includes(seed)),...databaseIds.filter(seed=>!requested.includes(seed))];
        const tournamentName=button.closest('[data-event-card]')?.querySelector('.dh')?.childNodes[1]?.textContent?.trim()||'this tournament';
        if(!window.confirm(`Publish the bracket for ${tournamentName} with ${ordered.length} approved teams in the seed order shown? This creates the tournament matches and locks registration decisions.`)){button.disabled=false;return;}
        result=await SUPA.client.rpc('generate_bracket',{p_tournament_id:id,p_seeded_registration_ids:ordered});
      }
      else if(action==='prepare_playoff_stage')result=await SUPA.client.rpc('prepare_playoff_stage',{p_tournament_id:id});
      else if(action==='publish_playoff_stage'){
        const order=playoffSeedOrders.get(id)||[];
        if(order.length<2)throw new Error('The playoff seed list is incomplete. Refresh the draft and try again.');
        if(!window.confirm(`Publish the ${order.length}-team playoff bracket using the seed order shown? The round robin will remain open.`)){button.disabled=false;return;}
        result=await SUPA.client.rpc('publish_playoff_stage',{p_tournament_id:id,p_seeded_registration_ids:order});
      }
      else if(action==='reopen_registration')result=await SUPA.client.rpc('reopen_tournament_registration',{p_tournament_id:id});
      if(result?.error)throw result.error;
      toast('ok','Tournament updated','The database accepted the action and the workspace is refreshing.');
      await render();
    }catch(error){toast('err','Tournament action failed',error.message||'Please check your assignment and try again.');button.disabled=false;}
  });
  host.addEventListener('submit',event=>{const form=event.target.closest('[data-match-schedule],[data-match-result]');if(form){event.preventDefault();form.querySelector('[data-event-action]')?.click();}});
  try{await render();}catch(error){setError(error);}
}).catch(error=>toast('err','Tournament operations unavailable',error.message||'Please reload and try again.'));
