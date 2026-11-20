import assert from 'node:assert/strict';
import {highlightDiceResults} from '../module/damage/dice-highlights.mjs';
const createNode=(v)=>({textContent:String(v),tags:new Set(),classList:{add(c){this.parent.tags.add(c);}},});
function group(values) {
  const nodes=values.map(value=>{const n={textContent:String(value),tags:new Set()};n.classList={add(c){n.tags.add(c);}};return n;});
  return {nodes,querySelectorAll(s){return s==='.dice-rolls .roll'?nodes:[];}};
}
const groups=[group([1]),group([8]),group([5])];
const html={querySelectorAll(s){return s==='.dice-tooltip .dice'?groups:[];}};
const dice=[{faces:20,results:[{result:1,active:true}]},{faces:8,results:[{result:8,active:true}]},
  {faces:6,results:[{result:5,active:true}]}];
const msg={rolls:[{dice}],getFlag(s,k){return s==='fast-nri-v14' && k==='weaponAttack'?{}:null;}};
assert.equal(highlightDiceResults(msg,html),2);
assert.ok(groups[0].nodes[0].tags.has('fnri-die-min'));
assert.ok(groups[1].nodes[0].tags.has('fnri-die-max'));
assert.equal(groups[2].nodes[0].tags.size,0);
assert.equal(highlightDiceResults(msg,{querySelectorAll(){return groups.slice(0,1);}}),0,'unmatched markup is skipped');
assert.equal(highlightDiceResults({...msg,getFlag(){return null;}},html),0,'foreign messages not decorated');
// Active dice of complex rolls are not attached to incorrect tooltip cells.
const discarded=group([2,20]);
assert.equal(highlightDiceResults({rolls:[{dice:[{faces:20,results:[{result:2,active:false},{result:20,active:true}]}]}],
  getFlag:msg.getFlag},{querySelectorAll(){return [discarded];}}),1);
assert.ok(discarded.nodes[1].tags.has('fnri-die-max'));
console.log('PASS: exact natural minimum/maximum highlights, complex rolls and unrelated chat safe');
