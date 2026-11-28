import {installTemplateMock} from './foundry-test-helpers.js';
import {sheetOptions} from './foundry-test-helpers.js';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const file=p=>resolve(root,p);
const manifest=JSON.parse(readFileSync(file('system.json'),'utf8'));
assert.equal(manifest.id,'fast-nri-v14');
assert.match(manifest.version,/^\d+(?:\.\d+){2,3}(?:-[A-Za-z0-9.-]+)?$/);
assert.equal(manifest.download,`https://github.com/Nerfu/FNRI/releases/download/v${manifest.version}/fast-nri-v14.zip`);
assert.equal(manifest.manifest,'https://raw.githubusercontent.com/Nerfu/FNRI/main/system.json');

const hooks=new Map();const registrations=[];let nextId=0;
class Field {constructor(...args){this.args=args;}}
class TypeModel {}
class SheetMock {
  constructor(options={}) { Object.assign(this,options);this.isEditable=options.editable??true;this.renders=0;this.submits=0; }
  async _prepareContext(){return {};}
  async _onRender(){}
  async render(){this.renders++;return this;}
  async submit(){this.submits++;return {};}
}
const deletes=Symbol('Foundry v14 _del');
globalThis._del=deletes;
globalThis.Hooks={once(name,fn){hooks.set(name,fn)},on(name,fn){hooks.set(name,fn)}};
globalThis.CONFIG={statusEffects:{dead:{id:'dead',name:'Dead'}},Combat:{initiative:{}},Combatant:{},ActiveEffect:{expiryEvents:{},documentClass:class{}},Token:{objectClass:class{},documentClass:class{},hudClass:class {static DEFAULT_OPTIONS={actions:{effect:{buttons:[0,2],handler(){}}}};}},TextEditor:{enrichers:[]},Actor:{documentClass:class{},dataModels:{thirdPartyActor:class{}}},Item:{dataModels:{thirdPartyItem:class{}}}};
globalThis.game={settings:{get:(_scope,key)=>key==='skillAllocationMode'?'free':'public',register(){},registerMenu(scope,key,data){registrations.push({scope,key,data})}},system:{id:'fast-nri-v14'},user:{isGM:false},i18n:{localize(key){return key;}}};
let warnings=0,errors=0;
globalThis.ui={notifications:{warn(){warnings++;},error(){errors++;}}};
globalThis.foundry={
  data:{fields:{StringField:Field,NumberField:Field,SchemaField:Field,ArrayField:Field,TypedObjectField:Field,ObjectField:Field}},
  abstract:{TypeDataModel:TypeModel},utils:{randomID:()=>`testid${++nextId}`},
  applications:{api:{HandlebarsApplicationMixin(Parent){return class extends Parent{}},ApplicationV2:SheetMock,DialogV2:{confirm:async()=>true}},
    sheets:{ActorSheetV2:SheetMock,ItemSheetV2:SheetMock},
    apps:{DocumentSheetConfig:{registerSheet(...args){registrations.push(args)},getSheetClassesForSubType(){return {sheetClasses:{},defaultClass:null}}}}},
  documents:{Actor:class{},Item:class{},Combat:class{},Combatant:class{}},canvas:{placeables:{tokens:{TokenRuler:class{}}}}
};

