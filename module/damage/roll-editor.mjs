/** GM-only native chat context command. All corrections live in flags;
 * original Roll and already applied HP are NEVER changed.
 */
import {changePart,calculateDamage,copy} from './damage-core.mjs';
const ID='fast-nri-v14';
const esc=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const l=key=>game.i18n.localize(`FASTNRI.Damage.${key}`);
const own=msg=>!!game.user?.isGM && !!msg && (msg.canUserModify?.(game.user,'update')!==false);
const get=(msg,key)=>msg?.getFlag?.(ID,key) ?? msg?.flags?.[ID]?.[key];
const num=v=>Number(v);
export function editableMessage(msg) {
  return Boolean(get(msg,'weaponAttack') || get(msg,'weaponDamage') || get(msg,'checkRoll'));
}

function rollSnapshot(msg) {
  const roll=msg.rolls?.[0];
  if (!roll || !Number.isFinite(roll.total)) throw new Error('Original Roll is unavailable');
  let i=0;
  const pieces=(roll.dice??[]).flatMap(d=>(d.results??[])
    .filter(r=>r.active!==false).map(r=>({id:`die-${++i}`,kind:'die',faces:d.faces,
      original:r.result,value:r.result,excluded:false,formula:`1d${d.faces}`})));
  return {version:1,originalTotal:roll.total,components:pieces,offset:0,
    currentTotal:roll.total,history:[]};
}
export function computedRollTotal(state) {
  return state.originalTotal + (state.offset??0) + state.components.reduce((sum,p)=>sum+(p.excluded?0:p.value)-p.original,0);
}
export async function applyRollCorrection(msg,{partId,action,value}={}) {
  if (!own(msg) || !editableMessage(msg)) throw new Error('Only GM may edit system rolls');
  const card=get(msg,'weaponDamage');
  if (card?.version===2) {
    const before=copy(card);
    let next,old,current;
    if(partId.startsWith('adjustment:')) {
      const key=partId.slice('adjustment:'.length);
      if(!['penalty','resistance','vulnerability'].includes(key)||action!=='set'||!Number.isFinite(value)||value<0)
        throw new Error('Invalid damage adjustment');
      next=copy(card);old=next.adjustments?.[key]??0;
      next.adjustments??={};next.adjustments[key]=value;current=value;
    } else ({next,old,current}=changePart(card,partId,action,value));
    next.history=[...(next.history??[]),{by:game.user.id,at:Date.now(),action,
      id:partId,before:old,after:current}];
    next.revision=(next.revision??0)+1;
    await msg.update({[`flags.${ID}.weaponDamage`]:next});
    return {previous:calculateDamage(before),current:calculateDamage(next)};
  }
  const state=copy(get(msg,'rollEdit') ?? rollSnapshot(msg));
  if (partId==='offset') {
    if(action!=='set'||!Number.isFinite(value)) throw new Error('Invalid total correction');
    const old=state.offset??0;state.offset=value;
    state.history.push({by:game.user.id,at:Date.now(),action,id:'offset',before:old,after:value});
  } else {
    const part=state.components.find(p=>p.id===partId);
    if(!part)throw new Error('Missing roll component');
    const old={value:part.value,excluded:!!part.excluded};
    if(action==='exclude')part.excluded=true;
    else if(action==='restore')part.excluded=false;
    else if(action==='set'||action==='reroll') {
      if(!Number.isFinite(value)|| (action==='reroll' && (part.kind!=='die'||!Number.isInteger(value)||value<1||value>part.faces)))throw new Error('Invalid roll value');
      part.value=value;
    } else throw new Error('Unknown roll correction');
    state.history.push({by:game.user.id,at:Date.now(),action,id:partId,before:old,
      after:{value:part.value,excluded:!!part.excluded}});
  }
  state.currentTotal=computedRollTotal(state);
  await msg.update({[`flags.${ID}.rollEdit`]:state});
  return state;
}

export function getEditorParts(msg) {
  const card=get(msg,'weaponDamage');
  if(card?.version===2)return card.parts;
  return (get(msg,'rollEdit') ?? rollSnapshot(msg)).components;
}

