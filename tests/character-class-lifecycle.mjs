import assert from 'node:assert/strict';
import {CLASSES,classInitializationUpdate,classSelectionUpdate} from '../module/data/classes.mjs';
import {registerClassLifecycle} from '../module/data/class-lifecycle.mjs';
const setProperty=(obj,path,value)=>{const keys=path.split('.');let ptr=obj;for(const k of keys.slice(0,-1))ptr=ptr[k]??={};ptr[keys.at(-1)]=structuredClone(value);};
const merge=(target,source)=>{for(const [k,v] of Object.entries(source??{})){if(v&&typeof v==='object'&&!Array.isArray(v)){target[k]??={};merge(target[k],v);}else target[k]=v;}return target;};
const expandObject=obj=>{const result={};for(const [path,v] of Object.entries(obj)){if(path.includes('.'))setProperty(result,path,v);else if(v&&typeof v==='object'&&!Array.isArray(v))result[path]=merge(result[path]??{},expandObject(v));else result[path]=v;}return result;};
const hooks=new Map();globalThis.Hooks={on:(name,callback)=>hooks.set(name,callback)};globalThis.game={user:{id:'owner'}};globalThis.foundry={utils:{expandObject,setProperty}};
registerClassLifecycle();const create=hooks.get('preCreateActor'),update=hooks.get('preUpdateActor');
const blank=()=>({className:'',level:null,hp:{current:null,max:null},resources:{}});
const makeActor=(system=blank(),type='character',items=[])=>({type,system:structuredClone(system),items:{contents:items},toObject(){return {system:structuredClone(this.system)};},updateSource(data){merge(this.system,data.system);}});
const initial=[['Клерик','class_divine','Божественная сила',5,5],['Волшебник','class_wizard','Волшебная сила',7,7],['Друид','class_life','Жизненная сила',5,5],['Бард','class_rhythm','Ритм',0,3],['Колдун','class_magic','Магическая сила',4,4]];
for(const [className,id,name,current,max] of initial){
 const actor=makeActor({...blank(),className});create(actor,{}, {},'owner');assert.deepEqual(actor.system.resources[id],{name,current,max,kind:'class'});assert.equal(actor.system.hp.current,Object.values(CLASSES).find(c=>c.name===className).hp);assert.equal(actor.system.level,1);
 actor.system.resources[id].current=-1;actor.system.resources[id].max=9;actor.system.hp.current=2;
 const change={'system.className':className};update(actor,change,{},'owner');assert.deepEqual(change,{'system.className':className});
 const imported=makeActor(actor.system);create(imported,{}, {},'owner');assert.deepEqual(imported.system,actor.system,'creation preserves supplied data');
}
for(const className of ['Защитник','Воин','Егерь','Разбойник','Боец'])assert.equal(Object.keys(classInitializationUpdate({...blank(),className})).some(k=>k.includes('resources')),false);
const actor=makeActor();let change={'system.className':'Колдун'};update(actor,change,{},'owner');let expanded=expandObject(change);assert.equal(expanded.system.resources.class_magic.current,4);assert.equal(expanded.system.hp.current,19);merge(actor.system,expanded.system);
actor.system.resources.class_magic.current=1;actor.system.hp.current=3;
change={system:{className:'Бард'}};update(actor,change,{},'owner');assert.deepEqual(change.system.resources.class_rhythm,{name:'Ритм',current:0,max:3,kind:'class'});assert.equal(change.system.hp,undefined);merge(actor.system,change.system);assert.equal(actor.system.resources.class_magic.current,1);assert.equal(actor.system.hp.current,3);
change={'system.className':'Колдун'};update(actor,change,{},'owner');assert.deepEqual(change,{'system.className':'Колдун'});
change={system:{className:'Друид',resources:{class_life:{name:'Жизненная сила',current:2,max:5,kind:'class'}},hp:{current:0}}};update(actor,change,{},'owner');assert.equal(change.system.resources.class_life.current,2);assert.equal(change.system.hp.current,0);
// An ordinary HP/resource write never resets or resurrects the class resource.
change={'system.hp.current':0};update(actor,change,{},'owner');assert.deepEqual(change,{'system.hp.current':0});
change={'system.resources.-=class_magic':null};update(actor,change,{},'owner');assert.deepEqual(change,{'system.resources.-=class_magic':null});
change={'system.className':''};update(actor,change,{},'owner');assert.deepEqual(change,{'system.className':''});
// Sheet selection and native hook do not produce a duplicate patch.
const fresh=makeActor();change=classSelectionUpdate(fresh,'Колдун');const snapshot=structuredClone(change);update(fresh,change,{},'owner');assert.deepEqual(expandObject(change),{...expandObject(snapshot),system:{...expandObject(snapshot).system,resources:{...expandObject(snapshot).system.resources,intervention:{name:'Вмешательства',kind:'intervention',current:1,max:1}}}});
// No player-world synchronization on another client, NPC/Projection untouched.
const npc=makeActor({...blank(),className:'Колдун'},'npc');create(npc,{}, {},'owner');assert.deepEqual(npc.system.resources,{});change={'system.className':'Бард'};update(npc,change,{},'owner');assert.deepEqual(change,{'system.className':'Бард'});
const other=makeActor({...blank(),className:'Колдун'});create(other,{}, {},'other');assert.deepEqual(other.system.resources,{});
console.log('PASS class resource initialization for five classes, native Actor create/update, direct import values, no refills or duplicates, NPC isolation, sheet selection');