installTemplateMock();
await import(pathToFileURL(file('main.mjs')).href);
assert.ok(hooks.has('init'));
hooks.get('init')();
assert.equal(Object.keys(CONFIG.statusEffects).filter(k=>k.startsWith('fnri7-')).length,16);
assert.equal(CONFIG.statusEffects.dead.name,'Dead');
assert.equal(CONFIG.statusEffects['fnri7-grabbed'].showIcon,2);
assert.deepEqual(Object.keys(CONFIG.Actor.dataModels).sort(),['character','npc','thirdPartyActor']);
assert.deepEqual(Object.keys(CONFIG.Item.dataModels).sort(),['ability','armor','gear','item','thirdPartyItem','weapon']);
assert.equal(registrations.filter(x=>Array.isArray(x)).length,3);
assert.equal(registrations.filter(x=>x.key==='importContent').length,0,'no importer registered during stage 4');
assert.ok(hooks.has('renderChatMessageHTML'));
for(const model of [CONFIG.Actor.dataModels.character.defineSchema(),CONFIG.Actor.dataModels.npc.defineSchema()]){
  for(const field of ['hp','ac','defenses','skills','resources','equipment','equipmentSlots','wealth'])assert.ok(model[field],field);
  assert.equal(model.skills.constructor,Field);
  assert.equal(model.skills.args[0].constructor,Field,'skills value has schema');
  assert.equal(model.skills.args[1].required,false);
  const initial = model.skills.args[1].initial();
  assert.equal(Object.keys(initial).length, 16, 'Rulebook 7.0 base catalogue is complete');
  assert.equal(initial.core_acrobatics.name,'Акробатика');
  assert.equal(initial.core_intimidation.name,'Запугивание');
  assert.equal(initial.core_athletics.dice,'', 'new skills begin without an assigned cube');
  assert.equal(initial.starter_primary, undefined);
  assert.equal(initial.starter_secondary, undefined);
  assert.notEqual(initial, model.skills.args[1].initial(), 'new Actors receive independent skill dictionaries');
  const checkSchema=model.skills.args[0].args[0];
  for(const key of ['name','kind','dice','modifier','value'])assert.ok(checkSchema[key],key);
  assert.equal(checkSchema.dice.constructor,Field);
  assert.equal(checkSchema.modifier.constructor,Field);
  assert.equal(model.equipmentSlots.constructor,Field);
  const slotSchema=model.equipmentSlots.args[0].args[0];
  for(const key of ['name','itemId'])assert.ok(slotSchema[key],key);
}

const {FastNRICharacterSheet,FastNRINPCSheet,FastNRIItemSheet}=await import(pathToFileURL(file('module/sheets/sheets.mjs')).href);
for(const cls of [FastNRICharacterSheet,FastNRINPCSheet,FastNRIItemSheet]){
  assert.equal(sheetOptions(cls).tag,'form');
  const [part]=Object.values(cls.PARTS);
  assert.equal(part.root,true);
  assert.ok(existsSync(file(part.template.replace('systems/fast-nri-v14/',''))));
}
assert.equal(sheetOptions(FastNRICharacterSheet).form.submitOnChange,false,'single Actor save path');
assert.equal(sheetOptions(FastNRIItemSheet).form.submitOnChange,true,'Item forms still use core submission');
const actions=sheetOptions(FastNRICharacterSheet).actions;
assert.equal(typeof actions.createItem,'function');
for(const a of ['fnriSwitchTab','toggleQuickHp','toggleSkillGroup','rollAbility','rollSkill','createEffect','editEffect','toggleEffect','deleteEffect','openItem','createItem','deleteItem','addSkill','addSpecialization','removeSkill','addResource','removeResource','addEquipmentSlot','removeEquipmentSlot'])assert.equal(typeof actions[a],'function',a);

function actorFactory(){
 const items=[];let itemCounter=2;let openedItems=[];
 function createItem(id,name,type){return {id,name,type,system:{},getFlag(){return undefined;},sort:0,img:'a.png',sheet:{async render(){openedItems.push(id);}}};}
 items.push(createItem('i1','Sword','weapon'),createItem('i2','Ability','ability'));
 const actor={
  name:'Actor',system:{
   hp:{current:15,max:20,temp:null},speed:null,combatDie:'d8',
   ac:{partial:8,success:12,great:16},
   defenses:{awareness:null,reflex:null,fortitude:null,will:null},
   skills:{alpha:{name:'Alpha',kind:'skill',dice:'1d8',value:1},beta:{name:'Beta',kind:'specialization',dice:'2d6',value:2}},
   resources:{mana:{name:'Mana',current:4,max:8}},
   equipment:{leftHand:'i1',rightHand:'',armor:''},equipmentSlots:{},wealth:''
  },
  items:{contents:items,has(id){return items.some(x=>x.id===id);},get(id){return items.find(x=>x.id===id)}},updates:[],lastItemRecord:null,openedItems,
  async update(change){
   // Simulates a delayed server round-trip while applying independent dot-path
   // updates, as supported by the v14 Document API. Arrays are never merged.
   await new Promise(resolve=>setTimeout(resolve,5));
   this.updates.push(change);
   for(const [key,value] of Object.entries(change)){
    if(key==='name'){this.name=value;continue;}
    assert.ok(key.startsWith('system.'),'unexpected path '+key);
    const parts=key.slice(7).split('.');let object=this.system;
    while(parts.length>1){const part=parts.shift();object=object[part]??(object[part]={});}
    const last=parts[0];if(value===deletes)delete object[last];else object[last]=value;
   }
   return this;
  },
  async createEmbeddedDocuments(type,values){
   assert.equal(type,'Item');this.lastItemRecord=values[0];const added=values.map(value=>createItem('i'+(++itemCounter),value.name,value.type));
   items.push(...added);return added;
  },
  async deleteEmbeddedDocuments(type,ids){
   assert.equal(type,'Item');items.splice(0,items.length,...items.filter(item=>!ids.includes(item.id)));
  }
 };
 return actor;
}

