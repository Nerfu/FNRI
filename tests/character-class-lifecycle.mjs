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
const fresh=makeActor();change=classSelectionUpdate(fresh,'Колдун');const snapshot=structuredClone(change);update(fresh,change,{},'owner');assert.deepEqual(change,snapshot);
// No player-world synchronization on another client, NPC/Projection untouched.
const npc=makeActor({...blank(),className:'Колдун'},'npc');create(npc,{}, {},'owner');assert.deepEqual(npc.system.resources,{});change={'system.className':'Бард'};update(npc,change,{},'owner');assert.deepEqual(change,{'system.className':'Бард'});
const other=makeActor({...blank(),className:'Колдун'});create(other,{}, {},'other');assert.deepEqual(other.system.resources,{});
console.log('PASS class resource initialization for five classes, native Actor create/update, direct import values, no refills or duplicates, NPC isolation, sheet selection');
