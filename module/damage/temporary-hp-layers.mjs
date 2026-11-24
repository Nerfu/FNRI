import {queueActorWrite} from '../data/ability-accounting.mjs';
/**
 * Fast NRI 7.0: independent, NON-ADDITIVE temporary HP sources.
 * Damage simultaneously reduces every live layer by the FULL incoming damage
 * absorbed by the temporary-HP pool. The pool shown on the Actor is the
 * maximum remaining layer. Replacing a maximum does not delete older layers.
 *
 * Data is Actor-owned and optional: flags.fast-nri-v14.tempHpState. A legacy
 * positive system.hp.temp is represented as a source-less layer on first write;
 * no world migration, new roles, or Item snapshots are required.
 */
export const TEMP_HP_SCOPE='fast-nri-v14';
export const TEMP_HP_FLAG=`flags.${TEMP_HP_SCOPE}.tempHpState`;
const amount=n=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0?n:0;
const obj=x=>x&&typeof x==='object'&&!Array.isArray(x)?x:{};
const copy=value=>structuredClone(value);
const layersOf=state=>Object.values(obj(state?.layers));
const idValid=id=>typeof id==='string' && /^[A-Za-z0-9_-]{1,100}$/.test(id);
const normalizeLayer=(id,value)=>{
  const row=obj(value);
  const initial=amount(row.initial);
  const remaining=Math.min(initial,amount(row.remaining));
  return {id,initial,remaining,
    source:obj(row.source),
    createdWorldTime:typeof row.createdWorldTime==='number'&&Number.isFinite(row.createdWorldTime)?row.createdWorldTime:null,
    expiry:obj(row.expiry)};
};
export function normalizeTempHpState(value,legacyTemp=0) {
  if (value?.version===1 && value.layers && typeof value.layers==='object' && !Array.isArray(value.layers)) {
    const layers={};
    for(const [id,raw] of Object.entries(value.layers)) {
      if(idValid(id))layers[id]=normalizeLayer(id,raw);
    }
    return {version:1,layers};
  }
  const old=amount(legacyTemp);
  return {version:1,layers:old?{legacy:{id:'legacy',initial:old,remaining:old,
    source:{kind:'legacy'},createdWorldTime:null,expiry:{}}}:{}};
}
export const tempHpMax=state=>Math.max(0,...layersOf(state).map(layer=>amount(layer.remaining)));
/** Only IDs and HP amounts go into a ChatMessage HP receipt, never names,
 * hidden source metadata, Item data, or ActiveEffect snapshots. */
export const tempHpReceipt=state=>Object.fromEntries(Object.entries(
  normalizeTempHpState(state).layers).map(([id,layer])=>[id,layer.remaining]));
export const sameTempHpReceipt=(state,receipt)=>{
  const actual=tempHpReceipt(state),expected=obj(receipt);
  return Object.keys(actual).length===Object.keys(expected).length &&
    Object.keys(actual).every(id=>actual[id]===expected[id]);
};
export function restoreTempHpReceipt(currentState,beforeReceipt) {
  const result=copy(normalizeTempHpState(currentState)),before=obj(beforeReceipt);
  for(const id of Object.keys(result.layers)) {
    if(!Object.hasOwn(before,id))delete result.layers[id];
    else result.layers[id].remaining=Math.min(result.layers[id].initial,amount(before[id]));
  }
  if(Object.keys(result.layers).length!==Object.keys(before).length)
    throw Error('A temporary HP source needed for undo no longer exists');
  return result;
}
export const equalTempHpState=(a,b)=>JSON.stringify(normalizeTempHpState(a))===JSON.stringify(normalizeTempHpState(b));
export function readTempHpState(actor) {
  return normalizeTempHpState(actor?.getFlag?.(TEMP_HP_SCOPE,'tempHpState') ??
    actor?.flags?.[TEMP_HP_SCOPE]?.tempHpState,actor?.system?.hp?.temp);
}
/** Use a snapshot ONLY when the caller plans to write it back to the Actor. */
export function layeredHpSnapshot(actor) {
  return {...(actor?.system?.hp??{}),tempHpState:readTempHpState(actor)};
}
export function planTempHpLayers(state,value,kind,{id=null,source={},worldTime=null,expiry={}}={}) {
  const before=normalizeTempHpState(state);
  const next=copy(before);
  const requested=amount(value);
  if (kind==='damage') {
    // Simultaneous reduction, including a weaker hidden layer.
    for(const layer of Object.values(next.layers))layer.remaining=Math.max(0,layer.remaining-requested);
  } else if (kind==='grant') {
    if(requested>0) {
      if(!idValid(id))throw Error('Temporary HP layer requires a stable source instance ID');
      if(next.layers[id])throw Error('Temporary HP layer already exists');
      next.layers[id]={id,initial:requested,remaining:requested,
        source:obj(source),createdWorldTime:typeof worldTime==='number'&&Number.isFinite(worldTime)?worldTime:null,
        expiry:obj(expiry)};
    }
  } else if (kind==='remove') {
    if(!idValid(id))throw Error('Layer ID missing');
    delete next.layers[id];
  } else if(kind!=='keep')throw Error('Unknown temporary HP operation');
  return {before,after:next,from:tempHpMax(before),to:tempHpMax(next)};
}
/** A direct edit of the old numeric field remains possible. Decreasing it
 * reduces EVERY surviving layer by the same delta; increasing it makes a new
 * manual layer instead of silently overwriting previous source records.
 */
