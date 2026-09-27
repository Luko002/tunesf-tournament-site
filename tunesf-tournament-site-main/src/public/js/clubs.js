const GAME_LABELS={cs2:'Counter-Strike 2',val:'VALORANT',lol:'League of Legends',rl:'Rocket League',mlbb:'Mobile Legends: Bang Bang',eafc:'EA SPORTS FC',efootball:'eFootball'};
const GAME_ART={
  cs2:'https://cdn.akamai.steamstatic.com/steam/apps/730/library_hero.jpg',
  val:'https://cdn.mos.cms.futurecdn.net/QotLyoh6LR4VT8KvE3tGze.jpg',
  lol:'https://ddragon.leagueoflegends.com/cdn/img/champion/splash/Aatrox_0.jpg',
  rl:'https://cdn.akamai.steamstatic.com/steam/apps/252950/library_hero.jpg',
  mlbb:'https://en.moonton.com/upload/image/20260904/37ce82b6e6bcf523b232de69de356286.JPEG',
  eafc:'https://drop-assets.ea.com/images/58CQYDIE4wY3G5v6FAybEF/d2dba89adcd15dd3d5b3619d3c5033ba/maxresdefault__2_.jpg?im=AspectCrop%3D%2816%2C9%29%2CxPosition%3D0.5%2CyPosition%3D0.5',
  efootball:'https://img.konami.com/games_cms/promo/na/uploads/connect_v6_kv_0810.jpg'
};
const CLUB_GAME_CODES=Object.keys(GAME_LABELS);
const clubGrid=document.querySelector('#clubGrid');
const isTeamsDirectory=location.pathname.toLowerCase().endsWith('/teams.html');
let clubRows=[];

function clubCard(row){
  if(!row.team_id)return `<article class="dcard club-card"><div class="dh"><i data-lucide="landmark"></i>${esc(row.name)}</div><div class="club-art">${row.image_url?`<img src="${esc(encodeURI(row.image_url))}" alt="${esc(row.name)} logo" loading="lazy" decoding="async" onerror="this.closest('.club-art').classList.add('club-art-missing');this.remove()">`:'<i data-lucide="landmark"></i>'}</div><div class="db"><div class="club-meta">2026 federation directory</div><p class="club-note">Official federation listing. This club has not connected a captain account to TUNESF yet.</p><a class="btn btn-line btn-sm" href="${esc(row.source_url)}" target="_blank" rel="noopener">Official club page <i data-lucide="external-link"></i></a></div></article>`;
  const game=row.game,players=(row.rosters||[]).filter(player=>player.game===game),gameArt=GAME_ART[game];
  const roster=players.length?players.slice(0,5).map(player=>`<span class="team-identity">${identityImage(player.avatar_path,player.username||player.player_name||'Player',24,'player')}<a href="player.html?id=${encodeURIComponent(player.user_id)}">${esc(player.username||player.player_name||'Player')}</a></span>`).join(''):'<span class="club-roster-empty">Roster forming</span>';
  const actions=Auth.is()&&Auth.user.roles.includes('PLAYER')?`<form class="club-contact" data-contact="${esc(row.team_id)}" data-game="${esc(game||'')}"${READ_ONLY_PREVIEW?' aria-describedby="clubContactPreviewNote"':''}><label><span>Message to captain</span><textarea name="message" minlength="5" maxlength="2000" required placeholder="Introduce yourself and your game experience"${READ_ONLY_PREVIEW?' disabled':''}></textarea></label><button class="btn btn-gold btn-sm" name="intent" value="request" type="submit"${READ_ONLY_PREVIEW?' disabled':''}>Send join request</button><button class="btn btn-line btn-sm" name="intent" value="message" type="submit"${READ_ONLY_PREVIEW?' disabled':''}>Message captain</button>${READ_ONLY_PREVIEW?'<p class="club-note" id="clubContactPreviewNote">Contact actions are disabled in this production-connected preview.</p>':''}</form>`:`<p class="club-note">Sign in as a player to contact this captain.</p>`;
  return `<article class="dcard club-card club-team-card" tabindex="0"><div class="dh">${identityImage(row.logo_path,row.name,34,'team')}<a href="team.html?id=${encodeURIComponent(row.team_id)}">${esc(row.name)}</a><span class="mono-r">${esc(row.tag)}</span></div><div class="club-art club-art-team" data-game="${esc(game||'')}">${gameArt?`<img class="club-game-art" src="${esc(gameArt)}" alt="" loading="lazy" decoding="async" onerror="this.remove();this.closest('.club-art-team').classList.add('club-art-fallback')">`:''}<div class="club-art-tint"></div><div class="club-team-mark">${identityImage(row.logo_path,row.name,72,'team')}</div><span class="club-game-label"><i data-lucide="gamepad-2"></i>${esc(GAME_LABELS[game]||game||'Game not set')}</span><button class="club-team-reveal" type="button" aria-expanded="false" aria-label="Show roster and captain" aria-controls="clubRoster-${esc(row.team_id)}"><i data-lucide="users-round"></i><span>Roster &amp; captain</span></button><div class="club-team-hover-panel" id="clubRoster-${esc(row.team_id)}"><div class="club-hover-captain"><i data-lucide="crown"></i><span><small>TEAM CAPTAIN</small><b>${esc(row.captain_name||'Not listed')}</b></span></div><div class="club-hover-roster"><small>ROSTER · ${players.length} ${players.length===1?'PLAYER':'PLAYERS'}</small><div>${roster}${players.length>5?`<span class="club-roster-more">+${players.length-5} more</span>`:''}</div></div></div></div><div class="db"><div class="club-meta">${esc(row.organization_name||'Independent team')} <span>·</span> ${esc(row.region||'Region not set')}</div>${actions}</div></article>`;
}