// Real level-one class catalog: grant automatically on class selection and
// creation, reusing the native owned Item route; no writes for other users.
const {readdirSync,readFileSync}=await import('node:fs');
const scope='fast-nri-v14',dir=new URL('../packs/_source/abilities/',import.meta.url);
const catalog=readdirSync(dir).filter(f=>f.endsWith('.json')).map(f=>JSON.parse(readFileSync(new URL(f,dir),'utf8')));
const warlockCatalog=catalog.filter(c=>CLASSES.warlock.abilityIds.includes(c.flags?.[scope]?.contentId));
const card=data=>({...data,id:data._id,getFlag(s,k){return this.flags?.[s]?.[k]},toObject(){return structuredClone(data)}});
game.packs=new Map([[scope+'.abilities',{getIndex:async()=>({contents:catalog}),getDocument:async id=>card(catalog.find(c=>c._id===id))}]]);
function pc(id,initial=[]){
 const a={type:'character',isOwner:true,uuid:'Actor.'+id,system:{className:'Колдун'},items:new Map(initial.map(d=>[d._id,card(d)]))};
 Object.defineProperty(a.items,'contents',{get(){return [...this.values()]}});
 a.deleteEmbeddedDocuments=async(type,ids)=>{assert.equal(type,'Item');for(const id of ids)a.items.delete(id);};
 a.createEmbeddedDocuments=async(type,rows)=>{assert.equal(type,'Item');return rows.map(d=>{const item=card(d);item.parent=a;item.update=async patch=>{for(const [path,value] of Object.entries(patch))setProperty(item,path,value);};assert.ok(!a.items.has(item.id));a.items.set(item.id,item);return item;})};
 return a;
}
const selected=pc('selected',[warlockCatalog[0]]),manual=card({_id:'manual',type:'ability',name:'Manual'});selected.items.set(manual.id,manual);
await hooks.get('updateActor')(selected,{'system.className':'Колдун'},{},'owner');
assert.equal(selected.items.size,8);assert.ok(selected.items.has('manual'));
await hooks.get('updateActor')(selected,{system:{className:'Колдун'}},{},'owner');assert.equal(selected.items.size,8);
const created=pc('created');await hooks.get('createActor')(created,{},'owner');assert.equal(created.items.size,7);
const otherClient=pc('otherClient');await hooks.get('createActor')(otherClient,{},'other');assert.equal(otherClient.items.size,0);
const npcGrant=pc('npc');npcGrant.type='npc';await hooks.get('createActor')(npcGrant,{},'owner');assert.equal(npcGrant.items.size,0);
const unrelated=pc('unrelated');await hooks.get('updateActor')(unrelated,{'system.hp.current':1},{},'owner');assert.equal(unrelated.items.size,0);
console.log('PASS automatic class grant: real seven Warlock cards, explicit class selection and creation, no duplicates, manual cards preserved, no unrelated writes');

