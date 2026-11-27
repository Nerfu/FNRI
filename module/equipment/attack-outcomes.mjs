/**
 * Item-owned outcome instructions. Read-only, no name/text matching and no
 * automatic application to a target. The GM keeps the final choice and may
 * correct degree/damage with the existing chat editor.
 */
import {canReadChatContent} from '../data/chat-visibility.mjs';
import {privateAreaSourceFor} from '../data/private-area-source.mjs';
import {selectedWeaponAttackRules} from './weapon-traits.mjs';
import {areaOutcomeInstructionSources} from './area-outcome-snapshot.mjs';
import {nativeUnarmedGrant} from '../data/native-unarmed-grants.mjs';
const SCOPE='fast-nri-v14';
const degrees=Object.freeze({failure:0,partial:1,success:2,great:3});
const supported=new Set(['condition','periodicDamage','choice','forcedMove','stun']);
const asObject=x=>x && typeof x==='object' && !Array.isArray(x)?x:{};
/** Persistent content identities, never display-name or text matching. */
const effectRefs = value => Array.isArray(value) ? value.flatMap(entry => {
  if (typeof entry?.contentId !== 'string' || !entry.contentId.trim() ||
      typeof entry?.effectId !== 'string' || !entry.effectId.trim()) return [];
  return [{contentId:entry.contentId.trim(),effectId:entry.effectId.trim()}];
}) : [];

/**
 * An item can have multiple independent rules:
 * mechanics.attack.outcomes: [{minEffectDegree:'success',kind:'condition',
 *   conditions:['Замедлен','Ослаблен']}, ...]
 * The outcome is re-computed from the CURRENT degree at evaluation time,
 * not frozen at attack creation. Great success implies success where min is set.
 */
export function attackOutcomePreview(item,{effectDegree=null,inflictedDamage=null,damageResolved=false,weaponTraitIds=null,executionId=null}={}) {
  const rules=asObject(item?.system?.mechanics?.attack ?? nativeUnarmedGrant(item)?.attack);
  const execution=Array.isArray(item?.system?.mechanics?.executions) && typeof executionId==='string' ?
    item.system.mechanics.executions.find(e=>e?.id===executionId) : null;
  // An execution's explicitly authored rules take priority over the general
  // ability outcomes.  Do not concatenate both: that would double Bleeding.
  const authored=Array.isArray(execution?.attack?.outcomes)?execution.attack.outcomes:rules.outcomes;
  const list=item?.type==='weapon' && Array.isArray(weaponTraitIds)?
    selectedWeaponAttackRules(item,weaponTraitIds).outcomes:
    (Array.isArray(authored)?authored:[]);
  const level=Object.hasOwn(degrees,effectDegree) ? degrees[effectDegree] : undefined;
  const applicable=[],pending=[],unsupported=[];
  const sourceUuid=item?.uuid??null;
  for(const [index,raw] of list.entries()) {
    const rule=asObject(raw);
    const requirement=Object.hasOwn(degrees,rule.minEffectDegree) ? degrees[rule.minEffectDegree] : undefined;
    const entry={sourceUuid,index,kind:String(rule.kind??'')};
    if(!supported.has(rule.kind) || requirement===undefined) {
      unsupported.push({...entry,reason:'unknown-outcome-rule'});
      continue;
    }
    // No degree? Do not guess it: return the rule as pending.
    if(level===undefined) {pending.push({...entry,reason:'missing-effect-degree'});continue;}
    if(level<requirement || (Object.hasOwn(degrees,rule.maxEffectDegree) && level>degrees[rule.maxEffectDegree])) continue;
    if ((rule.afterDamage === true && !damageResolved) ||
        (rule.requiresDamage === true && !Number.isFinite(inflictedDamage))) {
      pending.push({...entry,reason:'damage-not-applied'});
      continue;
    }
    if(rule.requiresDamage === true && inflictedDamage<1) continue;
    // Item-authored fields are data only, NEVER executed as scripts.
    const options = Array.isArray(rule.options) ? rule.options.flatMap((label, position) =>
      typeof label === 'string' ? [{label, effects: asObject(rule.choiceEffects?.[position])}] : []) : [];
    const instruction={...entry,
      value:Number.isSafeInteger(rule.value) && rule.value>=0?rule.value:null,
      durationTicks:Number.isSafeInteger(rule.durationTicks)&&rule.durationTicks>0?rule.durationTicks:null,
      end:asObject(rule.end),
      periodicName:typeof rule.periodicName==='string'?rule.periodicName:null,
      conditions:Array.isArray(rule.conditions)?
      rule.conditions.filter(x=>typeof x==='string'):[],formula:typeof rule.formula==='string'?rule.formula:'',
      traits:Array.isArray(rule.traits)?rule.traits.filter(x=>typeof x==='string'):[],
      options:options.map(option => option.label),
      distance:Number.isFinite(rule.distance)?rule.distance:null,
      oncePerTurn:rule.oncePerTurn===true,requiresDamage:rule.requiresDamage===true,
      afterDamage:rule.afterDamage===true,
      requiresTarget:true,automaticallyApplied:false,
      // Require an explicit local or catalog reference.
      effectIds:Array.isArray(rule.effectIds)?rule.effectIds.filter(x=>typeof x==='string'&&x.trim()):[],
      effectRefs:effectRefs(rule.effectRefs),
      // Structured choice options are optional. Plain strings remain manual.
      choiceEffects:options.map(({effects})=>({
        effectIds:Array.isArray(effects.effectIds)?effects.effectIds.filter(x=>typeof x==='string'&&x.trim()):[],
        effectRefs:effectRefs(effects.effectRefs)
      }))};
    // Catalog-linked states declare the timing explicitly. A weapon copied
    // from the previous catalog can still be played manually.
    // Timing is a property of the authored outcome, not of a removed import pack.
    instruction.timingUndeclared = rule.timingUndeclared === true;
    applicable.push(instruction);
  }
  return {sourceUuid:item?.uuid??null,effectDegree,applicable,pending,unsupported,
    automaticallyApplied:false};
}

