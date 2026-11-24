import assert from 'node:assert/strict';
import {openRollEditor,executeRollEditorAction} from '../module/damage/roll-editor.mjs';

const ID='fast-nri-v14';
let nextDice=[4,4];const rendered=[],info=[];
class RollMock {
  constructor(formula){this.formula=formula;}
  async evaluate(){this.total=nextDice.shift();return this;}
}
globalThis.Roll=RollMock;
globalThis.game={user:{id:'gm',isGM:true},i18n:{localize:key=>key.split('.').at(-1)}};
globalThis.ui={notifications:{info:x=>info.push(x),error:x=>{throw Error(String(x))}}};
const responses=[{part:'A',action:'reroll',value:0},{part:'A',action:'reroll',value:0},null];
globalThis.foundry={applications:{api:{DialogV2:{input:async x=>{rendered.push(x.content);return responses.shift()}}}}};
const msg={flags:{[ID]:{weaponDamage:{version:2,parts:[
  {id:'A',kind:'die',faces:4,formula:'1d4',original:1,value:1,excluded:false},
  {id:'C',kind:'fixed',formula:'1',original:1,value:1,excluded:false}],
  history:[],revision:0,adjustments:{penalty:0,resistance:0,vulnerability:0}}}},
  getFlag(scope,key){return this.flags[scope][key];},canUserModify(){return true;},
  async update(patch){for(const [key,v] of Object.entries(patch))this.flags[ID][key.split('.').at(-1)]=v;}};
await openRollEditor(msg);
const damage=msg.getFlag(ID,'weaponDamage');
assert.equal(damage.parts[0].value,4,'reroll changed the die to the new Foundry Roll total');
assert.equal(damage.parts[0].original,1,'original result must remain untouched');
assert.equal(damage.history.length,2,'even an identical reroll must remain visible in the audit trail');
assert.equal(damage.history[0].action,'reroll');
assert.equal(damage.history[1].before.value,4);
assert.equal(damage.history[1].after.value,4);
assert.match(rendered[1],/1 → 4/,'first reroll feedback appears in the next dialog');
assert.match(rendered[2],/4 → 4/,'identical reroll feedback appears in the next dialog');
assert.match(rendered.at(-1),/4 → 4/,'next dialog must show the previous reroll outcome');
assert.equal(nextDice.length,0);
await assert.rejects(()=>executeRollEditorAction(msg,{partId:'C',action:'reroll'}),/notADie/);
assert.equal(damage.parts[1].value,1,'fixed modifier cannot be rerolled');
console.log('PASS: UI dialog rerolls actual Foundry dice, shows same results, saves history, preserves original');
