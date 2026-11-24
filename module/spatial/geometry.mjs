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
  const pair=nearestCellPair(source,target,grid);
  if(!pair)return null;
  try{
    const measure=grid.measurePath(pair.map(p=>({x:p.x,y:p.y})));
    const spaces=Number(measure?.spaces);
    return finite(spaces)&&spaces>=0?spaces:null;
  }catch{return null;}
}
export function nearestCellPair(source,target,grid=globalThis.canvas?.grid){
  const a=cellsForToken(source,grid),b=cellsForToken(target,grid);
  let pair=null,best=Infinity;
  for(const p of a)for(const q of b){
    const v=(p.x-q.x)**2+(p.y-q.y)**2;
    if(v<best){best=v;pair=[p,q];}
  }
  return pair;
}
export function sameScene(a,b){
  const da=a?.document??a,db=b?.document??b;
  return !!da?.parent?.id && da.parent.id===db?.parent?.id;
}
export function hasCondition(actor,ids){
  const keys=new Set(ids);
  const effects=typeof actor?.allApplicableEffects==='function' ?
    [...actor.allApplicableEffects()] : [...(actor?.effects?.contents??[])];
  return effects.some(e=> e?.disabled!==true && e?.active!==false && e?.isSuppressed!==true &&
      e?.flags?.['fast-nri-v14']?.effectState?.strength!==0 &&
      (keys.has(e?.flags?.['fast-nri-v14']?.conditionId) ||
      [...keys].some(id=>e?.statuses?.has?.(`fnri7-${id}`))));
}
export function standingConscious(token,{forFormation=false}={}){
  const actor=token?.actor;
  const hp=Number(actor?.system?.hp?.current);
  if(!actor || actor.system?.hp?.current==null || !finite(hp) || hp<=0)return false;
  if(hasCondition(actor,['prone','unconscious']))return false;
  if(forFormation && hasCondition(actor,['grabbed']))return false;
  return true;
}
