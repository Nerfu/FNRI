import assert from 'node:assert/strict';
import {
  readEffectState, validateEffectStateInput, writeEffectState, strengthStep, validateCoreDurationInput
} from '../module/effects/effect-state.mjs';
import { applyPanelClick, panelEffectData } from '../module/effects/effects-panel-core.mjs';

const owner={uuid:'Actor.A', documentName:'Actor', isOwner:true, items:new Map()};
const effect={name:'Тест',uuid:'Actor.A.ActiveEffect.x',parent:owner,disabled:false,flags:{},
  duration:{label:'3 rounds',value:3,units:'rounds',remaining:2},
  setFlag:async function(scope,key,value){ this.flags[scope]??={};this.flags[scope][key]=value;},
  update:async function(data){ this.lastUpdate=data; },
  delete:async function(){this.deleted=true;}};
owner.allApplicableEffects=function*(){yield effect;};
assert.equal(readEffectState(effect).effectLevel,null,'legacy effects keep working');
assert.equal(readEffectState(effect).strength,null,'no automatic stacks');
assert.deepEqual(strengthStep(readEffectState(effect),1),{kind:'none'});
assert.throws(()=>validateEffectStateInput({effectLevel:'1.2'}));
assert.throws(()=>validateEffectStateInput({strength:'-3'}));
assert.equal(validateEffectStateInput({strength:'123456'}).strength,123456,'no arbitrary upper bound');
assert.equal(validateEffectStateInput({strength:''}).strength,null,'unset is distinct from zero');
assert.throws(()=>validateCoreDurationInput({value:'-2',units:'rounds'}));
assert.deepEqual(validateCoreDurationInput({value:'5',units:'rounds'}),{value:5,units:'rounds'});
await writeEffectState(effect,{effectLevel:'8',strength:'3',magnitude:'-2.5'});
let s=readEffectState(effect);
assert.equal(s.effectLevel,8);assert.equal(s.strength,3);assert.equal(s.magnitude,-2.5);
assert.equal(await applyPanelClick(owner,effect,0),'increased-strength');
s=readEffectState(effect);
assert.equal(s.strength,4);assert.equal(s.effectLevel,8);assert.equal(s.magnitude,-2.5);
// Approved manual override contract: editing the computed-like value locks in
// that manual value even if the configured strength is changed later.
await writeEffectState(effect, { ...s, magnitude: -5, strength: 3 });
assert.equal(await applyPanelClick(owner,effect,0),'increased-strength');
assert.equal(readEffectState(effect).strength,4);
assert.equal(readEffectState(effect).magnitude,-5,'manual value survives a strength change');
await writeEffectState(effect, { ...readEffectState(effect), strength: 4, magnitude: -2.5 });
s = readEffectState(effect);
assert.equal(effect.duration.value,3,'duration remains independent');
assert.equal(await applyPanelClick(owner,effect,2),'decreased-strength');
assert.equal(readEffectState(effect).strength,3);
assert.equal(panelEffectData(owner)[0].strength,3);
assert.equal(panelEffectData(owner)[0].effectLevel,8);
assert.equal(panelEffectData(owner)[0].hasMagnitude,true);
let openParamCalls=0;
assert.equal(await applyPanelClick(owner,effect,0,{shiftKey:true,openEditor:async(a,e)=>{ assert.equal(a,owner);assert.equal(e,effect);openParamCalls++;}}),'opened');
assert.equal(openParamCalls,1);
assert.equal(readEffectState(effect).strength,3,'Shift editor never adjusts strength');
await writeEffectState(effect,{...s, strength:5});
assert.equal(await applyPanelClick(owner,effect,0),'increased-strength','positive effect strength has no upper limit');
await writeEffectState(effect,{...s,strength:1});
assert.equal(await applyPanelClick(owner,effect,2),'deleted-actor','Actor effect removed when strength reaches zero');
assert.equal(effect.deleted,true);
const item={documentName:'Item',id:'i',name:'Amulet',isOwner:true,parent:owner};
owner.items.set('i',item);
const itemEffect={parent:item,flags:{},update:async function(patch){this.lastUpdate=patch;this.disabled=patch.disabled;}};
itemEffect.setFlag=async()=>{};
await writeEffectState(itemEffect,{strength:0});
assert.equal(itemEffect.disabled,true,'Item effect disabled at zero');
const locked={...owner,isOwner:false};
assert.equal(await applyPanelClick(locked,effect,0),'forbidden');
await assert.rejects(()=>writeEffectState({...effect, parent:locked},{effectLevel:4}));
console.log('PASS stage14 effect parameters: independent level / strength / magnitude / duration, manual flags, strength controls, legacy effects, permissions');
