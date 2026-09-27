/* TUNESF shared application shell. Tournament data and authorization come from Supabase. */
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>Math.round(Number(n)||0).toLocaleString('en-US');
const icons=()=>{try{window.lucide&&lucide.createIcons()}catch{}};
function logoSvg(size=34){return `<img src="/assets/tunesf-mark.png" width="${size}" height="${size}" alt="TUNESF" style="object-fit:contain">`;}

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
  lol:{label:'League of Legends',icon:'swords',maps:[]},rl:{label:'Rocket League',icon:'car',maps:[]},mlbb:{label:'Mobile Legends: Bang Bang',icon:'gamepad-2',maps:[]},eafc:{label:'EA SPORTS FC',icon:'goal',maps:[]},efootball:{label:'eFootball',icon:'goal',maps:[]}
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
let DEMO_MODE=false;
const LOCAL_ORIGIN=location.protocol==='file:'||['localhost','127.0.0.1'].includes(location.hostname);
const READ_ONLY_PREVIEW=SUPABASE_CONFIG.environment==='production'&&LOCAL_ORIGIN;
const READ_ONLY_RPCS=new Set(['get_my_roles','get_my_permissions','get_my_team_matches','get_match_room','get_match_readiness','list_my_tournament_operations','list_tournament_referees','list_team_roster','list_team_invitations','list_public_clubs','list_public_team_rosters','list_public_tournament_registrations','list_tournament_referee_names','list_public_player_achievements','get_team_captain_inbox','list_organizations_for_current_user','list_organization_staff','list_organization_player_accounts','get_public_player_profile','get_public_team_profile','get_admin_analytics','list_tournament_registration_history']);
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
      SUPA.client.from('profiles').select('player_name,username,game,region,discord_username,avatar_path').eq('id',id).maybeSingle(),
      SUPA.client.rpc('get_my_roles'),SUPA.client.rpc('get_my_permissions')
    ]);
    if(profile.error)throw profile.error;if(assigned.error)throw assigned.error;if(permissionRows.error)throw permissionRows.error;
    const roleKeys=(assigned.data||[]).map(r=>r.role_key).filter(key=>ROLES[key]);
    if(!roleKeys.length)throw new Error('This account has no active TUNESF role.');
    roleKeys.sort((a,b)=>(ROLES[b]?.level||0)-(ROLES[a]?.level||0));
    this.permissions=new Set(permissionRows.data||[]);
    this.user={id,email:session.user.email,name:profile.data?.username||profile.data?.player_name||session.user.email,game:profile.data?.game||null,discordUsername:profile.data?.discord_username||null,avatarPath:profile.data?.avatar_path||null,roles:roleKeys};
  },
  async signInPassword(email,password){const {data,error}=await SUPA.client.auth.signInWithPassword({email,password});if(error)throw error;await this._loadUser(data.session);return this.user;},
  async signUp(username,email,password,discordUsername){return SUPA.client.auth.signUp({email,password,options:{data:{username,player_name:username,discord_username:discordUsername,game:'Not selected'},emailRedirectTo:location.origin}});}
};

