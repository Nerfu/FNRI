import {canReadChatContent} from '../data/chat-visibility.mjs';
import {activeActorTokens,supportsHpBar} from './token-visuals.mjs';
import {readTempHpState,tempHpMax} from '../damage/temporary-hp-layers.mjs';
const S='fast-nri-v14';
const COLORS={damage:0xff0000,healing:0x00ff00,tempHp:0x4f9ee8};
const number=n=>Number.isFinite(n)?Math.max(0,n):0;
const snapshot=actor=>({current:number(actor.system.hp.current),temp:tempHpMax(readTempHpState(actor))});

/** Actual deltas only. One red number for ordinary and absorbed damage. */
export function classifyHpFeedback(before,after) {
  if(!before||!after)return [];
  const current=number(after.current)-number(before.current),temp=number(after.temp)-number(before.temp);
  const damage=Math.max(0,-current)+Math.max(0,-temp);
  return [damage>0&&{kind:'damage',amount:damage},current>0&&{kind:'healing',amount:current},
    temp>0&&{kind:'tempHp',amount:temp}].filter(Boolean);
}
export function feedbackFromMessage(message,changed=null) {
  if(!canReadChatContent(message))return null;
  const report=message.getFlag(S,'hpReport');
  if(report?.version===1){
    if(changed){
      const reverted=changed?.flags?.[S]?.hpReport?.reverted??changed?.[`flags.${S}.hpReport.reverted`];
      if(reverted!==true||!report.reverted||!report.reverseBefore||!report.reverseAfter)return null;
      return {actorUuid:report.actorUuid,tokenUuid:report.tokenUuid,entries:classifyHpFeedback(report.reverseBefore,report.reverseAfter)};
    }
    if(report.reverted)return null;
    return {actorUuid:report.actorUuid,tokenUuid:report.tokenUuid,entries:classifyHpFeedback(report.before,report.after)};
  }
  if(changed)return null;
  const damage=message.getFlag(S,'periodicReceipt');
  if(Number.isFinite(damage?.hpDelta)&&damage.hpDelta<0)
    return {actorUuid:damage.targetActorUuid,tokenUuid:damage.tokenUuid,entries:[{kind:'damage',amount:-damage.hpDelta}]};
  const healing=message.getFlag(S,'periodicHealingReport');
  if(Number.isFinite(healing?.hpDelta)&&healing.hpDelta>0)
    return {actorUuid:healing.actorUuid,tokenUuid:healing.tokenUuid,entries:[{kind:'healing',amount:healing.hpDelta}]};
  return null;
}
function canShow(token) {
  return token?.isVisible===true && (game.user?.isGM===true || token.document?.hidden!==true);
}
export function feedbackTokens({actorUuid,tokenUuid}) {
  if(!globalThis.canvas?.ready||!actorUuid)return [];
  return (canvas.tokens?.placeables??[]).filter(token=>token.document?.actor?.uuid===actorUuid &&
    (!tokenUuid||token.document?.uuid===tokenUuid)&&canShow(token));
}
function showEntries(token,entries) {
  if(!canShow(token)||!canvas.interface?.createScrollingText)return;
  const {x,y}=token.center;
  entries.forEach(({kind,amount},index)=>{
    const origin={x:x+(index-(entries.length-1)/2)*28,y:y-Math.max(10,Number(token.h)*0.18||10)};
    void canvas.interface.createScrollingText(origin,`${kind==='damage'?'−':'+'}${amount}`,{
      anchor:CONST.TEXT_ANCHOR_POINTS.TOP,direction:CONST.TEXT_ANCHOR_POINTS.TOP,duration:1200,jitter:0.12,
      textStyle:{fill:COLORS[kind],fontSize:34,fontWeight:'800',stroke:0x000000,strokeThickness:4}
    })?.catch?.(error=>console.warn("Fast NRI | HP feedback animation failed",error));
  });
}
function showMessage(message,changed) {
  const result=feedbackFromMessage(message,changed);
  if(!result?.entries.length)return;
  for(const token of feedbackTokens(result))showEntries(token,result.entries);
}
const touchesManualHp=changed=>['current','temp'].some(key=>Object.hasOwn(changed?.system?.hp??{},key)||Object.hasOwn(changed??{},`system.hp.${key}`));
export function registerHpFeedback() {
  Hooks.on('createChatMessage',message=>showMessage(message));
  Hooks.on('updateChatMessage',(message,changed)=>showMessage(message,changed));
  // Direct sheet/HUD edits have no chat audience. Render locally for the editor only.
  // Managed writes (including private card applications, rollback, expiry and rest)
  // never generate Actor-based numbers; card receipts are the sole combat source.
  const pending=new Map();
  let sequence=0;
  function before(actor,changed,options,userId){
    if(userId!==game.user?.id||!supportsHpBar(actor)||!touchesManualHp(changed)||!options)return;
    if(!options.fnriHpFeedbackLocal&&(options.fnriTempHp==='managed'||options.fnriDeathLifecycle==='managed'||options.fnriHpMaximumManaged||options.fnriJournal?.kind&&options.fnriJournal.kind!=='manual'))return;
    let id=options.fnriHpVisualOperation;
    if(!id||!pending.has(id)){
      id=`${userId}:${++sequence}`;options.fnriHpVisualOperation=id;
      pending.set(id,new Map());
      if(pending.size>256)pending.delete(pending.keys().next().value);
    }
    const batch=pending.get(id);
    if(!batch.has(actor.uuid))batch.set(actor.uuid,snapshot(actor));
  }
  function after(actor,_changed,options,userId){
    if(userId!==game.user?.id||!supportsHpBar(actor))return;
    const id=options?.fnriHpVisualOperation,batch=pending.get(id),old=batch?.get(actor.uuid);
    if(!old)return;
    batch.delete(actor.uuid);
    if(!batch.size)pending.delete(id);
    const entries=classifyHpFeedback(old,snapshot(actor));
    if(entries.length)for(const token of activeActorTokens(actor))showEntries(token,entries);
  }
  Hooks.on('preUpdateActor',before);
  Hooks.on('updateActor',after);
  Hooks.on('preUpdateActorDelta',(delta,changed,options,userId)=>before(delta.parent?.actor,changed,options,userId));
  Hooks.on('updateActorDelta',(delta,changed,options,userId)=>after(delta.parent?.actor,changed,options,userId));
}
