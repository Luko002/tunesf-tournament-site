const GAME_LABELS={cs2:'Counter-Strike 2',val:'VALORANT',lol:'League of Legends',rl:'Rocket League',eafc:'EA SPORTS FC'};
const CLUB_GAME_CODES=Object.keys(GAME_LABELS);
const CLUB_LOGOS={
  'tunisian-national-team':'https://esports.tunesf.tn/media/19143/conversions/eaglegold-medium.webp','asatb-e-sport':'https://esports.tunesf.tn/media/19172/conversions/atb-medium.webp','stade-gabesien':'https://esports.tunesf.tn/media/20632/conversions/26sgg-medium.webp','olympique-el-ayoun':'https://esports.tunesf.tn/media/20610/conversions/26aayounn-medium.webp','gng-amazigh':'https://esports.tunesf.tn/media/19133/conversions/جمعية-جيم-وجيم-للألعاب-الإلكترونية-GNG-ESPORTS-medium.webp','el-menzah-e-sport':'https://esports.tunesf.tn/media/19141/conversions/المنزه-الرياضي-medium.webp','jeunesse-sportive-kairouanaise':'https://esports.tunesf.tn/media/19527/conversions/jsk-medium.webp','el-hamma-martial-arts-association':'https://esports.tunesf.tn/media/20624/conversions/26hammaa-medium.webp','maknassy-sport-for-all-association':'https://esports.tunesf.tn/media/20630/conversions/26maknesss-medium.webp','elite-sports-siliana':'https://esports.tunesf.tn/media/2844/conversions/elitesiliana-medium.webp','thysdrus-esports':'https://esports.tunesf.tn/media/19529/conversions/th-medium.webp','zahrouni-e-sports':'https://esports.tunesf.tn/media/19139/conversions/Untitled-medium.webp','association-sportive-mansoura':'https://esports.tunesf.tn/media/19127/conversions/mansoura-logo-medium.webp','mechanic-sports':'https://esports.tunesf.tn/media/650/conversions/asm-medium.webp','monastir-sport-for-all-association':'https://esports.tunesf.tn/media/20616/conversions/26asptt-medium.webp','olympique-mednine':'https://esports.tunesf.tn/media/22745/conversions/Club_olympique_de_Médenine-medium.webp','jbenyena-e-sports':'https://esports.tunesf.tn/media/19140/conversions/jbeniana-medium.webp','grand-8-bardo':'https://esports.tunesf.tn/media/632/conversions/g8-medium.webp','tadhamon-esports':'https://esports.tunesf.tn/media/634/conversions/atsl-medium.webp','association-aigle-sportif-de-sfax':'https://esports.tunesf.tn/media/2846/conversions/aass-medium.webp','avenir-sport-ariana':'https://esports.tunesf.tn/media/648/conversions/ariana-medium.webp','the-tunisian-association-of-youth-and-science-in-korba':'https://esports.tunesf.tn/media/21152/conversions/WhatsApp-Image-2026-04-13-at-13.54.23-medium.webp','team-wave':'https://esports.tunesf.tn/media/14171/conversions/team-wavee-medium.webp','jandouba-e-sports':'https://esports.tunesf.tn/media/636/conversions/jendouba-medium.webp','royal-class-gaming':'https://esports.tunesf.tn/media/19147/conversions/جمعية-ROYAL-CLASS-medium.webp','supreme-leaders':'https://esports.tunesf.tn/media/19534/conversions/l-medium.webp','olympique-mnihla':'https://esports.tunesf.tn/media/19123/conversions/om-medium.webp','est-esports':'https://esports.tunesf.tn/media/19128/conversions/الترجي-الرياضي-التونسي-medium.webp','simplicity-esports':'https://esports.tunesf.tn/media/16438/conversions/WhatsApp-Image-2025-11-11-at-15.43.58-medium.webp','enfida-sports':'https://esports.tunesf.tn/media/19531/conversions/enfida-medium.webp','tunisian-professionals-association-of-kasserine':'https://esports.tunesf.tn/media/20634/conversions/266-medium.webp','kef-sports-club':'https://esports.tunesf.tn/media/20626/conversions/26keff-medium.webp','avenir-sportif-de-gabes':'https://esports.tunesf.tn/media/20621/conversions/26gabess-medium.webp'
};
const clubGrid=document.querySelector('#clubGrid');
let clubRows=[];