function publicMediaUrl(path){
  if(!path||!SUPA.client)return '';
  return SUPA.client.storage.from('public-media').getPublicUrl(path).data.publicUrl;
}
function identityImage(path,label,size=36,kind='team'){
  const initials=String(label||'?').trim().split(/\s+/).slice(0,2).map(part=>part[0]||'').join('').replace(/[^a-z0-9]/gi,'').toUpperCase()||'?';
  const cls=kind==='player'?'player-avatar':'team-logo';
  const side=Math.max(16,Math.min(160,Number(size)||36)),style=`--identity-size:${side}px;width:${side}px;height:${side}px`;
  return path?`<img class="identity-image ${cls}" style="${style}" src="${esc(publicMediaUrl(path))}" width="${side}" height="${side}" alt="${esc(label||kind)} ${kind==='player'?'profile picture':'logo'}" loading="lazy" decoding="async" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'identity-fallback ${cls}',textContent:'${esc(initials)}',style:'${style}'}))">`:`<span class="identity-fallback ${cls}" style="${style}" role="img" aria-label="${esc(label||kind)}">${esc(initials)}</span>`;
}
async function uploadPublicImage(file,folder){
  if(!file)throw new Error('Choose an image to upload.');
  if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('Choose a JPG, PNG, or WebP image.');
  if(file.size>5*1024*1024)throw new Error('Images must be 5 MB or smaller.');
  if(!Auth.user?.id)throw new Error('Sign in before uploading an image.');
  const ext={ 'image/jpeg':'jpg','image/png':'png','image/webp':'webp' }[file.type];
  const name=crypto.randomUUID().replaceAll('-','')+'.'+ext;
  const path=`${folder}/${Auth.user.id}/${name}`;
  const {error}=await SUPA.client.storage.from('public-media').upload(path,file,{contentType:file.type,cacheControl:'31536000',upsert:false});
  if(error)throw error;
  return path;
}
async function removePublicImage(path){
  if(!path||!SUPA.client)return;
  const {error}=await SUPA.client.storage.from('public-media').remove([path]);
  if(error)console.warn('Old profile or team image could not be removed:',error.message);
}
Auth.ready=Auth.init().catch(error=>{
  console.warn('TUNESF backend unavailable; using public demo mode:',error.message||error);
  DEMO_MODE=true;
  const roles=[['VISITOR','Visitor',0,'eye'],['PLAYER','Player',1,'user'],['CAPTAIN','Captain',2,'users'],['REFEREE','Referee',3,'gavel'],['TOURNAMENT_ADMIN','Tournament Admin',4,'trophy'],['ORGANIZATION_OWNER','Organization Owner',5,'landmark'],['MODERATOR','Moderator',6,'flag'],['PLATFORM_ADMIN','Platform Admin',7,'shield'],['SUPER_ADMIN','Super Admin',8,'shield-check']];
  roles.forEach(([key,label,level,icon])=>{ROLE_ORDER.push(key);ROLES[key]={label,level,icon,cls:`r-${String(key).toLowerCase().replaceAll('_','-')}`,perms:[]};LANDING[key]='index.html';});
  loadDemoData();
});