function renderClubs(){
  const query=(document.querySelector('#clubSearch').value||'').trim().toLowerCase();
  const scopedRows=clubRows.filter(row=>isTeamsDirectory?Boolean(row.team_id):!row.team_id);
  const organization=document.querySelector('#teamOrgFilter')?.value||'',game=document.querySelector('#teamGameFilter')?.value||'';
  const rows=scopedRows.filter(row=>{
    const matchesSearch=`${row.name} ${row.tag||''} ${row.region||''} ${row.organization_name||''} ${(row.games||[row.game]).map(g=>GAME_LABELS[g]||g).join(' ')}`.toLowerCase().includes(query);
    const matchesOrganization=!organization||(organization==='independent'?!row.organization_id:row.organization_id===organization);
    return matchesSearch&&matchesOrganization&&(!game||row.game===game);
  });
  document.querySelector('#clubCount').textContent=`${rows.length} ${isTeamsDirectory?'TUNESF teams':'federation clubs'}`;
  clubGrid.innerHTML=rows.length?rows.map(clubCard).join(''):`<div class="team-empty">${scopedRows.length?'No results match your search.':isTeamsDirectory?'No teams have been created on TUNESF yet.':'The federation club directory is being prepared.'}</div>`;
  icons();
}

Auth.ready.then(async()=>{
  const [directory,clubIds]=await Promise.all([SUPA.client.rpc('list_public_clubs'),SUPA.client.from('clubs').select('id,external_slug')]);
  if(directory.error)throw directory.error;
  if(clubIds.error)throw clubIds.error;
  const logos=new Map((clubIds.data||[]).map(club=>[club.id,FEDERATION_CLUB_LOGOS[club.external_slug]]));
  const allRows=(directory.data||[]).map(row=>({...row,image_url:row.club_id?logos.get(row.club_id):null}));
  const data=allRows.filter(row=>isTeamsDirectory?Boolean(row.team_id):!row.team_id);
  const teamRows=data.filter(r=>r.team_id);
  if(isTeamsDirectory){
    const teamOrgs=teamRows.length?await SUPA.client.from('teams').select('id,organization_id').in('id',teamRows.map(row=>row.team_id)):{data:[],error:null};
    if(teamOrgs.error)throw teamOrgs.error;
    const orgByTeam=new Map((teamOrgs.data||[]).map(row=>[row.id,row.organization_id]));
    const organizations=await SUPA.client.from('organizations').select('id,name').order('name');
    if(organizations.error)throw organizations.error;
    const orgNames=new Map((organizations.data||[]).map(row=>[row.id,row.name]));
    teamRows.forEach(row=>{row.organization_id=orgByTeam.get(row.team_id)||null;row.organization_name=row.organization_id?orgNames.get(row.organization_id)||'Organization':'Independent team';});
    await applyOrganizationTeamLogos(teamRows);
    const orgFilter=document.querySelector('#teamOrgFilter'),gameFilter=document.querySelector('#teamGameFilter');
    if(orgFilter){const counts=new Map();teamRows.forEach(row=>{if(row.organization_id)counts.set(row.organization_id,(counts.get(row.organization_id)||0)+1)});const options=(organizations.data||[]).map(row=>`<option value="${esc(row.id)}">${esc(row.name)} · ${counts.get(row.id)||0} ${counts.get(row.id)===1?'team':'teams'}</option>`).join('');orgFilter.innerHTML='<option value="">All organizations</option>'+options+(teamRows.some(row=>!row.organization_id)?`<option value="independent">Independent teams · ${teamRows.filter(row=>!row.organization_id).length} teams</option>`:'');}
    if(gameFilter){const games=[...new Set(teamRows.map(row=>row.game).filter(Boolean))].sort((a,b)=>(GAME_LABELS[a]||a).localeCompare(GAME_LABELS[b]||b));gameFilter.innerHTML='<option value="">All games</option>'+games.map(value=>`<option value="${esc(value)}">${esc(GAME_LABELS[value]||value)}</option>`).join('');}
  }
  const rosterResults=await Promise.all(teamRows.map(row=>SUPA.client.rpc('list_public_team_rosters',{p_team_id:row.team_id})));
  rosterResults.forEach((result,i)=>{if(result.error)throw result.error;teamRows[i].rosters=(result.data||[]).filter(player=>player.game===teamRows[i].game);teamRows[i].games=teamRows[i].game?[teamRows[i].game]:[]});
  const playerIds=[...new Set(teamRows.flatMap(row=>row.rosters.map(player=>player.user_id)))];
  const {data:profiles,error:profileError}=playerIds.length?await SUPA.client.from('public_profiles').select('id,avatar_path').in('id',playerIds):{data:[],error:null};
  if(profileError)throw profileError;
  const avatarById=new Map((profiles||[]).map(profile=>[profile.id,profile.avatar_path]));
  teamRows.forEach(row=>row.rosters=row.rosters.map(player=>({...player,avatar_path:avatarById.get(player.user_id)})));
  clubRows=data||[];renderClubs();
}).catch(error=>{clubGrid.innerHTML=`<div class="team-empty">${isTeamsDirectory?'Teams':'Federation clubs'} could not be loaded. ${esc(error.message||'Please try again later.')}</div>`});

