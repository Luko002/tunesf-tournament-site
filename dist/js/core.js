/* TUNESF shared application shell. Tournament data and authorization come from Supabase. */
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>Math.round(Number(n)||0).toLocaleString('en-US');
const icons=()=>{try{window.lucide&&lucide.createIcons()}catch{}};
function logoSvg(size=34){return `<svg width="${size}" height="${size}" viewBox="0 0 48 48" aria-hidden="true"><polygon points="24,3 43,13.5 43,34.5 24,45 5,34.5 5,13.5" fill="rgba(245,180,0,.1)" stroke="#F5B400" stroke-width="2.4"/><text x="24" y="30" text-anchor="middle" font-family="Chakra Petch" font-weight="700" font-size="13" fill="#F5B400">TF</text></svg>`;}

function toast(type,title,msg){
  const host=$('#toasts');if(!host)return;
  const t=document.createElement('div');t.className='toast '+type;
  const ic={ok:'check',err:'triangle-alert',info:'info'}[type]||'info';
  t.innerHTML=`<i data-lucide="${ic}"></i><div><b></b><span></span></div>`;
  t.querySelector('b').textContent=title;t.querySelector('span').textContent=msg;host.appendChild(t);icons();
  setTimeout(()=>{t.classList.add('out');setTimeout(()=>t.remove(),350)},4600);
}

const GAMES={
  cs2:{label:'Counter-Strike 2',icon:'crosshair',maps:['Ancient','Anubis','Inferno','Mirage','Nuke','Overpass','Vertigo']},
  val:{label:'VALORANT',icon:'zap',maps:['Ascent','Bind','Haven','Lotus','Split','Icebox','Sunset']},
  lol:{label:'League of Legends',icon:'swords',maps:[]},rl:{label:'Rocket League',icon:'car',maps:[]},eafc:{label:'EA SPORTS FC',icon:'goal',maps:[]}
};
const TOURN=[];
const ROLE_ORDER=[];
const ROLES={};
const ROLE_PERMISSIONS=[];
const ROLE_FOR_PERM={};
const LANDING={};
const CONSOLES=[
  {perm:'PLAYER_ZONE',label:'Player',icon:'user',href:'dashboard.html'},
  {perm:'CAPTAIN_CONSOLE',label:'Team management',icon:'users',href:'captain.html'},
  {perm:'MANAGE_SCHEDULE',label:'Tournament operations',icon:'clipboard-list',href:'event-admin.html'},
  {perm:'REFEREE_MATCHES',label:'Referee',icon:'gavel',href:'referee.html'},
  {perm:'MANAGE_ORGANIZATION',label:'Organization',icon:'landmark',href:'organization.html'},
  {perm:'CREATE_TOURNAMENT',label:'Tournament organizer',icon:'clipboard-list',href:'organize.html'},
  {perm:'REVIEW_REPORTS',label:'Moderation',icon:'flag',href:'moderation.html'},
  {perm:'BAN_USERS',label:'Administration',icon:'shield',href:'admin.html'}
];
const SUPABASE_CONFIG=Object.assign({url:'',anonKey:''},window.TUNESF_SUPABASE||{});
const SUPA={client:null};
const LOCAL_ORIGIN=location.protocol==='file:'||['localhost','127.0.0.1'].includes(location.hostname);
const READ_ONLY_PREVIEW=SUPABASE_CONFIG.environment==='production'&&LOCAL_ORIGIN;
const READ_ONLY_RPCS=new Set(['get_my_roles','get_my_permissions','list_team_roster','list_team_invitations','list_public_clubs','list_public_team_rosters','get_team_captain_inbox']);
function supabaseFetch(input,init){
  if(!READ_ONLY_PREVIEW)return fetch(input,init);
  const url=new URL(input instanceof Request?input.url:String(input),SUPABASE_CONFIG.url);
  const method=String(init?.method||(input instanceof Request?input.method:'GET')).toUpperCase();
  const authToken=url.pathname.endsWith('/auth/v1/token')&&['password','refresh_token'].includes(url.searchParams.get('grant_type'));
  const signOut=url.pathname.endsWith('/auth/v1/logout');
  const signedEvidence=url.pathname.startsWith('/storage/v1/object/sign/')&&method==='POST';
  const readRpc=url.pathname.startsWith('/rest/v1/rpc/')&&method==='POST'&&READ_ONLY_RPCS.has(url.pathname.split('/').pop());
  if(['GET','HEAD','OPTIONS'].includes(method)||authToken||signOut||signedEvidence||readRpc)return fetch(input,init);
  return Promise.resolve(new Response(JSON.stringify({code:'TUNESF_READ_ONLY_PREVIEW',message:'This local preview is connected to production and cannot make changes. Configure an isolated staging project for write testing.'}),{status:403,headers:{'Content-Type':'application/json'}}));
}