function loadDemoData(){
  const date=(days,hour=19)=>{const d=new Date();d.setDate(d.getDate()+days);d.setHours(hour,0,0,0);return d.toISOString();};
  const sample=[
    {id:'demo-valorant-open',name:'TUNESF National VALORANT Open',game:'val',prize:1200,currency:'TND',teams:18,max:32,startsAt:date(9),status:'reg',loc:'Tunis, Tunisia',fmt:'SINGLE ELIMINATION · BO3',org:'TUNESF',desc:'Tunisia’s top VALORANT teams clash for the national title. Assemble your roster and claim a place on the stage.',cover:'https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&w=1200&q=85'},
    {id:'demo-cs2-cup',name:'Carrefour CS2 Champions Cup',game:'cs2',prize:850,currency:'TND',teams:11,max:16,startsAt:date(16),status:'reg',loc:'Sousse, Tunisia',fmt:'DOUBLE ELIMINATION · BO3',org:'TUNESF',desc:'A high stakes Counter-Strike showdown featuring the country’s rising competitive squads.',cover:'https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&w=1200&q=85'},
    {id:'demo-rl-series',name:'Tunisian Rocket League Series',game:'rl',prize:500,currency:'TND',teams:21,max:32,startsAt:date(24),status:'reg',loc:'Online · Tunisia',fmt:'SWISS · BO5',org:'TUNESF',desc:'Fast rotations, aerial plays and a path to the Tunisian Rocket League podium.',cover:'https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&w=1200&q=85'}
  ];
  TOURN.splice(0,TOURN.length,...sample.map(t=>({...t,statusKey:'registration_open',when:new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(t.startsAt))})));
}
const demoMatches=[
  {tournament:'TUNESF National VALORANT Open',home:'Carthage Phoenix',away:'Sahara Wolves',homeScore:13,awayScore:9,status:'completed',round:'Grand Final',game:'val'},
  {tournament:'Carrefour CS2 Champions Cup',home:'Atlas Gaming',away:'Red Dunes',homeScore:0,awayScore:0,status:'scheduled',round:'Semi Final',game:'cs2'},
  {tournament:'Tunisian Rocket League Series',home:'Blue Medina',away:'Oasis FC',homeScore:0,awayScore:0,status:'scheduled',round:'Round 1',game:'rl'}
];
function renderDemoData(){
  const page=currentPage();
  if(page==='standings.html'){
    const target=$('#stBody');
    if(target)target.innerHTML=`<tr><td>1</td><td>Carthage Phoenix</td><td>12</td><td>2</td><td>+24</td><td>36</td><td><span class="chip gold">QUALIFIED</span></td></tr><tr><td>2</td><td>Atlas Gaming</td><td>10</td><td>4</td><td>+18</td><td>30</td><td><span class="chip green">ACTIVE</span></td></tr><tr><td>3</td><td>Sahara Wolves</td><td>9</td><td>5</td><td>+11</td><td>27</td><td><span class="chip green">ACTIVE</span></td></tr><tr><td>4</td><td>Blue Medina</td><td>8</td><td>6</td><td>+7</td><td>24</td><td><span class="chip">ACTIVE</span></td></tr>`;
  }
  if(page==='bracket.html'){
    const canvas=$('#bcanvas');
    if(canvas)canvas.innerHTML=`<div class="demo-bracket"><article><h3>QUARTER FINALS</h3><p>Atlas Gaming <b>2</b></p><p>Carthage Knights <b>0</b></p><p>Sahara Wolves <b>2</b></p><p>Desert Foxes <b>1</b></p></article><article><h3>SEMI FINALS</h3><p>Atlas Gaming <b>1</b></p><p>Sahara Wolves <b>2</b></p></article><article><h3>GRAND FINAL · COMPLETE</h3><p>Carthage Phoenix <b>2</b></p><p>Sahara Wolves <b>1</b></p><span class="chip gold">CHAMPIONS · CARTHAGE PHOENIX</span></article></div>`;
  }
}

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
  const now=Date.now();
  TOURN.splice(0,TOURN.length,...rows.map(t=>{
    const effectiveStatus=t.status==='registration_open'&&t.registration_opens_at&&new Date(t.registration_opens_at).getTime()>now?'registration_scheduled'
      :t.status==='registration_open'&&(t.registration_closes_at||t.starts_at)&&new Date(t.registration_closes_at||t.starts_at).getTime()<=now?'registration_closed':t.status;
    return ({
    id:t.id,name:t.name,game:t.game,prize:Number(t.prize_pool)||0,currency:t.currency||'TND',teams:Number(t.registered_teams)||0,max:Number(t.max_teams)||0,
    startsAt:t.starts_at||null,statusKey:effectiveStatus,
    status:({registration_open:'reg',registration_scheduled:'soon',registration_closed:'closed',in_progress:'live',completed:'closed',cancelled:'closed',draft:'soon'})[effectiveStatus]||'soon',
    when:t.starts_at?new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(t.starts_at)):'Date to be announced',
    loc:t.region||'Location to be announced',fmt:`${String(t.format||'').replaceAll('_',' ').toUpperCase()} · ${/^BO\d+$/i.test(String(t.best_of||''))?String(t.best_of).toUpperCase():`BO${Number(t.best_of)||1}`}`,
    org:'Tournament organizer',desc:t.description||'The organizer has not added a description yet.',cover:coverUrls.get(t.cover_image_path)||''
  });}));
}
function boot(fn){Auth.ready.then(async()=>{if(!DEMO_MODE&&['index.html','tournaments.html'].includes(currentPage()))await loadPublicData();if(DEMO_MODE)renderDemoData();return fn()}).catch(e=>{console.error('Startup failed:',e);toast('err','Could not load the site',String(e?.message||e));});}
function requirePerm(perm){if(Auth.has(perm))return true;const role=ROLE_FOR_PERM[perm]||'PLAYER';const next=currentPage();location.replace('login.html?next='+encodeURIComponent(next)+'&need='+encodeURIComponent(role));return false;}

