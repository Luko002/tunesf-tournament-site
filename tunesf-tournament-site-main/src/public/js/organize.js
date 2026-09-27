/* =============================================================
   TUNESF — organizer engine (guarded: CREATE_TOURNAMENT)
   Publishing saves the tournament in Supabase and lands on tournaments.html
   ============================================================= */
boot(()=>{
if(!requirePerm('CREATE_TOURNAMENT'))return;

const WSTEPS=['IDENTITY & GAME','FORMAT & RULES','SCHEDULE & ROSTER','EVENT DETAILS','REVIEW & PUBLISH'];
let wI=0; const WSEL={game:null,struct:'single',series:'BO3'};
const isSuperAdmin=Auth.user?.roles?.includes('SUPER_ADMIN')===true;

async function loadOrganizations(){
  const wrap=$('#wOrganizationWrap'),select=$('#wOrganization');
  try{
    const {data,error}=await SUPA.client.rpc('list_organizations_for_current_user',{p_capability:'create_tournaments'});
    if(error)throw error;
    select.innerHTML='<option value="">Personal tournament</option>'+(data||[]).map(o=>`<option value="${esc(o.id)}">${esc(o.name)}</option>`).join('');
    wrap.hidden=false;
  }catch(error){console.error('Could not load hosting organizations:',error);}
}
loadOrganizations();

$('#wRail').innerHTML=WSTEPS.map((t,i)=>`<div class="wstep" data-i="${i}"><i>${i+1}</i><b>${t}</b></div>`).join('');
$('#wGames').innerHTML=[['cs2','crosshair'],['val','zap'],['lol','swords'],['rl','car'],['mlbb','gamepad-2'],['eafc','goal'],['efootball','goal']]
  .map(([g,ic])=>`<button class="gtile" data-g="${g}"><i data-lucide="${ic}"></i>${GAMES[g].label}</button>`).join('');
function renderMaps(){
  const maps=GAMES[WSEL.game||'cs2'].maps||[];
  $('#wMaps').innerHTML=maps.length?maps.map((m,i)=>`<button data-m="${m}"${i<5?' class="act"':''}>${m}</button>`).join(''):'<span class="mono" style="color:var(--faint)">No map pool for this game.</span>';
  $$('#wMaps button').forEach(b=>b.onclick=()=>b.classList.toggle('act'));
}
$$('#wGames .gtile').forEach(b=>b.onclick=()=>{$$('#wGames .gtile').forEach(x=>x.classList.remove('act'));b.classList.add('act');WSEL.game=b.dataset.g;renderMaps();});
function expectedPlayoffByes(qualifiers){let size=1;while(size<qualifiers)size*=2;return size-qualifiers;}
function syncQualifierSetting(){const setting=$('#wQualifierWrap');if(setting)setting.hidden=!isSuperAdmin||WSEL.struct!=='rr';const qualifiers=Math.max(2,Math.min(64,Number($('#wPlayoffQualifiers')?.value)||4)),byes=expectedPlayoffByes(qualifiers),byeInput=$('#wPlayoffByes');if(byeInput){byeInput.value=String(byes);byeInput.min=String(byes);byeInput.max=String(byes);}const hint=$('#wPlayoffByeHint');if(hint)hint.textContent=`A ${qualifiers}-team single-elimination bracket needs ${byes} first-round bye${byes===1?'':'s'} for its highest seeds.`;}
$$('#wStruct button').forEach(b=>b.onclick=()=>{$$('#wStruct button').forEach(x=>x.classList.remove('act'));b.classList.add('act');WSEL.struct=b.dataset.v;syncQualifierSetting();});
$$('#wSeries button').forEach(b=>b.onclick=()=>{$$('#wSeries button').forEach(x=>x.classList.remove('act'));b.classList.add('act');WSEL.series=b.dataset.v;});
renderMaps();
syncQualifierSetting();
$('#wPlayoffQualifiers')?.addEventListener('input',syncQualifierSetting);
$('#wAc').onclick=()=>$('#wAc').classList.toggle('act');
const localDateTimeInput=value=>{const d=new Date(value);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);};
const defaultStart=new Date(Date.now()+21*864e5);defaultStart.setHours(18,0,0,0);
$('#wDate').value=localDateTimeInput(defaultStart);$('#wDate').min=localDateTimeInput(new Date(Date.now()+60000));
$('#wRegistrationOpens').value=localDateTimeInput(new Date(Date.now()+60000));
const defaultRegistrationClose=new Date(defaultStart.getTime()-60*60000);
$('#wRegistrationCloses').value=localDateTimeInput(defaultRegistrationClose);$('#wRegistrationCloses').min=$('#wRegistrationOpens').value;
$('#wRegistrationOpens').addEventListener('change',()=>{$('#wRegistrationCloses').min=$('#wRegistrationOpens').value;});
function updDist(){
  const pool=Math.round((+$('#wPrize').value||0)*100)/100;
  const first=Math.max(0,Math.min(100,Math.trunc(+$('#wFirstShare').value||0))),second=100-first;
  $('#wFirstShare').value=first;$('#wSecondShare').value=second;
  $('#wFirstBar').style.width=first+'%';$('#wFirstBar').textContent='1ST - '+first+'%';
  $('#wSecondBar').style.width=second+'%';$('#wSecondBar').textContent='2ND - '+second+'%';
  $('#wDist').textContent='CHAMPION '+fmt(pool*first/100)+' TND - RUNNER-UP '+fmt(pool-pool*first/100)+' TND';
}
$('#wPrize').addEventListener('input',updDist);$('#wFirstShare').addEventListener('input',updDist);updDist();

function wGo(i){wI=i;$('#wError').textContent='';
  $$('.wstep').forEach(s=>{const k=+s.dataset.i;s.classList.toggle('act',k===i);s.classList.toggle('done',k<i);if(k===i)s.setAttribute('aria-current','step');else s.removeAttribute('aria-current');});
  $$('.wpane').forEach(p=>p.classList.toggle('act',+p.dataset.w===i));
  $('#wBack').disabled=i===0; $('#wCount').textContent=i<4?`STEP ${i+1} OF 5 · NEXT: ${WSTEPS[i+1]}`:'STEP 5 OF 5 · REVIEW YOUR EVENT';
  const next=$('#wNext');next.innerHTML=i===4?(READ_ONLY_PREVIEW?'<i data-lucide="lock-keyhole"></i>PUBLISH UNAVAILABLE':'<i data-lucide="megaphone"></i>PUBLISH'):'NEXT<i data-lucide="chevron-right"></i>';next.disabled=i===4&&READ_ONLY_PREVIEW;if(i===4&&READ_ONLY_PREVIEW)next.setAttribute('aria-describedby','organizerReadonly');else next.removeAttribute('aria-describedby');icons();
  if(i===4)wSum();}
function wSum(){const maps=$$('#wMaps button.act').length;
  const st={single:'Single elimination',double:'Double elimination',rr:'Round robin → playoffs'}[WSEL.struct];
  const d=$('#wDate').value?new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date($('#wDate').value)):'TBA';
  const registrationOpens=$('#wRegistrationOpens').value?new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date($('#wRegistrationOpens').value)):'Not set';
  const registrationCloses=$('#wRegistrationCloses').value?new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date($('#wRegistrationCloses').value)):'Not set';
  const cover=$('#wCover').files[0];
  const rows=[['TOURNAMENT', $('#wName').value.trim()||'Not named'],['GAME',WSEL.game?GAMES[WSEL.game].label:'— SELECT A GAME —'],['COVER IMAGE',cover?cover.name:'NOT ADDED'],['STRUCTURE',st],...(isSuperAdmin&&WSEL.struct==='rr'?[['PLAYOFF QUALIFIERS',`TOP ${Number($('#wPlayoffQualifiers').value)||4} TEAMS`],['FIRST-ROUND BYES',`${Number($('#wPlayoffByes').value)||0} TOP SEEDS`]]:[]),['SERIES FORMAT',WSEL.series],
    ['MAP POOL',maps+' MAPS'],['ANTI-CHEAT',$('#wAc').classList.contains('act')?'REQUIRED':'OPTIONAL'],
    ['REGISTRATION OPENS',registrationOpens],['REGISTRATION CLOSES',registrationCloses],['TOURNAMENT START',d],['SLOTS',$('#wMax').value+' TEAMS · '+$('#wRoster').value],['SUBSTITUTES',$('#wSubs').value+' PER TEAM'],
    ['RULES',$('#wRules').value.trim()?`${$('#wRules').value.trim().length} CHARACTERS`:'NOT ADDED'],['PRIZE POOL',fmt(+$('#wPrize').value||0)+' TND'],['PRIZE SHARE',$('#wFirstShare').value+'% / '+$('#wSecondShare').value+'%'],
    ['REGION',$('#wRegion').value],['CHECK-IN',$('#wCheck').value]];
  $('#wSum').innerHTML=rows.map(r=>`<div class="srow"><span>${esc(r[0])}</span><b>${esc(r[1])}</b></div>`).join('');}
