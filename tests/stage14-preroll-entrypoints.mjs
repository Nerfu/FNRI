import {sheetOptions} from './foundry-test-helpers.js';
/**
 * Local end-to-end-ish action regression: v14 ApplicationV2 action dispatch,
 * shared prepareRoll, Roll.evaluate, ChatMessage.toMessage, then onUse cleanup.
 * Mocks are not evidence of actual Foundry UI or multiplayer behavior.
 */
import assert from 'node:assert/strict';

const timeline = [];
const messages = [];
const dialogPlans = [];
let dialogs = 0;
let warnings = 0;
let nextId = 1;
let failEvaluate = false;
let failMessage = false;
let unsavedMessage = false;
const pause = () => new Promise(resolve => setImmediate(resolve));
const collection = contents => ({contents,get(id){return this.contents.find(doc => doc.id === id) ?? null;}});

class RollMock {
  static validate(expression) {return !!String(expression).trim();}
  constructor(expression, data) {
    this.expression = expression;
    this.data = data;
    this.total = 15;
    this.dice = [{faces:20,number:1,results:[{result:12,active:true}]}];
  }
  async evaluate() {
    timeline.push('roll');
    if (failEvaluate) throw Error('evaluate failed');
    return this;
  }
  async toMessage(payload) {
    timeline.push('message');
    if (failMessage) throw Error('message failed');
    const doc = {...payload,id:unsavedMessage ? undefined : `msg-${nextId++}`,expression:this.expression};
    messages.push(doc);
    return doc;
  }
}
class SheetMock {
  constructor({actor=null,item=null}={}) {this.actor=actor;this.item=item;this.isEditable=true;}
  async _prepareContext(){return {};}
}
const dialog = {wait:async config => {
  dialogs++;
  const plan = dialogPlans.shift() ?? {type:'all'};
  assert.match(config.content,/data-fnri-preroll/);
  if (plan.type === 'cancel') return null;
  const entries = [...config.content.matchAll(/(<input\b[^>]*name="(part_(\d+)_\d+)"[^>]*>)/g)];
  const fields = new Map();
  for (const [,tag,name,index] of entries) {
    fields.set(name,{checked:/\bchecked\b/.test(tag) && !plan.disabled?.includes(Number(index))});
  }
  fields.set('situational',{value:''});
  fields.set('situationalName',{value:''});
  return config.buttons[0].callback({}, {form:{elements:{namedItem(name){return fields.get(name) ?? null;}}}});
}};
globalThis.Roll = RollMock;
globalThis.ChatMessage = {getSpeaker({actor}={}){return actor ? {actor:actor.id} : {alias:'World Item'};}};
globalThis.game = {
  i18n:{localize:key=>key},
  user:{targets:new Set(),getFlag(){return null;}},
  settings:{get(){return 'public';}}
};
globalThis.ui = {notifications:{warn(){warnings++;}}};
globalThis.foundry={applications:{api:{HandlebarsApplicationMixin:Parent=>Parent,DialogV2:dialog},
  sheets:{ActorSheetV2:SheetMock,ItemSheetV2:SheetMock}}};

const {FastNRICharacterSheet,FastNRIItemSheet}=await import('../module/sheets/sheets.mjs');
const actor={documentName:'Actor',id:'hero',uuid:'Actor.hero',name:'Hero',isOwner:true,hasPlayerOwner:true,
  system:{className:'Воин',combatDie:'d10'},effects:collection([]),items:collection([]),
  allApplicableEffects(){return [...this.effects.contents,
    ...this.items.contents.flatMap(item => item.effects?.contents ?? [])];},
  getRollData(){return {};}
};
const weapon={documentName:'Item',id:'sword',uuid:'Actor.hero.Item.sword',name:'Sword',type:'weapon',parent:actor,
  system:{attackKind:'melee',proficiencyMode:'yes',damageProfile:{A:'1d8',B:'1d4',C:1},
    rollFormula:'',mechanics:{}},effects:collection([])};
