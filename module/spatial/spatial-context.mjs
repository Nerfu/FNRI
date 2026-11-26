import {tokenDistance,sameScene,hasCondition} from './geometry.mjs';
import {projectionCaster} from '../projection/projection.mjs';
import {weaponTraitOptions} from '../equipment/weapon-traits.mjs';
import {standingLineObstacles} from './attack-line.mjs';
import {formationForTarget} from './formation.mjs';
/** Snapshot the chosen source and declared target BEFORE opening preroll.
 * Provides independently toggleable attack modifiers. No new user manual UI.
 * Defender's "Застигнут врасплох" is NOT an attacker-side checkbox.
 */
function entry(id,label,value){return {
  uuid:`spatial:${id}`,sourceUuid:null,sourceType:'spatial',id,
  name:'Пространство',effect:null,native:false,nativeChanges:[],actorOwned:false,onUse:'none',
  parts:[{id:'penalty',kind:'modifier',label,value:String(value),nonStackingGroup:'hindrance'}]
};}
function propertySet(raw){return String(raw??'').split(/[,;]+/).map(x=>x.trim().toLowerCase());}
// The same range check is used by attacks and directed non-attack spells.
// A hidden source/target, an area or absent geometry yields no advisory.
function spellRangeAtDistance(source,target,spellRange,distanceSpaces){
  if(!Number.isFinite(spellRange)||spellRange<0||!Number.isFinite(distanceSpaces)||
    (source.document??source).hidden===true||(target.document??target).hidden===true)return null;
  return {distanceSpaces,spellRange,...(distanceSpaces>spellRange?{spellRangeWarning:'Цель вне дистанции заклинания'}:{})};
}
export function directedSpellSpatialContext({origin,targetTokens=[],spellRange=null,properties='',
  scene=globalThis.canvas?.scene,grid=globalThis.canvas?.grid,tokens=globalThis.canvas?.tokens?.placeables??[]}={}){
  const props=propertySet(properties);
  if(targetTokens.length!==1||!scene||grid?.isSquare!==true||props.includes('область действия')||props.includes('area'))return null;
  const source=tokens.find(t=>t?.document?.uuid&&t.document.uuid===origin?.tokenUuid),target=targetTokens[0];
  if(!source||!sameScene(source,target))return null;
  return spellRangeAtDistance(source,target,spellRange,tokenDistance(source,target,grid));
}
export function spatialAttackContext({origin,targetTokens=[],weaponItem=null,attackKind=null,
  properties='',spellRange=null,scene=globalThis.canvas?.scene,grid=globalThis.canvas?.grid,
  tokens=globalThis.canvas?.tokens?.placeables??[]}={}){
  const target=targetTokens?.length===1?targetTokens[0]:null;
  const out={entries:[],distanceSpaces:null,lineCreatures:[],formation:null,
    offGuardFromFormation:false,warnings:[]};
  if(!target || !scene || grid?.isSquare!==true)return out;
  const source=tokens.find(t=>t?.document?.uuid && t.document.uuid===origin?.tokenUuid);
  if(!source || !sameScene(source,target))return out;
  out.distanceSpaces=tokenDistance(source,target,grid);
  out.formation=formationForTarget(target,tokens,{grid});
  out.offGuardFromFormation=out.formation?.surrounded===true;
  // No directed hindrances on area attacks; area targets belong to players/GM.
  const props=[...propertySet(properties),...propertySet(weaponItem?.system?.properties)];
  if(props.includes('область действия')||props.includes('area'))return out;
  const directed=['melee','ranged'].includes(attackKind);
  if(!directed)return out;
  // Spell distance is advisory, never a weapon second-distance penalty.
  // Do not surface a hidden token's range in the new display.
  Object.assign(out,spellRangeAtDistance(source,target,spellRange,out.distanceSpaces)??{});
  // 'Наводимое' is a selectable weapon property: apply its suppression only
  // after trait switches are resolved by the shared preroll, not here.
  // The weapon may expose 'Дальнобойное' as a per-attack trait option.
  // Do not make its penalty permanent merely because the source Item lists it.
  const longrangeTrait=weaponTraitOptions(weaponItem).find(option=>
    String(option.label??'').trim().toLowerCase()==='дальнобойное');
  const longrange=props.includes('дальнобойное') || !!longrangeTrait;
  const withLongrangeGate=(id,label,value,enabled)=>{
    const result=entry(id,label,value);
    if(longrangeTrait && weaponItem?.uuid)result.weaponTraitGate={
      entryUuid:`weapon-traits:${weaponItem.uuid}`,
      partId:`trait-${longrangeTrait.id}`,enabled
    };
    return result;
  };
  if(spellRange===null&&attackKind==='ranged'&&weaponItem?.type==='weapon'){
    const base=Number(String(weaponItem.system?.distance??'').replace(',','.'));
    if(Number.isFinite(base)&&base>0&&Number.isFinite(out.distanceSpaces)&&out.distanceSpaces>base){
      if(out.distanceSpaces>2*base) {
        out.warnings.push('Цель за пределами второй дистанции оружия');
      } else {
        const description=`Вторая дистанция (${out.distanceSpaces} / ${base} клеток)`;
        if(longrangeTrait && weaponItem?.uuid){
          out.entries.push(withLongrangeGate('second-range-longrange',
            `Дальнобойное · ${description}`,-3,true));
          out.entries.push(withLongrangeGate('second-range-standard',description,-6,false));
        }else out.entries.push(entry('second-range',description,-(longrange?3:6)));
      }
    }
  }
  if(longrange && attackKind==='ranged' && Number.isFinite(out.distanceSpaces) &&
    out.distanceSpaces<=3)out.entries.push(withLongrangeGate('longrange-near',
    `Дальнобойное: цель в пределах 3 клеток`,-2,true));
  out.lineCreatures=standingLineObstacles(source,target,tokens,{grid});
  if(out.lineCreatures.length)out.entries.push(entry('standing-creature',
    `Существа на линии атаки (${out.lineCreatures.length})`,-4));
  return out;
}
/** Apply defender adjustment to a SINGLE attack snapshot only. The native
 * prepared Actor defense already includes -2 if the condition is applied.
 * Surrounding does not create an ActiveEffect or a persistent combat log.
 */
export function spatialDefenderSnapshot(snapshot,{formation=null}={},targetActor=null){
  if(snapshot?.status!=='one'||!formation?.surrounded)return snapshot;
  // The source condition was prepared into current defenses already.
  const already=hasCondition(targetActor,['prone','grabbed','offguard']) ||
    hasCondition(projectionCaster(targetActor),['prone','grabbed','offguard']);
  if(already)return {...snapshot,surrounded:true,defenseAdjusted:false};
  if(snapshot.ac)return {...snapshot,surrounded:true,defenseAdjusted:true,
    ac:Object.fromEntries(Object.entries(snapshot.ac).map(([k,v])=>[k,v-2]))};
  if(Number.isFinite(snapshot.difficulty))return {...snapshot,surrounded:true,
    defenseAdjusted:true,difficulty:snapshot.difficulty-2};
  return snapshot;
}