function clubCard(row){
  if(!row.team_id)return `<article class="dcard club-card"><div class="dh"><i data-lucide="landmark"></i>${esc(row.name)}</div><div class="club-art">${row.image_url?`<img src="${esc(encodeURI(row.image_url))}" alt="${esc(row.name)} logo" loading="lazy" decoding="async" onerror="this.closest('.club-art').classList.add('club-art-missing');this.remove()">`:'<i data-lucide="landmark"></i>'}</div><div class="db"><div class="club-meta">2026 federation directory</div><p class="club-note">Official federation listing. This club has not connected a captain account to TUNESF yet.</p><a class="btn btn-line btn-sm" href="${esc(row.source_url)}" target="_blank" rel="noopener">Official club page <i data-lucide="external-link"></i></a></div></article>`;
  const games=(row.games||[row.game]).filter(Boolean);
  const rosters=(row.rosters||[]).length?games.map(game=>{const players=row.rosters.filter(p=>p.game===game);return `<div class="club-roster"><b>${esc(GAME_LABELS[game]||game)} <small>${players.length} players</small></b><p>${players.length?players.map(p=>esc(p.username||p.player_name||'Player')).join(', '):'Roster forming'}</p></div>`}).join(''):'<p class="club-note">Roster forming.</p>';
  const actions=Auth.is()&&Auth.user.roles.includes('PLAYER')?`<form class="club-contact" data-contact="${esc(row.team_id)}"><label><span>Game</span><select name="game">${games.map(g=>`<option value="${esc(g)}">${esc(GAME_LABELS[g]||g)}</option>`).join('')}</select></label><label><span>Message to captain</span><textarea name="message" minlength="5" maxlength="2000" required placeholder="Introduce yourself and your game experience"></textarea></label><button class="btn btn-gold btn-sm" name="intent" value="request" type="submit">Send join request</button><button class="btn btn-line btn-sm" name="intent" value="message" type="submit">Message captain</button></form>`:`<p class="club-note">Sign in as a player to contact this captain.</p>`;
  return `<article class="dcard club-card"><div class="dh"><i data-lucide="shield"></i>${esc(row.name)} <span class="mono-r">${esc(row.tag)}</span></div><div class="club-art club-art-team"><i data-lucide="shield"></i></div><div class="db"><div class="club-meta">${esc(row.region||'Region not set')} · ${games.length} game rosters${row.captain_name?' · Captain '+esc(row.captain_name):''}</div>${rosters}${actions}</div></article>`;
}

function renderClubs(){
  const query=(document.querySelector('#clubSearch').value||'').trim().toLowerCase();
  const rows=clubRows.filter(row=>`${row.name} ${row.tag||''} ${row.region||''} ${(row.games||[]).map(g=>GAME_LABELS[g]||g).join(' ')}`.toLowerCase().includes(query));
  document.querySelector('#clubCount').textContent=`${rows.length} clubs and teams`;
  clubGrid.innerHTML=rows.length?rows.map(clubCard).join(''):'<div class="team-empty">No clubs match your search.</div>';
  icons();
}

Auth.ready.then(async()=>{
  const [directory,clubIds]=await Promise.all([SUPA.client.rpc('list_public_clubs'),SUPA.client.from('clubs').select('id,external_slug')]);
  if(directory.error)throw directory.error;
  if(clubIds.error)throw clubIds.error;
  const logos=new Map((clubIds.data||[]).map(club=>[club.id,CLUB_LOGOS[club.external_slug]]));
  const data=(directory.data||[]).map(row=>({...row,image_url:row.club_id?logos.get(row.club_id):null}));
  const teamRows=(data||[]).filter(r=>r.team_id);
  const rosterResults=await Promise.all(teamRows.map(row=>SUPA.client.rpc('list_public_team_rosters',{p_team_id:row.team_id})));
  rosterResults.forEach((result,i)=>{if(result.error)throw result.error;teamRows[i].rosters=result.data||[];teamRows[i].games=[...new Set([teamRows[i].game,...teamRows[i].rosters.map(p=>p.game)].filter(Boolean))]});
  clubRows=data||[];renderClubs();
}).catch(error=>{clubGrid.innerHTML=`<div class="team-empty">Clubs could not be loaded. ${esc(error.message||'Please try again later.')}</div>`});

document.querySelector('#clubSearch').addEventListener('input',renderClubs);
clubGrid.addEventListener('submit',async event=>{
  const form=event.target.closest('[data-contact]');if(!form)return;
  event.preventDefault();const button=event.submitter;button.disabled=true;
  const values=new FormData(form),teamId=form.dataset.contact,message=String(values.get('message')||'').trim(),game=String(values.get('game')||'');
  try{
    const {error}=button.value==='request'
      ?await SUPA.client.rpc('request_team_join',{p_team_id:teamId,p_game:game,p_message:message})
      :await SUPA.client.rpc('send_team_message',{p_team_id:teamId,p_message:message});
    if(error)throw error;
    toast('ok',button.value==='request'?'Request sent':'Message sent','The team captain will see your message in their workspace.');form.reset();
  }catch(error){toast('err','Could not contact the team',error.message||'Please try again.');}
  finally{button.disabled=false;}
});
