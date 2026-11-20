import assert from 'node:assert/strict';
import {appendDamageComponents,calculateDamage,changePart} from '../module/damage/damage-core.mjs';
import {addDamageToMessage,renderRollEditorContent,rollEditorPage,promptEditorNumber,
  promptAddDamageComponent,openRollEditor,rollMarkedDice,resolvePendingOnClose} from '../module/damage/roll-editor.mjs';
const ID='fast-nri-v14';
const old={id:'original',kind:'die',faces:4,formula:'1d4',original:2,value:2,
  damageType:'physical',traits:[],excluded:false};
const start={version:2,parts:[old],history:[],revision:0,adjustments:{},naturalD20:10};
const first=appendDamageComponents(start,{kind:'die',faces:6,count:2,values:[1,6],damageType:'Fire',traits:['Holy','Piercing']});
assert.equal(first.next.parts.length,3);assert.equal(start.parts.length,1,'pure function must never modify original');
assert.deepEqual(first.appended.map(p=>p.id),['gm-1','gm-2']);
assert.deepEqual(first.appended.map(p=>p.original),[1,6]);
assert.deepEqual(first.appended[0].traits,['Holy','Piercing']);
assert.equal(calculateDamage(first.next).total,9);
const second=appendDamageComponents(first.next,{kind:'fixed',value:-5,damageType:'Frost',traits:['Magic']});
assert.equal(second.appended[0].formula,'-5');assert.equal(calculateDamage(second.next).total,4);
assert.equal(changePart(first.next,'gm-2','set',9).next.parts[2].value,9,'GM may exceed d6');
assert.equal(changePart(first.next,'gm-2','set',-2).next.parts[2].value,1,'negative die is clamped to 1');
assert.equal(changePart(first.next,'gm-2','set',0).next.parts[2].value,1,'zero die is clamped to 1');
assert.equal(calculateDamage(changePart(first.next,'gm-2','set',-2).next).total,4);
assert.throws(()=>changePart(first.next,'gm-2','set',1.5),'dice results remain integers');
assert.throws(()=>changePart(first.next,'gm-2','reroll',9),'real reroll must obey faces');
assert.throws(()=>appendDamageComponents(start,{kind:'die',count:2,faces:6,values:[1]}));
assert.throws(()=>appendDamageComponents(start,{kind:'die',count:1001,faces:6,values:[]}));
const much=appendDamageComponents(start,{kind:'die',faces:10,count:603,values:Array(603).fill(7),damageType:'Radiant',traits:['Special']});
assert.equal(much.next.parts.length,604);assert.equal(new Set(much.next.parts.map(p=>p.id)).size,604);
assert.equal(rollEditorPage(much.next.parts,{query:'Radiant'}).count,603);
assert.equal(rollEditorPage(much.next.parts,{query:'Special',page:20}).items.length,20);
assert.equal(rollEditorPage(much.next.parts,{query:'#500'}).items[0].part.id,'gm-499');

globalThis.game={user:{id:'gm',isGM:true},i18n:{localize:key=>key.split('.').at(-1)}};
const card={version:2,parts:[structuredClone(old)],adjustments:{},history:[],revision:0,naturalD20:10};
const msg={flags:{[ID]:{weaponDamage:card}},rolls:[{total:2}],getFlag(s,k){return this.flags[s][k]},
  canUserModify(){return true},async update(patch){for(const [path,value] of Object.entries(patch))
    this.flags[ID][path.split('.').at(-1)]=value;}};
