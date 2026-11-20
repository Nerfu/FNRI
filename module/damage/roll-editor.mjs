/** GM-only native chat context command. All corrections live in flags;
 * original Roll and already applied HP are NEVER changed.
 */
import {changePart,calculateDamage,copy} from './damage-core.mjs';
import {messageIntervention} from '../rolls/attack-properties.mjs';
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

/** Override only the concrete chat result, not its source Item or original Roll. */
export async function setMessageIntervention(msg,enabled) {
  if (!own(msg) || !editableMessage(msg) || typeof enabled!=='boolean')
    throw new Error('Only GM may change intervention state');
  const before=messageIntervention(msg);
  if(before===enabled)return false;
  const history=[...(get(msg,'interventionHistory')??[]),{by:game.user.id,at:Date.now(),before,after:enabled}];
  await msg.update({[`flags.${ID}.interventionOverride`]:enabled,
    [`flags.${ID}.interventionHistory`]:history});
  return true;
}

/** Manual critical override changes only this damage result, never the attack Roll. */
export async function setMessageCritical(msg,mode='auto',multiplier=2) {
  if(!own(msg)) throw new Error('Only GM may change critical damage');
  const card=get(msg,'weaponDamage');
  if(card?.version!==2 || !['auto','true','false'].includes(mode))
    throw new Error('Unsupported critical edit');
  if(mode==='true' && (!Number.isFinite(multiplier) || multiplier<=1))
    throw new Error('Invalid critical multiplier');
  const next=copy(card);
  const previous={enabled:next.manualCritical??null,multiplier:next.manualCritMultiplier??null};
  next.manualCritical=mode==='auto'?null:mode==='true';
  if(mode==='true')next.manualCritMultiplier=multiplier;
  const current={enabled:next.manualCritical,multiplier:next.manualCritMultiplier??null};
  if(previous.enabled===current.enabled && previous.multiplier===current.multiplier)return false;
  next.history=[...(next.history??[]),{by:game.user.id,at:Date.now(),action:'critical',before:previous,after:current}];
  next.revision=(next.revision??0)+1;
  await msg.update({[`flags.${ID}.weaponDamage`]:next});
  return true;
}

export function getEditorParts(msg) {
  const card=get(msg,'weaponDamage');
  if(card?.version===2)return card.parts;
  return (get(msg,'rollEdit') ?? rollSnapshot(msg)).components;
}

/** A real Foundry Roll, followed by one flag update. Never mutate the source Roll. */
export async function executeRollEditorAction(msg,{partId,action,value}={}) {
  if (!own(msg) || !editableMessage(msg)) throw new Error('Only GM may edit system rolls');
  if (action !== 'reroll') {
    await applyRollCorrection(msg,{partId,action,value});
    return {action,partId};
  }
  const part=getEditorParts(msg).find(p=>p.id===partId);
  if (!part || part.kind !== 'die' || !Number.isInteger(part.faces) || part.faces < 1)
    throw new Error(l('notADie'));
  const before=part.value;
  const roll=await new Roll(`1d${part.faces}`).evaluate();
  const current=roll?.total;
  if (!Number.isInteger(current) || current < 1 || current > part.faces)
    throw new Error('Invalid new dice result');
  await applyRollCorrection(msg,{partId,action,value:current});
  return {action,partId,before,current};
}