/** Foundry document updates recursively MERGE object flags. Always address
 * removed layer keys with the native `.-=id` deletion syntax, never assume
 * updating a map to {} deletes its previous children. */
export function tempHpStateUpdate(actor,nextState) {
  const raw=actor?.getFlag?.(TEMP_HP_SCOPE,'tempHpState')??
    actor?.flags?.[TEMP_HP_SCOPE]?.tempHpState;
  const old=raw?.version===1?normalizeTempHpState(raw):{version:1,layers:{}};
  const next=normalizeTempHpState(nextState);
  const base=`${TEMP_HP_FLAG}.layers`;
  const patch={[`${TEMP_HP_FLAG}.version`]:1};
  for(const id of Object.keys(old.layers)){
    if(!Object.hasOwn(next.layers,id))patch[`${base}.-=${id}`]=null;
  }
  for(const [id,layer] of Object.entries(next.layers))patch[`${base}.${id}`]=layer;
  return patch;
}
export function planManualTempHpEdit(state,newValue,{id=null}={}) {
  const old=tempHpMax(state),value=amount(newValue);
  if(value===old)return normalizeTempHpState(state);
  if(value<old)return planTempHpLayers(state,old-value,'damage').after;
  return planTempHpLayers(state,value,'grant',{id,source:{kind:'manual'}}).after;
}
const randomId=()=>foundry.utils.randomID();
const worldTime=()=>typeof game?.time?.worldTime==='number'?game.time.worldTime:null;
/** World-time expiration never exceeds the Rulebook's 10-minute maximum.
 * Legacy scalar HP has unknown timing and is not retroactively expired. */
export function cappedTempHpExpiry(expiry={},now=worldTime()) {
  const row={...obj(expiry)};
  if(typeof now==='number'&&Number.isFinite(now)){
    row.worldTime=typeof row.worldTime==='number'&&Number.isFinite(row.worldTime)?
      Math.min(row.worldTime,now+600):now+600;
  }
  return row;
}
export function grantTempHpPlan(actor,value,{id=randomId(),source={},expiry={}}={}) {
  const before=readTempHpState(actor);
  const now=worldTime();
  const change=planTempHpLayers(before,value,'grant',{id,source,expiry:cappedTempHpExpiry(expiry,now),worldTime:now});
  return {id,...change,patch:{'system.hp.temp':change.to,...tempHpStateUpdate(actor,change.after)}};
}
export async function grantTempHp(actor,value,options={}) {
  const plan=grantTempHpPlan(actor,value,options);
  await actor.update(plan.patch,{fnriJournal:{kind:'temp',reason:'Temporary HP layer'},fnriTempHp:'managed'});
  return plan;
}
/** Expire one source without changing any other layer. Can be called by
 * approved card-specific expiration handlers or macros with Actor rights. */
