import {tokenSide} from '../data/actor-side.mjs';
import {hasCondition,minimumCellGap,standingConscious,sameScene} from './geometry.mjs';
import {isProjectionActor} from '../projection/projection.mjs';
/** Fast NRI: threats vs formation. Not PF2e flanking. No persistent statuses. */
function affinity(a,b){
  const x=tokenSide(a),y=tokenSide(b);
  if(![1,-1].includes(x)||![1,-1].includes(y))return 'unknown';
  return x===y?'ally':'enemy';
}
function isThreat(actor,token,target,grid){
  if(isProjectionActor(actor) || !standingConscious(token))return false;
  const distance=minimumCellGap(token,target,grid);
  if(distance===1)return true; // ordinary unarmed control of adjacent cells
  if(distance!==2)return false;
  // Only a documented two-cell melee weapon controls cells exactly at reach 2.
  const hands=actor?.system?.equipment??{};
  const ids=new Set([hands.leftHand,hands.rightHand].filter(Boolean));
  return [...ids].some(id=>{
    const item=actor?.items?.get?.(id);
    return item?.type==='weapon' && String(item.system?.attackKind).toLowerCase()==='melee' &&
      Number(String(item.system?.distance??'').replace(',','.'))===2;
  });
}
export function formationForTarget(target,tokens=[],{grid=globalThis.canvas?.grid}={}){
  if(!target)return null;
  const own=standingConscious(target,{forFormation:true})?1:0;
  let allies=0,threats=0,uncertain=false;
  for(const other of tokens){
    if(other===target || !sameScene(other,target) || other?.document?.hidden===true ||
       other?.visible===false || !standingConscious(other))continue;
    const relation=affinity(other,target);
    if(relation==='ally'){
      if(minimumCellGap(other,target,grid)===1 && !hasCondition(other.actor,['grabbed']))allies++;
    }else if(relation==='enemy'){
      if(isThreat(other.actor,other,target,grid))threats++;
    }else if(isProjectionActor(other.actor)){
      // Unknown allegiance matters only if the projection could contribute to formation.
      if(minimumCellGap(other,target,grid)===1 && !hasCondition(other.actor,['grabbed']))uncertain=true;
    }else if((minimumCellGap(other,target,grid)??Infinity)<=2)uncertain=true;
  }
  return {threats,formation:own+allies,surrounded:!uncertain&&threats>own+allies,
    uncertain,standing:own===1};
}