const Auth={
  user:null,permissions:new Set(),ready:null,
  is(){return !!this.user},
  has(perm){return this.permissions.has(perm)||this.user?.roles?.includes('SUPER_ADMIN')||false},
  highestRole(){return this.user?.roles?.[0]||'VISITOR'},
  consoles(){return CONSOLES.filter(c=>this.has(c.perm))},
  async signOut(){const {error}=await SUPA.client.auth.signOut();if(error)throw error;this.user=null;location.href='login.html';},
  async init(){
    if(!SUPABASE_CONFIG.url||!SUPABASE_CONFIG.anonKey)throw new Error('Supabase settings are missing. Sign-in and data access are disabled.');
    const mod=await import('https://esm.sh/@supabase/supabase-js@2.117.1');
    SUPA.client=mod.createClient(SUPABASE_CONFIG.url,SUPABASE_CONFIG.anonKey,{global:{fetch:supabaseFetch}});
    const [{data:sessionData,error:sessionError},{data:roles,error:rolesError},{data:permissionRows,error:permissionsError}]=await Promise.all([
      SUPA.client.auth.getSession(),SUPA.client.from('roles').select('key,label,level,icon,blurb').order('level'),
      SUPA.client.from('role_permissions').select('role_key,permission_key')
    ]);
    if(sessionError)throw sessionError;if(rolesError)throw rolesError;if(permissionsError)throw permissionsError;
    ROLE_PERMISSIONS.push(...(permissionRows||[]));
    (roles||[]).forEach(r=>{ROLE_ORDER.push(r.key);ROLES[r.key]={level:r.level,label:r.label,icon:r.icon||'user',cls:'r-'+String(r.key).toLowerCase().replaceAll('_','-'),blurb:r.blurb||'',perms:ROLE_PERMISSIONS.filter(p=>p.role_key===r.key).map(p=>p.permission_key)};LANDING[r.key]=({PLAYER:'dashboard.html',CAPTAIN:'captain.html',REFEREE:'referee.html',MODERATOR:'moderation.html',TOURNAMENT_ADMIN:'organize.html',ORGANIZATION_OWNER:'organization.html',PLATFORM_ADMIN:'admin.html',SUPER_ADMIN:'admin.html'})[r.key]||'index.html';});
    Object.keys(ROLES).forEach(role=>ROLES[role].perms.forEach(key=>{ROLE_FOR_PERM[key]??=role;}));
    if(sessionData.session)await this._loadUser(sessionData.session);
    SUPA.client.auth.onAuthStateChange((event)=>{if(event==='SIGNED_OUT'){this.user=null;this.permissions.clear();if(currentPage()!=='login.html')location.href='login.html';}});
  },
  async _loadUser(session){
    const id=session.user.id;
    const [profile,assigned,permissionRows]=await Promise.all([
      SUPA.client.from('profiles').select('player_name,username,game,region,discord_username').eq('id',id).maybeSingle(),
      SUPA.client.rpc('get_my_roles'),SUPA.client.rpc('get_my_permissions')
    ]);
    if(profile.error)throw profile.error;if(assigned.error)throw assigned.error;if(permissionRows.error)throw permissionRows.error;
    const roleKeys=(assigned.data||[]).map(r=>r.role_key).filter(key=>ROLES[key]);
    if(!roleKeys.length)throw new Error('This account has no active TUNESF role.');
    roleKeys.sort((a,b)=>(ROLES[b]?.level||0)-(ROLES[a]?.level||0));
    this.permissions=new Set(permissionRows.data||[]);
    this.user={id,email:session.user.email,name:profile.data?.username||profile.data?.player_name||session.user.email,game:profile.data?.game||null,discordUsername:profile.data?.discord_username||null,roles:roleKeys};
  },
  async signInPassword(email,password){const {data,error}=await SUPA.client.auth.signInWithPassword({email,password});if(error)throw error;await this._loadUser(data.session);return this.user;},
  async signUp(username,email,password,discordUsername){return SUPA.client.auth.signUp({email,password,options:{data:{username,player_name:username,discord_username:discordUsername,game:'Not selected'},emailRedirectTo:location.origin}});}
};
Auth.ready=Auth.init();

