/* Keep the permission cards and matrix in sync with the federation's live RBAC records. */
document.querySelectorAll('.tree,.codebox').forEach(el=>el.closest('section')?.remove());
const rolePicker=document.querySelector('#roleCompare'),roleList=document.querySelector('#rolePermissionList'),roleTable=document.querySelector('table.mtx');
if(roleTable)roleTable.innerHTML='<tbody><tr><td>Loading the live permission matrix…</td></tr></tbody>';
const renderRole=()=>{
  if(!rolePicker||!roleList||!roleTable)return;
  const roleKey=rolePicker.value,permissions=[...roleTable.tBodies[0].rows];
  roleList.innerHTML=permissions.map(row=>{
    const allowed=row.querySelector(`[data-role="${CSS.escape(roleKey)}"]`)?.dataset.allowed==='true';
    return `<li><span>${esc(row.cells[0].textContent.trim())}</span><b class="${allowed?'yes':'no'}">${allowed?'Allowed':'No access'}</b></li>`;
  }).join('');
};
rolePicker?.addEventListener('change',renderRole);
boot(()=>{
  const host=$('#roleCards');
  if(host){
    host.innerHTML='<p class="team-empty">Loading federation permissions…</p>';
    SUPA.client.from('permissions').select('key,label').then(({data,error})=>{
      if(error)throw error;
      const labels=new Map((data||[]).map(row=>[row.key,row.label]));
      const roleKeys=ROLE_ORDER.filter(key=>ROLES[key]);
      const permissions=(data||[]).filter(row=>ROLE_PERMISSIONS.some(item=>item.permission_key===row.key)).sort((a,b)=>a.label.localeCompare(b.label));
      host.innerHTML=roleKeys.map(key=>{
        const role=ROLES[key],names=(role.perms||[]).map(permission=>labels.get(permission)||permission.toLowerCase().replaceAll('_',' '));
        return `<article class="rolecard"><div class="rc-head"><span class="rolechip ${role.cls}"><i data-lucide="${esc(role.icon)}"></i>${esc(role.label)}</span><span class="rc-lvl">LEVEL ${role.level}</span></div><p>${esc(role.blurb||'Federation role with verified permissions.')}</p><p class="role-permissions">${names.length?`Base permissions: ${names.map(esc).join(', ')}`:'No direct base permissions.'}</p></article>`;
      }).join('');
      if(rolePicker){
        rolePicker.innerHTML=roleKeys.map(key=>`<option value="${esc(key)}">${esc(ROLES[key].label)}</option>`).join('');
        rolePicker.value=roleKeys.includes('PLAYER')?'PLAYER':roleKeys[0]||'';
      }
      if(roleTable){
        const columns=roleKeys.map(key=>`<th class="c" scope="col">${esc(ROLES[key].label)}</th>`).join('');
        roleTable.innerHTML=`<thead><tr><th scope="col">Permission</th>${columns}</tr></thead><tbody>${permissions.map(permission=>`<tr><th scope="row">${esc(permission.label)}</th>${roleKeys.map(key=>{const allowed=ROLE_PERMISSIONS.some(item=>item.role_key===key&&item.permission_key===permission.key);return `<td class="c ${allowed?'hl-col':''}" data-role="${esc(key)}" data-allowed="${allowed}" aria-label="${esc(ROLES[key].label)}: ${allowed?'allowed':'no access'}"><span class="${allowed?'y':'n'}" aria-hidden="true">${allowed?'✓':'—'}</span></td>`}).join('')}</tr>`).join('')||'<tr><td colspan="99">No permission records are configured.</td></tr>'}</tbody>`;
      }
      renderRole();icons();
    }).catch(error=>{
      host.innerHTML='<p class="team-empty">Role permissions could not be loaded.</p>';
      if(roleTable)roleTable.innerHTML='<tbody><tr><td>Permission matrix unavailable. Please reload to retry.</td></tr></tbody>';
      if(roleList)roleList.innerHTML='<li><span>Permission matrix unavailable.</span><b class="no">Unavailable</b></li>';
      toast('err','Role permissions unavailable',error?.message||'Please reload and try again.');
    });
  }
  const heading=document.querySelector('#roleCards')?.closest('section')?.querySelector('h2');
  if(heading)heading.innerHTML='Federation <span class="out">Base Permissions</span>';
  const note=document.querySelector('#roleCards')?.closest('section')?.querySelector('.sec-note');
  if(note)note.textContent='Base role permissions come from the federation database. Scoped access is checked separately for each team, organization, and tournament.';
  icons();
});
