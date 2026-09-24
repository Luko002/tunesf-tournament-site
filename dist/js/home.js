/* Home page content is drawn from published Supabase records. */
boot(async()=>{
  const grid=$('#featGrid');
  if(grid){
    const items=TOURN.filter(t=>t.status==='reg').slice(0,3);
    grid.innerHTML=items.length?items.map(tCardHTML).join(''):'<p style="color:var(--faint);font:500 13px var(--fm);letter-spacing:.08em;padding:24px 0">No tournaments yet. Check back for the next competition.</p>';
  }
  const roles=$('#roleChips');
  if(roles)roles.innerHTML=ROLE_ORDER.map(role=>`<a class="rolechip ${ROLES[role].cls}" href="roles.html" style="font-size:10.5px;padding:10px 14px"><i data-lucide="${ROLES[role].icon}"></i>${ROLES[role].label}</a>`).join('');

  const cta=$('#ctaRegister');
  if(cta){
    cta.href=Auth.has('CREATE_TOURNAMENT')?'organize.html':'tournaments.html';
    cta.innerHTML=Auth.has('CREATE_TOURNAMENT')?'<i data-lucide="plus"></i>Create a tournament':'<i data-lucide="trophy"></i>Browse tournaments';
  }
  const meta=document.querySelector('.hero-meta');
  if(meta)meta.innerHTML='<span>OFFICIAL TOURNAMENTS</span><span class="dsep"></span><span>VERIFIED ACCOUNTS</span><span class="dsep"></span><span>ROLE-BASED ACCESS</span>';

  const matchCard=document.querySelector('.hcard .cut-in'),strip=$('#strip');
  const showEmpty=()=>{
    if(matchCard)matchCard.innerHTML='<div class="hc-head"><span class="dot"></span><b>Match center</b></div><div class="hc-score" style="display:block;padding:22px"><p style="color:var(--dim);margin:0">No live matches are scheduled.</p></div><div class="hc-foot"><span class="hc-view">Official matches will appear here when play begins.</span><a class="btn btn-line btn-sm" href="tournaments.html">Browse events</a></div>';
    if(strip)strip.innerHTML='<div class="dcard" style="grid-column:1/-1"><div class="db"><p style="color:var(--dim)">No live matches right now.</p></div></div>';
  };
  try{
    const {data:matches,error}=await SUPA.client.from('tournament_matches').select('id,tournament_id,round_number,position,home_registration_id,away_registration_id,home_score,away_score,started_at').eq('status','live').order('started_at',{ascending:true,nullsFirst:false}).order('position').limit(4);
    if(error)throw error;
    if(!matches?.length){showEmpty();icons();return;}
    const registrationIds=[...new Set(matches.flatMap(m=>[m.home_registration_id,m.away_registration_id]).filter(Boolean))];
    const tournamentIds=[...new Set(matches.map(m=>m.tournament_id))];
    const [{data:registrations,error:registrationError},{data:tournaments,error:tournamentError}]=await Promise.all([
      registrationIds.length?SUPA.client.from('tournament_registrations').select('id,team_id').in('id',registrationIds):Promise.resolve({data:[],error:null}),
      Promise.resolve({data:TOURN.filter(t=>tournamentIds.includes(t.id)),error:null})
    ]);
    if(registrationError)throw registrationError;if(tournamentError)throw tournamentError;
    const teamIds=[...new Set((registrations||[]).map(r=>r.team_id))];
    const {data:teams,error:teamError}=teamIds.length?await SUPA.client.from('teams').select('id,name,tag').in('id',teamIds):{data:[],error:null};
    if(teamError)throw teamError;
    const regMap=new Map((registrations||[]).map(r=>[r.id,r.team_id])),teamMap=new Map((teams||[]).map(t=>[t.id,t])),eventMap=new Map((tournaments||[]).map(t=>[t.id,t]));
    const team=id=>teamMap.get(regMap.get(id))||{name:'Team unavailable',tag:'—'};
    const event=match=>eventMap.get(match.tournament_id);
    const card=matches[0],home=team(card.home_registration_id),away=team(card.away_registration_id),tournament=event(card);
    if(matchCard)matchCard.innerHTML=`<div class="hc-head"><span class="dot"></span><b>Live match</b></div><div class="hc-score"><div class="hc-team"><b>${esc(home.name)}</b><span>${esc(home.tag)}</span></div><div class="hc-mid"><div class="s">${card.home_score??'—'}<em>:</em>${card.away_score??'—'}</div><div class="lbl">● LIVE</div></div><div class="hc-team"><b>${esc(away.name)}</b><span>${esc(away.tag)}</span></div></div><div class="hc-info"><span>${esc(tournament?.name||'Official tournament')}</span><b>Round ${card.round_number}</b></div><div class="hc-foot"><span class="hc-view">Match ${card.position}</span><a class="btn btn-line btn-sm" href="bracket.html?tournament=${encodeURIComponent(card.tournament_id)}">Open bracket</a></div>`;
    if(strip)strip.innerHTML=matches.map(match=>{
      const a=team(match.home_registration_id),b=team(match.away_registration_id),name=event(match)?.name||'Official tournament';
      return `<article class="scard dcard"><div class="top"><span class="chip">${esc(name)}</span><span class="badge live">LIVE</span></div><div class="vs"><span>${esc(a.name)}</span><b>VS</b><span>${esc(b.name)}</span></div><div class="bot"><span>Round ${match.round_number} · Match ${match.position}</span><a class="wbtn" href="bracket.html?tournament=${encodeURIComponent(match.tournament_id)}">Match center <i data-lucide="arrow-up-right"></i></a></div></article>`;
    }).join('');
    icons();
  }catch(error){
    if(matchCard)matchCard.innerHTML=`<div class="hc-head"><b>Match center</b></div><div class="hc-score" style="display:block;padding:22px"><p style="color:var(--dim);margin:0">Live matches could not be loaded.</p></div><div class="hc-foot"><a class="btn btn-line btn-sm" href="tournaments.html">Browse events</a></div>`;
    if(strip)strip.innerHTML=`<div class="dcard" style="grid-column:1/-1"><div class="db"><p style="color:var(--dim)">Live matches could not be loaded: ${esc(error?.message||'Please try again.')}</p></div></div>`;
    console.error('Live matches unavailable:',error);
  }
  icons();
});
