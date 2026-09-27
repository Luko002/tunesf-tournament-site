/* =============================================================
   TUNESF — tournaments page logic (public discovery grid)
   ============================================================= */
boot(()=>{
let FILT={game:'all',status:'all',sort:'feat'};
const TABS=[['all','ALL GAMES'],['cs2','CS2'],['val','VALORANT'],['lol','LOL'],['rl','ROCKET LEAGUE'],['mlbb','MLBB'],['eafc','EA FC'],['efootball','EFOOTBALL']];

function renderT(){
  let list=TOURN.filter(t=>(FILT.game==='all'||t.game===FILT.game)&&(FILT.status==='all'||t.status===FILT.status));
  if(FILT.sort==='prize')list.sort((a,b)=>b.prize-a.prize);
  else if(FILT.sort==='teams')list.sort((a,b)=>b.teams-a.teams);
  else list.sort((a,b)=>(b.featured?1:0)-(a.featured?1:0)||b.prize-a.prize);
  $('#tgrid').innerHTML=list.length
    ? list.map(tCardHTML).join('')
    : TOURN.length
      ? '<section class="t-filter-empty" aria-live="polite"><span>NO MATCHES FOUND</span><h2>No tournaments match those filters</h2><p>Try another game or status to find an event.</p><button class="btn btn-line btn-sm" type="button" data-clear-tournament-filters>Clear game and status filters</button></section>'
      : '<div class="dcard" style="grid-column:1/-1"><div class="dh">No tournaments yet</div><div class="db"><p>The federation has not published a tournament. Check back here for verified events.</p></div></div>';
  icons();
}

(function init(){
  const tabs=$('#gameTabs'); if(!tabs)return;
  tabs.innerHTML=TABS.map(([k,l],i)=>`<button type="button" data-g="${k}" aria-pressed="${i===0}"${i?'':' class="act"'}>${l}</button>`).join('');
  $$('#gameTabs button').forEach(b=>b.onclick=()=>{
    $$('#gameTabs button').forEach(x=>{x.classList.toggle('act',x===b);x.setAttribute('aria-pressed',String(x===b));});FILT.game=b.dataset.g;renderT();});
  $('#tgrid').addEventListener('click',event=>{
    if(!event.target.closest('[data-clear-tournament-filters]'))return;
    FILT.game='all';FILT.status='all';$('#statusSel').value='all';
    $$('#gameTabs button').forEach(button=>{const selected=button.dataset.g==='all';button.classList.toggle('act',selected);button.setAttribute('aria-pressed',String(selected));});
    renderT();$('#gameTabs button[data-g="all"]')?.focus();
  });
  $('#statusSel').onchange=e=>{FILT.status=e.target.value;renderT();};
  $('#sortSel').onchange=e=>{FILT.sort=e.target.value;renderT();};
  $('#refreshTournaments').onclick=async event=>{
    const button=event.currentTarget;button.disabled=true;
    if(DEMO_MODE){renderT();toast('info','Demo tournaments refreshed','These sample events are for preview only.');button.disabled=false;return;}
    try{await loadPublicData();renderT();toast('ok','Tournament list refreshed',`${TOURN.length} tournaments are up to date.`);}
    catch(error){toast('err','Could not refresh tournaments',error.message||'Please try again.');}
    finally{button.disabled=false;}
  };
  renderT();

  /* a tournament published from the organizer engine lands here, highlighted */
  const neu=new URLSearchParams(location.search).get('new');
  if(neu){
    const card=$(`.t-card[data-t="${neu}"]`);
    if(card){card.classList.add('flash');
      setTimeout(()=>card.scrollIntoView({behavior:'smooth',block:'center'}),150);}
    const t=TOURN.find(x=>x.id===neu);
    t&&toast('ok','Tournament published','“'+t.name+'” is live on the discovery grid — organizer tools unlocked.');
  }
  icons();
})();
});
