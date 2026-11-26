import {installTemplateMock} from './foundry-test-helpers.js';
import {acceptPreroll} from './foundry-test-helpers.js';
import {sheetOptions} from './foundry-test-helpers.js';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const localize=key=>key;
const rolls=[];
class RollMock {
 static validate(s){return !s.includes('oops');}
 constructor(expression,data){this.expression=expression;this.data=data;}
 async evaluate(){return this;}
 async toMessage(msg,opts){rolls.push({expression:this.expression,msg,opts});return msg;}
}
globalThis.Roll=RollMock;
globalThis.ChatMessage={getSpeaker({actor}={}){return actor?{actor:actor.id}:{alias:'No actor'};}};
let currentMode='gm';
globalThis.game={i18n:{localize},settings:{get(scope,key){if(scope==='fast-nri-v14'&&key==='skillAllocationMode')return 'strict';assert.equal(scope,'core');assert.equal(key,'messageMode');return currentMode;}}};
let warnings=0,errors=0;
globalThis.ui={notifications:{warn(){warnings++;},error(){errors++;}}};
const DialogV2={confirm:async()=>true,wait:acceptPreroll};
class SheetMock {constructor({actor,item,editable=true}={}){this.actor=actor;this.item=item;this.isEditable=editable;}async _prepareContext(){return {}}async _onRender(){}}
globalThis.foundry={applications:{api:{HandlebarsApplicationMixin:Parent=>Parent,DialogV2},sheets:{ActorSheetV2:SheetMock,ItemSheetV2:SheetMock}}};
installTemplateMock();
const source=resolve('module/sheets/sheets.mjs');
const {FastNRICharacterSheet,FastNRINPCSheet,FastNRIItemSheet}=await import(pathToFileURL(source).href);
const entry={name:'Незаметность',kind:'specialization',dice:'2d6',modifier:2,value:45};
const effectRows=[];
const actor={getFlag(){return undefined;},documentName:'Actor',id:'a1',type:'character',system:{skills:{sample:entry}},
 effects:{get(id){return effectRows.find(e=>e.id===id);},get contents(){return effectRows;}},
 getRollData(){return {hello:'world'}}
};
actor.createEmbeddedDocuments=async (type,records)=>{
 assert.equal(type,'ActiveEffect');
 assert.equal(records.length,1);
 assert.equal(records[0].type,'base');
 const e={id:'e1',name:records[0].name,disabled:false,changes:records[0].system.changes,
  sheet:{async render(){}},async update(patch){Object.assign(this,patch);}};
 effectRows.push(e);return [e];
};
actor.deleteEmbeddedDocuments=async (type,ids)=>{
 assert.equal(type,'ActiveEffect');
 for(const id of ids){const i=effectRows.findIndex(e=>e.id===id);if(i>=0)effectRows.splice(i,1);}
};
const sheet=new FastNRICharacterSheet({actor});
sheet.element={querySelector(sel){
 if(sel==='[data-fnri-effect-key]')return {value:'system.skills.sample.modifier'};
 if(sel==='[data-fnri-effect-amount]')return {value:'2'};
 return null;
}};
const actions=sheetOptions(FastNRICharacterSheet).actions;
await actions.rollSkill.call(sheet,null,{dataset:{id:'sample'}});
assert.equal(rolls[0].expression,'1d20 + (2d6) + (2)');
assert.equal(rolls[0].opts.messageMode,'gm');
assert.deepEqual(rolls[0].msg.speaker,{actor:'a1'});
await actions.createEffect.call(sheet,null,{});
assert.equal(effectRows.length,1);
assert.deepEqual(effectRows[0].changes,[{key:'system.skills.sample.modifier',type:'add',value:'2',phase:'initial'}]);
await actions.toggleEffect.call(sheet,null,{dataset:{id:'e1'}});
assert.equal(effectRows[0].disabled,true);
await actions.editEffect.call(sheet,null,{dataset:{id:'e1'}});
await actions.deleteEffect.call(sheet,null,{dataset:{id:'e1'}});
assert.equal(effectRows.length,0);
const originalEffectQuery=sheet.element.querySelector;
sheet.element.querySelector=sel=>sel==='[data-fnri-effect-key]'?{value:'system.spellRange'}:originalEffectQuery(sel);
await actions.createEffect.call(sheet,null,{});
assert.deepEqual(effectRows[0].changes,[{key:'system.spellRange',type:'add',value:'2',phase:'initial'}]);
await actions.deleteEffect.call(sheet,null,{dataset:{id:'e1'}});
sheet.element.querySelector=originalEffectQuery;
// No AE double-applying in the roll handler. It reads just the prepared modifier.
entry.modifier=4;currentMode='blind';
await actions.rollSkill.call(sheet,null,{dataset:{id:'sample'}});
assert.equal(rolls[1].expression,'1d20 + (2d6) + (4)');
assert.equal(rolls[1].opts.messageMode,'blind');
// Failed save halts only rolling stale data, not normal navigation.
sheet._failedFields.add('system.skills.sample.dice');
await actions.rollSkill.call(sheet,null,{dataset:{id:'sample'}});
assert.equal(rolls.length,2);assert.ok(warnings>=1);