export async function removeTempHpLayer(actor,id) {
  const state=readTempHpState(actor);
  if(!state.layers[id])return {removed:false};
  const plan=planTempHpLayers(state,0,'remove',{id});
  await actor.update({'system.hp.temp':plan.to,...tempHpStateUpdate(actor,plan.after)},
    {fnriJournal:{kind:'temp',reason:'Temporary HP source expired'},fnriTempHp:'managed'});
  await reconcileTempHpEffects(actor);
  return {removed:true,...plan};
}
/** v14 preUpdateActor hook: respect direct manual edits to temp HP, including
 * updates from stock Actor sheets. Managed writes include the state flag and
 * are not reinterpreted as separate manual grants.
 */
const shieldEffectId=effect=>effect.getFlag?.(TEMP_HP_SCOPE,'shieldLayer')??effect.flags?.[TEMP_HP_SCOPE]?.shieldLayer;
export async function reconcileTempHpEffects(actor) {
  const layers=readTempHpState(actor).layers;
  const effects=Array.from(actor.effects?.contents??[]);
  const stale=effects.filter(e=>shieldEffectId(e)&&!layers[shieldEffectId(e)]);
  if(stale.length)await actor.deleteEmbeddedDocuments('ActiveEffect',stale.map(e=>e.id),{fnriShieldSync:true});
  for(const layer of Object.values(layers)){
    if(!layer.expiry.recipientTurnEnd||effects.some(e=>shieldEffectId(e)===layer.id))continue;
    await actor.createEmbeddedDocuments('ActiveEffect',[{name:game.i18n.localize('FASTNRI.AbilityChat.shadowShield'),img:'icons/svg/shield.svg',type:'base',showIcon:2,disabled:false,transfer:false,duration:{},system:{changes:[]},flags:{[TEMP_HP_SCOPE]:{shieldLayer:layer.id}}}],{fnriShieldSync:true});
  }
}
export async function settleTempHpTurnEnd(combat,combatant,context={}) {
  if(!game.user?.isGM||!combat?.started||context.skipped||!combatant?.actor)return;
  const actor=combatant.actor;
  return queueActorWrite(actor,async()=>{
    for(const layer of Object.values(readTempHpState(actor).layers)){
      if(layer.expiry.recipientTurnEnd)await removeTempHpLayer(actor,layer.id);
    }
    await reconcileTempHpEffects(actor);
  });
}
export function registerTempHpManualEdits() {
  Hooks.on('deleteActiveEffect',(effect,options,userId)=>{
    if(options?.fnriShieldSync||game.user?.id!==userId||!shieldEffectId(effect))return;
    if(effect.parent?.documentName==='Actor')return queueActorWrite(effect.parent,()=>removeTempHpLayer(effect.parent,shieldEffectId(effect))).catch(error=>console.warn('Fast NRI | Shield deletion sync needs retry',error));
  });
  Hooks.on('preUpdateActor',(actor,changed,options)=>{
    if(options?.fnriTempHp==='managed')return;
    const nested=changed?.system?.hp?.temp;
    const flat=changed?.['system.hp.temp'];
    const value=nested!==undefined?nested:flat;
    const existing=changed?.flags?.[TEMP_HP_SCOPE]?.tempHpState ?? changed?.[TEMP_HP_FLAG];
    if(value===undefined || existing!==undefined)return;
    if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)return;
    const before=readTempHpState(actor);
    const updated=planManualTempHpEdit(before,value,{id:randomId()});
    foundry.utils.setProperty(changed,TEMP_HP_FLAG,updated);
  });
}

/** Deterministic expiration. A grant can declare:
 * expiry: {turnStart:{combatId,combatantId,notBeforeRound}}
 * The card decides notBeforeRound; the generic engine does not guess it.
 * Optional worldTime is a deadline in Foundry's in-world seconds.
 */