const TMODAL_HTML=`<div class="overlay" id="tmodal"><div class="modal cut"><div class="cut-in"><button class="iconbtn m-close" id="mClose" aria-label="Close"><i data-lucide="x"></i></button><img class="m-img" id="mImg" alt=""><div class="m-content"><div class="m-chips" id="mChips"></div><h2 id="mName"></h2><p id="mDesc"></p><div class="m-info"><div><small>Prize pool</small><b id="mPrize"></b></div><div><small>Approved teams</small><b id="mTeams"></b></div><div><small>Starts</small><b id="mDates"></b></div><div><small>Format</small><b id="mFmt"></b></div><div><small>Region</small><b id="mLoc"></b></div><div><small>Organizer</small><b id="mOrg"></b></div></div><label id="mTeamWrap" hidden style="display:block;margin:14px 0"><span>Choose your team</span><select id="mTeam"></select></label><p class="preview-write-note m-reg-readonly" id="mRegReadonly" role="note" hidden>Team registration is disabled in this local preview because it is connected to production data. Open a writable staging site to submit a team entry.</p><div class="m-acts"><button class="btn btn-gold" id="mReg" type="button">Register a team</button><a class="btn btn-line" href="tournaments.html" id="mBracket">Open tournament page</a></div></div></div></div></div>`;
(function injectShell(){
  document.body.insertAdjacentHTML('beforeend',`<div id="toasts"></div>${TMODAL_HTML}`);
  const ticker=document.createElement('div');ticker.className='ticker';ticker.setAttribute('role','region');ticker.setAttribute('aria-label','TUNESF federation updates');
  const updates=['TEST 2026','LEAGUE OF LEGENDS ', 'REGISTRATION IS OPEN','MORE GAMES','BIGGER CASH PRIZE'];
  const tickerItems=updates.map(text=>`<span>${text}<i class="g">◆</i></span>`).join('');
  ticker.innerHTML=`<span class="ticker-label">${updates.join(' · ')}</span><div class="tk" aria-hidden="true"><div class="tk-group">${tickerItems}</div><div class="tk-group">${tickerItems}</div></div>`;
  $('#topbar')?.insertAdjacentElement('afterend',ticker);
  if(DEMO_MODE){const notice=document.createElement('div');notice.className='preview-notice';notice.setAttribute('role','status');notice.textContent='DEMO MODE · SAMPLE TOURNAMENTS · ACCOUNT ACTIONS UNAVAILABLE';document.body.classList.add('preview-readonly');ticker.insertAdjacentElement('afterend',notice);}
  else if(READ_ONLY_PREVIEW){const notice=document.createElement('div');notice.className='preview-notice';notice.setAttribute('role','status');notice.textContent='LOCAL PREVIEW · CONNECTED TO PRODUCTION · CHANGES ARE DISABLED';document.body.classList.add('preview-readonly');ticker.insertAdjacentElement('afterend',notice);}
  else if(SUPABASE_CONFIG.environment==='local'){const notice=document.createElement('div');notice.className='preview-notice';notice.setAttribute('role','status');notice.textContent='LOCAL TEST DATABASE · CHANGES ARE ISOLATED FROM PRODUCTION';ticker.insertAdjacentElement('afterend',notice);}
})();

