import {cellsForToken,occupiedCellCorners,sameScene,standingConscious} from './geometry.mjs';
/** Straight corner-to-corner lanes between any occupied cells. Finds visible
 * standing creatures only; walls, cover and hidden creatures remain manual.
 */
function crossesCell(a,b,c,size){
  // Clip against the closed cell. A point-only corner touch is not a crossing;
  // following an occupied edge for a nonzero length counts as an obstacle.
  const x0=c.x-size/2,x1=c.x+size/2,y0=c.y-size/2,y1=c.y+size/2;
  const dx=b.x-a.x,dy=b.y-a.y;
  let near=0,far=1;
  for(const [p,q] of [[-dx,a.x-x0],[dx,x1-a.x],[-dy,a.y-y0],[dy,y1-a.y]]){
    if(Math.abs(p)<1e-10){if(q<0)return false;continue;}
    const r=q/p;
    if(p<0){near=Math.max(near,r);}else{far=Math.min(far,r);}
    if(near>far)return false;
  }
  return far>0 && near<1 && far-near>1e-10;
}
const docOf=t=>t?.document??t;
const identity=t=>docOf(t)?.uuid??(docOf(t)?.id&&docOf(t)?.parent?.id?`${docOf(t).parent.id}:${docOf(t).id}`:docOf(t));
const hidden=t=>docOf(t)?.hidden===true||t?.visible===false;
const sameCell=(a,b)=>a.col===b.col&&a.row===b.row;
export function standingLineObstacles(source,target,tokens=[],{grid=globalThis.canvas?.grid}={}){
  const size=Number(grid?.size);
  if(!sameScene(source,target)||hidden(source)||hidden(target)||
    identity(source)===identity(target)||!Number.isFinite(size)||size<=0)return [];
  const sourceCells=cellsForToken(source,grid),targetCells=cellsForToken(target,grid);
  if(!sourceCells.length||!targetCells.length||sourceCells.some(a=>targetCells.some(b=>sameCell(a,b))))return [];
  const starts=occupiedCellCorners(sourceCells,size),ends=occupiedCellCorners(targetCells,size);
  const endpointCells=new Set([...sourceCells,...targetCells].map(c=>`${c.row}:${c.col}`));
  // Deduplicate actual token documents, never actors or names. Cache each
  // footprint once: a large creature contributes one obstacle per lane.
  const seen=new Set([identity(source),identity(target)]),candidates=[];
  for(const token of tokens){
    const key=identity(token);
    if(seen.has(key)||!sameScene(source,token)||hidden(token)||!standingConscious(token))continue;
    seen.add(key);
    const cells=cellsForToken(token,grid).filter(c=>!endpointCells.has(`${c.row}:${c.col}`));
    if(cells.length)candidates.push({token,cells});
  }
  if(!candidates.length)return [];
  let selected=null;
  for(const a of starts)for(const b of ends){
    if(a.x===b.x&&a.y===b.y)return [];
    const obstacles=candidates.filter(({cells})=>cells.some(cell=>crossesCell(a,b,cell,size))).map(({token})=>token);
    // Any free line is sufficient; the number of obstacles is informational.
    if(!obstacles.length)return [];
    if(selected===null||obstacles.length<selected.length)selected=obstacles;
  }
  return selected??[];
}