function makeControl({name='',dataset={},value=''}){
 const listeners={};const control={name,dataset,value,listeners,invalid:'',validationCalls:0,
  addEventListener(type,callback){listeners[type]=callback;},
  setCustomValidity(msg){this.invalid=msg;},reportValidity(){this.validationCalls++;return !this.invalid;}};
 control.fireChange=()=>{
  assert.equal(typeof listeners.change,'function','missing input listener');
  let stopped=false;listeners.change({currentTarget:control,stopPropagation(){stopped=true;}});
  assert.ok(stopped,'custom handler must stop core form change bubbling');
 };
 return control;
}
async function attachControls(sheet,rowControls=[],namedControls=[]){
 if(sheet.isEditable)sheet._configurationLocked=false;
 sheet.element={
  querySelectorAll(selector){
   if(selector.startsWith('[data-row'))return rowControls;
   if(selector.startsWith('input[name]'))return namedControls;
   return [];
  },
  querySelector(){return [...rowControls,...namedControls].find(c=>!!c.invalid)??null;}
 };
 await sheet._onRender({},{});
}

// Resource quick controls: both sheet types, sequential writes, no max clamp,
// protected access, automatic potion limit and no changes to other fields.
for(const Cls of [FastNRICharacterSheet,FastNRINPCSheet]){
 const a=actorFactory();a.uuid='Actor.resource-'+Cls.name;a.system.potionsUsed=3;
 const sh=new Cls({actor:a});const adjust=sheetOptions(Cls).actions.adjustResource;
 const click=(resource,delta,id)=>adjust.call(sh,{}, {dataset:{resource,delta:String(delta),id}});
 await Promise.all([click('potions',1),click('potions',1),click('row',1,'mana')]);
 assert.equal(a.system.potionsUsed,5);assert.equal(a.system.resources.mana.current,5);
 assert.equal(a.system.resources.mana.max,8);
 assert.equal((await sh._prepareContext({})).potions.over,true);
 a.items.contents.push({id:'stable',type:'ability',name:'Устойчивый',sort:0,system:{},getFlag:(_s,k)=>k==='contentId'?'fnri7.rulebook.racial.ustoichivyi':undefined});
 assert.equal((await sh._prepareContext({})).potions.max,4);
 await click('potions',-1);assert.equal((await sh._prepareContext({})).potions.over,false);
 a.system.potionsUsed=0;await click('potions',-1);assert.equal(a.system.potionsUsed,0);
 a.system.resources.mana.current=8;await click('row',1,'mana');assert.equal(a.system.resources.mana.current,9);
 a.system.resources.mana.current=0;await click('row',-1,'mana');assert.equal(a.system.resources.mana.current,-1);
 await click('row',1,'missing');await click('row',1,'bad.id');await click('row',10,'mana');
 assert.equal(a.system.resources.mana.current,-1);assert.equal(a.system.resources.missing,undefined);
 sh.isEditable=false;await click('potions',1);await click('row',1,'mana');
 assert.equal(a.system.potionsUsed,0);assert.equal(a.system.resources.mana.current,-1);
}

const actor=actorFactory();const sheet=new FastNRICharacterSheet({actor});
let ctx=await sheet._prepareContext({});
assert.equal(ctx.tabs.characteristics,true);
assert.equal(ctx.skillRows.length,1);
assert.equal(ctx.resourceRows.length,1);
assert.equal(ctx.attackHands[0].id,'i1');
assert.equal(ctx.attackHands[1].id,'');
assert.equal(ctx.unarmedAction.name,'Безоружная атака');
assert.equal(ctx.inventoryItems.find(x=>x.id==='i1').isEquipped,true);
assert.equal(ctx.skillRows[0].hasLegacyValue,true,'draft numeric values remain visible, not erased');
assert.equal(ctx.ungroupedSpecializations[0].isSpecialization,true);

