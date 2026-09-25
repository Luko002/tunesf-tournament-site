/* Home page uses upcoming events and the signed-in player's own match schedule. */
boot(async()=>{
  const grid=$('#featGrid'),countdownTitle=$('#homeCountdownTitle');
  if(grid){
    const items=TOURN.filter(t=>t.status==='reg').slice(0,3);
    grid.innerHTML=items.length?items.map(tCardHTML).join(''):'<p style="color:var(--faint);font:500 13px var(--fm);letter-spacing:.1em;padding:24px 0">No tournaments yet. Check back for the next competition.</p>';
  }
  const roles=$('#roleChips');
  if(roles)roles.innerHTML=ROLE_ORDER.map(role=>`<a class="rolechip ${ROLES[role].cls}" href="roles.html" style="font-size:10.5px;padding:10px 14px"><i data-lucide="${ROLES[role].icon}"></i>${ROLES[role].label}</a>`).join('');
  const cta=$('#ctaRegister');
  if(cta){cta.href=Auth.has('CREATE_TOURNAMENT')?'organize.html':'tournaments.html';cta.innerHTML=Auth.has('CREATE_TOURNAMENT')?'<i data-lucide="plus"></i>Create a tournament':'<i data-lucide="trophy"></i>Browse tournaments';}
  const meta=document.querySelector('.hero-meta');
  if(meta)meta.innerHTML='<span>OFFICIAL TOURNAMENTS</span><span class="dsep"></span><span>VERIFIED ACCOUNTS</span><span class="dsep"></span><span>ROLE-BASED ACCESS</span>';

  let hoveredTournament=null;
  const nextTournament=()=>TOURN.filter(t=>t.startsAt&&new Date(t.startsAt)>new Date()&&['registration_open','registration_closed'].includes(t.statusKey)).sort((a,b)=>new Date(a.startsAt)-new Date(b.startsAt))[0];
  const updateCountdown=()=>{
    if(!countdownTitle)return;
    const tournament=hoveredTournament||nextTournament();
    if(!tournament){countdownTitle.textContent='No upcoming tournament has a start time yet';countdownTitle.href='tournaments.html';$$('[data-home-time]').forEach(el=>el.textContent='--');return;}
    countdownTitle.textContent=tournament.name;countdownTitle.href=`tournament.html?id=${encodeURIComponent(tournament.id)}`;
    const seconds=Math.max(0,Math.floor((new Date(tournament.startsAt)-Date.now())/1000));
    const values={days:Math.floor(seconds/86400),hours:Math.floor(seconds%86400/3600),minutes:Math.floor(seconds%3600/60),seconds:seconds%60};
    $$('[data-home-time]').forEach(el=>el.textContent=String(values[el.dataset.homeTime]).padStart(2,'0'));
  };
  grid?.addEventListener('pointerover',event=>{
    const card=event.target.closest('.t-card[data-t]');if(!card)return;
    const item=TOURN.find(t=>String(t.id)===card.dataset.t);
    hoveredTournament=item?.startsAt&&new Date(item.startsAt)>new Date()?item:null;updateCountdown();
  });
  grid?.addEventListener('pointerleave',()=>{hoveredTournament=null;updateCountdown();});
  grid?.addEventListener('focusin',event=>{
    const card=event.target.closest('.t-card[data-t]');if(!card)return;
    const item=TOURN.find(t=>String(t.id)===card.dataset.t);
    hoveredTournament=item?.startsAt&&new Date(item.startsAt)>new Date()?item:null;updateCountdown();
  });
  grid?.addEventListener('focusout',event=>{if(!grid.contains(event.relatedTarget)){hoveredTournament=null;updateCountdown();}});
  updateCountdown();setInterval(updateCountdown,1000);

  const matchCard=document.querySelector('.hcard .cut-in'),strip=$('#strip');
  const showEmpty=()=>{
    if(matchCard)matchCard.innerHTML='<div class="hc-head"><span class="dot"></span><b>Match center</b></div><div class="hc-score" style="display:block;padding:22px"><p style="color:var(--dim);margin:0">No live or scheduled matches yet.</p></div><div class="hc-foot"><span class="hc-view">Your team matches appear here after a bracket is published.</span><a class="btn btn-line btn-sm" href="tournaments.html">Browse events</a></div>';
    if(strip)strip.innerHTML='<div class="dcard" style="grid-column:1/-1"><div class="db"><p style="color:var(--dim)">No live matches right now.</p></div></div>';
  };
  const renderGlobalMatches=async()=>{
    const {data:matches,error}=await SUPA.client.from('tournament_matches').select('id,tournament_id,round_number,position,home_registration_id,away_registration_id,home_score,away_score,started_at').eq('status','live').order('started_at',{ascending:true,nullsFirst:false}).order('position').limit(4);
    if(error)throw error;
    if(!matches?.length){showEmpty();return;}
    const registrationIds=[...new Set(matches.flatMap(m=>[m.home_registration_id,m.away_registration_id]).filter(Boolean))];
    const [{data:registrations,error:registrationError},{data:tournaments,error:tournamentError}]=await Promise.all([
      registrationIds.length?SUPA.client.from('tournament_registrations').select('id,team_id').in('id',registrationIds):Promise.resolve({data:[],error:null}),
      Promise.resolve({data:TOURN.filter(t=>matches.some(m=>m.tournament_id===t.id)),error:null})
    ]);
    if(registrationError)throw registrationError;if(tournamentError)throw tournamentError;
    const teamIds=[...new Set((registrations||[]).map(r=>r.team_id))];
    const {data:teams,error:teamError}=teamIds.length?await SUPA.client.from('teams').select('id,name,tag').in('id',teamIds):{data:[],error:null};
    if(teamError)throw teamError;
    const regMap=new Map((registrations||[]).map(r=>[r.id,r.team_id])),teamMap=new Map((teams||[]).map(t=>[t.id,t])),eventMap=new Map((tournaments||[]).map(t=>[t.id,t]));
    const team=id=>teamMap.get(regMap.get(id))||{name:'Team unavailable',tag:'—'};
    const event=match=>eventMap.get(match.tournament_id);
    const card=matches[0],home=team(card.home_registration_id),away=team(card.away_registration_id),tournament=event(card);
    if(matchCard)matchCard.innerHTML=`<div class="hc-head"><span class="dot"></span><b>Live match</b></div><div class="hc-score"><div class="hc-team"><b>${esc(home.name)}</b><span>${esc(home.tag)}</span></div><div class="hc-mid"><div class="s">${card.home_score??'—'}<em>:</em>${card.away_score??'—'}</div><div class="lbl">● LIVE</div></div><div class="hc-team"><b>${esc(away.name)}</b><span>${esc(away.tag)}</span></div></div><div class="hc-info"><span>${esc(tournament?.name||'Official tournament')}</span><b>Round ${card.round_number}</b></div><div class="hc-foot"><span class="hc-view">Match ${card.position}</span><a class="btn btn-line btn-sm" href="tournament.html?id=${encodeURIComponent(card.tournament_id)}#eventBrackets">Open event</a></div>`;
    if(strip)strip.innerHTML=matches.map(match=>{
      const a=team(match.home_registration_id),b=team(match.away_registration_id),name=event(match)?.name||'Official tournament';
      return `<article class="scard dcard"><div class="top"><span class="chip">${esc(name)}</span><span class="badge live">LIVE</span></div><div class="vs"><span>${esc(a.name)}</span><b>VS</b><span>${esc(b.name)}</span></div><div class="bot"><span>Round ${match.round_number} · Match ${match.position}</span><a class="wbtn" href="tournament.html?id=${encodeURIComponent(match.tournament_id)}#eventBrackets">Open event <i data-lucide="arrow-up-right"></i></a></div></article>`;
    }).join('');
    icons();
  };
  const renderPersonalMatch=async()=>{
    if(!Auth.is())return;
    const {data,error}=await SUPA.client.rpc('get_my_team_matches');if(error)throw error;
    const matches=data||[],now=Date.now();
    matches.sort((a,b)=>{
      const priority=m=>m.match_status==='live'?0:m.match_status==='paused'?1:m.match_status==='ready'&&m.scheduled_at&&new Date(m.scheduled_at)>now?2:3;
      return priority(a)-priority(b)||(a.scheduled_at?new Date(a.scheduled_at).getTime():Infinity)-(b.scheduled_at?new Date(b.scheduled_at).getTime():Infinity);
    });
    const match=matches[0];if(!match)return;
    const status=match.match_status==='live'?'LIVE NOW':match.match_status==='paused'?'PAUSED':match.match_status==='ready'?'YOUR NEXT MATCH':match.match_status==='disputed'?'DISPUTE REVIEW':'RESULT REVIEW';
    const center=match.match_status==='live'?`${match.your_score??0}<em>:</em>${match.opponent_score??0}`:match.match_status==='paused'?'—':match.match_status==='ready'&&match.scheduled_at?`<span data-home-match-countdown="${esc(match.scheduled_at)}"></span>`:'TBD';
    const centerLabel=match.match_status==='live'?'● LIVE':match.match_status==='ready'&&match.scheduled_at?'STARTS IN':match.match_status==='ready'?'SCHEDULE PENDING':status;
    matchCard.innerHTML=`<div class="hc-head"><span class="dot${match.match_status==='live'?' live-pulse':''}"></span><b>${status}</b><span class="hc-game">${esc(GAMES[match.game]?.label||match.game)}</span></div><div class="hc-score"><div class="hc-team"><b>${esc(match.your_team_name||'Your team')}</b><span>${esc(match.your_team_tag||'')}</span></div><div class="hc-mid"><div class="s">${center}</div><div class="lbl">${centerLabel}</div></div><div class="hc-team"><b>${esc(match.opponent_team_name||'Opponent TBD')}</b><span>${esc(match.opponent_team_tag||'')}</span></div></div><div class="hc-info"><span>${esc(match.tournament_name)} · ${esc(match.stage_name)}</span><b>Round ${match.round_number}</b></div><div class="hc-foot"><span class="hc-view">${match.scheduled_at?esc(new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(match.scheduled_at))):'Awaiting schedule'}</span><a class="btn btn-gold btn-sm" href="match-room.html?id=${encodeURIComponent(match.match_id)}">Open match room</a></div>`;
  };
  const updatePersonalMatchTimers=()=>document.querySelectorAll('[data-home-match-countdown]').forEach(timer=>{
    const seconds=Math.max(0,Math.floor((new Date(timer.dataset.homeMatchCountdown)-Date.now())/1000));
    timer.textContent=seconds?`${Math.floor(seconds/3600)}:${String(Math.floor(seconds%3600/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`:'Starting now';
  });
  updatePersonalMatchTimers();setInterval(updatePersonalMatchTimers,1000);
  try{await renderGlobalMatches();}catch(error){
    if(matchCard)matchCard.innerHTML=`<div class="hc-head"><b>Match center</b></div><div class="hc-score" style="display:block;padding:22px"><p style="color:var(--dim);margin:0">Live matches could not be loaded.</p></div><div class="hc-foot"><a class="btn btn-line btn-sm" href="tournaments.html">Browse events</a></div>`;
    if(strip)strip.innerHTML=`<div class="dcard" style="grid-column:1/-1"><div class="db"><p style="color:var(--dim)">Live matches could not be loaded: ${esc(error?.message||'Please try again.')}</p></div></div>`;
    console.error('Live matches unavailable:',error);
  }
  if(Auth.is()){
    try{await renderPersonalMatch();}catch(error){console.error('Personal match schedule unavailable:',error);}
    setInterval(()=>renderPersonalMatch().catch(error=>console.warn('Personal match refresh failed:',error)),30000);
  }
  icons();
});
