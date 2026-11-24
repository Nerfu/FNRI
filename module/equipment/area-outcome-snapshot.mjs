/** Minimal immutable instructions for one area attack execution.
 * Captures only authored outcome RULE DATA, not an Item or ActiveEffect copy.
 * Native templates remain linked by ID and may require the source Item.
 */
import {selectedWeaponAttackRules} from './weapon-traits.mjs';
const object=x=>x&&typeof x==='object'&&!Array.isArray(x)?x:{};
const strings=x=>Array.isArray(x)?x.filter(y=>typeof y==='string').map(y=>y.trim()).filter(Boolean):[];
const refs=x=>Array.isArray(x)?x.filter(r=>typeof r?.contentId==='string'&&r.contentId.trim()&&
  typeof r?.effectId==='string'&&r.effectId.trim()).map(r=>({contentId:r.contentId.trim(),effectId:r.effectId.trim()})):[];

function instruction(raw){
  const r=object(raw), choiceEffects=Array.isArray(r.choiceEffects)?r.choiceEffects:object(r.choiceEffects);
  const choices={};
  for(const [position,effects] of Object.entries(choiceEffects)){
    if(!/^(?:0|[1-9]\d*)$/.test(position))continue;
    choices[position]={effectIds:strings(effects?.effectIds),effectRefs:refs(effects?.effectRefs)};
  }
  return {kind:typeof r.kind==='string'?r.kind:'',
    minEffectDegree:typeof r.minEffectDegree==='string'?r.minEffectDegree:'',
    value:Number.isSafeInteger(r.value)?r.value:null,
    durationTicks:Number.isSafeInteger(r.durationTicks)?r.durationTicks:null,
    end:{skipCheck:r.end?.skipCheck===true,
      bonuses:Array.isArray(r.end?.bonuses)?r.end.bonuses.filter(Number.isSafeInteger):[],
      penalties:Array.isArray(r.end?.penalties)?r.end.penalties.filter(Number.isSafeInteger):[]},
    periodicName:typeof r.periodicName==='string'?r.periodicName:null,
    conditions:strings(r.conditions),formula:typeof r.formula==='string'?r.formula:'',
    traits:strings(r.traits),
    // Preserve authored positions: choiceEffects is indexed by original slot.
    options:Array.isArray(r.options)?r.options.map(v=>typeof v==='string'?v:null):[],
    choiceEffects:choices,
    distance:Number.isFinite(r.distance)?r.distance:null,
    oncePerTurn:r.oncePerTurn===true,requiresDamage:r.requiresDamage===true,
    afterDamage:r.afterDamage===true,effectIds:strings(r.effectIds),effectRefs:refs(r.effectRefs),
    timingUndeclared:r.timingUndeclared===true};
}
function sourceInstructions(item,{executionId=null,traitIds=null}={}){
  if(!item?.uuid)return null;
  const mechanics=object(item.system?.mechanics);
  const execution=Array.isArray(mechanics.executions)?
    mechanics.executions.find(e=>e?.id===executionId):null;
  const authored=item.type==='weapon' ?
    selectedWeaponAttackRules(item,traitIds).outcomes :
    (Array.isArray(execution?.attack?.outcomes)?execution.attack.outcomes:mechanics.attack?.outcomes);
  return Array.isArray(authored)&&authored.length ?
    {sourceUuid:item.uuid,rules:authored.map(instruction)}:null;
}
/** Never copy hidden GM-owned Item rules into a public/IC chat flag. */
export function captureAreaOutcomeInstructions({sourceItem=null,weaponItem=null,
  executionId=null,weaponTraitIds=null,redact=false}={}){
  if(redact)return null;
  const sources=[];
  for(const item of [sourceItem,weaponItem]){
    if(!item?.uuid||sources.some(x=>x.sourceUuid===item.uuid))continue;
    const entry=sourceInstructions(item,{executionId:item===sourceItem?executionId:null,
      traitIds:item.type==='weapon'?weaponTraitIds:null});
    if(entry)sources.push(entry);
  }
  return sources.length?{version:1,sources}:null;
}
/** An isolated rule-only stand-in for the existing evaluator. It is never
 * resolved as an actual Item and cannot create embedded documents by itself. */
export function areaOutcomeInstructionSources(snapshot){
  if(snapshot?.version!==1||!Array.isArray(snapshot.sources))return [];
  return snapshot.sources.filter(s=>typeof s?.sourceUuid==='string'&&Array.isArray(s.rules))
    .map(s=>({uuid:s.sourceUuid,type:'ability',system:{mechanics:{attack:{outcomes:s.rules}}}}));
}