actor.items.contents.push(weapon);
// A minimal Foundry-like source/clone contract for the unchecked-effect path.
// Exclusion must happen on the clone, never by disabling the live effect.
actor.toObject = () => ({
  effects:actor.effects.contents.map(effect=>({
    _id:effect.id,name:effect.name,disabled:effect.disabled,
    flags:structuredClone(effect.flags),system:structuredClone(effect.system)})),
  items:actor.items.contents.map(item=>({
    _id:item.id,effects:item.effects.contents.map(effect=>({
      _id:effect.id,name:effect.name,disabled:effect.disabled,
      flags:structuredClone(effect.flags),system:structuredClone(effect.system)}))}))
});
actor.clone = source => {
  const temporary={...actor};
  const cloneEffect=(raw,parent)=>({
    id:raw._id,uuid:`${parent.uuid}.ActiveEffect.${raw._id}`,
    name:raw.name,disabled:raw.disabled,flags:raw.flags,system:raw.system,parent});
  temporary.effects=collection(source.effects.map(e=>cloneEffect(e,temporary)));
  temporary.items=collection(source.items.map(item=>{
    const doc={documentName:'Item',id:item._id,uuid:`${temporary.uuid}.Item.${item._id}`,parent:temporary};
    doc.effects=collection(item.effects.map(e=>cloneEffect(e,doc)));
    return doc;
  }));
  return temporary;
};
const actorSheet = new FastNRICharacterSheet({actor});
const itemSheet = new FastNRIItemSheet({item:weapon});
const actorAttack = sheetOptions(FastNRICharacterSheet).actions.weaponAttack;
const itemAttack = sheetOptions(FastNRIItemSheet).actions.weaponAttack;
const actorButton = {closest(){return {dataset:{itemId:'sword'}};}};

let effectCounter=0;
function addEffect({onUse='remove',modifier=2,parent=actor}={}) {
  const id=`buff${++effectCounter}`;
  const effect={id,name:`Buff ${id}`,uuid:`${parent.uuid}.ActiveEffect.${id}`,parent,
    disabled:false,flags:{'fast-nri-v14':{rollInfluence:{kinds:['attack'],modifier,onUse}}},
    system:{changes:[]},
    async delete() {
      timeline.push('delete');
      parent.effects.contents=parent.effects.contents.filter(other=>other!==this);
    },
    async update(change) {
      timeline.push('disable');Object.assign(this,change);
    }};
  parent.effects.contents.push(effect);
  return effect;
}
const assertLastFormula = formula => assert.equal(messages.at(-1)?.expression,formula);

// Actor sheet: ordinary click opens preparation; selected effect applies once.
let effect = addEffect();
dialogPlans.push({type:'all'});
await actorAttack.call(actorSheet,{shiftKey:false},actorButton);
assert.equal(dialogs,1);
assertLastFormula('1d20 + 1d10 + (2)');
assert.deepEqual(timeline.slice(-3),['roll','message','delete'],
  'onUse cleanup must happen after evaluation and persisted chat message');
assert.equal(actor.effects.contents.length,0);

// Actor sheet: Shift skips the window, DOES use and spend the one-use effect.
effect=addEffect({modifier:3});
const dialogsBeforeShift=dialogs;
await actorAttack.call(actorSheet,{shiftKey:true},actorButton);
assert.equal(dialogs,dialogsBeforeShift);
assertLastFormula('1d20 + 1d10 + (3)');
assert.equal(actor.effects.get(effect.id),null);

// Embedded Item sheet uses the SAME route and passes Shift. This is the bug fix.
effect=addEffect({modifier:4});
await itemAttack.call(itemSheet,{shiftKey:true},{});
assert.equal(dialogs,dialogsBeforeShift,'Item-sheet Shift must skip pre-roll dialog');
assertLastFormula('1d20 + 1d10 + (4)');
assert.equal(actor.effects.get(effect.id),null,'Shift still consumes AFTER roll');

effect=addEffect({modifier:5});
dialogPlans.push({type:'all'});
await itemAttack.call(itemSheet,{shiftKey:false},{});
assert.equal(dialogs,dialogsBeforeShift+1,'Item-sheet ordinary click opens pre-roll');
assertLastFormula('1d20 + 1d10 + (5)');
assert.equal(actor.effects.get(effect.id),null);

