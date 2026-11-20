import assert from 'node:assert/strict';
import {openRollEditor,criticalCheckboxState,promptEditorNumber} from '../module/damage/roll-editor.mjs';
import {calculateDamage} from '../module/damage/damage-core.mjs';
const ID='fast-nri-v14';
globalThis.game={user:{id:'GM',isGM:true},i18n:{localize:s=>s.split('.').at(-1)}};
globalThis.ui={notifications:{info:()=>{},error:message=>{throw Error(message);}}};
const rolls=[2];globalThis.Roll=class {constructor(formula){this.formula=formula;}async evaluate(){this.total=rolls.shift();return this;}};
const msg={id:'d',flags:{[ID]:{weaponDamage:{version:2,isIntervention:true,
  parts:[{id:'die',kind:'die',faces:4,value:1,original:1,excluded:false,formula:'1d4'},
  {id:'fixed',kind:'fixed',value:2,original:2,excluded:false,formula:'+2'}],
  naturalD20:15,naturalCritMultiplier:3,manualCritical:null,
  adjustments:{penalty:0,resistance:0,vulnerability:0},revision:0,history:[]}}},
  canUserModify(){return true;},getFlag(scope,key){return this.flags[scope][key];},
  async update(patch){for(const [p,v] of Object.entries(patch))this.flags[ID][p.split('.').at(-1)]=v;}};
let visits=0,popups=0;
globalThis.foundry={applications:{api:{DialogV2:{
  async input(options){
    if(!options.render){popups++; assert.match(options.content,/name="newValue"/);
      assert.match(options.content,/value="2"/,'popup is seeded from current roll value');
      return {newValue:'3'};
    }
    visits++;
    const op=visits===1?'reroll:0':visits===2?'set:0':null;
    if(!op)return null;
    let listener;
    const checkbox=(name)=>({checked:name==='critical'});
    const root={contains:()=>true,addEventListener:(type,fn)=>{if(type==='click')listener=fn;},
      querySelector:s=>checkbox(s.includes('critical')?'critical':'intervention')};
    options.render(null,{element:{querySelector:()=>root},close:async()=>{}});
    assert.equal(typeof listener,'function');
    let prevent=false;
    listener({target:{closest:()=>({dataset:{fnriEditorOp:op}})},
      preventDefault:()=>{prevent=true;},stopPropagation:()=>{}});
    assert.equal(prevent,true,'component buttons are handled as actual clicks');
    return null;
  }
}}}};
await openRollEditor(msg);
assert.equal(visits,3,'reopens editor after each direct action');
assert.equal(popups,1,'numeric popup only after Set button');
assert.equal(msg.getFlag(ID,'weaponDamage').parts[0].value,3,'numeric entry updates selected die');
assert.equal(msg.getFlag(ID,'weaponDamage').parts[0].original,1,'original die is immutable');
assert.equal(msg.getFlag(ID,'weaponDamage').parts[1].value,2,'fixed component untouched');
assert.equal(msg.getFlag(ID,'weaponDamage').manualCritical,true,'checked Critical saved together with button action');
assert.equal(criticalCheckboxState(msg),true);
assert.equal(msg.getFlag(ID,'interventionOverride'),false,'unchecked Intervention restored its action');
assert.equal(calculateDamage(msg.getFlag(ID,'weaponDamage')).multiplier,3,'attack-card x3 retained');
assert.equal(rolls.length,0,'reroll used a real Roll');
assert.equal(msg.getFlag(ID,'weaponDamage').history.filter(x=>x.id==='die').length,2);
// Invalid and aborted popup input must never change dice or introduce a fake zero.
globalThis.foundry.applications.api.DialogV2.input=async()=>null;
assert.equal(await promptEditorNumber(msg,'set:0'),null);
assert.equal(msg.getFlag(ID,'weaponDamage').parts[0].value,3);
console.log('PASS direct editor dialog: per-die buttons, numeric popup, independent checkboxes, x3 critical, history, cancellation');
