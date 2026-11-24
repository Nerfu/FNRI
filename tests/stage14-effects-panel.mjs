import assert from 'node:assert/strict';
import {
  selectedEffectActor, applicablePanelEffects, getEffectByIdentity,
  effectSource, mayManageEffect, applyPanelClick, panelEffectData
} from '../module/effects/effects-panel-core.mjs';

let deleted = 0, disabled = 0, opened = 0, levelsSaved = 0;
const actor = { uuid: 'Scene.x.Token.z.Actor.r', isOwner: true, name:'Hero', items: new Map(), effects: {contents:[]} };
const normal = { name:'Внимательность', uuid:`${actor.uuid}.ActiveEffect.a1`, img:'icons/a.webp', disabled:false,
  parent: {documentName:'Actor',isOwner:true}, delete:async()=>{deleted++;},
  sheet:{ render:async()=>{opened++;} }, duration:{label:'2 rounds'},
  flags:{}, setFlag:async (scope,key,value)=>{normal.flags[scope] ??= {}; normal.flags[scope][key]=value; levelsSaved++;} }; 
normal.parent = actor;
actor.documentName = 'Actor';
const item = { documentName:'Item', parent:actor, id:'i1', isOwner:true, name:'Amulet' };
actor.items.set('i1',item);
const transferred={ name:'Внимательность', uuid:`${actor.uuid}.Item.i1.ActiveEffect.e2`, parent:item,
  disabled:false, transfer:true, update:async v=>{ if(v.disabled) disabled++; },
  sheet:{render:async()=>{opened++;}}, flags:{} };
const unrelated={...transferred,uuid:'Compendium.pack.Item.fake.ActiveEffect.e3', parent:{...item,parent:null}};
const hidden={...normal,uuid:`${actor.uuid}.ActiveEffect.off`,disabled:true};
actor.allApplicableEffects=function*(){yield normal;yield transferred;yield hidden;};
assert.equal(selectedEffectActor([{actor}], null),actor);
assert.equal(selectedEffectActor([], actor),actor);
assert.equal(selectedEffectActor([], null),null);
assert.deepEqual(applicablePanelEffects(actor).map(e=>e.uuid).sort(),[normal.uuid,transferred.uuid].sort());
assert.equal(getEffectByIdentity(actor,actor.uuid,transferred.uuid),transferred);
assert.equal(getEffectByIdentity(actor,'Actor.another',transferred.uuid),null,'stale token clicks blocked');
assert.equal(getEffectByIdentity(actor,actor.uuid,unrelated.uuid),null,'never resolve effects by icon');
assert.equal(effectSource(transferred),'item');
assert.equal(effectSource(normal),'actor');
assert.equal(mayManageEffect(actor,normal),true);
assert.equal(mayManageEffect(actor,transferred),true);
assert.equal(mayManageEffect(actor,unrelated),false,'foreign Item cannot be modified');
assert.equal(mayManageEffect({...actor,isOwner:false},transferred),false,'viewer cannot modify');
const data=panelEffectData(actor);
assert.equal(data.length,2);
assert.equal(data.find(e=>e.uuid===transferred.uuid).origin,'Amulet');
assert.equal(data.find(e=>e.uuid===normal.uuid).duration,'2 rounds');
assert.equal(await applyPanelClick(actor,normal,0),'no-change', 'no automatic strength for legacy effect');
assert.equal(await applyPanelClick(actor,normal,0,{shiftKey:true}),'opened');
assert.equal(opened,1);
assert.equal(levelsSaved,0);
assert.equal(await applyPanelClick(actor,normal,2),'deleted-actor');
assert.equal(deleted,1);
assert.equal(await applyPanelClick(actor,transferred,2),'disabled-item');
assert.equal(disabled,1);
assert.equal(await applyPanelClick({...actor,isOwner:false},transferred,2),'forbidden');
assert.equal(disabled,1);
assert.equal(await applyPanelClick(actor,unrelated,2),'forbidden');
assert.equal(await applyPanelClick(actor,normal,1),'ignored');
assert.equal(deleted,1);
console.log('PASS stage14 effects-panel: native UUID, owner rights, Shift+left editor, neutral left for unconfigured strength, Actor removal, Item disable');