async function loadPublicData(){
  const {data,error}=await SUPA.client.from('tournament_directory').select('*').order('starts_at',{ascending:true,nullsFirst:false});
  if(error)throw error;
  const rows=data||[],paths=[...new Set(rows.map(t=>t.cover_image_path).filter(Boolean))];
  let coverUrls=new Map();
  if(paths.length){
    const {data:signed,error:coverError}=await SUPA.client.storage.from('tournament-covers').createSignedUrls(paths,3600);
    if(coverError)console.warn('Tournament covers could not be loaded:',coverError.message);
    else coverUrls=new Map((signed||[]).filter(row=>row.signedUrl).map(row=>[row.path,row.signedUrl]));
  }
  TOURN.splice(0,TOURN.length,...rows.map(t=>({
    id:t.id,name:t.name,game:t.game,prize:Number(t.prize_pool)||0,currency:t.currency||'TND',teams:Number(t.registered_teams)||0,max:Number(t.max_teams)||0,
    startsAt:t.starts_at||null,statusKey:t.status,
    status:({registration_open:'reg',registration_closed:'closed',in_progress:'live',completed:'closed',cancelled:'closed',draft:'soon'})[t.status]||'soon',
    when:t.starts_at?new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(t.starts_at)):'Date to be announced',
    loc:t.region||'Location to be announced',fmt:`${String(t.format||'').replaceAll('_',' ').toUpperCase()} · ${/^BO\d+$/i.test(String(t.best_of||''))?String(t.best_of).toUpperCase():`BO${Number(t.best_of)||1}`}`,
    org:'Tournament organizer',desc:t.description||'The organizer has not added a description yet.',cover:coverUrls.get(t.cover_image_path)||''
  })));
}
function boot(fn){Auth.ready.then(async()=>{if(['index.html','tournaments.html'].includes(currentPage()))await loadPublicData();return fn()}).catch(e=>{console.error('Startup failed:',e);toast('err','Could not load the site',String(e?.message||e));});}
function requirePerm(perm){if(Auth.has(perm))return true;const role=ROLE_FOR_PERM[perm]||'PLAYER';const next=currentPage();location.replace('login.html?next='+encodeURIComponent(next)+'&need='+encodeURIComponent(role));return false;}

const TMODAL_HTML=`<div class="overlay" id="tmodal"><div class="modal cut"><div class="cut-in"><button class="iconbtn m-close" id="mClose" aria-label="Close"><i data-lucide="x"></i></button><img class="m-img" id="mImg" alt=""><div class="m-content"><div class="m-chips" id="mChips"></div><h2 id="mName"></h2><p id="mDesc"></p><div class="m-info"><div><small>Prize pool</small><b id="mPrize"></b></div><div><small>Teams</small><b id="mTeams"></b></div><div><small>Starts</small><b id="mDates"></b></div><div><small>Format</small><b id="mFmt"></b></div><div><small>Region</small><b id="mLoc"></b></div><div><small>Organizer</small><b id="mOrg"></b></div></div><label id="mTeamWrap" hidden style="display:block;margin:14px 0"><span>Choose your team</span><select id="mTeam"></select></label><div class="m-acts"><button class="btn btn-gold" id="mReg" type="button">Register a team</button><a class="btn btn-line" href="tournaments.html" id="mBracket">Open tournament page</a></div></div></div></div></div>`;
(function injectShell(){
  document.body.insertAdjacentHTML('beforeend',`<div id="toasts"></div>${TMODAL_HTML}`);
  const ticker=document.createElement('div');ticker.className='ticker';ticker.setAttribute('role','region');ticker.setAttribute('aria-label','TUNESF federation updates');
  const updates=['TEST 2026','LEAGUE OF LEGENDS ', 'REGISTRATION IS OPEN','MORE GAMES','BIGGER CASH PRIZE'];
  const tickerItems=updates.map(text=>`<span>${text}<i class="g">◆</i></span>`).join('');
  ticker.innerHTML=`<span class="ticker-label">${updates.join(' · ')}</span><div class="tk" aria-hidden="true">${tickerItems}${tickerItems}</div>`;
  $('#topbar')?.insertAdjacentElement('afterend',ticker);
  if(READ_ONLY_PREVIEW){const notice=document.createElement('div');notice.className='preview-notice';notice.setAttribute('role','status');notice.textContent='LOCAL PREVIEW · CONNECTED TO PRODUCTION · CHANGES ARE DISABLED';document.body.classList.add('preview-readonly');ticker.insertAdjacentElement('afterend',notice);}
  else if(SUPABASE_CONFIG.environment==='local'){const notice=document.createElement('div');notice.className='preview-notice';notice.setAttribute('role','status');notice.textContent='LOCAL TEST DATABASE · CHANGES ARE ISOLATED FROM PRODUCTION';ticker.insertAdjacentElement('afterend',notice);}
})();

