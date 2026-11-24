/** A searchable, immediate single-choice submenu. No rule validation here. */
const esc=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const key=s=>String(s??'').trim().toLocaleLowerCase('ru').replaceAll('ё','е');
export async function chooseCharacterOption({title,names,current='',searchLabel,clearLabel,cancelLabel}){
  const {DialogV2}=foundry.applications.api;
  let selection=null;
  const content=`<div data-character-choice><input type="search" data-character-search placeholder="${esc(searchLabel)}" aria-label="${esc(searchLabel)}"><div class="fnri-racial-options" data-character-options></div><button type="button" data-character-clear>${esc(clearLabel)}</button></div>`;
  await DialogV2.wait({window:{title},content,rejectClose:false,buttons:[{action:'cancel',label:cancelLabel}],render:(_event,dialog)=>{
    const root=dialog.element.querySelector('[data-character-choice]');
    if(!root||root.dataset.bound)return;
    root.dataset.bound='true';
    const search=root.querySelector('[data-character-search]'), list=root.querySelector('[data-character-options]');
    const finish=value=>{if(selection!==null)return;selection=value;void dialog.close();};
    const refresh=()=>{list.innerHTML=names.filter(name=>key(name).includes(key(search.value))).map(name=>`<button type="button" class="fnri-racial-pick" data-character-value="${esc(name)}" aria-pressed="${name===current}">${esc(name)}</button>`).join('');};
    search.addEventListener('input',refresh);
    search.addEventListener('keydown',e=>{if(e.key==='Enter')e.preventDefault();});
    list.addEventListener('click',e=>{const b=e.target.closest('[data-character-value]');if(b&&names.includes(b.dataset.characterValue))finish(b.dataset.characterValue);});
    root.querySelector('[data-character-clear]').addEventListener('click',()=>finish(''));
    refresh();search.focus();
  }});
  return selection;
}
