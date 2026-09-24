/* TUNESF account access — every account uses Supabase Auth. */
Auth.ready.then(()=>{
const q=new URLSearchParams(location.search);
const need=q.get('need');
const safeNext=value=>{
  if(!value)return null;
  try{
    const target=new URL(value,location.href), currentDir=new URL('.',location.href).pathname;
    const file=target.pathname.slice(currentDir.length);
    if(target.origin!==location.origin||!target.pathname.startsWith(currentDir)||target.username||target.password||
       !/^[a-z0-9][a-z0-9_-]*\.html$/i.test(file)||file.toLowerCase()==='login.html')return null;
    return target.pathname+target.search+target.hash;
  }catch{return null;}
};
const redirectAfterAuth=()=>{
  const role=Auth.highestRole();
  const landing=role==='TOURNAMENT_ADMIN'&&!Auth.has('CREATE_TOURNAMENT')?'event-admin.html':LANDING[role];
  return safeNext(q.get('next'))||safeNext(landing)||'index.html';
};
const recoveryRedirect=()=>new URL('login.html?mode=recovery',location.href).href;
if(need&&ROLES[need]){
  const role=ROLES[need];
  $('#needBanner').innerHTML=`<i data-lucide="lock"></i><div><b>${esc(role.label)} access required</b><span>${esc(role.blurb)} ${Auth.is()?`You are signed in as <b style="color:var(--txt)">${esc(Auth.user.name)}</b> (${esc(ROLES[Auth.highestRole()].label)}).`:'Sign in with an account that has this role.'}</span></div>`;
}

document.querySelector('label[for="liUser"]').textContent='Email';
$('#liUser').type='email';
$('#liUser').autocomplete='email';
$('#liUser').placeholder='you@example.com';
$('#suMail').autocomplete='email';
$('#suUser').autocomplete='username';
$('#upForm p').innerHTML='New accounts start as <b class="mono" style="color:var(--cyan)">PLAYER</b>. A player who creates a team becomes its team-scoped captain. Organization ownership and staff roles are separate scoped responsibilities.';
document.querySelector('.auth-side .mono').textContent='SECURE SIGN IN — ACCOUNTS AND ROLES ARE MANAGED BY TUNESF.';

const tabs=$$('#authTabs button'), inForm=$('#inForm'), upForm=$('#upForm'), recoverForm=$('#recoverForm'), resetForm=$('#resetForm');
function showForm(name){
  tabs.forEach(button=>button.classList.toggle('act',name===button.dataset.t));
  inForm.style.display=name==='in'?'flex':'none';
  upForm.style.display=name==='up'?'flex':'none';
  recoverForm.style.display=name==='recover'?'flex':'none';
  resetForm.style.display=name==='reset'?'flex':'none';
  $('#authTabs').style.display=name==='recover'||name==='reset'?'none':'flex';
  icons();
}
tabs.forEach(button=>button.onclick=()=>showForm(button.dataset.t));
$('#showRecover').onclick=()=>{if($('#liUser').value)$('#recoverMail').value=$('#liUser').value;showForm('recover');};
$$('[data-show-signin]').forEach(button=>button.onclick=()=>showForm('in'));
$$('[data-show-recover]').forEach(button=>button.onclick=()=>showForm('recover'));

inForm.onsubmit=async event=>{
  event.preventDefault();
  const email=$('#liUser').value.trim(), password=$('#liPass').value;
  if(!email||!password){toast('err','Sign-in details required','Enter your email address and password.');return;}
  try{
    await Auth.signInPassword(email,password);
    toast('ok','Welcome back','Signed in as '+Auth.user.name+'.');
    setTimeout(()=>location.replace(redirectAfterAuth()),350);
  }catch(error){toast('err','Sign-in failed',error.message||'Check your email and password.');}
};

$('#upForm').onsubmit=async event=>{
  event.preventDefault();
  const username=$('#suUser').value.trim(), email=$('#suMail').value.trim(), password=$('#suPass').value;
  if(username.length<3){toast('err','Username too short','Use at least 3 characters.');$('#suUser').focus();return;}
  if(!email||!email.includes('@')){toast('err','Email required','Enter a valid email address.');$('#suMail').focus();return;}
  if(password.length<12){toast('err','Password too short','Use at least 12 characters for your account password.');$('#suPass').focus();return;}
  const submitButton=$('#suBtn');submitButton.disabled=true;
  const usernameTaken=async()=>{
    const {data,error}=await SUPA.client.from('public_profiles').select('id').eq('username',username).maybeSingle();
    if(error)throw error;
    return Boolean(data);
  };
  try{
    if(await usernameTaken()){toast('err','Username already in use','Choose a different public username.');$('#suUser').focus();return;}
    const {data,error}=await SUPA.client.auth.signUp({email,password,options:{
      data:{username,player_name:username,game:'Not selected'},
      emailRedirectTo:new URL(redirectAfterAuth(),location.href).href
    }});
    if(error)throw error;
    if(data.session)await Auth._loadSupaUser(data.session);
    if(data.session){
      toast('ok','Account created','Your account is ready. You have the PLAYER role.');
      setTimeout(()=>location.replace(redirectAfterAuth()),350);
    }else{
      toast('info','Confirm your email','We sent a confirmation link. Confirm your address, then sign in.');
      setTimeout(()=>showForm('in'),700);
    }
  }catch(error){
    let message=error.message||'Please try again.';
    try{if(await usernameTaken())message='That public username is already in use. Choose a different one.';}catch{}
    toast('err','Registration failed',message);
  }finally{submitButton.disabled=false;}
};

recoverForm.onsubmit=async event=>{
  event.preventDefault();
  const email=$('#recoverMail').value.trim();
  if(!email){toast('err','Email required','Enter the email address for your account.');return;}
  try{
    const {error}=await SUPA.client.auth.resetPasswordForEmail(email,{redirectTo:recoveryRedirect()});
    if(error)throw error;
    toast('info','Check your email','If an account exists for this address, a secure reset link is on its way.');
    recoverForm.reset();
  }catch(error){toast('err','Could not send reset link',error.message||'Please wait a moment and try again.');}
};

const hash=new URLSearchParams(location.hash.slice(1));
const isRecovery=hash.get('type')==='recovery'||(q.get('mode')==='recovery'&&Auth.is());
if(hash.get('error_description'))toast('err','Reset link unavailable',hash.get('error_description').replaceAll('+',' '));
if(isRecovery){showForm('reset');$('#authTabs').style.display='none';}
SUPA.client.auth.onAuthStateChange(event=>{
  if(event==='PASSWORD_RECOVERY')showForm('reset');
});
resetForm.onsubmit=async event=>{
  event.preventDefault();
  const password=$('#resetPass').value, confirm=$('#resetConfirm').value;
  if(password.length<12){toast('err','Password too short','Use at least 12 characters.');$('#resetPass').focus();return;}
  if(password!==confirm){toast('err','Passwords do not match','Enter the same password in both fields.');$('#resetConfirm').focus();return;}
  try{
    const {error}=await SUPA.client.auth.updateUser({password});
    if(error)throw error;
    toast('ok','Password updated','Sign in with your new password.');
    await SUPA.client.auth.signOut().catch(()=>{});
    location.replace('login.html?password-updated=1');
  }catch(error){toast('err','Password update failed',error.message||'The reset link may have expired. Request a new one.');}
};
if(q.has('password-updated'))toast('ok','Password updated','You can now sign in with your new password.');

const note=$('#sessionNote');
if(note&&Auth.is())note.textContent=`SIGNED IN AS ${Auth.user.name} — ${ROLES[Auth.highestRole()].label.toUpperCase()}`;
icons();
}).catch(error=>toast('err','Account access unavailable',error.message||'Please reload and try again.'));