function stepError(){
  if(wI===0){if(!$('#wName').value.trim())return {field:$('#wName'),message:'Add a tournament name to continue.'};if(!WSEL.game)return {field:$('#wGames .gtile'),message:'Choose a game to continue.'};}
  if(wI===1&&isSuperAdmin&&WSEL.struct==='rr'){const qualifiers=Number($('#wPlayoffQualifiers').value),byes=Number($('#wPlayoffByes').value);if(!Number.isInteger(qualifiers)||qualifiers<2||qualifiers>64)return {field:$('#wPlayoffQualifiers'),message:'Choose between 2 and 64 playoff qualifiers.'};if(qualifiers>Number($('#wMax').value||64))return {field:$('#wPlayoffQualifiers'),message:'Playoff qualifiers cannot exceed the tournament team limit.'};if(!Number.isInteger(byes)||byes!==expectedPlayoffByes(qualifiers))return {field:$('#wPlayoffByes'),message:`A balanced ${qualifiers}-team playoff needs ${expectedPlayoffByes(qualifiers)} first-round byes.`};}
  if(wI===2){const max=Number($('#wMax').value),start=$('#wDate').value,opens=$('#wRegistrationOpens').value,closes=$('#wRegistrationCloses').value,now=Date.now();if(!Number.isInteger(max)||max<2||max>512)return {field:$('#wMax'),message:'Choose a limit from 2 to 512 teams.'};if(isSuperAdmin&&WSEL.struct==='rr'&&Number($('#wPlayoffQualifiers').value)>max)return {field:$('#wMax'),message:'The tournament team limit must be at least the playoff qualifier count.'};if(!start||new Date(start).getTime()<=now)return {field:$('#wDate'),message:'Choose a tournament start time in the future.'};if(!opens)return {field:$('#wRegistrationOpens'),message:'Choose when team registration opens.'};if(!closes)return {field:$('#wRegistrationCloses'),message:'Choose when team registration closes.'};if(new Date(closes)<=new Date(opens))return {field:$('#wRegistrationCloses'),message:'Registration must close after it opens.'};if(new Date(closes)>=new Date(start))return {field:$('#wRegistrationCloses'),message:'Registration must close before the tournament starts.'};if(new Date(closes)<=now)return {field:$('#wRegistrationCloses'),message:'Registration close time must be in the future.'};}
  if(wI===3){const prize=Number($('#wPrize').value),share=Number($('#wFirstShare').value);if(!Number.isFinite(prize)||prize<0)return {field:$('#wPrize'),message:'The prize pool must be zero or more.'};if(!Number.isInteger(share)||share<0||share>100)return {field:$('#wFirstShare'),message:'Set the first-place share between 0 and 100.'};if($('#wRules').value.trim().length>6000)return {field:$('#wRules'),message:'Keep tournament rules under 6,000 characters.'};}
  return null;
}
function validateStep(){const issue=stepError();if(!issue)return true;$('#wError').textContent=issue.message;issue.field?.focus();issue.field?.scrollIntoView({behavior:'smooth',block:'center'});return false;}
function validateAllSteps(){for(const index of [0,1,2,3]){const prior=wI;wI=index;const issue=stepError();wI=prior;if(issue){wGo(index);$('#wError').textContent=issue.message;issue.field?.focus();return false;}}return true;}
$('#wNext').onclick=()=>{if(wI===4){wPublish();return;}if(validateStep())wGo(wI+1);};
$('#wBack').onclick=()=>wGo(wI-1);

