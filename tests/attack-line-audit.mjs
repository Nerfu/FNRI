import assert from 'node:assert/strict';
import {standingLineObstacles} from '../module/spatial/attack-line.mjs';
import {occupiedCellCorners,cellsForToken} from '../module/spatial/geometry.mjs';
import {spatialAttackContext} from '../module/spatial/spatial-context.mjs';
import {prepareRoll,fixedRollComponents} from '../module/rolls/roll-context.mjs';
const scene={id:'scene'},grid={isSquare:true,size:100,getCenterPoint:({i,j})=>({x:j*100+50,y:i*100+50}),measurePath:([a,b])=>({spaces:Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y))/100})};
const actor={name:'Same',uuid:'Actor.same',system:{hp:{current:10},equipment:{}},items:{contents:[]},effects:{contents:[]}};
const token=(id,cells,a=actor)=>({name:'Same',actor:a,visible:true,document:{uuid:`Scene.scene.Token.${id}`,id,parent:scene,x:0,y:0,width:3,height:3,disposition:1,getOccupiedGridSpaceOffsets:()=>cells.map(([i,j])=>({i,j}))}});
const s=token('source',[[0,0],[1,0]]),t=token('target',[[0,4],[1,4]]);
const b=token('blocker',[[0,1],[0,2],[0,3]]),c=token('blocker2',[[1,1],[1,2]]);
const line=(...tokens)=>standingLineObstacles(s,t,tokens,{grid});
assert.equal(occupiedCellCorners(cellsForToken(s,grid),100).length,6);
assert.deepEqual(line(b),[]);assert.deepEqual(line(c),[]);assert.deepEqual(line(b,c),[b]);
s.document.getOccupiedGridSpaceOffsets=()=>[{i:1,j:0},{i:0,j:0}];t.document.getOccupiedGridSpaceOffsets=()=>[{i:1,j:4},{i:0,j:4}];
assert.deepEqual(line(c,b),[b]); // tie is independent of offset enumeration
const single=token('single',[[0,0]]),end=token('end',[[0,5]]),b2=token('other',[[0,4]]);
const one=(...tokens)=>standingLineObstacles(single,end,tokens,{grid});
assert.deepEqual(one(b,{...b,document:{...b.document}},b2,{...single},{...end}),[b,b2]);
const gap=token('gap',[[1,1],[1,2]]);assert.deepEqual(one(gap),[]); // bounding box is irrelevant
const overlap=token('shared',[[0,0],[0,5]]);assert.deepEqual(one(overlap),[]);
assert.deepEqual(standingLineObstacles(single,overlap,[b],{grid}),[]);
const corner=token('corner',[[0,1]]),diag=token('diag',[[2,2]]),middle=token('middle',[[1,1]]);
assert.deepEqual(standingLineObstacles(single,diag,[corner,middle],{grid}),[]);
// The nearest pair alone is blocked; a farther occupied source cell opens a lane.
const tall=token('tall',[[0,0],[1,0],[2,0]]), farBlock=token('farBlock',[[0,2]]);
assert.deepEqual(one(farBlock),[farBlock]);
assert.deepEqual(standingLineObstacles(tall,end,[farBlock],{grid}),[]);
assert.deepEqual(standingLineObstacles(end,tall,[farBlock],{grid}),[]);
// Blocking an entire intermediate column leaves no free corner-to-corner lane.
const screen=token('screen',[[0,2],[1,2],[2,2]]);
assert.deepEqual(standingLineObstacles(tall,end,[screen],{grid}),[screen]);
// A pure corner contact is not an obstacle, but a line along an occupied edge is.
assert.deepEqual(standingLineObstacles(single,diag,[corner],{grid}),[]);
assert.deepEqual(one(farBlock),[farBlock]);
const status=id=>({flags:{'fast-nri-v14':{conditionId:id}}});
for(const id of ['prone','unconscious']){
 const blocker=token(id,[[0,2]],{...actor,effects:{contents:[status(id)]}});assert.deepEqual(one(blocker),[]);
 blocker.actor.effects.contents[0].duration={expired:true};assert.deepEqual(one(blocker),[blocker]);
}
assert.deepEqual(one(token('zero',[[0,2]],{...actor,system:{hp:{current:0}}})),[]);
for(const hidden of [{...b,visible:false},{...b,document:{...b.document,hidden:true}},{...b,document:{...b.document,parent:{id:'other'}}}])assert.deepEqual(one(hidden),[]);
assert.deepEqual(standingLineObstacles({...single,visible:false},end,[b],{grid}),[]);
assert.deepEqual(standingLineObstacles(single,{...end,document:{...end.document,hidden:true}},[b],{grid}),[]);
assert.deepEqual(standingLineObstacles(single,end,[b],{grid:{...grid,isSquare:false}}),[]);
const bad=token('bad',[[0,2]]);bad.document.getOccupiedGridSpaceOffsets=()=>{throw Error('bad footprint')};assert.deepEqual(one(bad),[]);
const projection=token('projection',[[0,0]]),caster=token('caster',[[3,0]]),target=token('victim',[[0,5]]);
const tokens=[projection,caster,target,b,b2];
const ctx=(props='',origin=projection,extra={})=>spatialAttackContext({origin:{kind:'projection',tokenUuid:origin.document.uuid},targetTokens:[target],attackKind:'ranged',properties:props,scene,grid,tokens,...extra});
assert.deepEqual(ctx().lineCreatures,[b,b2]);assert.equal(ctx().entries.filter(x=>x.id==='standing-creature').length,1);assert.equal(ctx().entries[0].parts[0].value,'-4');
assert.deepEqual(ctx('',caster).lineCreatures,[]); // different geometry from the actual spatial origin
for(const prop of ['Область действия','area','Атака Область действия'])assert.deepEqual(ctx(prop).entries,[]);
assert.deepEqual(ctx('',projection,{targetTokens:[target,end]}).entries,[]);
globalThis.game={user:{isGM:true},i18n:{localize:k=>k}};
const prep=await prepareRoll({actor,kind:'attack',formula:'1d20',extraEntries:ctx().entries,skipDialog:true});
assert.equal(prep.expression,'1d20 + (-4)');assert.equal(fixedRollComponents(prep).length,1);
const strongest=await prepareRoll({actor,kind:'attack',formula:'1d20',extraEntries:ctx().entries,targetActor:{...actor,effects:{contents:[status('invisible')]}},targetToken:target,skipDialog:true});
assert.equal(strongest.expression,'1d20 + (-10)');
console.log('PASS P.3.2 actual footprints, all cell corners, identity, hidden tokens, projection, area and non-stacking hindrance');