let lastRoll;
globalThis.Roll=class {constructor(formula){lastRoll=formula;}async evaluate(){this.dice=[{faces:6,results:[{result:4},{result:1},{result:6}]}];this.total=11;return this;}};
const added=await addDamageToMessage(msg,{kind:'die',faces:6,count:3,damageType:'Огонь',traits:['Святой','Бронебойный']});
assert.equal(lastRoll,undefined,'adding dice must not roll');
assert.deepEqual(added.added.map(x=>x.value),[null,null,null]);
assert.ok(added.added.every(x=>x.pending),'new dice start unrolled');
assert.equal(calculateDamage(msg.getFlag(ID,'weaponDamage')).total,2,'pending dice must not contribute');
await rollMarkedDice(msg,added.added.map(x=>x.id));
assert.equal(lastRoll,'3d6','selected dice must be rolled in one batch');
assert.deepEqual(msg.getFlag(ID,'weaponDamage').parts.slice(1).map(x=>x.value),[4,1,6]);
assert.equal(msg.getFlag(ID,'weaponDamage').parts.length,4);
assert.equal(msg.getFlag(ID,'weaponDamage').history.length,2);
assert.deepEqual(msg.getFlag(ID,'weaponDamage').history[0].ids,['gm-1','gm-2','gm-3']);
assert.equal(msg.rolls[0].total,2,'original Foundry roll unchanged');
await addDamageToMessage(msg,{kind:'fixed',value:9,damageType:'Лёд',traits:['Особый']});
assert.equal(msg.getFlag(ID,'weaponDamage').parts.at(-1).id,'gm-4');
assert.equal(msg.getFlag(ID,'weaponDamage').revision,3);
assert.equal(calculateDamage(msg.getFlag(ID,'weaponDamage')).total,22);
const view=renderRollEditorContent(msg);
assert.match(view,/data-fnri-editor-op="add"/,'add button is at bottom');
assert.match(view,/Огонь · Святой · Бронебойный/);
assert.match(view,/data-fnri-editor-op="reroll:1"/);
assert.equal(rollEditorPage(msg.getFlag(ID,'weaponDamage').parts,{query:'Лёд'}).count,1);
// Adding does not grant privilege to ordinary players.
game.user.isGM=false;
await assert.rejects(addDamageToMessage(msg,{kind:'fixed',value:1}));
game.user.isGM=true;

// Manual over-range values are explicitly warned/confirmed, never silently refused.
let confirmations=0;
const dialog={async input(opts){assert.doesNotMatch(opts.content,/<small>/);return {newValue:'11'};},
  async confirm(opts){confirmations++;assert.match(opts.content,/1d4: 11 &gt; 4/);assert.doesNotMatch(opts.content,/невозможно|ordinary roll/i);return true;}};
assert.equal(await promptEditorNumber(msg,'set:0',dialog),11);
assert.equal(confirmations,1);
dialog.confirm=async()=>false;
assert.equal(await promptEditorNumber(msg,'set:0',dialog),null,'cancel must preserve stored result');
let normalizedNotice=0;
const tooLow={...dialog,input:async()=>({newValue:'-8'}),async prompt(opts){normalizedNotice++;assert.match(opts.content,/dieValueSetToOne/);return true;},async confirm(){throw Error('below minimum must not request confirmation');}};
assert.equal(await promptEditorNumber(msg,'set:0',tooLow),1);
assert.equal(normalizedNotice,1);
const zeroDialog={...tooLow,input:async()=>({newValue:'0'})};
assert.equal(await promptEditorNumber(msg,'set:0',zeroDialog),1);
assert.equal(normalizedNotice,2);
const viewWithoutWarning=renderRollEditorContent({...msg,flags:{[ID]:{weaponDamage:{...msg.getFlag(ID,'weaponDamage'),parts:[{...old,value:12}]}}}});
assert.doesNotMatch(viewWithoutWarning,/⚠|outOfRangeTag/);
assert.equal(msg.getFlag(ID,'weaponDamage').parts[0].value,2);
const bad={...dialog,input:async()=>({newValue:'1.5'})};
await assert.rejects(promptEditorNumber(msg,'set:0',bad));

const addDialog={async input(opts){assert.match(opts.content,/name="damageType"/);
  assert.match(opts.content,/name="traits"/);assert.match(opts.content,/name="count"/);
  return {kind:'fixed',value:'-3',damageType:'Fire',traits:'Holy, Armor-piercing'};}};
assert.deepEqual(await promptAddDamageComponent(addDialog),
  {kind:'fixed',faces:6,count:1,value:-3,damageType:'Fire',traits:['Holy','Armor-piercing']});
assert.equal(await promptAddDamageComponent({input:async()=>null}),null);
assert.equal(rollEditorPage(msg.getFlag(ID,'weaponDamage').parts,{query:'Армор'}).count,0);
console.log('PASS stage 12: additive GM-only dice and fixed, minimum die one, upper overrides with compact confirm/cancel, real roll, 603+ dice, traits and immutable originals');