assert.deepEqual(ctx.skillRows[0].skillDiceOptions.slice(1,6).map(option => option.value),
  ['1d4','1d6','1d8','1d10','1d12']);
assert.deepEqual(ctx.ungroupedSpecializations[0].specializationDiceOptions.slice(1,3).map(option => option.value),
  ['1d6','1d4']);
assert.equal(ctx.skillRows[0].skillDiceOptions.find(option => option.selected).value,'1d8');
assert.equal(ctx.ungroupedSpecializations[0].specializationDiceOptions.find(option => option.selected).value,'__stored__');
assert.equal(ctx.skillRows[0].hasCustomDice,false);

assert.equal(ctx.missingEquipment.leftHand,false);
assert.equal(ctx.abilityItems.length,1);

// Two quick edits to DIFFERENT skills must both survive delayed updates.
const name=makeControl({dataset:{rowCollection:'skills',rowId:'alpha',rowField:'name'},value:'Alpha changed'});
const value=makeControl({dataset:{rowCollection:'skills',rowId:'beta',rowField:'value'},value:'99'});
const dice=makeControl({dataset:{rowCollection:'skills',rowId:'alpha',rowField:'dice'},value:'2d6 + 1d8'});
const current=makeControl({dataset:{rowCollection:'resources',rowId:'mana',rowField:'current'},value:'5,5'});
const hp=makeControl({name:'system.hp.current',dataset:{dtype:'Number',integer:'true'},value:'18'});
const wealth=makeControl({name:'system.wealth',value:'12 серебряных'});
await attachControls(sheet,[name,value,dice,current],[hp,wealth]);
name.fireChange();value.fireChange();dice.fireChange();current.fireChange();hp.fireChange();wealth.fireChange();
await sheet._flushWrites();
assert.equal(actor.system.skills.alpha.name,'Alpha changed');
assert.equal(actor.system.skills.beta.value,99);
assert.equal(actor.system.skills.alpha.dice,'2d6 + 1d8');
assert.equal(actor.system.resources.mana.current,5.5);
assert.equal(actor.system.hp.current,18);
assert.equal(actor.system.wealth,'12 серебряных');
assert.equal(sheet.submits,0,'Actor native submit must not compete with addressable writes');
assert.ok(actor.updates.every(update=>!('system.skills' in update) && !('system.resources' in update)));

// Multi-client independent paths: edits to distinct fields should commute.
const sheetB=new FastNRICharacterSheet({actor});
const b1=makeControl({dataset:{rowCollection:'skills',rowId:'alpha',rowField:'value'},value:'-3'});
const b2=makeControl({dataset:{rowCollection:'skills',rowId:'beta',rowField:'name'},value:'Beta new'});
await attachControls(sheetB,[b1,b2]);
b1.fireChange();b2.fireChange();
await sheetB._flushWrites();
assert.equal(actor.system.skills.alpha.value,-3);
assert.equal(actor.system.skills.beta.name,'Beta new');

// Two separate sheet instances commit distinct paths at the same time.
const remoteOne=makeControl({dataset:{rowCollection:'skills',rowId:'alpha',rowField:'name'},value:'Remote A'});
const remoteTwo=makeControl({dataset:{rowCollection:'skills',rowId:'beta',rowField:'value'},value:'-1.5'});
await attachControls(sheet,[remoteOne]);
await attachControls(sheetB,[remoteTwo]);
remoteOne.fireChange();remoteTwo.fireChange();
await Promise.all([sheet._flushWrites(),sheetB._flushWrites()]);
assert.equal(actor.system.skills.alpha.name,'Remote A');
assert.equal(actor.system.skills.beta.value,-1.5);
// Restore the original controls for input validation tests.
await attachControls(sheet,[name,value,dice,current],[hp,wealth]);