function currentPage(){const page=location.pathname.split('/').filter(Boolean).pop()||'index';const normalized=page.toLowerCase();return normalized.endsWith('.html')?normalized:`${normalized}.html`;}
function buildNav(){
  $$('.js-logo').forEach(el=>{el.innerHTML=logoSvg(34);});
  $$('.js-logo-s').forEach(el=>{el.innerHTML=logoSvg(30);});
  const nl=$('#navLinks'),page=currentPage();
  if(nl){
    const links=[['index.html','Home'],['tournaments.html','Tournaments'],['clubs.html','Clubs'],['standings.html','Standings'],['roles.html','Roles']];
    let html=links.map(([href,label])=>`<a href="${href}"${page===href?' class="act" aria-current="page"':''}>${label}</a>`).join('');
    const consoles=Auth.consoles();
    if(consoles.length===1)html+=`<a href="${consoles[0].href}">${consoles[0].label}</a>`;
    else if(consoles.length>1)html+=`<div class="nav-drop" id="navDrop"><button type="button" id="dropBtn">My workspace<i data-lucide="chevron-down"></i></button><div class="drop-menu">${consoles.map(c=>`<a href="${c.href}"><i data-lucide="${c.icon}"></i>${c.label}</a>`).join('')}</div></div>`;
    const mobileActions=[...(!Auth.is()?[{href:'login.html',label:'Sign in',className:'mobile-nav-secondary'}]:[]),{href:Auth.has('CREATE_TOURNAMENT')?'organize.html':'tournaments.html',label:Auth.has('CREATE_TOURNAMENT')?'Create tournament':'Find a tournament',className:'mobile-nav-primary'}];
    html+=`<div class="mobile-nav-actions">${mobileActions.map(action=>`<a class="${action.className}" href="${action.href}">${action.label}<i data-lucide="arrow-up-right" aria-hidden="true"></i></a>`).join('')}</div>`;
    nl.innerHTML=html;$('#dropBtn')?.addEventListener('click',e=>{e.stopPropagation();$('#navDrop')?.classList.toggle('open');});
  }
  if(Auth.is()){
    const role=Auth.highestRole(),workspace=role==='TOURNAMENT_ADMIN'&&!Auth.has('CREATE_TOURNAMENT')?'event-admin.html':LANDING[role]||'dashboard.html';
    $$("footer a[href=\"login.html\"]").forEach(link=>{link.href=workspace;link.textContent='My workspace';link.setAttribute('aria-label','Open your TUNESF workspace');});
  }
  const cta=$('#navCta');if(cta){
    const role=ROLES[Auth.highestRole()];
    cta.innerHTML=`${Auth.is()?`<span class="who"><span class="rolechip ${role?.cls||''}">${esc(role?.label||'Member')}</span><span class="uname">${esc(Auth.user.name)}</span><button class="iconbtn" id="signOutBtn" title="Sign out"><i data-lucide="log-out"></i></button></span><button class="iconbtn notification-toggle" id="notificationToggle" type="button" aria-label="Notifications"><i data-lucide="bell"></i><span id="notificationUnread" class="notification-unread" hidden></span></button>`:'<a class="btn btn-line btn-sm" href="login.html">Sign in</a>'}<a class="btn btn-gold btn-sm" id="navCreate" href="${Auth.has('CREATE_TOURNAMENT')?'organize.html':'tournaments.html'}">${Auth.has('CREATE_TOURNAMENT')?'Create tournament':'Find a tournament'}</a><button class="iconbtn" id="burger" aria-label="Open navigation menu" aria-controls="navLinks" aria-expanded="false"><i data-lucide="menu"></i></button>`;
    $('#signOutBtn')?.addEventListener('click',()=>Auth.signOut());$('#burger')?.addEventListener('click',()=>{const open=$('#topbar')?.classList.toggle('nav-open');$('#burger')?.setAttribute('aria-expanded',String(!!open));$('#burger')?.setAttribute('aria-label',open?'Close navigation menu':'Open navigation menu');});
    $('#navLinks')?.addEventListener('click',event=>{if(event.target.closest('a')){$('#topbar')?.classList.remove('nav-open');$('#burger')?.setAttribute('aria-expanded','false');$('#burger')?.setAttribute('aria-label','Open navigation menu');}});
    document.addEventListener('click',event=>{if(!event.target.closest('#topbar')&&$('#topbar')?.classList.contains('nav-open')){$('#topbar').classList.remove('nav-open');$('#burger')?.setAttribute('aria-expanded','false');$('#burger')?.setAttribute('aria-label','Open navigation menu');}});
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&$('#topbar')?.classList.contains('nav-open')){$('#topbar').classList.remove('nav-open');$('#burger')?.setAttribute('aria-expanded','false');$('#burger')?.setAttribute('aria-label','Open navigation menu');$('#burger')?.focus();}});
    $('#notificationToggle')?.addEventListener('click',()=>toggleNotifications());
  }
  icons();
}
const notificationHref=n=>n.entity_type==='match'?`match-room.html?id=${encodeURIComponent(n.entity_id||'')}`:n.entity_type==='tournament'?`tournament.html?id=${encodeURIComponent(n.entity_id||'')}`:n.entity_type==='team'?'clubs.html':'dashboard.html';
function ensureNotificationPanel(){
  if($('#notificationPanel'))return;
  document.body.insertAdjacentHTML('beforeend',`<section class="notification-panel" id="notificationPanel" aria-label="Notifications" aria-live="polite" hidden><div class="notification-panel-head"><div><b>Notifications</b><small id="notificationPanelStatus">Recent account and tournament updates</small></div><button class="btn btn-line btn-sm" id="notificationMarkAll" type="button">Mark all read</button></div><div class="notification-list" id="notificationList"><p class="team-empty">Sign in to see your notifications.</p></div></section>`);
  $('#notificationMarkAll')?.addEventListener('click',markAllNotificationsRead);
  $('#notificationList')?.addEventListener('click',async event=>{
    const button=event.target.closest('[data-notification-read]');if(!button)return;
    button.disabled=true;try{await markNotificationRead(button.dataset.notificationRead);await refreshNotifications();}catch(error){toast('err','Could not update notification',error.message||'Please try again.');button.disabled=false;}
  });
  document.addEventListener('click',event=>{if(!event.target.closest('#notificationPanel,#notificationToggle'))$('#notificationPanel')?.setAttribute('hidden','');});
}
function toggleNotifications(){
  ensureNotificationPanel();const panel=$('#notificationPanel');
  if(panel.hidden){panel.removeAttribute('hidden');void refreshNotifications();}else panel.setAttribute('hidden','');
}
async function markNotificationRead(id){
  const {error}=await SUPA.client.from('notifications').update({read_at:new Date().toISOString()}).eq('id',id).is('read_at',null);
  if(error)throw error;
}
async function markAllNotificationsRead(){
  const button=$('#notificationMarkAll');if(button)button.disabled=true;
  try{
    const {error}=await SUPA.client.from('notifications').update({read_at:new Date().toISOString()}).is('read_at',null);
    if(error)throw error;await refreshNotifications();
  }catch(error){toast('err','Could not update notifications',error.message||'Please try again.');}
  finally{if(button)button.disabled=false;}
}
async function refreshNotifications(){
  if(!Auth.is()||!SUPA.client)return;
  ensureNotificationPanel();
  const [listResult,countResult]=await Promise.all([
    SUPA.client.from('notifications').select('id,title,message,type,entity_type,entity_id,read_at,created_at').order('created_at',{ascending:false}).limit(50),
    SUPA.client.from('notifications').select('id',{count:'exact',head:true}).is('read_at',null)
  ]);
  if(listResult.error)throw listResult.error;if(countResult.error)throw countResult.error;
  const count=countResult.count||0,badge=$('#notificationUnread'),list=$('#notificationList'),status=$('#notificationPanelStatus');
  if(badge){badge.hidden=count===0;badge.textContent=count>99?'99+':String(count);$('#notificationToggle')?.setAttribute('aria-label',count?`Notifications, ${count} unread`:'Notifications');}
  if(status)status.textContent=count?`${fmt(count)} unread · latest 50 shown`:'You are all caught up';
  if(list)list.innerHTML=listResult.data?.length?listResult.data.map(n=>`<article class="notification-item${n.read_at?'':' unread'}"><a href="${notificationHref(n)}" data-notification-open="${esc(n.id)}"><b>${esc(n.title)}</b><span>${esc(n.message)}</span><small>${esc(new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(n.created_at)))}</small></a>${n.read_at?'':'<button class="notification-read" type="button" data-notification-read="'+esc(n.id)+'" aria-label="Mark as read">Mark read</button>'}</article>`).join(''):'<p class="team-empty">No notifications yet. Tournament and match updates will appear here.</p>';
}
function buildConsoleStrip(){const el=$('#consoleStrip');if(!el)return;const consoles=Auth.consoles(),active=consoles.find(c=>c.href===currentPage());el.setAttribute('aria-label','Your authorized workspaces');el.innerHTML=`<div class="console-strip-head"><span class="console-strip-title">Your workspaces</span><span class="console-strip-current">${active?`Current: <b>${esc(active.label)}</b>`:'Choose a workspace'}</span><span class="console-strip-hint">Scroll to explore <i data-lucide="arrow-right"></i></span></div><nav class="console-strip-links" aria-label="Workspace links">${consoles.map(c=>`<a class="cchip${c.href===currentPage()?' act':''}" href="${c.href}" title="Open ${esc(c.label)} workspace"${c.href===currentPage()?' aria-current="page"':''}><i data-lucide="${c.icon}"></i><span>${esc(c.label)}</span>${c.href===currentPage()?'<i class="console-active-mark" data-lucide="check"></i>':''}</a>`).join('')}</nav>`;icons();}