// Cancel and unchecked checkbox are not usages; no roll and no consumption.
effect=addEffect({modifier:6});
const beforeCancel=messages.length;
dialogPlans.push({type:'cancel'});
await itemAttack.call(itemSheet,{shiftKey:false},{});
assert.equal(messages.length,beforeCancel);
assert.ok(actor.effects.get(effect.id));
dialogPlans.push({type:'all',disabled:[0]});
await itemAttack.call(itemSheet,{shiftKey:false},{});
assert.equal(messages.length,beforeCancel+1);
assertLastFormula('1d20 + 1d10');
assert.ok(actor.effects.get(effect.id),'unchecked one-use effect remains');
// An effect lacking onUse stays in place, even if chosen and included.
await effect.delete();
effect=addEffect({modifier:7,onUse:'none'});
const beforeNoUse=timeline.filter(e=>e==='delete').length;
await itemAttack.call(itemSheet,{shiftKey:true},{});
assertLastFormula('1d20 + 1d10 + (7)');
assert.ok(actor.effects.get(effect.id));
assert.equal(timeline.filter(e=>e==='delete').length,beforeNoUse);
await effect.delete();

// Missing message / failing evaluation / failed message must never spend.
for (const mode of ['evaluate','message','unsaved']) {
  effect=addEffect({modifier:8});
  const before=timeline.filter(e=>e==='delete').length;
  failEvaluate=mode==='evaluate'; failMessage=mode==='message';unsavedMessage=mode==='unsaved';
  // These failures are deliberately injected; do not print expected traces.
  const report = console.error;
  try {
    console.error = () => {};
    await itemAttack.call(itemSheet,{shiftKey:true},{});
  } finally { console.error = report; }
  assert.ok(actor.effects.get(effect.id),`${mode}: no consumption`);
  assert.equal(timeline.filter(e=>e==='delete').length,before);
  failEvaluate=failMessage=unsavedMessage=false;
  await effect.delete();
}
assert.ok(warnings>=2,'UI warned on mocked failures');

// A disabled one-use effect is disabled AFTER the committed result, not removed.
effect=addEffect({modifier:9,onUse:'disable'});
await actorAttack.call(actorSheet,{shiftKey:true},actorButton);
assert.ok(actor.effects.get(effect.id));
assert.equal(effect.disabled,true);
assert.equal(timeline.at(-1),'disable');

// A transferred Item effect can contribute, but the Item template is not spent.
const template=addEffect({modifier:2,onUse:'remove',parent:weapon});
const callsBefore=timeline.filter(e=>e==='delete').length;
await itemAttack.call(itemSheet,{shiftKey:true},{});
assertLastFormula('1d20 + 1d10 + (2)');
assert.equal(weapon.effects.get(template.id),template);
assert.equal(timeline.filter(e=>e==='delete').length,callsBefore);

// World/standalone Item has no Actor or ownership dependency, and its own
// explicitly scoped card contribution still enters the shared preparation.
const world={...weapon,id:'world',uuid:'Item.world',name:'World Sword',parent:null,
  system:{...weapon.system,mechanics:{rollContributions:[
    {label:'Runic edge',kind:'modifier',value:3,kinds:['attack']}]}}};
const worldSheet=new FastNRIItemSheet({item:world});
const normalBefore=dialogs;
dialogPlans.push({type:'all'});
await itemAttack.call(worldSheet,{shiftKey:false},{});
assert.equal(dialogs,normalBefore+1);
assertLastFormula('1d20 + (3)');
assert.equal(messages.at(-1).flags['fast-nri-v14'].weaponAttack.actorUuid,null);
await itemAttack.call(worldSheet,{shiftKey:true},{});
assert.equal(dialogs,normalBefore+1);
assertLastFormula('1d20 + (3)');
assert.equal(messages.at(-1).flags['fast-nri-v14'].weaponAttack.actorUuid,null);

await pause();
console.log('PASS stage14 entrypoints: Actor/Item Shift and normal, cancel, checkbox, no onUse, after-roll cleanup, failed roll/chat, item template, standalone world Item');
