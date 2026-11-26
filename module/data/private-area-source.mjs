import {canReadChatContent} from './chat-visibility.mjs';

const SCOPE = 'fast-nri-v14';
const KEY = 'privateAreaSources';
export const PENDING_AREA_USES = 'pendingAreaUses';
const messageId = /^[A-Za-z0-9]{16}$/;

function isRedacted(message) {
  return message?.getFlag?.(SCOPE,'abilityPublication')?.areaSourceRedacted === true ||
    message?.getFlag?.(SCOPE,'weaponDamage')?.areaOutcomeRedacted === true ||
    message?.getFlag?.(SCOPE,'spellCastRedacted') === true;
}

function* sourceActors() {
  yield* game.actors?.contents ?? [];
  for (const scene of game.scenes?.contents ?? []) {
    for (const token of scene.tokens?.contents ?? []) {
      if (token.actorLink) continue;
      const actor=token.actor;
      if (actor) yield actor;
    }
  }
}

// Correlate by message ID on the original Actor, under its native ownership.
// No source references or copied rules are written to the public message.
export function privateAreaSourceFor(message) {
  if (!game.user?.isGM || !messageId.test(message?.id ?? '') ||
      !isRedacted(message) || !canReadChatContent(message)) return null;
  for (const actor of sourceActors()) {
    const source = actor.getFlag(SCOPE,KEY)?.[message.id];
    if (source) return {...source,actor};
  }
  return null;
}

async function removeLink(actor,id) {
  await actor.update({[`flags.${SCOPE}.${KEY}.-=${id}`]:null},{fnriJournal:{skip:true}});
}

export function followUpSourceFor(message,record) {
  if (!record?.success || !canReadChatContent(message)) return null;
  // A built-in defense always protects its own token. A card can protect
  // an ally while the performer is redacted, so the target is not a fallback.
  const tokenUuid=record.tokenUuid ?? (record.kindKey==='card'?null:record.targetKey);
  const candidates=tokenUuid ? [foundry.utils.fromUuidSync(tokenUuid)?.actor] : sourceActors();
  for (const actor of candidates) {
    if (!actor?.isOwner) continue;
    const source=actor.getFlag(SCOPE,KEY)?.[message.id];
    if (source?.offers && source.actorUuid===actor.uuid) return {actor,source};
  }
  return null;
}

// Keep the price on the performer, including when another token is protected.
export async function createAreaUseMessage(actor,use,publish,id=foundry.utils.randomID()) {
  if (actor.getFlag(SCOPE,'accountingEvents')?.[id]?.areaPerformerUuid===actor.uuid) return publish(id);
  const path=`flags.${SCOPE}.${PENDING_AREA_USES}`;
  try {
    await actor.update({[`${path}.${id}`]:use},{fnriJournal:{skip:true}});
  } catch(error) {
    // Accounting is advisory. Still publish and try to record the use.
    console.warn('Fast NRI | Could not stage area intervention accounting',error);
  }
  let message;
  try {
    message=await publish(id);
    return message;
  } finally {
    const settled=actor.getFlag(SCOPE,'accountingEvents')?.[id]?.areaPerformerUuid===actor.uuid;
    if (!message && (!game.messages?.get(id) || settled) && actor.getFlag(SCOPE,PENDING_AREA_USES)?.[id]) {
      try { await actor.update({[`${path}.-=${id}`]:null},{fnriJournal:{skip:true}}); }
      catch(error) {console.warn('Fast NRI | Could not clear unpublished intervention',error);}
    }
  }
}

export async function createPrivateAreaSourceMessage(data, actor, source) {
  return publishWithAreaSource(actor,source,id=>ChatMessage.create({...data,_id:id},{keepId:true}));
}

/** Reuse the private Actor/message link for a hidden spell's charge receipt.
 * Public non-area results keep their prior visibility; never add hidden weapon UUIDs. */
export async function createSpellResultMessage(data,actor,{spellCast=null,executionId=null,itemUuid=null,redacted=false}={}) {
  if(!spellCast)return ChatMessage.create(data);
  const flags=data.flags[SCOPE];
  if(!redacted){
    if(flags.abilityExecution)Object.assign(flags.abilityExecution,spellCast);
    return ChatMessage.create(data);
  }
  if(!spellCast.chargedWeaponUuid)return ChatMessage.create(data);
  flags.spellCastRedacted=true;
  return createPrivateAreaSourceMessage(data,actor,{actorUuid:actor.uuid,accountingItemUuid:itemUuid,
    executionId,chargedWeaponUuid:spellCast.chargedWeaponUuid});
}

export async function publishWithAreaSource(actor,source,publish,id=foundry.utils.randomID()) {
  try {
    await actor.update({[`flags.${SCOPE}.${KEY}.${id}`]:source},{fnriJournal:{skip:true}});
  } catch(error) {
    if (!source.offers) throw error;
    // Failing to save optional choices must not discard the defense roll.
    console.warn('Fast NRI | Could not save optional intervention choices',error);
    return publish(id);
  }
  let message;
  try {
    message=await publish(id);
    return message;
  } finally {
    if (!message && !game.messages?.get(id)) {
      try { await removeLink(actor,id); }
      catch (error) { console.warn('Fast NRI | Could not remove unused area source reference',error); }
    }
  }
}

export function registerPrivateAreaSourceCleanup() {
  Hooks.on('deleteChatMessage',(message,_options,userId)=>{
    if (game.user?.id !== userId) return;
    if (message.getFlag(SCOPE,'areaIntervention')) {
      for (const actor of sourceActors()) {
        if (!actor.isOwner) continue;
        const changes={};
        for (const key of [KEY,PENDING_AREA_USES]) {
          if (actor.getFlag(SCOPE,key)?.[message.id]?.actorUuid===actor.uuid)
            changes[`flags.${SCOPE}.${key}.-=${message.id}`]=null;
        }
        if (Object.keys(changes).length) void actor.update(changes,{fnriJournal:{skip:true}})
          .catch(error=>console.warn('Fast NRI | Could not clear deleted intervention',error));
      }
      return;
    }
    const source = privateAreaSourceFor(message);
    if (source) void removeLink(source.actor,message.id)
      .catch(error=>console.warn('Fast NRI | Could not remove area source reference',error));
  });
}
