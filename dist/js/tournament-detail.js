/* Tournament details, published stages, schedules, and standings belong to this event page. */
const header=$('#eventHeader'),content=$('#eventContent');
const id=new URLSearchParams(location.search).get('id');
const fail=message=>{header.innerHTML='<div class="eyebrow">Tournament</div><h1 class="ph-title">Details unavailable</h1>';content.innerHTML=`<article class="dcard event-card"><div class="db"><p>${esc(message)}</p><a class="btn btn-line btn-sm" href="tournaments.html">Browse tournaments</a></div></article>`;};
if(!id){fail('Choose a tournament from the discovery page.');}
else (async()=>{
  try{
    await Auth.ready;
    const {data:t,error}=await SUPA.client.from('tournament_directory').select('*').eq('id',id).maybeSingle();
    if(error)throw error;if(!t){fail('This tournament is unavailable or has not been published.');return;}
    let coverUrl='';
    if(t.cover_image_path){
      const {data:cover,error:coverError}=await SUPA.client.storage.from('tournament-covers').createSignedUrl(t.cover_image_path,3600);
      if(coverError)console.warn('Tournament cover could not be loaded:',coverError.message);else coverUrl=cover?.signedUrl||'';
    }
    $('#eventCrumb').textContent=t.name;
    const date=value=>value?new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)):'To be announced';
    const count=Number(t.registered_teams)||0,capacity=Number(t.max_teams)||0;
    header.innerHTML=`${coverUrl?`<img class="event-cover" src="${esc(coverUrl)}" alt="${esc(t.name)} tournament cover">`:''}<div class="eyebrow">${esc(GAMES[t.game]?.label||t.game)} · ${esc(t.status.replaceAll('_',' '))}</div><h1 class="ph-title">${esc(t.name)}</h1><p class="lead">${esc(t.description||'The organizer has not added event details yet.')}</p><div class="hero-cta"><a class="btn btn-line" href="#eventBrackets">View this tournament’s bracket</a><a class="btn btn-line" href="standings.html?tournament=${encodeURIComponent(t.id)}">View standings</a>${t.status==='registration_open'?'<label id="eventTeamWrap" hidden><span>Choose team</span><select id="eventTeam"></select></label><button class="btn btn-gold" id="eventRegister" type="button">Register a team</button>':''}</div>`;

    const [regResult,stageResult,prizeResult]=await Promise.all([
      SUPA.client.from('tournament_registrations').select('id,team_id,status').eq('tournament_id',t.id).in('status',['approved','checked_in']).order('created_at').order('id'),
      SUPA.client.from('tournament_stages').select('id,name,format,status,stage_number').eq('tournament_id',t.id).in('status',['published','in_progress','completed']).order('stage_number'),
      SUPA.client.from('tournament_prizes').select('place,label,amount,currency').eq('tournament_id',t.id).order('place')
    ]);
    if(regResult.error)throw regResult.error;if(stageResult.error)throw stageResult.error;if(prizeResult.error)throw prizeResult.error;
    const regs=regResult.data||[],stages=stageResult.data||[],stageIds=stages.map(s=>s.id),regIds=regs.map(r=>r.id);
    const teamIds=[...new Set(regs.map(r=>r.team_id))];
    const [teamResult,matchResult]=await Promise.all([
      teamIds.length?SUPA.client.from('teams').select('id,name,tag').in('id',teamIds):Promise.resolve({data:[],error:null}),
      stageIds.length?SUPA.client.from('tournament_matches').select('id,stage_id,round_number,position,bracket_side,home_registration_id,away_registration_id,winner_registration_id,home_expected,away_expected,home_score,away_score,status,scheduled_at').in('stage_id',stageIds).order('round_number').order('position'):Promise.resolve({data:[],error:null})
    ]);
    if(teamResult.error)throw teamResult.error;if(matchResult.error)throw matchResult.error;
    const teamMap=new Map((teamResult.data||[]).map(row=>[row.id,row]));
    const regTeam=new Map(regs.map(row=>[row.id,row.team_id]));
    const stageMatches=new Map(stages.map(stage=>[stage.id,(matchResult.data||[]).filter(match=>match.stage_id===stage.id)]));
    const stageStandings=new Map();
    for(const stage of stages.filter(row=>row.format==='round_robin')){
      const {data,error}=await SUPA.client.from('tournament_standings').select('registration_id,played,wins,draws,losses,points,score_for,score_against,rank').eq('stage_id',stage.id).order('rank');
      if(error)throw error;stageStandings.set(stage.id,data||[]);
    }

    const {data:assignedReferees,error:refereeError}=await SUPA.client.rpc('list_tournament_referee_names',{p_tournament_id:t.id});
    if(refereeError)throw refereeError;
    let refereeMarkup=assignedReferees?.length
      ?`<ul class="team-invites">${assignedReferees.map(ref=>`<li class="event-reg"><span><b>${esc(ref.username||ref.player_name||'Assigned referee')}</b><small>Tournament referee</small></span></li>`).join('')}</ul>`
      :'<p class="team-empty">No referee has been assigned to this tournament yet.</p>';
    const allMatches=matchResult.data||[];
    if(Auth.is()&&allMatches.length){
      const {data:officials,error:officialError}=await SUPA.client.from('match_officials').select('match_id,user_id').in('match_id',allMatches.map(m=>m.id));
      if(officialError)throw officialError;
      const userIds=[...new Set((officials||[]).map(row=>row.user_id))];
      const {data:profiles,error:profileError}=userIds.length?await SUPA.client.from('public_profiles').select('id,username,player_name').in('id',userIds):{data:[],error:null};
      if(profileError)throw profileError;
      const profileMap=new Map((profiles||[]).map(row=>[row.id,row.username||row.player_name||'Assigned referee']));
      const assignedNames=new Set((assignedReferees||[]).map(ref=>String(ref.username||ref.player_name||'').trim().toLocaleLowerCase()).filter(Boolean));
      const matchOfficials=(officials||[]).map(row=>{
        const name=profileMap.get(row.user_id)||'Assigned referee';
        if(assignedNames.has(name.trim().toLocaleLowerCase()))return '';
        const match=allMatches.find(item=>item.id===row.match_id);
        return `<li class="event-reg"><span><b>${esc(name)}</b><small>Round ${match?.round_number} · Match ${match?.position}</small></span></li>`;
      }).join('');
      if(matchOfficials)refereeMarkup=`<ul class="team-invites">${(assignedReferees||[]).map(ref=>`<li class="event-reg"><span><b>${esc(ref.username||ref.player_name||'Assigned referee')}</b><small>Tournament referee</small></span></li>`).join('')}${matchOfficials}</ul>`;
    }

    const teamFor=registrationId=>teamMap.get(regTeam.get(registrationId));
    const sideHtml=(registrationId,expected,score,winner)=>{
      const team=teamFor(registrationId),label=team?`${esc(team.name)}<small>${esc(team.tag||'')}</small>`:expected?'Pending':'BYE';
      return `<div class="bracket-match-team${winner?' is-winner':''}"><span>${label}</span><b>${score===null||score===undefined?'—':score}</b></div>`;
    };
    const matchHtml=match=>`<article class="bracket-match" data-status="${esc(match.status)}"><div class="bracket-match-meta"><span>Match ${match.position}</span><b>${esc(match.status.replaceAll('_',' '))}</b></div>${sideHtml(match.home_registration_id,match.home_expected,match.home_score,match.winner_registration_id===match.home_registration_id&&match.winner_registration_id!==null)}${sideHtml(match.away_registration_id,match.away_expected,match.away_score,match.winner_registration_id===match.away_registration_id&&match.winner_registration_id!==null)}</article>`;
    const eliminationHtml=stage=>{
      const matches=stageMatches.get(stage.id)||[];
      if(!matches.length)return '<p class="team-empty">No matches have been published for this stage yet.</p>';
      const sides=stage.format==='double_elimination'?[['winners','Upper bracket'],['losers','Lower bracket'],['grand_final','Grand final']]:[['main',stage.format==='single_elimination'?'Single elimination':'Playoff bracket']];
      return sides.map(([side,title])=>{
        const group=matches.filter(match=>match.bracket_side===side&&!(match.status==='cancelled'&&!match.home_expected&&!match.away_expected));
        if(!group.length)return '';
        const rounds=[...new Set(group.map(match=>match.round_number))].sort((a,b)=>a-b);
        return `<section class="event-bracket-stage"><div class="dh"><i data-lucide="git-fork"></i>${title}<span class="bracket-stage-meta">${esc(stage.name)}</span></div><div class="bracket-rail"><div class="bracket-columns">${rounds.map(round=>`<div class="bracket-round"><h4>Round ${round}</h4>${group.filter(match=>match.round_number===round).map(matchHtml).join('')}</div>`).join('')}</div></div></section>`;
      }).join('');
    };
    const roundRobinHtml=stage=>{
      const standings=stageStandings.get(stage.id)||[],matches=stageMatches.get(stage.id)||[];
      const laterStages=stages.filter(other=>other.stage_number>stage.stage_number);
      const qualified=new Set(laterStages.flatMap(other=>(stageMatches.get(other.id)||[]).flatMap(match=>[match.home_registration_id,match.away_registration_id]).filter(Boolean)));
      const statusFor=row=>laterStages.length?(qualified.has(row.registration_id)?'PLAYOFFS':'GROUP STAGE'):'LEAGUE TABLE';
      const table=standings.length?`<div class="rr-table-wrap"><table class="rr-table"><thead><tr><th>#</th><th>Team</th><th>W</th><th>L</th><th>Round diff</th><th>Pts</th><th>Status</th></tr></thead><tbody>${standings.map(row=>{const team=teamFor(row.registration_id);return `<tr><td class="rr-rank">${row.rank}</td><td>${esc(team?.name||'Team unavailable')} <small>${esc(team?.tag||'')}</small></td><td>${row.wins}</td><td>${row.losses}</td><td>${row.score_for-row.score_against>0?'+':''}${row.score_for-row.score_against}</td><td><b>${row.points}</b></td><td>${statusFor(row)}</td></tr>`}).join('')}</tbody></table></div>`:'<p class="team-empty">Standings will fill in as match results are approved.</p>';
      const distinctRounds=[...new Set(matches.map(match=>match.round_number))];
      let rounds=[];
      if(distinctRounds.length>1){
        rounds=distinctRounds.sort((a,b)=>a-b).map(number=>({number,matches:matches.filter(match=>match.round_number===number)}));
      }else if(matches.length){
        const pairKey=(a,b)=>[a,b].sort().join(':');
        const byPair=new Map(matches.filter(match=>match.home_registration_id&&match.away_registration_id)
          .map(match=>[pairKey(match.home_registration_id,match.away_registration_id),match]));
        const slots=regs.map(reg=>reg.id);
        if(slots.length%2)slots.push(null);
        const rotation=[...slots],used=new Set();
        for(let index=0;index<rotation.length-1;index++){
          const roundMatches=[];
          for(let position=0;position<rotation.length/2;position++){
            const first=rotation[position],second=rotation[rotation.length-1-position];
            if(!first||!second)continue;
            const match=byPair.get(pairKey(first,second));
            if(match){roundMatches.push(match);used.add(match.id);}
          }
          if(roundMatches.length)rounds.push({number:index+1,matches:roundMatches});
          rotation.splice(1,0,rotation.pop());
        }
        const unassigned=matches.filter(match=>!used.has(match.id));
        if(unassigned.length)rounds.push({number:'Other',matches:unassigned});
      }
      const teamMark=team=>`<span class="rr-team-mark" aria-hidden="true">${esc((team?.tag||team?.name||'T').trim().slice(0,3).toUpperCase())}</span>`;
      const fixtures=rounds.length?`<div class="rr-rounds">${rounds.map(round=>`<details class="rr-round"><summary class="rr-round-title"><span class="rr-round-name">${typeof round.number==='number'?`Round ${round.number}`:round.number}</span><span class="rr-round-count">${round.matches.length} match${round.matches.length===1?'':'es'}</span></summary><div class="rr-fixtures">${round.matches.map(match=>{const home=teamFor(match.home_registration_id),away=teamFor(match.away_registration_id);return `<article class="rr-fixture"><small>Match ${match.position} · ${esc(match.status.replaceAll('_',' '))}${match.scheduled_at?` · ${esc(date(match.scheduled_at))}`:''}</small><div class="rr-fixture-teams"><span class="rr-fixture-team">${teamMark(home)}<span>${esc(home?.name||'TBD')}</span></span><span class="rr-score">${match.home_score??'—'} : ${match.away_score??'—'}</span><span class="rr-fixture-team rr-fixture-away"><span>${esc(away?.name||'TBD')}</span>${teamMark(away)}</span></div></article>`}).join('')}</div></details>`).join('')}</div>`:'<p class="team-empty">No round-robin matches are published yet.</p>';
      return `<section class="event-bracket-stage"><div class="dh"><i data-lucide="list-ordered"></i>${esc(stage.name)}<span class="bracket-stage-meta">Round robin</span></div><h3 class="team-section-title">Standings</h3>${table}<h3 class="team-section-title" style="margin-top:22px">Match schedule</h3>${fixtures}</section>`;
    };

    const prizes=prizeResult.data?.length?prizeResult.data.map(p=>`<li class="event-reg"><b>${esc(p.label||`Place ${p.place}`)}</b><span>${fmt(p.amount)} ${esc(p.currency)}</span></li>`).join(''):'<li class="team-empty">No prize schedule has been published.</li>';
    const participants=regs.length?regs.map(r=>{const team=teamFor(r.id);return `<li class="event-reg"><span><b>${esc(team?.name||'Team unavailable')}</b><small>${esc(team?.tag||'')}</small></span><span>${esc(r.status.replaceAll('_',' '))}</span></li>`}).join(''):'<li class="team-empty">No approved teams yet.</li>';
    const rules=`<p>${esc(t.description||'The organizer has not published additional rules.')}</p><p class="team-empty">Format: ${esc(String(t.format).replaceAll('_',' '))} · ${esc(t.best_of||'Best of 1')} · ${esc(t.region||'Region to be announced')}</p>${t.map_pool?.length?`<p>Map pool: ${t.map_pool.map(esc).join(' · ')}</p>`:''}<p>Anti-cheat required: ${t.anti_cheat_required?'Yes':'No'}</p><p>Substitutes allowed: ${Number(t.substitute_limit)||0} · Check-in window: ${Number(t.check_in_minutes)||0} minutes</p>`;
    const stageMarkup=stages.length?stages.map(stage=>stage.format==='round_robin'?roundRobinHtml(stage):eliminationHtml(stage)).join(''):'<p class="team-empty">The organizer has not published a bracket for this tournament yet.</p>';
    content.innerHTML=`<article class="dcard event-card"><div class="dh"><i data-lucide="calendar-days"></i>Event overview</div><div class="db"><div class="team-meta"><span>Registration ${esc(t.status.replaceAll('_',' '))}</span><span>Starts ${esc(date(t.starts_at))}</span><span>Closes ${esc(date(t.registration_closes_at))}</span><span>${count}${capacity?` / ${capacity}`:''} approved teams</span><span>Roster size ${Number(t.roster_size)||'TBA'}</span></div></div></article><article class="dcard event-card"><div class="dh"><i data-lucide="book-open-check"></i>Rules &amp; eligibility</div><div class="db">${rules}</div></article><article class="dcard event-card"><div class="dh"><i data-lucide="award"></i>Prizes</div><div class="db"><ul class="team-invites">${prizes}</ul><p class="team-empty">Advertised prize pool: ${fmt(t.prize_pool)} ${esc(t.currency)}</p></div></article><article class="dcard event-card"><div class="dh"><i data-lucide="users"></i>Approved participants</div><div class="db"><ul class="team-invites">${participants}</ul></div></article><article class="dcard event-card"><div class="dh"><i data-lucide="shield-check"></i>Referees &amp; match officials</div><div class="db">${refereeMarkup}</div></article><article class="dcard event-card" id="eventBrackets"><div class="dh"><i data-lucide="git-fork"></i>${esc(t.format==='round_robin'?'Round robin table & schedule':t.format==='round_robin_playoffs'?'Group stage & playoffs':'Tournament bracket')}</div><div class="db">${stageMarkup}</div></article>`;

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
        toast('ok','Registration submitted','The organizer will review this registration.');button.textContent='Registration submitted';
      }catch(error){toast('err','Could not register team',error.message||'Please try again.');button.disabled=false;}
    });
    icons();
  }catch(error){fail(error.message||'Please try again.');}
})();
