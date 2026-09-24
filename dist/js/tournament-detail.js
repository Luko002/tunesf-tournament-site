/* Public tournament detail page. Registration remains a scoped database RPC. */
(async()=>{
  const header=$('#eventHeader'),content=$('#eventContent');
  const id=new URLSearchParams(location.search).get('id');
  const fail=message=>{header.innerHTML='<div class="eyebrow">Tournament</div><h1 class="ph-title">Details unavailable</h1>';content.innerHTML=`<article class="dcard event-card"><div class="db"><p>${esc(message)}</p><a class="btn btn-line btn-sm" href="tournaments.html">Browse tournaments</a></div></article>`;};
  if(!id){fail('Choose a tournament from the discovery page.');return;}
  try{
    await Auth.ready;
    const {data:t,error}=await SUPA.client.from('tournament_directory').select('*').eq('id',id).maybeSingle();
    if(error)throw error;if(!t){fail('This tournament is unavailable or has not been published.');return;}
    $('#eventCrumb').textContent=t.name;
    const date=value=>value?new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)):'To be announced';
    const count=Number(t.registered_teams)||0,capacity=Number(t.max_teams)||0;
    header.innerHTML=`<div class="eyebrow">${esc(GAMES[t.game]?.label||t.game)} · ${esc(t.status.replaceAll('_',' '))}</div><h1 class="ph-title">${esc(t.name)}</h1><p class="lead">${esc(t.description||'The organizer has not added event details yet.')}</p><div class="hero-cta"><a class="btn btn-line" href="bracket.html?tournament=${encodeURIComponent(t.id)}">View bracket</a><a class="btn btn-line" href="standings.html?tournament=${encodeURIComponent(t.id)}">View standings</a>${t.status==='registration_open'?'<label id="eventTeamWrap" hidden><span>Choose team</span><select id="eventTeam"></select></label><button class="btn btn-gold" id="eventRegister" type="button">Register a team</button>':''}</div>`;
    const [regResult,stageResult,prizeResult]=await Promise.all([
      SUPA.client.from('tournament_registrations').select('id,team_id,status').eq('tournament_id',t.id).in('status',['approved','checked_in']),
      SUPA.client.from('tournament_stages').select('id,name,format,status,stage_number').eq('tournament_id',t.id).in('status',['published','in_progress','completed']).order('stage_number'),
      SUPA.client.from('tournament_prizes').select('place,label,amount,currency').eq('tournament_id',t.id).order('place')
    ]);
    if(regResult.error)throw regResult.error;if(stageResult.error)throw stageResult.error;if(prizeResult.error)throw prizeResult.error;
    const regs=regResult.data||[],teamIds=[...new Set(regs.map(r=>r.team_id))];
    const teamResult=teamIds.length?await SUPA.client.from('teams').select('id,name,tag').in('id',teamIds):{data:[],error:null};
    if(teamResult.error)throw teamResult.error;
    const teams=new Map((teamResult.data||[]).map(row=>[row.id,row]));
    let refereeMarkup='<p class="team-empty">Referee assignments will be available to match participants and assigned officials after matches are scheduled.</p>';
    if(Auth.is()){
      const {data:matches,error:matchError}=await SUPA.client.from('tournament_matches').select('id,round_number,position').eq('tournament_id',t.id).order('round_number').order('position');
      if(matchError)throw matchError;
      if(matches?.length){
        const {data:officials,error:officialError}=await SUPA.client.from('match_officials').select('match_id,user_id').in('match_id',matches.map(m=>m.id));
        if(officialError)throw officialError;
        const users=[...new Set((officials||[]).map(row=>row.user_id))];
        const {data:profiles,error:profileError}=users.length?await SUPA.client.from('public_profiles').select('id,username,player_name').in('id',users):{data:[],error:null};
        if(profileError)throw profileError;
        const profileMap=new Map((profiles||[]).map(row=>[row.id,row.username||row.player_name||'Assigned referee']));
        refereeMarkup=officials?.length?`<ul class="team-invites">${officials.map(row=>{const match=matches.find(item=>item.id===row.match_id);return `<li class="event-reg"><span><b>${esc(profileMap.get(row.user_id)||'Assigned referee')}</b><small>Round ${match?.round_number} · Match ${match?.position}</small></span></li>`}).join('')}</ul>`:'<p class="team-empty">No referee assignments are visible to this account yet.</p>';
      }else refereeMarkup='<p class="team-empty">Referees will be listed after matches are scheduled.</p>';
    }
    const prizes=prizeResult.data?.length?prizeResult.data.map(p=>`<li class="event-reg"><b>${esc(p.label||`Place ${p.place}`)}</b><span>${fmt(p.amount)} ${esc(p.currency)}</span></li>`).join(''):'<li class="team-empty">No prize schedule has been published.</li>';
    const participants=regs.length?regs.map(r=>{const team=teams.get(r.team_id);return `<li class="event-reg"><span><b>${esc(team?.name||'Team unavailable')}</b><small>${esc(team?.tag||'')}</small></span><span>${esc(r.status.replaceAll('_',' '))}</span></li>`}).join(''):'<li class="team-empty">No approved teams yet.</li>';
    const stages=stageResult.data||[];
    const rules=`<p>${esc(t.description||'The organizer has not published additional rules.')}</p><p class="team-empty">Format: ${esc(String(t.format).replaceAll('_',' '))} · ${esc(t.best_of||'Best of 1')} · ${esc(t.region||'Region to be announced')}</p>${t.map_pool?.length?`<p>Map pool: ${t.map_pool.map(esc).join(' · ')}</p>`:''}<p>Anti-cheat required: ${t.anti_cheat_required?'Yes':'No'}</p><p>Substitutes allowed: ${Number(t.substitute_limit)||0} · Check-in window: ${Number(t.check_in_minutes)||0} minutes</p>`;
    const stageList=stages.length?stages.map(s=>`<li class="event-reg"><span><b>${esc(s.name)}</b><small>${esc(String(s.format).replaceAll('_',' '))}</small></span><span>${esc(s.status.replaceAll('_',' '))}</span></li>`).join(''):'<li class="team-empty">The organizer has not published the bracket yet.</li>';
    content.innerHTML=`<article class="dcard event-card"><div class="dh"><i data-lucide="calendar-days"></i>Event overview</div><div class="db"><div class="team-meta"><span>Registration ${esc(t.status.replaceAll('_',' '))}</span><span>Starts ${esc(date(t.starts_at))}</span><span>Closes ${esc(date(t.registration_closes_at))}</span><span>${count}${capacity?` / ${capacity}`:''} approved teams</span><span>Roster size ${Number(t.roster_size)||'TBA'}</span></div></div></article><article class="dcard event-card"><div class="dh"><i data-lucide="book-open-check"></i>Rules &amp; eligibility</div><div class="db">${rules}</div></article><article class="dcard event-card"><div class="dh"><i data-lucide="award"></i>Prizes</div><div class="db"><ul class="team-invites">${prizes}</ul><p class="team-empty">Advertised prize pool: ${fmt(t.prize_pool)} ${esc(t.currency)}</p></div></article><article class="dcard event-card"><div class="dh"><i data-lucide="users"></i>Approved participants</div><div class="db"><ul class="team-invites">${participants}</ul></div></article><article class="dcard event-card"><div class="dh"><i data-lucide="shield-check"></i>Referees &amp; match officials</div><div class="db">${refereeMarkup}</div></article><article class="dcard event-card"><div class="dh"><i data-lucide="git-fork"></i>Stages &amp; bracket</div><div class="db"><ul class="team-invites">${stageList}</ul><div class="event-actions"><a class="btn btn-line btn-sm" href="bracket.html?tournament=${encodeURIComponent(t.id)}">Open bracket</a><a class="btn btn-line btn-sm" href="standings.html?tournament=${encodeURIComponent(t.id)}">Open standings</a></div></div></article>`;
    $('#eventRegister')?.addEventListener('click',async event=>{
      const button=event.currentTarget;button.disabled=true;
      try{
        if(!Auth.is()){location.href=`login.html?next=${encodeURIComponent(`tournament.html?id=${t.id}`)}&need=PLAYER`;return;}
        const {data:members,error:memberError}=await SUPA.client.from('team_members').select('team_id').eq('user_id',Auth.user.id).eq('role','captain').eq('status','active');
        if(memberError)throw memberError;
        const ids=[...new Set((members||[]).map(m=>m.team_id))];
        if(!ids.length)throw new Error('An active team captain is required to register.');
        const {data:eligible,error:teamError}=await SUPA.client.from('teams').select('id,name,tag').in('id',ids).eq('game',t.game);
        if(teamError)throw teamError;if(!eligible?.length)throw new Error('Your captain teams must play this tournament’s game.');
        if(eligible.length>1){
          const wrap=$('#eventTeamWrap'),select=$('#eventTeam');
          if(wrap.hidden){select.innerHTML=eligible.map(team=>`<option value="${esc(team.id)}">${esc(team.name)} (${esc(team.tag)})</option>`).join('');wrap.hidden=false;button.textContent='Submit selected team';button.disabled=false;return;}
        }
        const team=eligible.length===1?eligible[0]:eligible.find(x=>x.id===$('#eventTeam').value);
        if(!team)throw new Error('Choose an eligible team before registering.');
        const {error}=await SUPA.client.rpc('register_team',{p_tournament_id:t.id,p_team_id:team.id});if(error)throw error;
        toast('ok','Registration submitted','The organizer will review your team.');button.textContent='Registration submitted';
      }catch(error){toast('err','Could not register team',error.message||'Please try again.');button.disabled=false;}
    });
    icons();
  }catch(error){fail(error.message||'Please try again.');}
})();
