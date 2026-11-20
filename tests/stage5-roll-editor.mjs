import assert from 'node:assert/strict';
import {registerRollEditor,applyRollCorrection,editableMessage} from '../module/damage/roll-editor.mjs';
const ID='fast-nri-v14',handlers={},messages=new Map();
globalThis.game={user:{id:'gm',isGM:true},messages:{get:id=>messages.get(id)},i18n:{localize:k=>k}};
globalThis.Hooks={on:(name,fn)=>{handlers[name]=fn;}};
function doc(id,flags,rolls=[]) {const msg={id,flags:{[ID]:flags},rolls,isAuthor:false,
  canUserModify(){return true;},getFlag(scope,key){return this.flags?.[scope]?.[key];},
  async update(patch){for(const [path,value] of Object.entries(patch))this.flags[ID][path.split('.').at(-1)]=value;}};
  messages.set(id,msg);return msg;}
const check=doc('check',{checkRoll:{version:1}},[{total:17,dice:[
  {faces:20,results:[{result:12,active:true}]},{faces:8,results:[{result:4,active:true}]}]}]);
const damage=doc('damage',{weaponDamage:{version:2,parts:[{id:'A',kind:'die',faces:6,original:5,value:5,
  formula:'1d6',excluded:false},{id:'C',kind:'fixed',original:6,value:6,formula:'6',excluded:false}],
  naturalD20:13,history:[],revision:0,adjustments:{penalty:0,resistance:0,vulnerability:0}}});
assert.equal(editableMessage(check),true);
await applyRollCorrection(check,{partId:'die-2',action:'set',value:8});
assert.equal(check.getFlag(ID,'rollEdit').currentTotal,21);
assert.equal(check.rolls[0].total,17,'original is never rewritten');
await applyRollCorrection(check,{partId:'die-1',action:'exclude'});
assert.equal(check.getFlag(ID,'rollEdit').currentTotal,9);
await applyRollCorrection(damage,{partId:'C',action:'exclude'});
assert.equal(damage.getFlag(ID,'weaponDamage').parts[1].excluded,true);
assert.equal(damage.getFlag(ID,'weaponDamage').parts[1].original,6);
await applyRollCorrection(damage,{partId:'A',action:'reroll',value:2});
assert.equal(damage.getFlag(ID,'weaponDamage').parts[0].value,2);
await applyRollCorrection(damage,{partId:'adjustment:resistance',action:'set',value:2});
assert.equal(damage.getFlag(ID,'weaponDamage').adjustments.resistance,2);
assert.equal(damage.getFlag(ID,'weaponDamage').history.length,3);
await assert.rejects(()=>applyRollCorrection(damage,{partId:'C',action:'reroll',value:5}));
registerRollEditor();
const opts=[];handlers.getChatMessageContextOptions({},opts);
assert.equal(opts.length,1);
const el={dataset:{messageId:'check'},closest(){return this;}};
assert.equal(opts[0].visible(el),true);
game.user.isGM=false;
assert.equal(opts[0].visible(el),false);
await assert.rejects(()=>applyRollCorrection(check,{partId:'die-1',action:'restore'}));
console.log('PASS stage 5 roll editor: GM context, persistent corrections, non-GM denial, original Roll preserved');