$('#wCover').addEventListener('change',()=>{
  const file=$('#wCover').files[0],preview=$('#wCoverPreview');
  if(preview.dataset.url)URL.revokeObjectURL(preview.dataset.url);
  delete preview.dataset.url;
  if(!file){preview.innerHTML='<span><i data-lucide="image-plus"></i>Cover preview</span>';icons();return;}
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5*1024*1024){
    $('#wCover').value='';preview.innerHTML='<span><i data-lucide="image-plus"></i>Cover preview</span>';icons();
    toast('err','Unsupported cover image','Choose a JPG, PNG, or WebP image no larger than 5 MB.');return;
  }
  const url=URL.createObjectURL(file);preview.dataset.url=url;
  preview.innerHTML=`<img src="${url}" alt="Tournament cover preview"><button class="cover-remove" type="button" aria-label="Remove cover image"><i data-lucide="x"></i></button>`;
  preview.querySelector('.cover-remove').onclick=()=>{$('#wCover').value='';URL.revokeObjectURL(url);delete preview.dataset.url;preview.innerHTML='<span><i data-lucide="image-plus"></i>Cover preview</span>';icons();};
  icons();
});

async function wPublish(){
  if(READ_ONLY_PREVIEW)return;
  if(!validateAllSteps())return;
  if(!WSEL.game){toast('err','Game required','Pick the game in step 1 before publishing.');wGo(0);return;}
  const name=$('#wName').value.trim();
  if(!name){toast('err','Name required','Give your tournament a name in step 1.');$('#wName').focus();wGo(0);return;}
  const day=$('#wDate').value;
  const startsAt=day?new Date(day).toISOString():null;
  if(startsAt&&new Date(startsAt)<=new Date()){
    toast('err','Choose a future date','Tournament start dates must be in the future.');wGo(2);$('#wDate').focus();return;
  }
  const format={single:'single_elimination',double:'double_elimination',rr:'round_robin_playoffs'}[WSEL.struct];
  const prizePool=Math.round((+$('#wPrize').value||0)*100)/100;
  const coverFile=$('#wCover').files[0];
  if(coverFile&&(!['image/jpeg','image/png','image/webp'].includes(coverFile.type)||coverFile.size>5*1024*1024)){
    toast('err','Unsupported cover image','Choose a JPG, PNG, or WebP image no larger than 5 MB.');wGo(0);$('#wCover').focus();return;
  }
  const firstShare=Number($('#wFirstShare').value);
  if(!Number.isFinite(prizePool)||prizePool<0||!Number.isInteger(firstShare)||firstShare<0||firstShare>100){
    toast('err','Check the prize schedule','The prize total must be zero or more and the first place share must be between 0 and 100.');wGo(3);return;
  }
  let result;
  try{
    result=await SUPA.client.rpc('create_tournament',{p_data:{
      name,game:WSEL.game,description:$('#wDescription').value.trim(),rules:$('#wRules').value.trim(),format,best_of:WSEL.series,
      organization_id:$('#wOrganization').value||null,
      region:$('#wRegion').value,starts_at:startsAt,
      registration_opens_at:new Date($('#wRegistrationOpens').value).toISOString(),registration_closes_at:new Date($('#wRegistrationCloses').value).toISOString(),
      max_teams:+$('#wMax').value||64,roster_size:parseInt($('#wRoster').value,10)||5,
      substitute_limit:+$('#wSubs').value||0,check_in_minutes:+($('#wCheck').value.match(/\d+/)||[])[0]||60,
      map_pool:$$('#wMaps button.act').map(button=>button.dataset.m),
      anti_cheat_required:$('#wAc').classList.contains('act'),
      prize_pool:prizePool,currency:'TND'
      ,...(isSuperAdmin&&WSEL.struct==='rr'?{playoff_qualifier_count:Number($('#wPlayoffQualifiers').value)||4,playoff_bye_count:Number($('#wPlayoffByes').value)||0}:{})
    }});
  }catch(error){toast('err','Could not publish tournament',error.message||'Check your connection and try again.');return;}
  if(result.error){toast('err','Could not save tournament',result.error.message);return;}
  const tournamentId=result.data;
  if(coverFile){
    const extension=({ 'image/jpeg':'jpg','image/png':'png','image/webp':'webp' })[coverFile.type];
    const objectPath=`${tournamentId}/${crypto.randomUUID().replaceAll('-','')}.${extension}`;
    let upload;
    try{
      upload=await SUPA.client.storage.from('tournament-covers').upload(objectPath,coverFile,{contentType:coverFile.type,cacheControl:'3600',upsert:false});
      if(upload.error)throw upload.error;
      const {error}=await SUPA.client.rpc('set_tournament_cover',{p_tournament_id:tournamentId,p_cover_path:objectPath});
      if(error)throw error;
    }catch(error){
      if(upload?.data)await SUPA.client.storage.from('tournament-covers').remove([objectPath]);
      toast('err','Tournament saved as draft',`Its cover image could not be saved. Draft ID: ${tournamentId}. ${error.message||'Please try again after checking storage access.'}`);return;
    }
  }
  if(prizePool>0){
    const firstAmount=Math.round(prizePool*firstShare)/100;
    const prizes=[{place:1,label:'Champion',amount:firstAmount},{place:2,label:'Runner-up',amount:Math.round((prizePool-firstAmount)*100)/100}].filter(p=>p.amount>0);
    let saved;
    try{saved=await Promise.all(prizes.map(prize=>SUPA.client.rpc('upsert_tournament_prize',{
      p_tournament_id:tournamentId,p_place:prize.place,p_label:prize.label,p_amount:prize.amount,p_currency:'TND'
    })));}
    catch(error){toast('err','Tournament saved as draft','Prize scheduling failed. Draft ID: '+tournamentId+'. '+(error.message||'Please retry from the tournament workspace.'));return;}
    const prizeError=saved.find(item=>item.error)?.error;
    if(prizeError){toast('err','Tournament saved as draft','Its prize total was saved, but the schedule could not be stored. Draft ID: '+tournamentId+'. '+prizeError.message);return;}
  }
  let openError;
  try{({error:openError}=await SUPA.client.rpc('transition_tournament',{p_tournament_id:tournamentId,p_new_status:'registration_open'}));}
  catch(error){openError=error;}
  if(openError){toast('err','Tournament saved as draft',`The event was saved but could not open registration. Draft ID: ${tournamentId}. ${openError.message}`);return;}
  toast('ok','Tournament published','Your event is saved in TUNESF and appears in tournament discovery.');
  setTimeout(()=>location.href='tournaments.html?new='+tournamentId,500);
}

buildConsoleStrip();
if(READ_ONLY_PREVIEW){const note=document.createElement('p');note.id='organizerReadonly';note.className='admin-readonly-note';note.setAttribute('role','note');note.textContent='You can configure and review this tournament, but publishing is disabled in this local preview because it is connected to production. Use a writable staging environment to create events.';$('#consoleStrip')?.insertAdjacentElement('afterend',note);}
wGo(0); icons();
});
