import assert from 'node:assert/strict';
import {capCurrentHp,prepareHpLimit,planHpMaximumChange,registerHpLimit} from '../module/damage/hp-limit.mjs';
const p=(current,max,next)=>planHpMaximumChange({current,max},{max:next});
assert.equal(p(12,20,25),17);assert.equal(p(17,25,20),12);
assert.equal(p(20,20,15),15);assert.equal(p(15,15,20),20);
assert.equal(p(2,20,15),0);assert.equal(p(0,15,20),5);
assert.equal(p(7,20,20),null);assert.equal(p(null,20,25),null);
assert.equal(planHpMaximumChange({current:12,max:20},{current:18,max:18},{explicitCurrent:true,rawCurrent:25}),18);
assert.equal(planHpMaximumChange({current:12,max:20},{current:8,max:25},{explicitCurrent:true,rawCurrent:8}),8);
const hooks=new Map();globalThis.Hooks={on:(name,fn)=>hooks.set(name,fn)};
globalThis.game={user:{id:'owner',isGM:false}};
function expandObject(changes){const obj={};for(const [key,value] of Object.entries(changes)){const paths=key.split('.');let target=obj;for(const part of paths.slice(0,-1))target=target[part]??={};target[paths.at(-1)]=structuredClone(value);}return obj;}
globalThis.foundry={utils:{expandObject}};registerHpLimit();
const fire=(name,...args)=>hooks.get(name)?.(...args);
function actor(uuid,type='character'){
 const raw={current:12,max:20,temp:7};
 return {uuid,documentName:'Actor',type,isOwner:true,bonus:0,writes:[],system:{hp:{...raw}},
  toObject(){return {system:{hp:{...raw}}}},prepare(){this.system.hp={...raw,max:raw.max+this.bonus};prepareHpLimit(this.system);},
  async update(changed,options={}){fire('preUpdateActor',this,changed,options,'owner');Object.assign(raw,expandObject(changed).system?.hp??{});this.prepare();this.writes.push({changed,options});const result=fire('updateActor',this,changed,structuredClone(options),'owner');if(!options.fnriHpMaximumManaged)await result;return this;}};
}
const a=actor('Actor.a');await a.update({'system.hp.max':25});assert.deepEqual(a.system.hp,{current:17,max:25,temp:7});assert.equal(a.toObject().system.hp.current,17);
await a.update({'system.hp.current':14});await a.update({'system.hp.max':20});assert.deepEqual(a.system.hp,{current:9,max:20,temp:7});
await a.update({'system.hp.max':23,'system.hp.current':18});assert.equal(a.system.hp.current,18);
await a.update({system:{hp:{max:10,current:50}}});assert.equal(a.toObject().system.hp.current,10);
await a.update({'system.hp.max':20});await a.update({'system.hp.current':12});
const effect={documentName:'ActiveEffect',parent:a,actor:a};
async function changeEffect(action,bonus,doc=effect,target=a,user='owner'){
 const options={};if(action==='Delete')fire(`pre${action}${doc.documentName}`,doc,options,user);else fire(`pre${action}${doc.documentName}`,doc,{},options,user);
 target.bonus=bonus;target.prepare();const wire=structuredClone(options);
 return action==='Update'?fire(`update${doc.documentName}`,doc,{},wire,user):fire(`${action.toLowerCase()}${doc.documentName}`,doc,wire,user);
}
await changeEffect('Create',5);assert.equal(a.system.hp.current,17);await a.update({'system.hp.current':14});await changeEffect('Update',0);assert.equal(a.system.hp.current,9);
await changeEffect('Update',-15);assert.deepEqual(a.system.hp,{current:0,max:5,temp:7});await changeEffect('Delete',0);assert.equal(a.system.hp.current,15);
const item={documentName:'Item',parent:a};await changeEffect('Create',2,item);assert.equal(a.system.hp.current,17);await changeEffect('Delete',0,item);assert.equal(a.system.hp.current,15);
const b=actor('Scene.s.Token.t.Actor.npc','npc'),delta={parent:{actor:b}},o={};fire('preUpdateActorDelta',delta,{'system.hp.max':25},o,'owner');b.bonus=5;b.prepare();await fire('updateActorDelta',delta,{},structuredClone(o),'owner');assert.equal(b.system.hp.current,17);assert.equal(a.system.hp.current,15);
// Two effects in a single native batch and duplicate descendant notifications.
const opt={},e2={...effect};fire('preUpdateActiveEffect',effect,{},opt,'owner');fire('preUpdateActiveEffect',e2,{},opt,'owner');a.bonus=4;a.prepare();const wire=structuredClone(opt);const first=fire('updateActiveEffect',effect,{},wire,'owner');const duplicate=fire('updateActiveEffect',e2,{},wire,'owner');await Promise.all([first,duplicate]);assert.equal(a.system.hp.current,19);
// A rapid pair of opposite changes before queued reconciliation must not change HP.
const x=changeEffect('Update',6),y=changeEffect('Update',4);await Promise.all([x,y]);assert.equal(a.system.hp.current,19);
// No writes for unchanged max, passive clients or missing ownership.
const n=a.writes.length;await changeEffect('Update',4);assert.equal(a.writes.length,n);await changeEffect('Update',5,effect,a,'other');assert.equal(a.writes.length,n);a.isOwner=false;await changeEffect('Update',6);assert.equal(a.writes.length,n);
console.log('PASS HP maximum: equal delta, clamping, explicit edits, damage between changes, AE/Item lifecycle, ActorDelta, deduplication, ownership and temp HP');

// Rest handles its own final HP after removing Actor effects, including the
// case where the prepared pool is already at the new maximum but raw HP isn't.
const {restActor}=await import('../module/data/ability-accounting.mjs');
const {queueActorWrite}=await import('../module/data/ability-accounting.mjs');
let seq=0;foundry.utils.randomID=()=>`rest${++seq}`;
game.time={worldTime:0};game.i18n={localize:key=>key};
const r=actor('Actor.rest','npc');r.flags={};r.getFlag=(s,k)=>r.flags[s]?.[k];
r.system.resources={};r.effects={contents:[],get(id){return this.contents.find(e=>e.id===id)}};
const re={documentName:'ActiveEffect',id:'max',parent:r,actor:r,toObject:()=>({_id:'max'})};r.effects.contents=[re];
await changeEffect('Create',5,re,r);await r.update({'system.hp.current':20});
r.deleteEmbeddedDocuments=async(_type,_ids,options)=>{fire('preDeleteActiveEffect',re,options,'owner');r.effects.contents=[];r.bonus=0;r.prepare();fire('deleteActiveEffect',re,structuredClone(options),'owner');};
// Native hooks are synchronous; the real core does not await hook return values.
const update=r.update.bind(r);r.update=async(changes,options={})=>{
  if(options.fnriJournal?.kind==='rest'){
    fire('preUpdateActor',r,changes,options,'owner');
    // The mock's accounting flags are irrelevant to the HP transaction.
    const current=changes['system.hp.current'];
    if(current!==undefined)await update({'system.hp.current':current},{fnriHpMaximumManaged:true});
    return r;
  }
  return update(changes,options);
};
await restActor(r);await queueActorWrite(r,async()=>{});assert.equal(r.system.hp.current,20);assert.equal(r.system.hp.max,20);
assert.equal(capCurrentHp(-5,20),0);
console.log('PASS Rest does not schedule an obsolete maximum shift after restoring ordinary HP');
