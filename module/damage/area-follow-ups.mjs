import {canReadChatContent,chatAudience} from '../data/chat-visibility.mjs';
import {followUpSourceFor,publishWithAreaSource} from '../data/private-area-source.mjs';
import {publishAreaUse} from '../data/ability-accounting.mjs';
import {redactActorSourceForAudience} from '../rolls/roll-context.mjs';

const SCOPE='fast-nri-v14';
const triggers=new Set(['dodge','counteraction','card']);
const allowedId=/^[A-Za-z0-9_-]{1,64}$/;
const tokenDocument=uuid=>uuid ? foundry.utils.fromUuidSync(uuid) : null;

function cardRules(item,trigger) {
  const rules=item.system?.mechanics?.areaFollowUps;
  if (!Array.isArray(rules) || !triggers.has(trigger)) return [];
  return rules.filter(rule=>rule && typeof rule.id==='string' && allowedId.test(rule.id) &&
    rules.filter(other=>other?.id===rule.id).length===1 && rule.after===trigger &&
    Number.isInteger(rule.degreeReduction) && rule.degreeReduction>=1 && rule.degreeReduction<=3);
}

// Reserve one native message ID per offered choice. Only the performer's
// Actor holds the Item/option references, even for a publicly visible roll.
export function publishWithFollowUpOffers({actor,token,record,publish,messageId}) {
  if (record.success!==true) return publish(messageId);
  const offers=[];
  for (const item of actor.items.contents) {
    for (const rule of cardRules(item,record.kindKey)) {
      offers.push({itemId:item.id,ruleId:rule.id,messageId:foundry.utils.randomID()});
    }
  }
  // Same format marker for every success; the public roll reveals no inventory.
  record.followUpVersion=1;
  if (!offers.length) return publish(messageId);
  return publishWithAreaSource(actor,{actorUuid:actor.uuid,tokenUuid:token.document.uuid,offers},publish,messageId);
}

export function availableAreaFollowUps(message) {
  const parent=game.messages.get(message?.id);
  const record=parent?.getFlag(SCOPE,'areaIntervention');
  if (record?.followUpVersion!==1 || record.success!==true || !canReadChatContent(parent)) return [];
  const root=game.messages.get(record.rootMessageId);
  const area=root?.getFlag(SCOPE,'weaponDamage')?.areaAttack;
  if (!canReadChatContent(root) || !area?.targets?.some(target=>target.key===record.targetKey)) return [];
  const target=tokenDocument(record.targetKey);
  if (!target || target.hidden) return [];
  const binding=followUpSourceFor(parent,record);
  if (!binding) return [];
  const {actor,source}=binding;
  const performer=tokenDocument(source.tokenUuid);
  if (performer?.actor?.uuid!==actor.uuid) return [];
  const choices=[];
  for (const offer of source.offers) {
    if (game.messages.has(offer.messageId)) continue;
    const item=actor.items.get(offer.itemId);
    const rule=item && cardRules(item,record.kindKey).find(entry=>entry.id===offer.ruleId);
    if (!rule) continue;
    const label=typeof rule.label==='string' && rule.label.trim() ? rule.label.trim() : item.name;
    choices.push({messageId:offer.messageId,label,rule,actor,item,performer,parent,record});
  }
  return choices;
}

export async function applyAreaFollowUp(message,id) {
  const choice=availableAreaFollowUps(message).find(option=>option.messageId===id);
  if (!choice) return null;
  const {actor,item,rule}=choice;
  return publishAreaUse({actor,item,execution:{accounting:rule.accounting},isIntervention:false,
    messageId:id,publish:async()=>{
      // Staging the price can yield. Recheck the live parent, token, rights
      // and selected card before publishing or incurring a cost.
      const current=availableAreaFollowUps(message).find(option=>option.messageId===id);
      if (!current || current.actor.uuid!==actor.uuid || current.item.uuid!==item.uuid) return null;
      const {parent,record,performer}=current;
      const redacted=!record.actorUuid || performer.hidden || redactActorSourceForAudience(actor,parent);
      const label=redacted ? game.i18n.localize('FASTNRI.AreaIntervention.followUp') : choice.label;
      const content=document.createElement('strong');
      content.textContent=label;
      const result={version:1,rootMessageId:record.rootMessageId,parentMessageId:parent.id,
        targetKey:record.targetKey,targetName:record.targetName,kind:label,kindKey:'followUp',
        success:true,degreeReduction:rule.degreeReduction};
      try {
        return await ChatMessage.create({_id:id,content:content.outerHTML,
          speaker:redacted?{alias:'Fast NRI'}:ChatMessage.getSpeaker({actor,token:performer}),
          ...chatAudience(parent),flags:{[SCOPE]:{areaIntervention:result}}},{keepId:true});
      } catch(error) {
        const existing=game.messages.get(id)?.getFlag(SCOPE,'areaIntervention');
        if (existing?.kindKey==='followUp' && existing.parentMessageId===parent.id) return null;
        throw error;
      }
    }});
}
