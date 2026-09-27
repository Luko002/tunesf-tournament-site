/* Match center event picker. Brackets and fixtures are rendered in each event hub. */
boot(async()=>{
  const grid=$('#bracketEventGrid'),count=$('#bracketEventCount'),empty=$('#bracketEventEmpty');
  const search=$('#bracketEventSearch'),gameFilter=$('#bracketGameFilter'),statusFilter=$('#bracketStatusFilter');
  if(!grid||!count)return;
  Object.entries(GAMES).forEach(([key,game])=>gameFilter.insertAdjacentHTML('beforeend',`<option value="${esc(key)}">${esc(game.label)}</option>`));
  const statusLabels={registration_open:'Registration open',registration_scheduled:'Registration opens soon',registration_closed:'Registration closed',in_progress:'In progress',completed:'Completed',cancelled:'Cancelled',scheduled:'Upcoming'};
  const statusPriority={in_progress:0,registration_closed:1,registration_open:2,registration_scheduled:3,scheduled:4,completed:5,cancelled:6};
  const date=value=>value?new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)):'Start date to be announced';
  let events=[];
  function render(){
    const term=(search.value||'').trim().toLocaleLowerCase(),game=gameFilter.value,status=statusFilter.value;
    const visible=events.filter(event=>
      (!term||`${event.name} ${GAMES[event.game]?.label||event.game} ${event.format||''}`.toLocaleLowerCase().includes(term))&&
      (game==='all'||event.game===game)&&(status==='all'||event.status===status)
    );
    visible.sort((a,b)=>(statusPriority[a.status]??4)-(statusPriority[b.status]??4)||new Date(b.starts_at||0)-new Date(a.starts_at||0));
    count.textContent=`${visible.length} ${visible.length===1?'EVENT':'EVENTS'}`;
    grid.hidden=visible.length===0;empty.hidden=visible.length>0;
    grid.innerHTML=visible.map(event=>{
      const gameName=GAMES[event.game]?.label||String(event.game||'Game').toUpperCase();
      const statusName=statusLabels[event.status]||String(event.status||'upcoming').replaceAll('_',' ');
      const format=String(event.format||'Tournament format').replaceAll('_',' ').toUpperCase();
      const href=`tournament.html?id=${encodeURIComponent(event.id)}&view=schedule#eventBrackets`;
      return `<a class="bracket-event-card" href="${href}" data-status="${esc(event.status)}"><span class="bracket-event-topline"><span class="bracket-event-game"><i data-lucide="${esc(GAMES[event.game]?.icon||'gamepad-2')}" aria-hidden="true"></i>${esc(gameName)}</span><span class="bracket-event-status" data-status="${esc(event.status)}">${esc(statusName)}</span></span><h2>${esc(event.name)}</h2><div class="bracket-event-meta"><span><i data-lucide="git-fork" aria-hidden="true"></i>${esc(format)}</span><span><i data-lucide="calendar-days" aria-hidden="true"></i>${esc(date(event.starts_at))}</span></div><span class="bracket-event-link">View bracket &amp; schedule <i data-lucide="arrow-up-right" aria-hidden="true"></i></span></a>`;
    }).join('');
    icons();
  }
  search.addEventListener('input',render);gameFilter.addEventListener('change',render);statusFilter.addEventListener('change',render);
  $('#clearBracketFilters')?.addEventListener('click',()=>{search.value='';gameFilter.value='all';statusFilter.value='all';render();search.focus();});
  if(DEMO_MODE){
    count.textContent='LIVE DATA UNAVAILABLE';
    grid.innerHTML='<section class="dcard bracket-picker-state"><div class="dh"><i data-lucide="radio"></i>Match center unavailable</div><div class="db"><p>The official event list is unavailable while the site is in demo mode. Browse sample tournaments to explore the preview.</p><a class="btn btn-line btn-sm" href="tournaments.html">Browse tournaments</a></div></section>';
    icons();return;
  }
  try{
    const {data,error}=await SUPA.client.from('tournament_directory').select('id,name,game,status,starts_at,format').neq('status','draft').order('starts_at',{ascending:false,nullsFirst:false}).limit(120);
    if(error)throw error;
    events=data||[];
    if(!events.length){count.textContent='NO EVENTS';grid.innerHTML='<section class="dcard bracket-picker-state"><div class="dh"><i data-lucide="trophy"></i>No published events yet</div><div class="db"><p>Published brackets and schedules will appear here as tournaments open.</p><a class="btn btn-line btn-sm" href="tournaments.html">Browse tournaments</a></div></section>';icons();return;}
    render();
  }catch(error){
    count.textContent='UNAVAILABLE';
    grid.innerHTML=`<section class="dcard bracket-picker-state" role="alert"><div class="dh"><i data-lucide="triangle-alert"></i>Match center unavailable</div><div class="db"><p>${esc(error.message||'The tournament list could not be loaded.')}</p><button class="btn btn-line btn-sm" id="retryBracketEvents" type="button">Try again</button></div></section>`;
    $('#retryBracketEvents')?.addEventListener('click',()=>location.reload());icons();
  }
});
