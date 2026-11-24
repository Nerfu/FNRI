import assert from 'node:assert/strict';
import {finalizeRollEffects} from '../module/rolls/roll-context.mjs';

const list=[];
const actor={documentName:'Actor',id:'actor',uuid:'Actor.actor',isOwner:true,
  effects:{contents:list,get(id){return list.find(effect=>effect.id===id) ?? null;}}};
let executions=0;
let resolvePending;
const pending=new Promise(resolve=>{resolvePending=resolve;});
const effect={id:'oneUse',uuid:'Actor.actor.ActiveEffect.oneUse',parent:actor,disabled:false,
  async delete(){executions++;await pending;list.splice(list.indexOf(this),1)}};
list.push(effect);
const context={selected:[{effect,actorOwned:true,onUse:'remove'}]};
const created={id:'created-chat-message'};
await finalizeRollEffects(context,null);
await finalizeRollEffects(context,{content:'not-created'});
assert.equal(executions,0,'unsaved result never consumes');
const a=finalizeRollEffects(context,created);
const b=finalizeRollEffects(context,{id:'second-created-message'});
await new Promise(resolve=>setImmediate(resolve));
assert.equal(executions,1,'simultaneous completions share one pending removal');
resolvePending();
await Promise.all([a,b]);
assert.equal(list.length,0);
await finalizeRollEffects(context,created);
assert.equal(executions,1,'removed effect is not spent again');

// A non-disposable effect must remain. No Card flag means no lifetime rule.
const persistent={id:'persistent',parent:actor,disabled:false,
  async delete(){throw Error('persistent effect must not be consumed')}};
list.push(persistent);
await finalizeRollEffects({selected:[{effect:persistent,actorOwned:true,onUse:'none'}]},created);
assert.equal(list.length,1);

// Item templates can participate but are not actor-owned consumption targets.
const card={documentName:'Item',id:'templateItem',effects:{get(){return null;}}};
const template={id:'template',parent:card,disabled:false,
  async delete(){throw Error('template source cannot be deleted by a roll')}};
await finalizeRollEffects({selected:[{effect:template,actorOwned:false,onUse:'remove'}]},created);

// Disabled effects and effects that are already gone are never re-spent.
const disabled={id:'disabled',parent:actor,disabled:true,
  async delete(){throw Error('disabled effect cannot be consumed')}};
list.push(disabled);
await finalizeRollEffects({selected:[{effect:disabled,actorOwned:true,onUse:'remove'}]},created);
assert.ok(list.includes(disabled));

console.log('PASS stage14 finalization: after saved roll only, simultaneous cleanup once, persistent effects and Item templates untouched');
