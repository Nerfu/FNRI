/** A single view over version-2 damage snapshots, including linked interventions. */
import {calculateDamage,copy} from './damage-core.mjs';
import {applyCardDamage,renderHpReport} from './hp-actions.mjs';
import {initiateIntervention} from './interventions.mjs';
const ID='fast-nri-v14';
const l=k=>game.i18n.localize('FASTNRI.Damage.'+k);
const own=m=>game.user?.isGM || m.isAuthor;

export async function toggleManualCritical(message) {
  const card=message?.getFlag?.(ID,'weaponDamage');
  if(!card || card.version!==2 || !own(message) || message.canUserModify?.(game.user,'update')===false)
    throw new Error('Cannot toggle this critical');
  const next=copy(card);
  next.manualCritical=card.manualCritical===null ? card.naturalD20!==20 : !card.manualCritical;
  next.revision=(card.revision??0)+1;
  next.history=[...(card.history??[]),{at:Date.now(),by:game.user.id,action:'critical',
    before:card.manualCritical,after:next.manualCritical}];
  await message.update({[`flags.${ID}.weaponDamage`]:next});
  return next;
}

const element=(tag,css,text)=>{const e=document.createElement(tag);if(css)e.className=css;if(text!==undefined)e.textContent=String(text);return e;};
function actionButton(label,action) {
  const b=element('button','fnri-damage-button',label);b.type='button';
  b.addEventListener('click',async()=>{if(b.disabled)return;b.disabled=true;
    try{await action();}catch(error){console.error('Fast NRI | damage action failed',error);ui.notifications?.error(l('error'));}
    finally{b.disabled=false;}});
  return b;
}

export function renderDamageCard(message,html) {
  const card=message?.getFlag?.(ID,'weaponDamage');
  if(!card || card.version!==2 || !html?.querySelector || html.querySelector('[data-fnri-damage-card]'))return;
  const anchor=html.querySelector('.message-content')??html;
  const container=element('div','fnri-damage-card');container.dataset.fnriDamageCard='';
  const attack=element('div','fnri-damage-attack',`${l('attackTotal')}: ${card.attackTotal??'—'}`);
  container.append(attack);
  const lines=element('div','fnri-damage-parts');
  for(const part of card.parts??[]) {
    const p=element('span','fnri-damage-part',`${part.formula??part.id}: ${part.value}`);
    if(part.excluded||part.immune)p.classList.add('fnri-damage-excluded');
    p.title=[part.damageType,...(part.traits??[])].filter(Boolean).join(' · ');
    lines.append(p);
  }
  container.append(lines);
  const values=calculateDamage(card);
  container.append(element('div','fnri-damage-total',`${l('total')}: ${values.total}`+
    (values.multiplier>1?` ×${values.multiplier}`:'') ));
  const chain=(card.history??[]).filter(h=>h.action==='intervention');
  if(chain.length)container.append(element('small','fnri-damage-history',chain.map(h=>h.name??(h.source==='builtin:selfDefense'?l('selfDefense'):
    (h.source??l('intervention')))).join(' → ')));
  const intervene=actionButton(l('intervention'),()=>initiateIntervention(message));
  intervene.classList.add('fnri-intervene-button');container.append(intervene);
  const row=element('div','fnri-damage-bottom');
  const apply=actionButton(l('apply'),()=>applyCardDamage(message));apply.classList.add('fnri-apply-button');
  const crit=actionButton(l('critical'),()=>toggleManualCritical(message));
  crit.classList.add('fnri-crit-button');
  if(values.multiplier>1)crit.classList.add('fnri-crit-active');
  if(!own(message))crit.disabled=true;
  row.append(apply,crit);container.append(row);
  anchor.append(container);
}

export function registerDamageChatControls() {
  Hooks.on('renderChatMessageHTML',(msg,html)=>{renderDamageCard(msg,html);renderHpReport(msg,html);});
}
