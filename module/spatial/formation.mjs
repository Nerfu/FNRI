import {tokenSide} from '../data/actor-side.mjs';
import {hasCondition,cellsForToken,cellGap,standingConscious,sameScene} from './geometry.mjs';
import {isProjectionActor} from '../projection/projection.mjs';
import {itemGrip} from '../equipment/equipment.mjs';
/** Fast NRI: threats vs formation. Not PF2e flanking. No persistent statuses. */
const docOf=t=>t?.document??t;
const identity=t=>docOf(t)?.uuid??(docOf(t)?.id&&docOf(t)?.parent?.id?`${docOf(t).parent.id}:${docOf(t).id}`:null);
const hidden=t=>docOf(t)?.hidden===true||t?.visible===false;
function affinity(a,b){
  const x=tokenSide(a),y=tokenSide(b);
  if(![1,-1].includes(x)||![1,-1].includes(y))return 'unknown';
  return x===y?'ally':'enemy';
}
/** Only a held, level-accessible two-cell melee weapon extends ordinary
 * unarmed control. Proficiency is separate; a legal attack does not require it.
 * Unknown level/hand reservations are not invented from names or descriptions. */
export function hasAvailableReach(actor){
  const hands=actor?.system?.equipment??{};
  const ids=new Set([hands.leftHand,hands.rightHand].filter(Boolean));
  return [...ids].some(id=>{
    const item=actor?.items?.get?.(id);
    if(item?.type!=='weapon'||String(item.system?.attackKind).trim().toLowerCase()!=='melee'||
      Number(String(item.system?.distance??'').replace(',','.'))!==2)return false;
    const left=hands.leftHand===id,right=hands.rightHand===id,grip=itemGrip(item);
    if(grip==='2'&&!(left&&right))return false;
    if(grip==='1+'&&!(left&&right)&&hands.leftHand&&hands.rightHand)return false;
    const level=actor?.system?.level,required=item.system?.level;
    return !(Number.isFinite(level)&&Number.isFinite(required)&&level<required);
  });
}
function canThreaten(other,gap){
  return !isProjectionActor(other.actor)&& !hasCondition(other.actor,['invisible']) && (gap===1 || (gap===2&&hasAvailableReach(other.actor)));
}
export function formationForTarget(target,tokens=[],{grid=globalThis.canvas?.grid}={}){
  const targetCells=cellsForToken(target,grid);
  if(!target||hidden(target)||!targetCells.length)return null;
  const own=standingConscious(target,{forFormation:true})?1:0;
  const targetHp=target?.actor?.system?.hp?.current;
  let allies=0,threats=0,uncertain=![1,-1].includes(tokenSide(target))||targetHp==null||!Number.isFinite(Number(targetHp));
  const seen=new Set([identity(target)??target]);
  for(const other of tokens){
    const key=identity(other)??other;
    if(seen.has(key)||!sameScene(other,target)||hidden(other))continue;
    seen.add(key);
    // Missing HP/Actor cannot safely establish whether a visible token stands.
    const hp=other?.actor?.system?.hp?.current;
    const known=hp!=null&&Number.isFinite(Number(hp));
    if(known&&!standingConscious(other))continue;
    const relation=affinity(other,target);
    const cells=cellsForToken(other,grid);
    if(!cells.length){uncertain=true;continue;}
    let gap=Infinity;
    for(const a of cells)for(const b of targetCells)gap=Math.min(gap,cellGap(a,b));
    if(gap>2)continue;
    // Shared cells are legal in some size combinations, but the Rulebook
    // does not define a zero-distance melee control rule. Resolve manually.
    if(gap===0||!known){uncertain=true;continue;}
    const canForm=gap===1&&standingConscious(other,{forFormation:true});
    const threat=canThreaten(other,gap);
    if(relation==='ally'){if(canForm)allies++;}
    else if(relation==='enemy'){if(threat)threats++;}
    else if(canForm||threat)uncertain=true;
  }
  return {threats,formation:own+allies,surrounded:!uncertain&&threats>own+allies,
    uncertain,standing:own===1};
}
/** Use only a concrete token of this Actor on the current scene. No selection
 * by name, no arbitrary choice among copies of a linked Actor. */
export function defenseFormationForActor(actor,explicitToken=null,{canvas=globalThis.canvas}={}){
  const scene=canvas?.scene,grid=canvas?.grid,tokens=canvas?.tokens?.placeables??[];
  if(!actor||!scene||grid?.isSquare!==true)return null;
  const matches=t=>docOf(t)?.parent?.id===scene.id&&
    (t?.actor===actor||(!!actor.uuid&&t?.actor?.uuid===actor.uuid));
  const unique=rows=>[...new Map(rows.map(t=>[identity(t)??t,t])).values()];
  const selected=unique((canvas?.tokens?.controlled??[]).filter(matches));
  const synthetic=actor.isToken?actor.token:null;
  const token=explicitToken??synthetic??(selected.length===1?selected[0]:null);
  if(!token||!matches(token))return null;
  return formationForTarget(token,tokens,{grid});
}