if('IntersectionObserver'in window){
  const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('on');observer.unobserve(entry.target);}}),{threshold:.12});
  $$('.rv').forEach(el=>observer.observe(el));
}else $$('.rv').forEach(el=>el.classList.add('on'));
addEventListener('scroll',()=>$('#topbar')?.classList.toggle('scrolled',scrollY>10),{passive:true});

function tCardHTML(t){
  const badge={live:'In progress',reg:'Registration open',soon:'Upcoming',closed:'Registration closed'}[t.status]||'Status unavailable';
  const filled=t.max?Math.min(100,Math.round(t.teams/t.max*100)):0;
  const progress=t.max?`role="progressbar" aria-label="Approved team slots filled" aria-valuemin="0" aria-valuemax="${t.max}" aria-valuenow="${Math.min(t.teams,t.max)}"`:'aria-hidden="true"';
  return `<article class="t-card" data-t="${esc(t.id)}"><div class="t-media ${t.cover?'has-cover':'no-cover'}" data-game="${esc(t.game||'')}">${t.cover?`<img class="t-cover" src="${esc(t.cover)}" alt="" loading="lazy" decoding="async">`:''}<div class="t-scrim"></div><div class="t-tags"><span class="chip">${esc(t.org)}</span><span class="badge ${t.status==='live'?'live':t.status==='reg'?'reg':''}">${badge}</span></div><span class="t-game">${esc(GAMES[t.game]?.label||t.game||'Game to be announced')}</span></div><div class="t-body"><div class="t-top"><span>${esc(t.loc)}</span><span>${esc(t.when)}</span></div><h3>${esc(t.name)}</h3><p class="t-desc">${esc(t.desc)}</p><div class="t-meta"><span>${esc(t.fmt)}</span></div><div class="t-slots"><span>${t.max?`${t.teams} approved of ${t.max} slots`: 'Capacity to be announced'}</span><div class="slotbar" ${progress}><i style="width:${filled}%"></i></div></div><div class="t-foot"><div class="t-prize"><small>Prize pool</small><b>${fmt(t.prize)} <small>${esc(t.currency)}</small></b></div><a class="btn btn-line btn-sm" data-tournament-detail href="tournament.html?id=${encodeURIComponent(t.id)}">Details</a></div></div></article>`;
}
function openT(t){if(!t)return;$('#mImg').hidden=!t.cover;if(t.cover)$('#mImg').src=t.cover;$('#mChips').innerHTML=`<span class="chip">${esc(GAMES[t.game]?.label||t.game||'Game not set')}</span><span class="chip">${esc(t.fmt)}</span>`;$('#mName').textContent=t.name;$('#mDesc').textContent=t.desc;$('#mPrize').textContent=`${fmt(t.prize)} ${t.currency}`;$('#mTeams').textContent=t.max?`${t.teams} / ${t.max}`:String(t.teams);$('#mDates').textContent=t.when;$('#mFmt').textContent=t.fmt;$('#mLoc').textContent=t.loc;$('#mOrg').textContent=t.org;$('#mBracket').href=`tournament.html?id=${encodeURIComponent(t.id)}#eventBrackets`;$('#mBracket').textContent='Open tournament page';$('#mTeamWrap').hidden=true;const registerButton=$('#mReg'),registerNote=$('#mRegReadonly');registerButton.hidden=t.status!=='reg';registerNote.hidden=t.status!=='reg'||!READ_ONLY_PREVIEW;registerButton.disabled=t.status==='reg'&&READ_ONLY_PREVIEW;if(registerButton.disabled){registerButton.setAttribute('aria-describedby','mRegReadonly');registerButton.title='Team registration is disabled in this production-connected preview.';}else{registerButton.removeAttribute('aria-describedby');registerButton.removeAttribute('title');}let teamsLoaded=false;$('#tmodal').classList.add('open');document.body.classList.add('locked');
  $('#mReg').onclick=async()=>{
    const button=$('#mReg');if(READ_ONLY_PREVIEW)return;if(!Auth.is()){location.href='login.html?next='+encodeURIComponent('tournaments.html')+'&need=PLAYER';return;}
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

Auth.ready.then(()=>{buildNav();buildConsoleStrip();const whoName=$('#whoName');if(whoName)whoName.textContent=Auth.user?.name||'Sign in required';if(Auth.is()){ensureNotificationPanel();refreshNotifications().catch(error=>console.warn('Notifications unavailable:',error));setInterval(()=>{if(!document.hidden)refreshNotifications().catch(error=>console.warn('Notification refresh failed:',error));},30000);}icons();}).catch(e=>{console.error('Authentication initialization failed:',e);const whoName=$('#whoName');if(whoName)whoName.textContent='Account unavailable';buildNav();icons();});