// Invalid numeric input is not committed; empty input becomes null, zero works.
const updatesBefore=actor.updates.length;
value.value='garbage';value.fireChange();await sheet._flushWrites();
assert.equal(actor.updates.length,updatesBefore);
assert.equal(actor.system.skills.beta.value,-1.5);
assert.ok(value.invalid);assert.ok(value.validationCalls>=1);assert.ok(warnings>0);
value.value='0';value.fireChange();await sheet._flushWrites();
assert.equal(actor.system.skills.beta.value,0);
value.value='';value.fireChange();await sheet._flushWrites();
assert.equal(actor.system.skills.beta.value,null);
hp.value='18.5';hp.fireChange();await sheet._flushWrites();
assert.equal(actor.system.hp.current,18,'integer field must reject fractional input');
hp.value='0';hp.fireChange();await sheet._flushWrites();
assert.equal(actor.system.hp.current,0);
hp.value='';hp.fireChange();await sheet._flushWrites();
assert.equal(actor.system.hp.current,null);

// Tab navigation is independent of form validation and never re-renders:
// even invalid/unsaved input remains in the same DOM for manual correction.
value.value='no';value.fireChange();await sheet._flushWrites();
await actions.fnriSwitchTab.call(sheet,null,{dataset:{fnriTarget:'skills'}});
assert.equal(sheet._selectedTab,'skills');
assert.equal(sheet.renders,0,'navigation must never re-render the form');
value.value='7';value.fireChange();await sheet._flushWrites();
assert.equal(actor.system.skills.beta.value,7);

// Arbitrarily many entries; specialized rows use the same addressable collection.
for(let i=0;i<12;i++)await actions.addSkill.call(sheet);
for(let i=0;i<17;i++)await actions.addSpecialization.call(sheet,null,{dataset:{group:"physical"}});
assert.equal(Object.keys(actor.system.skills).length,31);
assert.equal(Object.values(actor.system.skills).filter(x=>x.kind==='specialization').length,18);
await actions.addSkill.call(sheet);
const newSkill=Object.keys(actor.system.skills).find(id=>id.startsWith('testid'));
assert.ok(newSkill);
assert.deepEqual(actor.system.skills[newSkill],{name:'',kind:'skill',dice:'',modifier:null,value:null});
await actions.addSpecialization.call(sheet,null,{dataset:{group:"physical"}});
const specialId=Object.keys(actor.system.skills).at(-1);
assert.equal(actor.system.skills[specialId].kind,'specialization');
const specialDice=makeControl({dataset:{rowCollection:'skills',rowId:specialId,rowField:'dice'},value:'3d12 + 1d4'});
const specialKind=makeControl({dataset:{rowCollection:'skills',rowId:specialId,rowField:'kind'},value:'skill'});
await attachControls(sheet,[specialDice,specialKind]);specialDice.fireChange();specialKind.fireChange();await sheet._flushWrites();
assert.equal(actor.system.skills[specialId].dice,'3d12 + 1d4');
assert.equal(actor.system.skills[specialId].kind,'skill');
await actions.addResource.call(sheet);
const newResource=Object.keys(actor.system.resources).find(id=>id.startsWith('testid'));
assert.ok(newResource);
await actions.removeSkill.call(sheet,null,{dataset:{id:newSkill}});
await actions.removeSkill.call(sheet,null,{dataset:{id:specialId}});
await actions.removeResource.call(sheet,null,{dataset:{id:newResource}});
assert.equal(Object.hasOwn(actor.system.skills,newSkill),false);
assert.equal(Object.hasOwn(actor.system.resources,newResource),false);
assert.ok(actor.updates.some(change=>Object.values(change).includes(deletes)));

