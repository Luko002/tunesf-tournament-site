const GAME_LABELS={cs2:'Counter-Strike 2',val:'VALORANT',lol:'League of Legends',rl:'Rocket League',eafc:'EA SPORTS FC'};
const CLUB_GAME_CODES=Object.keys(GAME_LABELS);
const clubGrid=document.querySelector('#clubGrid');
let clubRows=[];

function clubCard(row){
  if(!row.team_id)return `<article class="dcard club-card"><div class="dh"><i data-lucide="landmark"></i>${esc(row.name)}</div><div class="db"><div class="club-meta">2026 federation directory</div><p class="club-note">Official federation listing. This club has not connected a captain account to TUNESF yet.</p><a class="btn btn-line btn-sm" href="${esc(row.source_url)}" target="_blank" rel="noopener">Official club page <i data-lucide="external-link"></i></a></div></article>`;
  const games=(row.games||[row.game]).filter(Boolean);
  const rosters=(row.rosters||[]).length?games.map(game=>{const players=row.rosters.filter(p=>p.game===game);return `<div class="club-roster"><b>${esc(GAME_LABELS[game]||game)} <small>${players.length} players</small></b><p>${players.length?players.map(p=>esc(p.username||p.player_name||'Player')).join(', '):'Roster forming'}</p></div>`}).join(''):'<p class="club-note">Roster forming.</p>';
  const actions=Auth.is()&&Auth.user.roles.includes('PLAYER')?`<form class="club-contact" data-contact="${esc(row.team_id)}"><label><span>Game</span><select name="game">${games.map(g=>`<option value="${esc(g)}">${esc(GAME_LABELS[g]||g)}</option>`).join('')}</select></label><label><span>Message to captain</span><textarea name="message" minlength="5" maxlength="2000" required placeholder="Introduce yourself and your game experience"></textarea></label><button class="btn btn-gold btn-sm" name="intent" value="request" type="submit">Send join request</button><button class="btn btn-line btn-sm" name="intent" value="message" type="submit">Message captain</button></form>`:`<p class="club-note">Sign in as a player to contact this captain.</p>`;
  return `<article class="dcard club-card"><div class="dh"><i data-lucide="shield"></i>${esc(row.name)} <span class="mono-r">${esc(row.tag)}</span></div><div class="db"><div class="club-meta">${esc(row.region||'Region not set')} · ${games.length} game rosters${row.captain_name?' · Captain '+esc(row.captain_name):''}</div>${rosters}${actions}</div></article>`;
}

function renderClubs(){
  const query=(document.querySelector('#clubSearch').value||'').trim().toLowerCase();
  const rows=clubRows.filter(row=>`${row.name} ${row.tag||''} ${row.region||''} ${(row.games||[]).map(g=>GAME_LABELS[g]||g).join(' ')}`.toLowerCase().includes(query));
  document.querySelector('#clubCount').textContent=`${rows.length} clubs and teams`;
  clubGrid.innerHTML=rows.length?rows.map(clubCard).join(''):'<div class="team-empty">No clubs match your search.</div>';
  icons();
}

Auth.ready.then(async()=>{
  const {data,error}=await SUPA.client.rpc('list_public_clubs');
  if(error)throw error;
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