function currentPage(){return(location.pathname.split('/').pop()||'index.html').toLowerCase();}
function buildNav(){
  $$('.js-logo').forEach(el=>{el.innerHTML=logoSvg(34);});
  $$('.js-logo-s').forEach(el=>{el.innerHTML=logoSvg(30);});
  const nl=$('#navLinks'),page=currentPage();
  if(nl){
    const links=[['index.html','Home'],['tournaments.html','Tournaments'],['clubs.html','Clubs'],['standings.html','Standings'],['roles.html','Roles']];
    let html=links.map(([href,label])=>`<a href="${href}"${page===href?' class="act"':''}>${label}</a>`).join('');
    const consoles=Auth.consoles();
    if(consoles.length===1)html+=`<a href="${consoles[0].href}">${consoles[0].label}</a>`;
    else if(consoles.length>1)html+=`<div class="nav-drop" id="navDrop"><button type="button" id="dropBtn">My workspace<i data-lucide="chevron-down"></i></button><div class="drop-menu">${consoles.map(c=>`<a href="${c.href}"><i data-lucide="${c.icon}"></i>${c.label}</a>`).join('')}</div></div>`;
    nl.innerHTML=html;$('#dropBtn')?.addEventListener('click',e=>{e.stopPropagation();$('#navDrop')?.classList.toggle('open');});
  }
  const cta=$('#navCta');if(cta){
    const role=ROLES[Auth.highestRole()];
    cta.innerHTML=`${Auth.is()?`<span class="who"><span class="rolechip ${role?.cls||''}">${esc(role?.label||'Member')}</span><span class="uname">${esc(Auth.user.name)}</span><button class="iconbtn" id="signOutBtn" title="Sign out"><i data-lucide="log-out"></i></button></span>`:'<a class="btn btn-line btn-sm" href="login.html">Sign in</a>'}<a class="btn btn-gold btn-sm" id="navCreate" href="${Auth.has('CREATE_TOURNAMENT')?'organize.html':'tournaments.html'}">${Auth.has('CREATE_TOURNAMENT')?'Create tournament':'Find a tournament'}</a><button class="iconbtn" id="burger" aria-label="Menu"><i data-lucide="menu"></i></button>`;
    $('#signOutBtn')?.addEventListener('click',()=>Auth.signOut());$('#burger')?.addEventListener('click',()=>$('#topbar')?.classList.toggle('nav-open'));
  }
  icons();
}
function buildConsoleStrip(){const el=$('#consoleStrip');if(!el)return;el.innerHTML=Auth.consoles().map(c=>`<a class="cchip${c.href===currentPage()?' act':''}" href="${c.href}"><i data-lucide="${c.icon}"></i>${esc(c.label)}</a>`).join('');icons();}

const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('on');observer.unobserve(entry.target);}}),{threshold:.12});
$$('.rv').forEach(el=>observer.observe(el));
addEventListener('scroll',()=>$('#topbar')?.classList.toggle('scrolled',scrollY>10),{passive:true});

