/** A single view over version-2 damage snapshots, including linked interventions. */
import {damageDisplay} from './damage-core.mjs';
import {applyCardDamage,renderHpReport} from './hp-actions.mjs';
import {initiateIntervention} from './interventions.mjs';
import {messageIntervention} from '../rolls/attack-properties.mjs';
import {highlightDiceResults} from './dice-highlights.mjs';
const ID='fast-nri-v14';
const l=k=>game.i18n.localize('FASTNRI.Damage.'+k);
const own=m=>game.user?.isGM || m.isAuthor;

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
    else if(part.kind==='die' && Number.isInteger(part.faces)) {
      if(part.value===1)p.classList.add('fnri-die-min');
      if(part.value===part.faces)p.classList.add('fnri-die-max');
    }
    p.title=[part.damageType,...(part.traits??[])].filter(Boolean).join(' · ');
    lines.append(p);
  }
  container.append(lines);
  const values=damageDisplay(card);
  if((card.history??[]).some(h=>['set','reroll','exclude','restore'].includes(h.action))) {
    const original=html.querySelector('.dice-roll .dice-total');
    if(original) {original.classList.add('fnri-original-roll');original.title=l('originalTotal');}
  }
  const totalRow=element('div','fnri-damage-totals');
  const summary=element('span','fnri-damage-total',`${l('total')}: ${values.expression}`);
  if(values.active)summary.classList.add('fnri-crit-active');
  totalRow.append(summary);container.append(totalRow);
  const chain=(card.history??[]).filter(h=>h.action==='intervention');
  if(chain.length)container.append(element('small','fnri-damage-history',chain.map(h=>h.name??(h.source==='builtin:selfDefense'?l('selfDefense'):
    (h.source??l('intervention')))).join(' → ')));
  const intervene=actionButton(l('intervention'),()=>initiateIntervention(message));
  intervene.classList.add('fnri-intervene-button');
  if(messageIntervention(message)) {intervene.disabled=true;intervene.title=l('interventionBlocked');}
  container.append(intervene);
  const row=element('div','fnri-damage-bottom');
  if(values.active) {
    const crit=actionButton(l('applyCritical'),()=>applyCardDamage(message,{critical:true}));
    crit.classList.add('fnri-apply-button');crit.classList.add('fnri-crit-active');
    const normal=actionButton(l('applyNormal'),()=>applyCardDamage(message,{critical:false}));
    normal.classList.add('fnri-apply-normal-button');normal.classList.add('fnri-secondary-damage-button');
    row.append(crit,normal);
  } else {
    // Manual critical damage must remain available even when the triggering
    // attack is not a natural critical. Applying it does not mutate this card.
    const apply=actionButton(l('apply'),()=>applyCardDamage(message,{critical:false}));
    apply.classList.add('fnri-apply-button');
    const crit=actionButton(l('critical'),()=>applyCardDamage(message,{critical:true}));
    crit.classList.add('fnri-crit-button');crit.classList.add('fnri-secondary-damage-button');
    row.append(apply,crit);
  }
  container.append(row);
  anchor.append(container);
}

export function registerDamageChatControls() {
  Hooks.on('renderChatMessageHTML',(msg,html)=>{
    renderDamageCard(msg,html);renderHpReport(msg,html);
    highlightDiceResults(msg,html);
    // Some v14 chat skins build the tooltip only when the dice are expanded.
    html?.addEventListener?.('click',event=>{
      if(event?.target?.closest?.('.dice-roll')) queueMicrotask(()=>highlightDiceResults(msg,html));
    });
  });
}