document.querySelector('#clubSearch').addEventListener('input',renderClubs);
document.querySelector('#teamOrgFilter')?.addEventListener('change',renderClubs);
document.querySelector('#teamGameFilter')?.addEventListener('change',renderClubs);
document.querySelector('#teamFilterClear')?.addEventListener('click',()=>{document.querySelector('#clubSearch').value='';document.querySelector('#teamOrgFilter').value='';document.querySelector('#teamGameFilter').value='';renderClubs();});
clubGrid.addEventListener('submit',async event=>{
  const form=event.target.closest('[data-contact]');if(!form)return;
  event.preventDefault();if(READ_ONLY_PREVIEW){toast('info','Preview is read-only','Contact actions are disabled in this production-connected preview.');return;}const button=event.submitter;button.disabled=true;
  const values=new FormData(form),teamId=form.dataset.contact,message=String(values.get('message')||'').trim(),game=form.dataset.game||'';
  try{
    const {error}=button.value==='request'
      ?await SUPA.client.rpc('request_team_join',{p_team_id:teamId,p_game:game,p_message:message})
      :await SUPA.client.rpc('send_team_message',{p_team_id:teamId,p_message:message});
    if(error)throw error;
    toast('ok',button.value==='request'?'Request sent':'Message sent','The team captain will see your message in their workspace.');form.reset();
  }catch(error){toast('err','Could not contact the team',error.message||'Please try again.');}
  finally{button.disabled=false;}
});
clubGrid.addEventListener('click',event=>{
  const button=event.target.closest('.club-team-reveal');if(!button)return;
  const card=button.closest('.club-team-card'),open=card.dataset.detailsOpen!=='true';
  card.dataset.detailsOpen=String(open);button.setAttribute('aria-expanded',String(open));
});

