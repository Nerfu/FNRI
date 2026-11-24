/** Item use publishes the result first; applying HP never consumes the Item. */
import {queueActorWrite,finishCardAccounting} from '../data/ability-accounting.mjs';
import {actionAudience,actionSpeaker,actionText,canExecuteAction,escapeActionText as esc} from '../rolls/action-declaration.mjs';
import {redactActorSourceForAudience,prepareRoll,finalizeRollEffects} from '../rolls/roll-context.mjs';
import {cardRollKind} from '../rolls/roll-contributions.mjs';
import {cardEffectLinks} from '../effects/chat-effect-links.mjs';
import {isPotionItem} from '../data/potion-resource.mjs';
const ID='fast-nri-v14';
const asObject=v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};
const operationKinds=new Set(['healHp','restoreResource','addTempHp','applyEffect','roll']);
function itemUseRule(item){const use=asObject(item?.system?.mechanics?.use);return {consume:asObject(use.consume),operations:Array.isArray(use.operations)?use.operations:[]};}
export function inspectItemUse(item){const rule=itemUseRule(item);return {type:String(item?.type??''),supported:rule.operations.filter(op=>operationKinds.has(op?.kind)).length,unsupported:rule.operations.filter(op=>!operationKinds.has(op?.kind)).map(op=>String(op?.kind??'<missing>')),consumeField:['quantity','charges'].includes(rule.consume.field)?rule.consume.field:null,hasExplicitUse:rule.operations.length>0,manualReason:String(item?.system?.mechanics?.use?.manual??'')};}
function stackPlan(item,actor,consume){
  if(!Object.keys(consume).length)return null;
  const {field,amount}=consume;
  if(!['quantity','charges'].includes(field)||!Number.isSafeInteger(amount)||amount<1)return {reason:'invalid-stack'};
  if(!actor||actor.items?.get(item.id)!==item)return {reason:'world-item-not-a-stack'};
  const before=item.system?.[field];
  return Number.isSafeInteger(before)&&before>=amount?{field,before,after:before-amount}:{reason:'insufficient-stack'};
}
async function evaluateOperation(op,actor,rolls,{item,skipPreroll,contexts}){
  const result={kind:String(op?.kind??''),resourceName:String(op?.resourceName??''),classes:Array.isArray(op?.classes)?op.classes.map(String):[],formula:String(op?.formula??'')};
  if(!operationKinds.has(result.kind))result.manual=true;
  if(result.kind==='applyEffect'){result.effectId=op.effectId;result.manual=true;}
  if(result.formula){
    // Never guess missing target data; preserve the authored formula as manual.
    if(result.formula.length>200||typeof Roll.validate==='function'&&!Roll.validate(result.formula)){
      result.manual=true;result.reason='formula-unavailable';
    }else{
      const kind=result.kind==='healHp'?'heal':cardRollKind(item,op);
      // An interrupted or failed preparation must never consume an Item.
      const context=await prepareRoll({actor,kind,formula:result.formula,sourceItem:item,
        skipDialog:skipPreroll,label:item.name});
      if(context===null)return null;
      try{
        const roll=await new Roll(context.expression,context.actor?.getRollData?.()??{}).evaluate();
        if(!Number.isFinite(roll.total))throw Error('invalid amount');
        result.rollIndex=rolls.length;result.amount=roll.total;rolls.push(roll);contexts.push(context);
        if(roll.total<0)result.manual=true;
      }catch(error){result.manual=true;result.reason='formula-unavailable';}
    }
  }else if(Number.isFinite(op.amount)&&op.amount>=0)result.amount=op.amount;
  else result.manual=true;
  if(['restoreResource','roll'].includes(result.kind))result.manual=true;
  return result;
}
const active=new Set();
/** Source item only. A legacy target argument is deliberately ignored. */
export async function useItem(item,{actor=item?.parent,skipPreroll=false}={}){
  if(item?.documentName!=='Item')throw Error('Item document required');
  if(actor?.documentName!=='Actor'||item.parent!==actor||!canExecuteAction(actor))return null;
  const key=item.uuid??`${actor.uuid}:${item.id}`;
  if(active.has(key))return null;
  active.add(key);
  try{
    const report=await queueActorWrite(actor,async()=>{
      if(actor.items?.get(item.id)!==item||!canExecuteAction(actor))return null;
      const rule=itemUseRule(item),rolls=[],results=[],contexts=[];
      const options={item,skipPreroll,contexts};
      for(const op of rule.operations){
        const result=await evaluateOperation(op,actor,rolls,options);
        if(result===null)return null;
        results.push(result);
      }
      // A legacy/custom Item can own a native roll even without typed operations.
      // Do not roll the same authored effect twice.
      if(!rule.operations.some(op=>String(op?.formula??'').trim())&&String(item.system?.rollFormula??'').trim()){
        const result=await evaluateOperation({kind:'roll',formula:item.system.rollFormula},actor,rolls,options);
        if(result===null)return null;
        results.push(result);
      }
      const stack=stackPlan(item,actor,rule.consume);
      const audience=actionAudience(),redact=redactActorSourceForAudience(actor,audience);
      const labels={healHp:'itemHeal',addTempHp:'itemTemp',restoreResource:'itemResource',applyEffect:'itemEffect',roll:'itemRoll'};
      const lines=results.map(r=>`<li>${esc(actionText(labels[r.kind]??'itemManual'))}${r.resourceName?` · ${esc(r.resourceName)}`:''}${r.classes.length?` (${esc(r.classes.join(', '))})`:''}${r.amount!=null?`: <strong>${esc(r.amount)}</strong>`:''}${r.formula&&r.amount==null?` · ${esc(r.formula)}`:''}${r.manual?` · ${esc(actionText('manualConsequences'))}`:''}</li>`).join('');
      const raw=String(item.system?.description||item.system?.effect||item.system?.notes||'');
      const description=raw&&foundry.applications?.ux?.TextEditor?.enrichHTML?await foundry.applications.ux.TextEditor.enrichHTML(raw,{secrets:false,relativeTo:item}):esc(raw);
      const content=`<article class="fnri-item-use"><strong>${esc(item.name)} · ${esc(actionText('useItem'))}</strong>${description?`<div>${description}</div>`:''}${lines?`<ul>${lines}</ul>`:''}${stack?.reason?`<p>⚠ ${esc(actionText('itemStackWarning'))}</p>`:''}<p>${esc(actionText('manualConsequences'))}</p>${redact?'':cardEffectLinks(item)}</article>`;
      const message=await ChatMessage.create({speaker:actionSpeaker(actor,audience),...audience,content,rolls:rolls.map(r=>r.toJSON()),flags:{[ID]:{itemUseResult:{version:1,...(isPotionItem(item)?{potion:true}:{}),results:results.map(({kind,amount,rollIndex,manual})=>({kind,...(amount!=null?{amount}:{}),...(rollIndex!=null?{rollIndex}:{}),manual:!!manual})),...(!redact?{itemUuid:item.uuid,actorUuid:actor.uuid}:{})}}}});
      if(!message?.id)return null;
      let consumed=null;const skipped=[];
      if(stack?.reason){skipped.push(stack.reason);ui.notifications?.warn(actionText('itemStackWarning'));}
      else if(stack){
        try{if(actor.items?.get(item.id)!==item||item.system?.[stack.field]!==stack.before)throw Error('stack changed');await item.update({[`system.${stack.field}`]:stack.after});consumed=stack;}
        catch(error){skipped.push('consume-failed');ui.notifications?.warn(actionText('itemStackWarning'));console.warn('Fast NRI | published Item consumption failed',error);}
      }
      return {message,results,consumed,skipped,contexts};
    });
    if(report?.message){
      for(const context of report.contexts)await finalizeRollEffects(context,report.message);
      delete report.contexts;
      await finishCardAccounting({actor,item,message:report.message});
    }
    return report;
  }finally{active.delete(key);}
}