function tCardHTML(t){
  const badge={live:'In progress',reg:'Registration open',soon:'Upcoming',closed:'Registration closed'}[t.status]||'Status unavailable';
  const filled=t.max?Math.min(100,Math.round(t.teams/t.max*100)):0;
  return `<article class="t-card" data-t="${esc(t.id)}"><div class="t-media">${t.cover?`<img class="t-cover" src="${esc(t.cover)}" alt="" loading="lazy" decoding="async">`:''}<div class="t-scrim"></div><div class="t-tags"><span class="chip">${esc(t.org)}</span><span class="badge ${t.status==='live'?'live':t.status==='reg'?'reg':''}">${badge}</span></div><span class="t-game">${esc(GAMES[t.game]?.label||t.game||'Game to be announced')}</span></div><div class="t-body"><div class="t-top"><span>${esc(t.loc)}</span><span>${esc(t.when)}</span></div><h3>${esc(t.name)}</h3><p class="t-desc">${esc(t.desc)}</p><div class="t-meta"><span><i data-lucide="users"></i>${t.teams} teams</span><span>${esc(t.fmt)}</span></div><div class="t-slots"><span>${t.max?`${t.teams}/${t.max} team slots`: 'Capacity to be announced'}</span><div class="slotbar"><i style="width:${filled}%"></i></div></div><div class="t-foot"><div class="t-prize"><small>Prize pool</small><b>${fmt(t.prize)} <small>${esc(t.currency)}</small></b></div><a class="btn btn-line btn-sm" data-tournament-detail href="tournament.html?id=${encodeURIComponent(t.id)}">Details</a></div></div></article>`;
}
function openT(t){if(!t)return;$('#mImg').hidden=!t.cover;if(t.cover)$('#mImg').src=t.cover;$('#mChips').innerHTML=`<span class="chip">${esc(GAMES[t.game]?.label||t.game||'Game not set')}</span><span class="chip">${esc(t.fmt)}</span>`;$('#mName').textContent=t.name;$('#mDesc').textContent=t.desc;$('#mPrize').textContent=`${fmt(t.prize)} ${t.currency}`;$('#mTeams').textContent=t.max?`${t.teams} / ${t.max}`:String(t.teams);$('#mDates').textContent=t.when;$('#mFmt').textContent=t.fmt;$('#mLoc').textContent=t.loc;$('#mOrg').textContent=t.org;$('#mBracket').href=`tournament.html?id=${encodeURIComponent(t.id)}#eventBrackets`;$('#mBracket').textContent='Open tournament page';$('#mTeamWrap').hidden=true;$('#mReg').hidden=t.status!=='reg';$('#mReg').disabled=false;let teamsLoaded=false;$('#tmodal').classList.add('open');document.body.classList.add('locked');
  $('#mReg').onclick=async()=>{
    const button=$('#mReg');if(!Auth.is()){location.href='login.html?next='+encodeURIComponent('tournaments.html')+'&need=PLAYER';return;}
    button.disabled=true;
    try{
      if(!teamsLoaded){
        const {data:membershipRows,error:memberError}=await SUPA.client.from('team_members').select('team_id').eq('user_id',Auth.user.id).eq('role','captain').eq('status','active');
        if(memberError)throw memberError;
        const ids=[...new Set((membershipRows||[]).map(row=>row.team_id))];
        if(!ids.length){toast('info','Captain of a team required','Create a team or join one as captain before registering.');location.href='captain.html';return;}
        const {data:rows,error:teamError}=await SUPA.client.from('teams').select('id,name,tag,game').in('id',ids);
        if(teamError)throw teamError;
        const matching=(rows||[]).filter(team=>team.game===t.game);
        if(!matching.length){toast('err','No eligible team','Your captain teams must use the same game as this tournament.');return;}
        $('#mTeam').innerHTML=matching.map(team=>`<option value="${esc(team.id)}">${esc(team.name)} (${esc(team.tag)})</option>`).join('');
        $('#mTeamWrap').hidden=false;teamsLoaded=true;
      }
      const {error}=await SUPA.client.rpc('register_team',{p_tournament_id:t.id,p_team_id:$('#mTeam').value});
      if(error)throw error;
      button.textContent='Registration submitted';toast('ok','Team submitted','The tournament organizer will review this registration.');
    }catch(error){toast('err','Could not register team',error.message||'Please try again.');}
    finally{button.disabled=false;}
  };
}
function closeModal(){$('#tmodal')?.classList.remove('open');document.body.classList.remove('locked');}
document.addEventListener('click',e=>{if(e.target.closest('[data-tournament-detail]'))return;const card=e.target.closest('.t-card[data-t]');if(card){openT(TOURN.find(t=>String(t.id)===card.dataset.t));return;}if(e.target.closest('#mClose')||e.target.id==='tmodal')closeModal();});
addEventListener('keydown',e=>{if(e.key==='Escape')closeModal();});

Auth.ready.then(()=>{buildNav();buildConsoleStrip();icons();}).catch(e=>{console.error('Authentication initialization failed:',e);buildNav();icons();});