// Approved class transitions preserve spent interventions and manual cards.
for(const cls of ['Разбойник','Защитник']){const a=makeActor({...blank(),className:cls});create(a,{}, {},'owner');assert.equal(a.system.resources.intervention.max,2);assert.equal(a.system.resources.intervention.current,2);}
const a=makeActor({...blank(),className:'Воин',resources:{intervention:{kind:'intervention',current:0,max:1}}});
let c={'system.className':'Разбойник'};update(a,c,{},'owner');merge(a.system,expandObject(c).system);assert.equal(a.system.resources.intervention.current,1);assert.equal(a.system.resources.intervention.max,2);
c={'system.className':'Разбойник'};update(a,c,{},'owner');assert.deepEqual(c,{'system.className':'Разбойник'});
c={'system.className':'Воин'};update(a,c,{},'owner');assert.equal(expandObject(c).system.resources.intervention.current,0);
selected.system.className='Защитник';await hooks.get('updateActor')(selected,{'system.className':'Защитник'},{},'owner');assert.equal(selected.items.size,8);assert.ok(selected.items.has(warlockCatalog[0]._id));assert.ok(selected.items.has('manual'));assert.equal(selected.items.contents.filter(i=>i.getFlag(scope,'automaticClassAbility')).length,6);
selected.system.className='Воин';await hooks.get('updateActor')(selected,{'system.className':'Воин'},{},'owner');assert.equal(selected.items.size,7);assert.equal(selected.items.contents.filter(i=>i.getFlag(scope,'automaticClassAbility')).length,5);
console.log('PASS approved class transitions: spent interventions, six Defender cards, removal only of automatic Items');

