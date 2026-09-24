/* Display the permission matrix stored by the federation, without claiming scoped powers are global. */
document.querySelectorAll('.tree,table.mtx,.codebox').forEach(el=>el.closest('section')?.remove());
boot(()=>{
  const host=$('#roleCards');
  if(host){
    host.innerHTML='<p class="team-empty">Loading federation permissions…</p>';
    SUPA.client.from('permissions').select('key,label').then(({data,error})=>{
      if(error)throw error;
      const labels=new Map((data||[]).map(row=>[row.key,row.label]));
    host.innerHTML=ROLE_ORDER.map(key=>{
      const role=ROLES[key];
      const permissions=role.perms||[];
      const details=role.blurb||'Federation role with verified permissions.';
      const names=permissions.map(permission=>labels.get(permission)||permission.toLowerCase().replaceAll('_',' '));
      return `<article class="rolecard"><div class="rc-head"><span class="rolechip ${role.cls}"><i data-lucide="${esc(role.icon)}"></i>${esc(role.label)}</span><span class="rc-lvl">LEVEL ${role.level}</span></div><p>${esc(details)}</p><p class="role-permissions">${names.length?`Base permissions: ${names.map(esc).join(', ')}`:'No direct base permissions.'}</p></article>`;
    }).join('');
    icons();
    }).catch(error=>{host.innerHTML='<p class="team-empty">Role permissions could not be loaded.</p>';toast('err','Role permissions unavailable',error?.message||'Please reload and try again.');});
  }
  const heading=document.querySelector('#roleCards')?.closest('section')?.querySelector('h2');
  if(heading)heading.innerHTML='Federation <span class="out">Base Permissions</span>';
  const note=document.querySelector('#roleCards')?.closest('section')?.querySelector('.sec-note');
  if(note)note.textContent='Base role permissions come from the federation database. Scoped access is checked separately for each team, organization, and tournament.';
  icons();
});
