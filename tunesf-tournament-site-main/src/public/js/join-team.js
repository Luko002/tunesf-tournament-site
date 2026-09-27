Auth.ready.then(()=>{
  const body=document.querySelector('#joinBody'), params=new URLSearchParams(location.search), token=params.get('token')||'';
  const show=(title,message,action='')=>{
    body.innerHTML=`<h2 style="font:700 20px/1.2 var(--fd);margin-bottom:10px">${esc(title)}</h2><p style="color:var(--dim);font-size:13px;line-height:1.6">${esc(message)}</p>${action}`;
    icons();
  };
  if(!/^[0-9a-f]{64}$/.test(token)){
    show('Invitation link is invalid','Ask the team captain to create and share a new invitation link.');
    return;
  }
  if(!Auth.is()){
    const next=new URL('join-team.html',location.href);next.searchParams.set('token',token);
    const login='login.html?next='+encodeURIComponent(next.pathname.split('/').pop()+next.search);
    show('Sign in to continue','Sign in or create a PLAYER account, then return here to accept the invitation.',`<a class="btn btn-gold btn-sm" href="${esc(login)}" style="margin-top:16px">Sign in or create account</a>`);
    return;
  }
  show('Invitation ready',READ_ONLY_PREVIEW?'This single-use invitation would add your account to the team roster. Team changes are disabled in this production-connected preview.':'This single-use invitation will add your account to the team roster. Accept only if you trust the person who shared this link.',`<button class="btn btn-gold btn-sm" id="acceptTeamInvite" type="button" style="margin-top:16px"${READ_ONLY_PREVIEW?' disabled title="Changes are disabled in this production-connected preview."':''}><i data-lucide="user-round-plus"></i>Accept invitation</button>${READ_ONLY_PREVIEW?'<p class="team-empty preview-write-note" role="note">To accept invitations, open a writable staging environment.</p>':''}`);
  $('#acceptTeamInvite').onclick=async event=>{
    if(READ_ONLY_PREVIEW)return;
    const button=event.currentTarget;button.disabled=true;
    try{
      const {data,error}=await SUPA.client.rpc('accept_team_invitation',{p_token:token});
      if(error)throw error;
      history.replaceState(null,'',location.pathname);
      show('You joined the team','Your team membership is active. Open your player dashboard to see the roster.',`<a class="btn btn-gold btn-sm" href="dashboard.html" style="margin-top:16px">Open player dashboard</a>`);
      toast('ok','Invitation accepted','You have joined the team.');
    }catch(error){
      show('Could not accept invitation',error.message||'The link may have expired, been revoked, or already been used. Ask the captain for a new link.');
      toast('err','Invitation unavailable',error.message||'Ask the captain for a new link.');
    }
  };
}).catch(error=>{
  const body=document.querySelector('#joinBody');
  if(body)body.textContent='Account services are unavailable. Reload this page to try again.';
  toast('err','Account services unavailable',error?.message||'Please reload and try again.');
});