// Additional user-named slots have no quantity limit and can accept any Item type.
for(let i=0;i<6;i++)await actions.addEquipmentSlot.call(sheet);
let slotIds=Object.keys(actor.system.equipmentSlots);
assert.equal(slotIds.length,6);
const slotId=slotIds[0];
const slotName=makeControl({dataset:{rowCollection:'equipmentSlots',rowId:slotId,rowField:'name'},value:'Дополнительная рука'});
const slotItem=makeControl({dataset:{rowCollection:'equipmentSlots',rowId:slotId,rowField:'itemId'},value:'i1'});
await attachControls(sheet,[slotName,slotItem]);slotName.fireChange();slotItem.fireChange();await sheet._flushWrites();
assert.equal(actor.system.equipmentSlots[slotId].name,'Дополнительная рука');
assert.equal(actor.system.equipmentSlots[slotId].itemId,'i1');
ctx=await sheet._prepareContext({});
assert.equal(ctx.extraSlotRows.find(x=>x.id===slotId).itemId,'i1');
await actions.removeEquipmentSlot.call(sheet,null,{dataset:{id:slotIds[1]}});
assert.equal(Object.hasOwn(actor.system.equipmentSlots,slotIds[1]),false);
await actions.createItem.call(sheet,null,{dataset:{type:'gear'}});
assert.equal(actor.items.contents.length,3);
assert.deepEqual(actor.openedItems,[],'creating a gear item must not open its sheet');
// Actual sheet button action: gear enters dynamic other slot, then unequips.
const gearId=actor.items.contents.at(-1).id;
const gearButton={closest(){return {dataset:{itemId:gearId}}}};
await actions.toggleEquipment.call(sheet,null,gearButton);
assert.equal(actor.system.equipmentSlots[`auto_${gearId}`].itemId,gearId);
ctx=await sheet._prepareContext({});
assert.equal(ctx.inventoryItems.find(x=>x.id===gearId).isEquipped,true);
await actions.toggleEquipment.call(sheet,null,gearButton);
assert.equal(actor.system.equipmentSlots[`auto_${gearId}`].itemId,'');
await actions.createItem.call(sheet,null,{dataset:{type:'weapon'}});
assert.equal(actor.items.contents.length,4);
assert.equal(actor.lastItemRecord.type,'weapon');
assert.equal(actor.lastItemRecord.system,undefined,'no hidden test weapon defaults');
assert.deepEqual(actor.openedItems,[],'creating a weapon must not open its sheet');
const newWeaponId=actor.items.contents.at(-1).id;
await actions.openItem.call(sheet,null,{closest:()=>({dataset:{itemId:newWeaponId}})});
assert.deepEqual(actor.openedItems,[newWeaponId],'opening a sheet is a separate action');
await actor.deleteEmbeddedDocuments('Item',[actor.items.contents.at(-1).id]);
assert.equal(actor.items.contents.length,3);
await actions.deleteItem.call(sheet,null,{closest(){return {dataset:{itemId:'i1'}}}});
assert.equal(actor.items.contents.length,2);
assert.equal(actor.system.equipment.leftHand,'','our delete action clears slot');
assert.equal(actor.system.equipmentSlots[slotId].itemId,'','our delete action clears assigned custom slot without removing its name');

// Deletion from Foundry directory (outside our action): no silent mutation.
actor.system.equipment.rightHand='removedOutside';
actor.system.equipmentSlots[slotId].itemId='removedOutside';
const beforeOrphan=actor.updates.length;
ctx=await sheet._prepareContext({});
assert.equal(ctx.missingEquipment.rightHand,true);
assert.equal(ctx.extraSlotRows.find(x=>x.id===slotId).missing,true);
assert.equal(ctx.hasMissingEquipment,true);
assert.equal(actor.updates.length,beforeOrphan,'context must not auto-edit actor');
// Unknown references cannot silently be overwritten by a render.
assert.equal(actor.system.equipment.rightHand,'removedOutside');
assert.equal(actor.system.equipmentSlots[slotId].itemId,'removedOutside');

// Failed saves must not obstruct navigation or discard unsaved input.
let simulateSaveFailure = true;
const originalConsoleError=console.error;
let expectedSaveErrorLogged=0;
console.error=() => { expectedSaveErrorLogged++; };
const originalActorUpdate = actor.update.bind(actor);
actor.update = async change => {
  if (simulateSaveFailure && Object.hasOwn(change, 'system.wealth')) throw new Error('Simulated database rejection');
  return originalActorUpdate(change);
};
const failingInput=makeControl({name:'system.wealth',value:'unsaved field'});
await attachControls(sheet,[],[failingInput]);
failingInput.fireChange();
// Even a later successful write to a different field must not erase the
// failure of wealth (a previous bug in boolean-only error tracking).
const succeedingInput=makeControl({name:'system.hp.current',dataset:{dtype:'Number',integer:'true'},value:'27'});
await attachControls(sheet,[],[failingInput,succeedingInput]);
succeedingInput.fireChange();
await sheet._flushWrites();
assert.equal(actor.system.hp.current,20); // effective maximum
assert.ok(sheet._failedFields.has('system.wealth'));
await actions.fnriSwitchTab.call(sheet,null,{dataset:{fnriTarget:'inventory'}});
assert.equal(sheet._selectedTab,'inventory','failed save must NOT block tab navigation');
assert.equal(sheet.renders,0,'failed save must not cause a tab re-render');
assert.ok(errors>0,'save failure must be visible to user');
assert.ok(expectedSaveErrorLogged>0,'failed update must be logged for diagnosis');
simulateSaveFailure=false;
failingInput.value='corrected value';failingInput.fireChange();await sheet._flushWrites();
assert.equal(actor.system.wealth,'corrected value');
assert.equal(sheet._failedFields.size,0);
await actions.fnriSwitchTab.call(sheet,null,{dataset:{fnriTarget:'abilities'}});
assert.equal(sheet._selectedTab,'abilities','tab navigation remains available after correction');
actor.update=originalActorUpdate;
console.error=originalConsoleError;
errors=0;