const itemEffects=[];
const item={id:'it',name:'Старая способность',parent:actor,system:{rollFormula:'1d4+3'},
 effects:{get(id){return itemEffects.find(e=>e.id===id);},get contents(){return itemEffects;}},
 async createEmbeddedDocuments(type,records){
  assert.equal(type,'ActiveEffect');assert.equal(records[0].transfer,false);
  assert.equal(records[0].type,'base');assert.deepEqual(records[0].system.changes,[]);
  const e={id:'iE',name:'E',disabled:false,transfer:false,sheet:{async render(){}},async update(patch){Object.assign(this,patch);}};
  itemEffects.push(e);return [e];
 },
 async deleteEmbeddedDocuments(_type,ids){itemEffects.splice(0,itemEffects.length,...itemEffects.filter(e=>!ids.includes(e.id)));},
 getFlag(){return 'deprecated'}
};
currentMode='self';
const itemSheet=new FastNRIItemSheet({item});
itemSheet.element={querySelector(sel){
 if(sel==='[name="system.rollFormula"]')return {value:'1d4+3'};
 return null;
}};
const itemActions=sheetOptions(FastNRIItemSheet).actions;
await itemActions.itemRoll.call(itemSheet,null,{});
assert.equal(rolls[2].expression,'1d4+3');
assert.equal(rolls[2].opts.messageMode,'self');
await itemActions.createItemEffect.call(itemSheet);
assert.equal(itemEffects.length,1);
await itemActions.toggleItemEffect.call(itemSheet,null,{dataset:{id:'iE'}});
assert.equal(itemEffects[0].disabled,true);
await itemActions.deleteItemEffect.call(itemSheet,null,{dataset:{id:'iE'}});
assert.equal(itemEffects.length,0);
assert.equal(errors,0);
// Editing must show persisted bases, while rolls use AE-prepared values.
actor.items={contents:[]};
actor.system.defenses={awareness:1,reflex:5,fortitude:3,will:9};
const baseSystem={skills:{sample:{...entry,modifier:1}},defenses:{...actor.system.defenses,will:7}};
actor.toObject=source=>{assert.equal(source,true);return {system:baseSystem};};
entry.modifier=3;
const playContext=await sheet._prepareContext({});
assert.equal(playContext.system.defenses.will,7);
assert.equal(playContext.effectiveSystem.defenses.will,9);
sheet._configurationLocked=false;
const context=await sheet._prepareContext({});
assert.equal(context.system.defenses.will,7,'form field must use source, not AE-adjusted value');
assert.equal(context.effectiveSystem.defenses.will,9,'display uses prepared Actor');
// Compact header shows effective prepared values while detailed fields retain source values.
actor.system.hp={current:18,max:25,temp:3};
actor.system.ac={partial:10,success:18,great:22};
actor.system.speed=7;
actor.system.combatDie='d10';
const summaryContext=await sheet._prepareContext({});
assert.equal(summaryContext.summary.hp,'18 / 25');
assert.equal(summaryContext.summary.tempHP,'+3');
assert.equal(summaryContext.summary.ac,'10 / 18 / 22');
assert.equal(summaryContext.summary.combatDie,'d10');
assert.equal(summaryContext.summary.attackModifier,'—');
assert.equal(summaryContext.summary.speed,'7');
actor.system.hp.current=0;
const zeroContext=await sheet._prepareContext({});
assert.equal(zeroContext.summary.hp,'0 / 25','zero must remain visible');

assert.equal(context.skillRows[0].modifier,1,'skill edit field shows original number');
assert.equal(context.skillRows[0].effectiveModifier,3,'display/roll use prepared modifier');
assert.equal(context.skillRows[0].hasEffectiveModifier,true);

assert.equal(context.skillRows[0].specializationDiceOptions.find(x=>x.selected).value,'__custom__','stored formulas are not migrated');
assert.equal(context.skillRows[0].specializationDiceOptions.find(x=>x.value==='1d4').selected,false);
// Existing custom dice must stay visible and unchanged; a preset is not a migration.
baseSystem.skills.sample.dice='3d8 + 1d6';
const customContext=await sheet._prepareContext({});
assert.equal(customContext.skillRows[0].specializationDiceOptions.find(x=>x.selected).value,'__custom__');
assert.equal(customContext.skillRows[0].hasCustomDice,true);
assert.equal(baseSystem.skills.sample.dice,'3d8 + 1d6');
baseSystem.skills.sample.dice='2d6';

sheet._failedFields.clear();
await actions.rollSkill.call(sheet,null,{dataset:{id:'sample'}});
assert.equal(rolls.at(-1).expression,'1d20 + (2d6) + (3)');
console.log('PASS stage 3 actions: Actor Skill Check, targeted ActiveEffect, item card Roll, disable/delete, native visibility mode');
