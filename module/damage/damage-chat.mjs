import {canReadChatContent} from '../data/chat-visibility.mjs';
import {renderAreaChat} from './area-attack.mjs';
import {directedPostDefenseChoices,publishPostDefenseDamage} from './post-defense-damage.mjs';
/** A single view over version-2 damage snapshots, including linked interventions. */
import {damageDisplay,largestDamageDieHealing} from './damage-core.mjs';
import {applyCardDamage,renderHpReport,applyHp,chooseHpRecipient} from './hp-actions.mjs';
import {initiateIntervention} from './interventions.mjs';
import {messageIntervention} from '../rolls/attack-properties.mjs';
import {highlightDiceResults,highlightCheckTotal} from './dice-highlights.mjs';
import {renderCoverAlly} from './cover-ally.mjs';
import {isCurrentDirectedCoverSource} from './cover-ally-state.mjs';
const ID='fast-nri-v14';
const l=k=>game.i18n.localize('FASTNRI.Damage.'+k);
const own=m=>game.user?.isGM || m.isAuthor;

const element=(tag,css,text)=>{const e=document.createElement(tag);if(css)e.className=css;if(text!==undefined)e.textContent=String(text);return e;};
function actionButton(label,action) {
  const b=element('button','fnri-damage-button',label);b.type='button';
  // No visible button is disabled. An in-flight guard avoids duplicate writes,
  // without turning the control grey or changing its availability.
  let pending=false;
  b.addEventListener('click',async(event)=>{if(pending)return;pending=true;
    try{await action(event);}catch(error){console.error('Fast NRI | damage action failed',error);ui.notifications?.error(l('error'));}
    finally{pending=false;}});
  return b;
}

export function renderDamageCard(message,html) {
  if(!canReadChatContent(message)||!html?.querySelector)return;
  const card=message?.getFlag?.(ID,'weaponDamage');
  if(renderCoverAlly(message,html))return;
  if(renderAreaChat(message,html))return;
  if(!card || card.version!==2)return;
  // On document updates Foundry may reuse the chat element. Rebuild this view
  // from flags so a GM override immediately adds/removes its intervention button.
  html.querySelector('[data-fnri-damage-card]')?.remove?.();
  const anchor=html.querySelector('.message-content')??html;
  const container=element('div','fnri-damage-card');container.dataset.fnriDamageCard='';
  const attack=element('div','fnri-damage-attack',`${l('attackTotal')}: ${card.attackTotal??'—'}`);
  container.append(attack);
  if(card.intervention?.id==='builtin:selfDefense' && typeof card.intervention.success==='boolean') {
    const result=element('div',`fnri-defense-result ${card.intervention.success?'fnri-defense-success':'fnri-defense-failure'}`,l(card.intervention.success?'defenseSuccess':'defenseFailure'));
    container.append(result);
    if(card.intervention.success && Number.isFinite(card.intervention.damageReduction))
      container.append(element('div','fnri-defense-reduction',`${l('damageReducedBy')}: ${card.intervention.damageReduction}`));
  }
  const lines=element('div','fnri-damage-parts');
  for(const part of card.parts??[]) {
    const p=element('span','fnri-damage-part',`${part.formula??part.id}: ${part.pending?l('unrolledDie'):part.value}${part.noReroll?' · '+l('cannotReroll'):''}`);
    if(part.excluded||part.immune)p.classList.add('fnri-damage-excluded');
    else if(part.kind==='die' && Number.isInteger(part.faces)) {
      if(part.value===1)p.classList.add('fnri-die-min');
      if(part.value===part.faces)p.classList.add('fnri-die-max');
    }
    p.title=[part.damageType,...(part.traits??[]),...(part.noReroll?[l('cannotReroll')]:[])].filter(Boolean).join(' · ');
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
  // The latest defensive result may still be followed by Cover Ally.
  // Other interventions keep the existing GM override and menu rules.
  if(!card.postDefenseOrigin && (!messageIntervention(message) || isCurrentDirectedCoverSource(message))) {
    const intervene=actionButton(l('intervention'),event=>initiateIntervention(message,{skipPreroll:!!event?.shiftKey}));
    intervene.classList.add('fnri-intervene-button');
    container.append(intervene);
  }
  const row=element('div','fnri-damage-bottom');
  if(card.noCritical===true) {
    const apply=actionButton(l('apply'),()=>applyCardDamage(message,{critical:false}));
    apply.classList.add('fnri-apply-button');row.append(apply);
  } else if(values.active) {
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
  const healing=largestDamageDieHealing(card);
  if(healing!==null){
    container.append(element('div','fnri-damage-attack',`${l('heal')}: ${healing}`));
    container.append(actionButton(`${l('heal')} (${healing})`,async()=>{
      const recipient=await chooseHpRecipient();if(!recipient)return;
      const current=game.messages?.get(message.id);if(!canReadChatContent(current))return;
      const amount=largestDamageDieHealing(current.getFlag(ID,'weaponDamage'));
      if(amount!==null)await applyHp({kind:'heal',amount,sourceMessage:current,...recipient,independent:true});
    }));
  }
  for(const choice of directedPostDefenseChoices(message))
    container.append(actionButton(choice.label,()=>publishPostDefenseDamage(choice,()=>directedPostDefenseChoices(message))));
  anchor.append(container);
}

/** Refresh displayed cards after their message flags change, including for other clients. */
export function refreshDamageMessage(message) {
  if(!message?.id || typeof document==='undefined' || typeof document.querySelectorAll!=='function')return;
  for(const el of document.querySelectorAll('.chat-message')) {
    if(el?.dataset?.messageId===message.id){renderDamageCard(message,el);highlightCheckTotal(message,el);}
  }
}

export function registerDamageChatControls() {
  Hooks.on('updateChatMessage',msg=>refreshDamageMessage(msg));
  const refreshLinked=msg=>{
    const card=msg.getFlag?.(ID,'weaponDamage');
    const areaChoice=msg.getFlag?.(ID,'areaResult');
    const choiceRoot=areaChoice?.results?.some(row=>Array.isArray(row.profileChoices))?areaChoice.rootMessageId:null;
    const rootId=choiceRoot??card?.postDefenseOrigin?.rootMessageId??(card?.postDefenseDamage?.length?card.attackMessageId:null)??
      msg.getFlag?.(ID,'areaIntervention')?.rootMessageId;
    if(!rootId)return;
    for(const related of game.messages?.contents??[]){
      if(related.id===msg.id)continue;
      const c=related.getFlag?.(ID,'weaponDamage');
      if((related.id===rootId&&(c?.postDefenseDamage?.length||choiceRoot))||
        (c?.attackMessageId===rootId&&c?.postDefenseDamage?.length)||
        related.getFlag?.(ID,'areaResult')?.rootMessageId===rootId)refreshDamageMessage(related);
    }
  };
  Hooks.on('createChatMessage',refreshLinked);
  Hooks.on('deleteChatMessage',refreshLinked);
  Hooks.on('renderChatMessageHTML',(msg,html)=>{
    renderDamageCard(msg,html);renderHpReport(msg,html);
    highlightDiceResults(msg,html);highlightCheckTotal(msg,html);
    // Some v14 chat skins build the tooltip only when the dice are expanded.
    html?.addEventListener?.('click',event=>{
      if(event?.target?.closest?.('.dice-roll')) queueMicrotask(()=>{highlightDiceResults(msg,html);highlightCheckTotal(msg,html);});
    });
  });
}