const {clericWeaponOptions,editClassWeaponProficiency}=await import('../module/sheets/class-abilities.mjs');
const {weaponProficiency,itemGrip}=await import('../module/equipment/equipment.mjs');
const wd=new URL('../packs/_source/weapons/',import.meta.url);
const weapons=readdirSync(wd).filter(f=>f.endsWith('.json')).map(f=>JSON.parse(readFileSync(new URL(f,wd),'utf8')));
const choices=clericWeaponOptions(weapons);assert.equal(choices.length,11);assert.equal(weapons.filter(w=>itemGrip(w)==='1+').length,4);
game.packs.set(scope+'.weapons',{getIndex:async()=>({contents:weapons})});game.i18n={localize:k=>k};
let response=choices[0].name,dialogs=0;
foundry.applications={api:{DialogV2:{wait:async cfg=>{dialogs++;const search={value:'',addEventListener(){},focus(){}},list={innerHTML:'',addEventListener(_type,cb){this.click=cb;}},clear={addEventListener(_type,cb){this.click=cb;}};const root={dataset:{},querySelector(q){return q.includes('search')?search:q.includes('options')?list:clear;}};cfg.render(null,{element:{querySelector:()=>root},close(){}});if(cfg.window.title==='Природа клерика'){assert.match(list.innerHTML,/Святой/);list.click({target:{closest:()=>({dataset:{characterValue:'Святой'}})}});return;}assert.match(list.innerHTML,new RegExp(choices[0].name));if(response===null)return;if(response==='')clear.click();else list.click({target:{closest:()=>({dataset:{characterValue:response}})}});}}}};
const cleric=pc('cleric');cleric.system.className='Клерик';await hooks.get('createActor')(cleric,{},'owner');
assert.equal(cleric.items.size,8);assert.equal(cleric.items.contents.find(i=>i.system?.mechanics?.classNature).system.mechanics.classNature.selection,"holy");
const firstCard=cleric.items.contents[0];assert.equal(dialogs,2);assert.equal(weaponProficiency(choices[0],cleric).proficient,true);assert.equal(weaponProficiency(choices[1],cleric).proficient,false);
response=choices[1].name;await editClassWeaponProficiency(firstCard);assert.equal(weaponProficiency(choices[0],cleric).proficient,false);assert.equal(weaponProficiency(choices[1],cleric).proficient,true);
response=null;await editClassWeaponProficiency(firstCard);assert.equal(weaponProficiency(choices[1],cleric).proficient,true);
cleric.system.className='Воин';await hooks.get('updateActor')(cleric,{'system.className':'Воин'},{fnriClassChanged:true},'owner');assert.equal(cleric.items.size,5);
cleric.system.className='Клерик';await hooks.get('updateActor')(cleric,{'system.className':'Клерик'},{fnriClassChanged:true},'owner');assert.equal(cleric.items.size,8);assert.equal(weaponProficiency(choices[1],cleric).proficient,false);assert.equal(dialogs,6);
await hooks.get('updateActor')(cleric,{'system.className':'Клерик'},{fnriClassChanged:false},'owner');assert.equal(dialogs,6);
console.log('PASS Cleric: real 11 weapons, four corrected grips, initial picker, replace, cancel, leave/reenter, no duplicate picker');
const rogue=pc('rogue');rogue.system.className='Разбойник';await hooks.get('createActor')(rogue,{},'owner');assert.equal(rogue.items.size,8);assert.deepEqual(new Set(rogue.items.contents.map(i=>i.getFlag(scope,'contentId'))),new Set(CLASSES.rogue.abilityIds));
console.log('PASS Rogue: eight native class grants');
const {creatureNature}=await import('../module/data/racial-properties.mjs');
const inherited=structuredClone(catalog.find(c=>c.flags?.[scope]?.contentId==='fnri7.rulebook.racial.priroda-nefalema'));
inherited.system.mechanics.racialProperty.selection='unholy';
const inheritedCleric=pc('inherited',[inherited]);inheritedCleric.system.className='Клерик';const beforeDialogs=dialogs;
await hooks.get('createActor')(inheritedCleric,{},'owner');
assert.equal(dialogs,beforeDialogs+1,'weapon chooser only; existing Nature preserved');
assert.equal(creatureNature(inheritedCleric),'unholy');
assert.equal(inheritedCleric.items.contents.find(i=>i.system?.mechanics?.classNature).system.mechanics.classNature.selection,'unholy');
console.log('PASS Cleric Nature: existing Nephalem Nature preserved without a second dialog');
const wizard=pc('wizard');wizard.system.className='Волшебник';await hooks.get('createActor')(wizard,{},'owner');
assert.equal(wizard.items.size,7);assert.deepEqual(new Set(wizard.items.contents.map(i=>i.getFlag(scope,'contentId'))),new Set(CLASSES.wizard.abilityIds));
console.log('PASS Wizard automatic grant: seven actual cards');
const druid=pc('druid');druid.system.className='Друид';await hooks.get('createActor')(druid,{},'owner');assert.equal(druid.items.size,13);assert.deepEqual(new Set(druid.items.contents.map(i=>i.getFlag(scope,'contentId'))),new Set(CLASSES.druid.abilityIds));
console.log('PASS Druid automatic grant: eleven approved cards');
const bard=pc('bard');bard.system.className='Бард';await hooks.get('createActor')(bard,{},'owner');assert.equal(bard.items.size,12);assert.deepEqual(new Set(bard.items.contents.map(i=>i.getFlag(scope,'contentId'))),new Set(CLASSES.bard.abilityIds));
await hooks.get('updateActor')(bard,{'system.className':'Бард'},{fnriClassChanged:false},'owner');assert.equal(bard.items.size,12);
console.log('PASS Bard automatic grant: twelve cards, no duplicate grant');
const fighter=pc('fighter');fighter.system.className='Боец';await hooks.get('createActor')(fighter,{},'owner');
assert.equal(fighter.items.size,9);assert.deepEqual(new Set(fighter.items.contents.map(i=>i.getFlag(scope,'contentId'))),new Set(CLASSES.fighter.abilityIds));
await hooks.get('updateActor')(fighter,{'system.className':'Боец'},{fnriClassChanged:false},'owner');assert.equal(fighter.items.size,9);
console.log('PASS Fighter automatic grant: nine cards without duplicate');