// Read-only sheets never issue writes, even via synthetic action calls.
const readonly=new FastNRICharacterSheet({actor,editable:false});
const originalUpdateCount=actor.updates.length;
await actions.addSkill.call(readonly);
await actions.addSpecialization.call(readonly);
await actions.addEquipmentSlot.call(readonly);
await actions.removeSkill.call(readonly,null,{dataset:{id:'alpha'}});
await actions.createItem.call(readonly,null,{dataset:{type:'weapon'}});
const locked=makeControl({name:'system.wealth',value:'unauthorized'});
await attachControls(readonly,[],[locked]);locked.fireChange();await readonly._flushWrites();
assert.equal(actor.updates.length,originalUpdateCount);
assert.equal(errors,0);

// Confirm compact summary is persistent and editable fields live in Characteristics, once.
for(const path of ['templates/character.hbs','templates/npc.hbs']){
 const html=readFileSync(file(path),'utf8').replace('{{> fnri-actor-actions}}',readFileSync(file('templates/actor-actions.hbs'),'utf8')).replace('{{> fnri-actor-abilities}}',readFileSync(file('templates/actor-abilities.hbs'),'utf8')).replace('{{> fnri-actor-custom-skill}}',readFileSync(file('templates/actor-custom-skill.hbs'),'utf8'));
 assert.ok(html.indexOf('fnri-persistent')<html.indexOf('fnri-tabs'));
 assert.equal(html.lastIndexOf('name="system.hp.current"')>html.indexOf('fnri-tabs'),!path.includes('character'));
 assert.ok(html.indexOf('name="system.defenses.awareness"')>html.indexOf('fnri-tabs'));
 assert.equal(html.match(/name="system.hp.current"/g).length,path.includes('character')?2:3);
 assert.ok(html.includes('fnri-summary-stats'));
 assert.ok(html.includes('data-fnri-target="characteristics"'));
 assert.ok(!html.includes('data-fnri-message-mode'));
 assert.equal(html.match(/data-action="fnriSwitchTab"/g).length,path.includes("character")?9:7);
 assert.equal(html.match(/data-fnri-panel=/g).length,path.includes("character")?9:7);
 assert.equal(html.match(/fnri-tab-content"/g).length,path.includes("character")?9:7);
 assert.ok(html.includes('data-action="toggleEquipment"'));
 assert.ok(html.includes('name="system.wealth"'));
 assert.ok(html.includes('data-action="addSpecialization"') && !html.includes('data-action="openSkillEditor"'));
 assert.ok(html.includes('data-action="rollSkill"'));
 assert.ok(html.includes('data-action="rollAbility"'));
 assert.ok(html.includes(path.includes('character')?'data-fnri-hp-math':'data-fnri-quick-hp'));
 assert.ok(html.includes('data-fnri-save-state'));
 assert.ok(!html.includes('data-fnri-skill-filter'));
 assert.equal((html.match(/data-fnri-section=/g)||[]).length,6);
 assert.ok(html.includes('data-action="createEffect"'));
 assert.ok(html.includes('data-row-field="dice"'));
 assert.ok(html.includes('data-action="attackUnarmed"'));
 assert.ok(!html.includes('data-example='));
}
const css=readFileSync(file('styles/fast-nri.css'),'utf8');
assert.ok(css.includes('.fnri-persistent'));
assert.ok(css.includes('overflow-y: auto !important'));
assert.ok(css.includes('max-height: 650px'));
console.log('PASS: model/registration, concurrent independent edits, typed data, invalid inputs, tabs, equipment, rights, UI sources');
