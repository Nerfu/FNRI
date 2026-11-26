/**
 * Stage 3C.4 — one character 0-HP lifecycle for the existing HP, Item and
 * periodic channels. Mechanical rules come ONLY from Fast NRI 7.0.
 *
 * Native Actor flags and native Item-authored ActiveEffects are used. This
 * module never prevents an Actor update, movement or an action. The character
 * owner can edit HP and effects using ordinary Foundry permissions.
 */
import {queueActorWrite} from '../data/ability-accounting.mjs';
import {stableDocumentId} from '../data/document-id.mjs';
import {createCardEffectData} from '../effects/apply-card-effect.mjs';
import {resolveSystemContentItem} from '../data/system-content.mjs';

const SCOPE='fast-nri-v14';
const IDS=Object.freeze({
  unconscious:'fnri7.rulebook.condition.unconscious',
  prone:'fnri7.rulebook.condition.prone'
});
const obj=v=>v && typeof v==='object' && !Array.isArray(v)?v:{};
const nonnegative=v=>Number.isSafeInteger(v) && v>=0;
const canWrite=actor=>!!actor && actor.documentName==='Actor' &&
  (game.user?.isGM===true || actor.canUserModify?.(game.user,'update')===true || actor.isOwner===true);
export const deathStateOf=actor=>obj(actor?.getFlag?.(SCOPE,'deathState'));

export function deathStateUpdate(actor,state,reason) {
  const flag=`flags.${SCOPE}.deathState`;
  const patch={
    [flag]:state ? {...state} : null,
    [`flags.${SCOPE}.deathEffectsPending`]:{version:1,reason}
  };
  if (state) {
    // Document updates merge nested flag objects. Remove keys that did not
    // exist in the saved state (for example, the last processed turn).
    for (const key of Object.keys(deathStateOf(actor))) {
      if (!Object.hasOwn(state,key)) patch[`${flag}.-=${key}`]=null;
    }
  }
  return patch;
}

function conditionOf(effect) {
  return effect?.getFlag?.(SCOPE,'conditionId') ?? effect?.flags?.[SCOPE]?.conditionId ?? null;
}
function generated(actor,id) {
  return (actor.effects?.contents??[]).filter(effect=>
    effect.id===stableDocumentId('fzd',[actor.uuid,id]) && conditionOf(effect)===id && effect.getFlag?.(SCOPE,'deathLifecycle')?.version===1);
}
async function templateFor(id) {
  const key=IDS[id];
  const item=await resolveSystemContentItem(key);
  if (!item) return null;
  const templates=(item.effects?.contents??[]).filter(effect=>conditionOf(effect)===id && effect.transfer!==true);
  return templates.length===1?{item,template:templates[0]}:null;
}
/** No custom statuses, no name matching: the unified content Item supplies
 * the native ActiveEffect template. A missing template is advisory, not a
 * reason to reject HP changes. No deletion of player-created effects. */
export async function reconcileDeathEffects(actor) {
  if (!canWrite(actor) || actor.type!=='character') return {status:'no-permission-or-not-character'};
  const hp=actor.system?.hp?.current;
  const death=deathStateOf(actor);
  if (!nonnegative(hp)) return {status:'unavailable-hp'};
  const shouldBeUnconscious=hp===0 && death.version===1;
  const missing=[];
  const created=[];
  const removed=[];
  if (shouldBeUnconscious) {
    const create=[];
    for (const id of ['unconscious','prone']) {
      if (generated(actor,id).length) continue;
      const source=await templateFor(id);
      if (!source) {missing.push(IDS[id]);continue;}
      const newId=stableDocumentId('fzd',[actor.uuid,id]);
      const data=createCardEffectData(source.item,source.template,actor);
      data._id=newId;
      data.flags ??= {};
      data.flags[SCOPE] ??= {};
      data.flags[SCOPE].deathLifecycle={version:1,reason:'hp-zero',conditionId:id};
      create.push(data);
    }
    if (create.length) {
      // Persistent IDs permit an idempotent retry after an uncertain ack.
      try {await actor.createEmbeddedDocuments('ActiveEffect',create,{keepId:true});}
      catch(error) {
        if (!create.every(data=>actor.effects?.get(data._id)?.getFlag?.(SCOPE,'deathLifecycle')?.version===1))
          throw error;
      }
      created.push(...create.map(data=>data._id));
    }
  } else if (hp>0 && death.dead!==true) {
    // Successful healing removes only unconsciousness created by this system.
    // Prone persists even when it was created at the same 0-HP transition.
    const ids=generated(actor,'unconscious').map(effect=>effect.id);
    if (ids.length) {
      await actor.deleteEmbeddedDocuments('ActiveEffect',ids);
      removed.push(...ids);
    }
  }
  if (!missing.length) {
    const pending=actor.getFlag?.(SCOPE,'deathEffectsPending');
    if (pending) await actor.update({[`flags.${SCOPE}.-=deathEffectsPending`]:null},
      {fnriJournal:{skip:true},fnriDeathLifecycle:'managed'});
  }
  return {status:missing.length?'missing-content-template':'synchronized',missing,created,removed};
}

function attackLoss({degree=null,naturalD20=null}={}) {
  if (naturalD20===20) return 3;
  if (degree==='great') return 2;
  if (degree==='partial' || degree==='success') return 1;
  return 0; // Unclassified manual damage has no invented attack degree.
}
/** hitPointsDamage is the damage left after temporary HP, before flooring
 * current HP at zero. "periodic" always ignores temporary HP.
 * On initial fall from positive HP only periodic damage decrements the new
 * counter for its triggering hit. */
