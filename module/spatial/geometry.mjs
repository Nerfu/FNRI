import {activeConditionEffect, effectHasStatus} from '../effects/active-effect.mjs';
/** Fast NRI spatial geometry: token footprints, not image centres.
 * No movement, token updates, or actor mutation. Square-grid only; other grids
 * are reported as unknown instead of silently applying square-grid rules.
 */
const finite = n => typeof n === 'number' && Number.isFinite(n);
export function cellsForToken(token, grid = globalThis.canvas?.grid) {
  const doc = token?.document ?? token;
  const size = Number(grid?.size);
  if (!doc || grid?.isSquare !== true || !finite(size) || size <= 0 ||
      !finite(doc.x) || !finite(doc.y)) return [];
  // Foundry v14 knows the occupied cells of the actual token shape, including
  // non-rectangular footprints. Ignore vertical duplicates for FNRI's 2D rules.
  if(typeof doc.getOccupiedGridSpaceOffsets==='function' && typeof grid.getCenterPoint==='function'){
    try{
      const unique=new Map();
      for(const offset of doc.getOccupiedGridSpaceOffsets()){
        const {i,j}=offset;
        if(!Number.isInteger(i)||!Number.isInteger(j))return [];
        const point=grid.getCenterPoint({i,j});
        if(!finite(point?.x)||!finite(point?.y))return [];
        unique.set(`${i}:${j}`,{col:j,row:i,x:point.x,y:point.y});
      }
      return [...unique.values()];
    }catch{return [];}
  }
  // Rectangle fallback for test doubles without the native API.
  const w = Number(doc.width), h = Number(doc.height);
  if (!(w > 0 && h > 0 && w <= 64 && h <= 64)) return [];
  const cells=[];
  for(let y=0;y<Math.ceil(h);y++) for(let x=0;x<Math.ceil(w);x++) cells.push({
    col:Math.round(doc.x/size)+x,row:Math.round(doc.y/size)+y,
    x:doc.x+(x+.5)*size,y:doc.y+(y+.5)*size
  });
  return cells;
}
export function cellGap(a,b){return Math.max(Math.abs(a.col-b.col),Math.abs(a.row-b.row));}
export function minimumCellGap(source,target,grid=globalThis.canvas?.grid){
  const a=cellsForToken(source,grid),b=cellsForToken(target,grid);
  if(!a.length||!b.length)return null;
  let best=Infinity;
  for(const p of a)for(const q of b)best=Math.min(best,cellGap(p,q));
  return best;
}
/** Range is native Foundry measured spaces between nearest occupied cells.
 * Reach/adjacency deliberately use cellGap, per Rulebook Reach exception.
 */
export function tokenDistance(source,target,grid=globalThis.canvas?.grid){
  const a=cellsForToken(source,grid),b=cellsForToken(target,grid);
  if(!a.length||!b.length||typeof grid?.measurePath!=='function')return null;
  // A Euclidean-nearest pair is not necessarily nearest by native square-grid
  // distance. Measure each distinct displacement; square-grid spaces are
  // translation invariant. Keep the native metric, not a guessed diagonal rule.
  const measured=new Set();
  let best=Infinity;
  try{
    for(const p of a)for(const q of b){
      const key=`${q.col-p.col}:${q.row-p.row}`;
      if(measured.has(key))continue;
      measured.add(key);
      const measure=grid.measurePath([p,q].map(c=>({x:c.x,y:c.y})));
      const spaces=measure?.spaces;
      if(!finite(spaces)||spaces<0)return null;
      best=Math.min(best,spaces);
      if(best===0)return 0;
    }
    return finite(best)?best:null;
  }catch{return null;}
}
/** All distinct corners of actually occupied square cells, in stable order.
 * Attack lines are independent of nearest-cell range measurement. */
export function occupiedCellCorners(cells,size){
  const unique=new Map();
  for(const cell of cells)for(const dy of [-0.5,0.5])for(const dx of [-0.5,0.5]){
    const point={x:cell.x+dx*size,y:cell.y+dy*size};
    unique.set(`${point.x}:${point.y}`,point);
  }
  return [...unique.values()].sort((a,b)=>a.y-b.y||a.x-b.x);
}
export function sameScene(a,b){
  const da=a?.document??a,db=b?.document??b;
  return !!da?.parent?.id && da.parent.id===db?.parent?.id;
}
export function hasCondition(actor,ids){
  const keys=new Set(ids);
  const effects=typeof actor?.allApplicableEffects==='function' ?
    [...actor.allApplicableEffects()] : [...(actor?.effects?.contents??actor?.effects??[])];
  return effects.some(e => activeConditionEffect(e) && [...keys].some(id => effectHasStatus(e,id)));
}
export function standingConscious(token,{forFormation=false}={}){
  const actor=token?.actor;
  const hp=Number(actor?.system?.hp?.current);
  if(!actor || actor.system?.hp?.current==null || !finite(hp) || hp<=0)return false;
  if(hasCondition(actor,['prone','unconscious']))return false;
  if(forFormation && hasCondition(actor,['grabbed']))return false;
  return true;
}
