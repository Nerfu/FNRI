import {cellsForToken,nearestCellPair,sameScene,standingConscious} from './geometry.mjs';
/** A conservative straight lane between nearest occupied cells. Finds visible
 * STANDING creatures only. Walls, unusual cover and alternative attack lanes
 * remain GM decisions. No identifying hidden tokens on player clients.
 */
function entersInterior(a,b,c,size){
  // Liang-Barsky segment clipping to the INTERIOR, not a corner touch.
  const e=size*1e-5,x0=c.x-size/2+e,x1=c.x+size/2-e,
    y0=c.y-size/2+e,y1=c.y+size/2-e;
  const dx=b.x-a.x,dy=b.y-a.y;
  let near=0,far=1;
  for(const [p,q] of [[-dx,a.x-x0],[dx,x1-a.x],[-dy,a.y-y0],[dy,y1-a.y]]){
    if(Math.abs(p)<1e-10){if(q<0)return false;continue;}
    const r=q/p;
    if(p<0){near=Math.max(near,r);}else{far=Math.min(far,r);}
    if(near>far)return false;
  }
  return far>0 && near<1 && near<far;
}
export function standingLineObstacles(source,target,tokens=[],{grid=globalThis.canvas?.grid}={}){
  const pair=nearestCellPair(source,target,grid),size=Number(grid?.size);
  if(!pair||!Number.isFinite(size))return [];
  const [a,b]=pair;
  return tokens.filter(t=>t!==source && t!==target && sameScene(source,t) &&
    t?.document?.hidden!==true && t?.visible!==false && standingConscious(t) &&
    cellsForToken(t,grid).some(cell=>entersInterior(a,b,cell,size)));
}