/** A report is evidence for one current card revision and one Actor. */
export function confirmedAttackDamage(message, card, damageReportId, target) {
  if (typeof damageReportId !== 'string' || !damageReportId) return null;
  const reportMessage = game.messages?.get(damageReportId);
  if (!canReadChatContent(reportMessage)) return null;
  const report = reportMessage.getFlag(SCOPE, 'hpReport');
  const actorUuid = (target?.actor ?? target)?.uuid;
  if (report?.version !== 1 || report.kind !== 'damage' || report.reverted || report.pendingUndo ||
      report.sourceMessageId !== message.id || report.sourceRevision !== (card.revision ?? 0) ||
      !report.actorUuid || (target && report.actorUuid !== actorUuid) ||
      !Number.isFinite(report.actual) || report.actual < 0) return null;
  return report.actual;
}

export async function resolveOutcomeItem(uuid) {
  if (typeof uuid !== 'string' || !uuid) return null;
  try {
    const item = await fromUuid(uuid);
    return item?.documentName === 'Item' ? item : null;
  } catch {
    return null;
  }
}

/** Use the current card and its accessible Items, including an optional weapon. */
export async function attackOutcomeForDamageCard(message, {
  inflictedDamage=null, damageReportId=null, target=null, effectDegreeOverride=null
}={}) {
  const current = game.messages?.get(message?.id) ?? message;
  if (!canReadChatContent(current)) {
    throw Error('Damage message is unavailable');
  }
  const card = current?.getFlag?.(SCOPE, 'weaponDamage') ?? current?.flags?.[SCOPE]?.weaponDamage;
  if (!card || card.version !== 2) throw new Error('Existing component damage card required');
  const effectDegree = Object.hasOwn(degrees,effectDegreeOverride) ? effectDegreeOverride : (card.cancelled ? 'failure' : card.effectDegree ?? card.degree);
  const damage = confirmedAttackDamage(current, card, damageReportId, target);
  const config={effectDegree,inflictedDamage:damageReportId ? damage : inflictedDamage,
    damageResolved:damage !== null,weaponTraitIds:card.weaponTraitIds??null,
    executionId:card.executionId??null};
  let sourceUuid=card.sourceUuid,weaponItemUuid=card.weaponItemUuid;
  // A new area card already owns the effective rule instructions selected at
  // casting time. Editing/removing the Item later cannot silently change its
  // computed degree consequences. No ActiveEffect templates are duplicated.
  if(card.areaAttack?.version===1){
    if(card.areaOutcomeRedacted===true){
      // A public NPC attack must not store private rule data. Only the native
      // GM can consult its current Item; the old roll itself is never changed.
      // Withholding the snapshot is distinct from a genuinely empty outcome.
      if(!game.user?.isGM)return {sourceUuid:null,effectDegree,applicable:[],
        pending:[],unsupported:[],sourceUnavailable:true,automaticallyApplied:false};
      const source=card.sourceUuid ? null : privateAreaSourceFor(current);
      if(source){
        ({itemUuid:sourceUuid,weaponItemUuid}=source);
        config.executionId=source.executionId??null;
        config.weaponTraitIds=source.weaponTraitIds??null;
      }
    } else {
      // Empty captured instructions stay empty. Later Item edits cannot add
      // a new outcome to the old, already published area attack.
      const areaSources=areaOutcomeInstructionSources(card.areaOutcomeInstructions);
      const previews=areaSources.map(source=>attackOutcomePreview(source,{...config,
        weaponTraitIds:null,executionId:null}));
      return {sourceUuid:card.sourceUuid,effectDegree,
        applicable:previews.flatMap(p=>p.applicable),pending:previews.flatMap(p=>p.pending),
        unsupported:previews.flatMap(p=>p.unsupported),automaticallyApplied:false,
        outcomeInstructionSnapshot:true};
    }
  }
  const item = await resolveOutcomeItem(sourceUuid);
  if (!item) return {
    sourceUuid:null,effectDegree,applicable:[],pending:[],unsupported:[],sourceUnavailable:true,
    automaticallyApplied:false
  };
  const own=attackOutcomePreview(item,config);
  if (weaponItemUuid === sourceUuid) return own;
  if (!weaponItemUuid) {
    // Structured trait choices can outlive a redacted private weapon reference.
    return item.type !== 'weapon' && Array.isArray(config.weaponTraitIds)
      ? {...own,weaponSourceUnavailable:true} : own;
  }
  const weapon=await resolveOutcomeItem(weaponItemUuid);
  if (weapon?.type !== 'weapon') return {...own,weaponSourceUnavailable:true};
  const extra=attackOutcomePreview(weapon,config);
  return {...own,applicable:[...own.applicable,...extra.applicable],
    pending:[...own.pending,...extra.pending],unsupported:[...own.unsupported,...extra.unsupported]};
}
