import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Test the actual system subclass with a minimal native ruler stand-in.
const nativeContext = Object.freeze({cssClass:'native', measurement:42});
let templates;
class NativeRuler {
  static WAYPOINT_LABEL_TEMPLATE = 'templates/hud/waypoint-label.hbs';
  async draw() { return 'native-draw'; }
  refresh(data) { this.input = data; }
  _getWaypointLabelContext() { return nativeContext; }
}
globalThis.foundry = {canvas:{placeables:{tokens:{TokenRuler:NativeRuler}}}, applications:{handlebars:{loadTemplates:async paths=>{templates=paths;}}}};
globalThis.canvas = {grid:{isSquare:true}};
const lang = Object.fromEntries(['ru','en'].map(l=>[l, JSON.parse(readFileSync(new URL(`../lang/${l}.json`,import.meta.url),'utf8')).FASTNRI.MovementRuler]));
globalThis.game = {i18n:{lang:'ru',format:(key,{count})=>lang[game.i18n.lang][key.split('.').at(-1)].replace('{count}',count)}};
const {FastNRITokenRuler} = await import('../module/spatial/token-ruler.mjs');
const ruler = new FastNRITokenRuler();
const segment = (spaces,diagonals,distance=spaces,cost=distance)=>({spaces,diagonals,distance,cost});
function route(segments,previous=null) {
  for(const s of segments) {
    const waypoint = {stage:'planned',previous,measurement:{backward:s}};
    if(previous?.stage==='planned') previous.next=waypoint;
    previous=waypoint;
  }
  return previous;
}
const context = w=>ruler._getWaypointLabelContext(w,{});
function check(segments,expected,previous=null) {
  const w=route(segments,previous);
  const result=context(w);
  const l=game.i18n.lang;
  const category=new Intl.PluralRules(l).select(expected);
  assert.equal(result.fnriMovementLabel,lang[l][category].replace('{count}',expected.toLocaleString(l,{maximumFractionDigits:2})));
  assert.equal(result.cssClass,nativeContext.cssClass);
  return w;
}
assert.equal(await ruler.draw(),'native-draw');
assert.deepEqual(templates,[NativeRuler.WAYPOINT_LABEL_TEMPLATE]);
assert.equal(FastNRITokenRuler.WAYPOINT_LABEL_TEMPLATE,'systems/fast-nri-v14/templates/token-ruler-label.hbs');
for(const l of ['ru','en']) {
  game.i18n.lang=l;
  for(let d=1;d<=8;d++) check([segment(d,d)],d+Math.floor(d/2));
  check([segment(5,0)],5);
  check([segment(1,1),segment(1,0),segment(1,1)],4);
  check([segment(2,2,3),segment(2,2,3)],6);
  check([segment(1,1),segment(0,0,0,0),segment(1,1)],3);
  // A new drag does not inherit the diagonal parity of its historical predecessor.
  check([segment(1,1,2)],1,{stage:'passed',measurement:{backward:segment(5,5,7)}});
  // Uniform native multipliers are retained, including when native distance is not in cells.
  check([segment(2,2,15,30)],6);
  check([segment(1,1,5,5),segment(1,1,10,20)],5);
  check([segment(2,0,10,15)],3);
  check([segment(2,0,10,0)],0);
  check([segment(1,0,5,7.5)],1.5);
}
const last=route([segment(1,0),segment(1,1)]);
assert.equal(context(last.previous),undefined); // endpoint only
assert.equal(context({...last,unreachable:true}),nativeContext);
assert.equal(context({...last,stage:'passed'}),nativeContext);
for(const invalid of [null,segment(0,0,0,0),segment(1,2),segment(1,0,0),segment(1,0,1,-1),segment(1,0,1,Infinity),segment(1.5,0)]) {
  assert.equal(context(route([invalid])),nativeContext);
}
canvas.grid.isSquare=false;
assert.equal(context(last),nativeContext);
canvas.grid.isSquare=true;
const plan={history:[{id:'old'}],waypoints:[{id:'new'}],other:'native'};
const data={passedWaypoints:[1],pendingWaypoints:[2],plannedMovement:{player:plan},nativeOption:true};
const original=structuredClone(data);
ruler.refresh(data);
assert.deepEqual(data,original); // filtering is display-only, original input is not mutated
assert.deepEqual(ruler.input,{passedWaypoints:[],pendingWaypoints:[],plannedMovement:{player:{...plan,history:[]}},nativeOption:true});
ruler.refresh({plannedMovement:{}});
assert.deepEqual(ruler.input.plannedMovement,{});
// Fallback template delegates to Foundry rather than replacing the native label.
assert.match(readFileSync(new URL('../templates/token-ruler-label.hbs',import.meta.url),'utf8'), /\{\{> "templates\/hud\/waypoint-label.hbs"\}\}/);
console.log('token-ruler-audit: OK (native API mock)');