export async function openRollEditor(msg) {
  if(!own(msg)||!editableMessage(msg))return;
  const dialog=foundry.applications.api.DialogV2;
  // A single operation per dialog keeps the immutable audit trail unambiguous.
  // Reopen to continue editing; never make a chat message for each change.
  let feedback='';
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
    const interventionState=messageIntervention(msg);
    const critMode=card?.manualCritical===true?'true':card?.manualCritical===false?'false':'auto';
    const manualCritMultiplier=Number(card?.manualCritMultiplier);
    const sourceMultiplier=Number(card?.naturalCritMultiplier??card?.criticalMultiplier);
    const defaultCritMultiplier=manualCritMultiplier>1 && card?.manualCritical===true
      ? manualCritMultiplier : sourceMultiplier>1 ? sourceMultiplier : 2;
    const critRow=isDamage?`<option value="__critical__">${esc(l('criticalState'))}</option>`:'';
    const criticalControls=isDamage?`<div class="form-group"><label>${esc(l('criticalState'))}</label>`+
      `<select name="criticalMode">`+
      `<option value="auto" ${critMode==='auto'?'selected':''}>${esc(l('criticalAuto'))}</option>`+
      `<option value="true" ${critMode==='true'?'selected':''}>${esc(l('criticalEnable'))}</option>`+
      `<option value="false" ${critMode==='false'?'selected':''}>${esc(l('criticalDisable'))}</option></select>`+
      `<input name="criticalMultiplier" type="number" min="2" step="any" value="${defaultCritMultiplier}" `+
      `title="${esc(l('criticalMultiplier'))}"></div>`:'';
    const content=`<div class="fnri-roll-editor"><div>${rows}</div><strong>${esc(l('total'))}: ${total}</strong>`+
      `<div class="fnri-intervention-state">${esc(l('interventionProperty'))}: ${interventionState?esc(l('yes')):esc(l('no'))}</div>`+
      `<div class="form-group"><label>${esc(l('component'))}</label><select name="part">${options}${offset}`+
      `<option value="__intervention__">${esc(l('interventionProperty'))}</option>${critRow}</select></div>`+
      `<div class="form-group"><label>${esc(l('interventionProperty'))}</label><select name="intervention">`+
      `<option value="false" ${interventionState?'':'selected'}>${esc(l('no'))}</option>`+
      `<option value="true" ${interventionState?'selected':''}>${esc(l('yes'))}</option></select></div>`+
      criticalControls+
      `<div class="form-group"><label>${esc(l('action'))}</label><select name="action">`+
      `<option value="set">${esc(l('set'))}</option><option value="exclude">${esc(l('exclude'))}</option>`+
      `<option value="restore">${esc(l('restore'))}</option><option value="reroll">${esc(l('reroll'))}</option></select></div>`+
      `<div class="form-group"><label>${esc(l('value'))}</label><input name="value" type="number" step="any" value="0"></div>`+
      `<small>${esc(l('history'))}: ${isDamage?(card.history?.length??0):(get(msg,'rollEdit')?.history?.length??0)}</small>`+
      (feedback?`<div class="fnri-roll-editor-feedback" role="status">${esc(feedback)}</div>`:'')+'</div>';
    const result=await dialog.input({window:{title:l('editRoll')},content,
      ok:{label:l('applyCorrection')},rejectClose:false});
    if(!result)return;
    const id=String(result.part??'');const action=String(result.action??'');
    try {
      if(id==='__intervention__') {await setMessageIntervention(msg,result.intervention==='true');
        feedback=l('interventionSaved');continue;}
      if(id==='__critical__' && isDamage) {
        await setMessageCritical(msg,String(result.criticalMode??'auto'),Number(result.criticalMultiplier));
        feedback=l('criticalSaved');continue;
      }
      const outcome=await executeRollEditorAction(msg,{partId:id,action,value:num(result.value)});
      if(outcome.action==='reroll') {
        feedback=`${l('reroll')}: ${outcome.before} → ${outcome.current}`;
        ui.notifications?.info?.(feedback);
      } else feedback='';
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
    const original=html.querySelector('.dice-roll .dice-total');
    if(original) {original.classList.add('fnri-original-roll');original.title=l('originalTotal');}
    const label=document.createElement('div');label.dataset.fnriRollCorrected='';
    label.className='fnri-roll-corrected';label.textContent=`${l('correctedTotal')}: ${state.currentTotal}`;
    (html.querySelector('.message-content')??html).append(label);
  });
}