export async function openRollEditor(msg) {
  if(!own(msg)||!editableMessage(msg))return;
  const dialog=foundry.applications.api.DialogV2;
  // A single operation per dialog keeps the immutable audit trail unambiguous.
  // Reopen to continue editing; never make a chat message for each change.
  while(true) {
    const card=get(msg,'weaponDamage');
    const isDamage=card?.version===2;
    let parts;
    try {parts=getEditorParts(msg);}catch(error){ui.notifications?.error(error.message);return;}
    const options=parts.map(p=>`<option value="${esc(p.id)}">${esc(p.formula ?? p.id)} · ${p.value}${p.excluded?' (×)':''}</option>`).join('');
    const offset=(!isDamage)?`<option value="offset">${esc(l('totalCorrection'))}</option>`:
      ['penalty','resistance','vulnerability'].map(k=>`<option value="adjustment:${k}">${esc(l(k))}: ${card.adjustments?.[k]??0}</option>`).join('');
    const rows=parts.map(p=>`<div>${p.excluded?'<s>':''}${esc(p.formula ?? p.id)}: ${p.value}${p.excluded?'</s>':''} `+
      `<small>${esc(p.damageType??'')}</small></div>`).join('');
    const total=isDamage?calculateDamage(card).total:(get(msg,'rollEdit')?.currentTotal ?? msg.rolls?.[0]?.total);
    const content=`<div class="fnri-roll-editor"><div>${rows}</div><strong>${esc(l('total'))}: ${total}</strong>`+
      `<div class="form-group"><label>${esc(l('component'))}</label><select name="part">${options}${offset}</select></div>`+
      `<div class="form-group"><label>${esc(l('action'))}</label><select name="action">`+
      `<option value="set">${esc(l('set'))}</option><option value="exclude">${esc(l('exclude'))}</option>`+
      `<option value="restore">${esc(l('restore'))}</option><option value="reroll">${esc(l('reroll'))}</option></select></div>`+
      `<div class="form-group"><label>${esc(l('value'))}</label><input name="value" type="number" step="any" value="0"></div>`+
      `<small>${esc(l('history'))}: ${isDamage?(card.history?.length??0):(get(msg,'rollEdit')?.history?.length??0)}</small></div>`;
    const result=await dialog.input({window:{title:l('editRoll')},content,
      ok:{label:l('applyCorrection')},rejectClose:false});
    if(!result)return;
    const id=String(result.part??'');const action=String(result.action??'');
    try {
      const p=parts.find(x=>x.id===id);
      if(action==='reroll') {
        if(!p||p.kind!=='die'||!Number.isInteger(p.faces)||p.faces<1)throw new Error(l('notADie'));
        const roll=await new Roll(`1d${p.faces}`).evaluate();
        await applyRollCorrection(msg,{partId:id,action,value:roll.total});
      } else await applyRollCorrection(msg,{partId:id,action,value:num(result.value)});
    } catch(error) {console.error('Fast NRI | roll edit failed',error);ui.notifications?.error(error.message);}
  }
}

function contextMessage(element) {
  const id=element?.closest?.('[data-message-id]')?.dataset?.messageId ?? element?.dataset?.messageId;
  return id ? game.messages?.get(id) : null;
}
export function registerRollEditor() {
  Hooks.on('getChatMessageContextOptions',(app,items)=>{
    items.push({label:'FASTNRI.Damage.editRoll',icon:'fa-solid fa-sliders',
      visible:element=>{const msg=contextMessage(element);return own(msg)&&editableMessage(msg);},
      onClick:(event,element)=>{const msg=contextMessage(element);if(msg&&own(msg))void openRollEditor(msg);}});
  });
  Hooks.on('renderChatMessageHTML',(msg,html)=>{
    const state=get(msg,'rollEdit');
    if(!state||!html?.querySelector||html.querySelector('[data-fnri-roll-corrected]'))return;
    const label=document.createElement('div');label.dataset.fnriRollCorrected='';
    label.className='fnri-roll-corrected';label.textContent=`${l('correctedTotal')}: ${state.currentTotal}`;
    (html.querySelector('.message-content')??html).append(label);
  });
}