export function planTempHpExpiration(state,{combatId=null,combatantId=null,round=null,worldTime=null}={}) {
  const before=normalizeTempHpState(state),after=copy(before),removed=[];
  for(const layer of Object.values(before.layers)) {
    const expiry=obj(layer.expiry),turn=obj(expiry.turnStart);
    const dueTime=typeof expiry.worldTime==='number' && typeof worldTime==='number' &&
      Number.isFinite(worldTime) && worldTime>=expiry.worldTime;
    const dueTurn=turn.combatId===combatId && turn.combatantId===combatantId &&
      combatId && combatantId && Number.isInteger(round) &&
      Number.isInteger(turn.notBeforeRound) && round>=turn.notBeforeRound;
    if(dueTime || dueTurn){removed.push(layer.id);delete after.layers[layer.id];}
  }
  return {before,after,removed,temp:tempHpMax(after)};
}
/** Call on the native Foundry start-of-turn event for the current Combatant.
 * Expiration has no resource cost, never changes normal HP, and never deletes
 * an unrelated Actor ActiveEffect or a different temp-HP layer.
 */
// A shield can be granted to a different token while its duration still
// belongs to the caster's turn. Inspect existing layered HP, not just the caster.
function actorsWithTempHp(extra=[]) {
  const actors=new Map();
  const add=actor=>{
    if(actor?.uuid&&actor.getFlag?.(TEMP_HP_SCOPE,'tempHpState'))actors.set(actor.uuid,actor);
  };
  for(const actor of extra)add(actor);
  for(const actor of game.actors?.contents??[])add(actor);
  for(const scene of game.scenes?.contents??[])
    for(const token of scene.tokens?.contents??[])add(token?.actor);
  return actors;
}
export async function settleTempHpTurnStart(combat,combatant,context={}) {
  if(!combatant || !game.user?.isGM || !combat?.started || context?.skipped)return null;
  const args={combatId:combat.id,combatantId:combatant.id,
    round:context?.round ?? combat.round,worldTime:game.time?.worldTime};
  const actors=actorsWithTempHp([combatant.actor,...Array.from(combat.turns??[],row=>row.actor)]);
  let ownResult=null;
  for(const actor of actors.values()){
    const current=readTempHpState(actor);
    const result=planTempHpExpiration(current,args);
    if(actor.uuid===combatant.actor?.uuid)ownResult=result;
    if(!result.removed.length)continue;
    if(!equalTempHpState(readTempHpState(actor),current))continue;
    await actor.update({'system.hp.temp':result.temp,...tempHpStateUpdate(actor,result.after)},
      {fnriTempHp:'managed',fnriJournal:{kind:'temp',reason:'Temporary HP duration expired'}});
    await reconcileTempHpEffects(actor);
  }
  return ownResult;
}

/** One async pass at each authoritative change of the *in-game* clock. No
 * wall-clock timer, polling loop, or new permission model is introduced. */
const expiryBusy=new Set();
export async function settleTempHpWorldTime(actor,now) {
  if(!actor || !game.user?.isGM || !Number.isFinite(now))return null;
  const uuid=actor.uuid;
  if(!uuid || expiryBusy.has(uuid))return null;
  const state=readTempHpState(actor);
  const plan=planTempHpExpiration(state,{worldTime:now});
  if(!plan.removed.length)return plan;
  expiryBusy.add(uuid);
  try {
    if(!equalTempHpState(readTempHpState(actor),state))return null;
    await actor.update({'system.hp.temp':plan.temp,...tempHpStateUpdate(actor,plan.after)},
      {fnriTempHp:'managed',fnriJournal:{kind:'temp',reason:'Temporary HP 10-minute limit'}});
    await reconcileTempHpEffects(actor);
    return plan;
  } finally {expiryBusy.delete(uuid);}
}
export function registerTempHpWorldTime() {
  Hooks.on('updateWorldTime',now=>{
    const activeGM=game.users?.activeGM;
    if(!game.user?.isGM || (activeGM && activeGM.id!==game.user.id))return;
    const actors=actorsWithTempHp();
    for(const actor of actors.values()){
      void settleTempHpWorldTime(actor,now).catch(error=>
        console.warn('Fast NRI | temporary HP expiration needs retry',actor.uuid,error));
    }
  });
}
