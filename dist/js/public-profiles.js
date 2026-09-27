const PROFILE_GAMES={cs2:'Counter-Strike 2',val:'VALORANT',lol:'League of Legends',rl:'Rocket League',mlbb:'Mobile Legends: Bang Bang',eafc:'EA SPORTS FC',efootball:'eFootball'};
const profileGameLabel=value=>{const game=String(value||'').trim();return PROFILE_GAMES[game]||(!game||['not selected','not_selected','none','null'].includes(game.toLocaleLowerCase())?'Game not set':game);};
const PROFILE_STATUS={registration_open:'Registration open',registration_closed:'Registration closed',in_progress:'In progress',completed:'Finished',cancelled:'Cancelled',ready:'Upcoming',live:'Live',paused:'Paused',result_pending:'Result review',disputed:'Disputed',forfeit:'Forfeit'};
const profileDate=value=>value?new Intl.DateTimeFormat(undefined,{dateStyle:'medium'}).format(new Date(value)):'Date unavailable';
const profileStatus=value=>PROFILE_STATUS[value]||String(value||'Status unavailable').replaceAll('_',' ');
const profileStats=(stats,kind)=>{
  const entries=kind==='player'?[['Tournaments',stats.tournaments],['Matches played',stats.matches],['Wins',stats.wins],['Losses',Math.max(0,(stats.matches||0)-(stats.wins||0))]]:[['Tournaments',stats.tournaments],['Matches played',stats.matches],['Victories',stats.wins],['Defeats',stats.losses]];
  return `<div class="public-profile-stats">${entries.map(([label,value])=>`<div class="public-profile-stat"><b>${fmt(value)}</b><span>${esc(label)}</span></div>`).join('')}</div>`;
};
const tournamentHistory=items=>`<section class="dcard profile-history"><div class="dh"><i data-lucide="trophy"></i>Tournament history</div><div class="db">${items?.length?`<div class="profile-history-list">${items.map(item=>`<a class="profile-history-row" href="tournament.html?id=${encodeURIComponent(item.id)}"><span><b>${esc(item.name)}</b><small>${esc(profileGameLabel(item.game))} · ${esc(profileDate(item.starts_at))}</small></span><span class="badge ${item.status==='in_progress'?'live':''}">${esc(profileStatus(item.status))}</span></a>`).join('')}</div>`:'<p class="team-empty">Tournament entries will appear here after a registration is approved.</p>'}</div></section>`;
const matchHistory=items=>`<section class="dcard profile-history"><div class="dh"><i data-lucide="swords"></i>Match history</div><div class="db">${items?.length?`<div class="profile-history-list">${items.map(item=>{const dateLabel=item.scheduled_at?profileDate(item.scheduled_at):['completed','forfeit'].includes(item.status)?'Result recorded':'Schedule pending';return `<a class="profile-history-row" href="match-room.html?id=${encodeURIComponent(item.id)}"><span><b>${esc(item.tournament)} · Round ${esc(item.round)}</b><small>${esc(item.opponent||'Opponent pending')} · ${esc(dateLabel)}</small></span><span class="profile-match-result"><b>${item.home_score??'—'} : ${item.away_score??'—'}</b><small>${esc(profileStatus(item.status))}${item.won?' · WIN':''}</small></span></a>`}).join('')}</div>`:'<p class="team-empty">Match results will appear here as matches are completed.</p>'}</div></section>`;
const playerAchievements=items=>`<section class="dcard profile-history"><div class="dh"><i data-lucide="medal"></i>Verified achievements</div><div class="db">${items?.length?`<div class="profile-history-list">${items.map(a=>`<a class="profile-history-row" href="tournament.html?id=${encodeURIComponent(a.tournament_id)}"><span><b>${esc(a.label||`Place ${a.place}`)}</b><small>${esc(a.tournament_name)} · ${esc(profileDate(a.awarded_at))}</small></span><span class="badge">${esc(a.award_status)}</span></a>`).join('')}</div>`:'<p class="team-empty">Confirmed tournament awards will appear here after the tournament is completed.</p>'}</div></section>`;
async function loadPublicProfile(){
  const params=new URLSearchParams(location.search),isTeam=currentPage()==='team.html',id=params.get('id');
  const host=$('#profileContent');
  const showProfileLinkState=message=>{$('#profileSubtitle').textContent='Choose a directory to explore.';host.innerHTML=`<div class="team-empty"><p>${esc(message)}</p><a class="btn btn-line btn-sm" href="teams.html">Browse teams</a> <a class="btn btn-line btn-sm" href="clubs.html">Federation clubs</a></div>`;};
  if(!id){showProfileLinkState(`This ${isTeam?'team':'player'} link is missing its ID.`);return;}
  if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)){showProfileLinkState(`This ${isTeam?'team':'player'} profile link is invalid or expired.`);return;}
  const profileResult=await SUPA.client.rpc(isTeam?'get_public_team_profile':'get_public_player_profile',isTeam?{p_team_id:id}:{p_user_id:id});
  if(profileResult.error)throw profileResult.error;
  const data=profileResult.data;
  if(!data){showProfileLinkState('This public profile could not be found.');return;}
  if(isTeam){
    const team=data.team;if(!team){showProfileLinkState('This team could not be found.');return;}
    await applyOrganizationTeamLogos([team]);
    document.title=`${team.name} — TUNESF`;$('#profileTitle').innerHTML=`<span class="profile-title-identity">${identityImage(team.logo_path,team.name,72,'team')} <span class="profile-title-name">${esc(team.name)}</span></span> <span class="out2">${esc(team.tag||'')}</span>`;$('#profileCrumb').textContent=team.name;$('#profileSubtitle').textContent=`${profileGameLabel(team.game)} · ${team.region||'Region not set'} · Captain ${team.captain||'not listed'}`;
    const rosterByPlayer=new Map();
    (data.roster||[]).forEach((member,index)=>{
      const key=member.user_id||`unknown-${index}`;
      const person=rosterByPlayer.get(key)||{...member,games:[],roles:[]};
      if(member.game&&!person.games.includes(member.game))person.games.push(member.game);
      const role=member.role||'player';if(!person.roles.includes(role))person.roles.push(role);
      if(!person.avatar_path&&member.avatar_path)person.avatar_path=member.avatar_path;
      rosterByPlayer.set(key,person);
    });
    const roster=[...rosterByPlayer.values()];
    host.innerHTML=`${profileStats(data.stats||{},'team')}<div class="public-profile-columns"><section class="dcard profile-history"><div class="dh"><i data-lucide="users-round"></i>Roster <span class="mono-r">${roster.length} ${roster.length===1?'player':'players'}</span></div><div class="db">${roster.length?`<ul class="team-roster">${roster.map(p=>{const games=p.games.map(profileGameLabel).join(', ')||profileGameLabel(team.game);const role=p.roles.map(value=>value.replaceAll('_',' ')).join(', ');return `<li>${identityImage(p.avatar_path,p.username||'Player',34,'player')}<span><b><a href="player.html?id=${encodeURIComponent(p.user_id||'')}">${esc(p.username||'Player')}</a></b><small>${esc(role)} · ${esc(games)}</small></span>${p.roles.includes('captain')?'<i data-lucide="crown" aria-label="Team captain"></i>':''}</li>`;}).join('')}</ul>`:'<p class="team-empty">This team has not published a roster yet.</p>'}</div></section>${tournamentHistory(data.tournaments)}${matchHistory(data.matches)}</div>`;
  }else{
    const p=data.profile;if(!p){showProfileLinkState('This player could not be found.');return;}
    document.title=`${p.username} — TUNESF`;$('#profileTitle').innerHTML=`<span class="profile-title-identity">${identityImage(p.avatar_path,p.username,72,'player')} <span class="profile-title-name">${esc(p.username)}</span></span> <span class="out2">profile</span>`;$('#profileCrumb').textContent=p.username;$('#profileSubtitle').textContent=`${profileGameLabel(p.game)} · ${p.region||'Region not set'}`;
    const {data:achievements,error:achievementError}=await SUPA.client.rpc('list_public_player_achievements',{p_user_id:id});
    if(achievementError)throw achievementError;
    const teams=data.teams||[];host.innerHTML=`${profileStats(data.stats||{},'player')}<div class="public-profile-columns"><section class="dcard profile-history"><div class="dh"><i data-lucide="shield"></i>Current teams</div><div class="db">${teams.length?`<div class="profile-history-list">${teams.map(t=>`<a class="profile-history-row" href="team.html?id=${encodeURIComponent(t.id)}"><span class="team-identity">${identityImage(t.logo_path,t.name,34,'team')}<span><b>${esc(t.name)} <small>${esc(t.tag)}</small></b><small>${esc(profileGameLabel(t.game))} · ${esc(t.region||'Region not set')}</small></span></span><span class="badge">${esc(t.role||'player')}</span></a>`).join('')}</div>`:'<p class="team-empty">No active team membership is listed.</p>'}</div></section>${playerAchievements(achievements)}${tournamentHistory(data.tournaments)}${matchHistory(data.matches)}</div>`;
  }
  icons();
}
Auth.ready.then(loadPublicProfile).catch(error=>{console.error('Public profile unavailable:',error);const subtitle=$('#profileSubtitle'),host=$('#profileContent');if(subtitle)subtitle.textContent='Profile information is unavailable right now.';if(host)host.innerHTML=`<div class="team-empty">Profile information could not be loaded. ${esc(error.message||'Please try again later.')}<p><a class="btn btn-line btn-sm" href="clubs.html">Browse clubs &amp; teams</a></p></div>`;});