export async function planDeathTransition(actor,{before,after,kind='damage',
  hitPointsDamage=0,periodic=false,degree=null,naturalD20=null}={}) {
  const empty={patch:{},changed:false,roll:null,needsEffects:false};
  if (actor?.type!=='character' || !nonnegative(before) || !nonnegative(after)) return empty;
  const old={...deathStateOf(actor)};
  let next=null;
  let roll=null;
  const positiveHit=kind==='damage' && hitPointsDamage>0;
  if (before>0 && after===0 && positiveHit) {
    roll=await new Roll('1d4+3').evaluate({allowInteractive:false});
    if (!nonnegative(Number(roll.total))) throw Error('Invalid death counter roll');
    const initial=Number(roll.total);
    next={version:1,initial,remaining:Math.max(0,initial-(periodic?1:0)),dead:false};
  } else if (before===0 && after===0 && positiveHit && old.version!==1) {
    // The Actor may have arrived at zero through a previously manual path.
    // Do not abandon its first recorded hit merely because no state exists.
    roll=await new Roll('1d4+3').evaluate({allowInteractive:false});
    const initial=Number(roll.total);
    if (!nonnegative(initial)) throw Error('Invalid death counter roll');
    const amount=periodic?1:attackLoss({degree,naturalD20});
    next={version:1,initial,remaining:Math.max(0,initial-amount),dead:initial<=amount};
  } else if (before===0 && after===0 && positiveHit && old.version===1 &&
      !old.dead && nonnegative(old.remaining)) {
    const amount=periodic?1:attackLoss({degree,naturalD20});
    if (amount>0) next={...old,remaining:Math.max(0,old.remaining-amount),
      dead:old.remaining<=amount};
  } else if (kind==='heal' && after>0 && old.version===1 && !old.dead) {
    next=null; // Recovery does NOT remove the separately owned Prone condition.
  }
  if (next===null && !(kind==='heal' && after>0 && old.version===1 && !old.dead)) return empty;
  // A successful heal clears the flag. An explicit GM reversal/revival can
  // still edit it directly; never override a 'dead' record via ordinary heal.
  const patch=deathStateUpdate(actor,next,next?'hp-zero':'healed');
  return {patch,changed:true,roll,needsEffects:true,before:old,after:next};
}

/** The same native end-turn identity used for periodic effects. A dead Actor
 * is no longer decremented. A round reversal never creates another charge. */
export async function advanceDeathEndTurn(actor,identity) {
  if (actor?.type!=='character' || !canWrite(actor) || !identity?.key) return null;
  const death=deathStateOf(actor);
  const turnPrefix = `${identity.combatId}:${identity.combatantId}:`;
  const previousRound = death.lastTurnKey?.startsWith?.(turnPrefix)
    ? Number(death.lastTurnKey.slice(turnPrefix.length)) : null;
  if (actor.system?.hp?.current!==0 || death.version!==1 ||
      !nonnegative(death.remaining) || death.dead===true ||
      death.lastTurnKey===identity.key ||
      (Number.isSafeInteger(previousRound) && previousRound>=identity.round)) return null;
  const after={...death,remaining:Math.max(0,death.remaining-1),
    dead:death.remaining<=1,lastTurnKey:identity.key};
  await actor.update({[`flags.${SCOPE}.deathState`]:after},
    {fnriJournal:{skip:true},fnriDeathLifecycle:'managed'});
  return after;
}

/** Manual sheet edits are never blocked. The initiating client reconciles
 * only actual HP edits (other clients must not duplicate the initial die).
 * Explicit HP/Item/periodic routes set 'managed' and reconcile themselves.
 * A manual zero does not pretend to know an attack or subtract damage twice.
 */
export function registerDeathLifecycle() {
  Hooks.on('updateActor',(actor,changed,options,userId)=>{
    if (game.system?.id!==SCOPE || userId!==game.user?.id ||
        options?.fnriDeathLifecycle==='managed' || actor?.type!=='character') return;
    const delta=foundry.utils.expandObject(changed);
    if (!Object.hasOwn(obj(delta.system?.hp),'current')) return;
    void queueActorWrite(actor,async()=>{
      if (!canWrite(actor)) return;
      const hp=actor.system?.hp?.current;
      const old=deathStateOf(actor);
      if (!nonnegative(hp)) return;
      if (hp===0 && old.version!==1) {
        // Manual correction/HP entry: initiate countdown without inventing
        // directed attack damage, natural 20 or a cause-specific penalty.
        const roll=await new Roll('1d4+3').evaluate({allowInteractive:false});
        const initial=Number(roll.total);
        if (!nonnegative(initial) || actor.system?.hp?.current!==0 ||
            deathStateOf(actor).version===1) return;
        await actor.update({[`flags.${SCOPE}.deathState`]:{
          version:1,initial,remaining:initial,dead:false
        },[`flags.${SCOPE}.deathEffectsPending`]:{version:1,reason:'manual-hp-zero'}},
        {fnriJournal:{skip:true},fnriDeathLifecycle:'managed'});
      } else if (hp>0 && old.version===1 && !old.dead) {
        await actor.update({[`flags.${SCOPE}.deathState`]:null,
          [`flags.${SCOPE}.deathEffectsPending`]:{version:1,reason:'manual-hp-healed'}},
        {fnriJournal:{skip:true},fnriDeathLifecycle:'managed'});
      }
      try {await reconcileDeathEffects(actor);}
      catch(error) {console.warn('Fast NRI | manual 0-HP effect sync needs retry',error);}
    }).catch(error=>console.error('Fast NRI | manual 0-HP reconciliation failed',error));
  });
}
