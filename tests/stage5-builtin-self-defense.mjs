import {installTemplateMock} from './foundry-test-helpers.js';
import {sheetOptions} from './foundry-test-helpers.js';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {BASE_SELF_DEFENSE} from '../module/data/core-actions.mjs';
import {availableInterventions,selfDefenseFormula} from '../module/damage/interventions.mjs';

const ru=JSON.parse(readFileSync(new URL('../lang/ru.json',import.meta.url),'utf8')).FASTNRI;
const en=JSON.parse(readFileSync(new URL('../lang/en.json',import.meta.url),'utf8')).FASTNRI;
const localize=key=>key.split('.').slice(1).reduce((obj,name)=>obj?.[name],ru)??key;
let shown=[];
class SheetMock {
  constructor(opts={}) {this.actor=opts.actor;this.isEditable=opts.editable??true;}
  async _prepareContext(){return {};}
}
globalThis.game={user:{getFlag(){return null;},setFlag(){throw Error('A read-only ability must not persist flags');}},
  i18n:{localize}};
globalThis.foundry={applications:{api:{
  HandlebarsApplicationMixin(Parent){return class extends Parent{};},
  DialogV2:{prompt:async opts=>{shown.push(opts);return 'ok';}}
},sheets:{ActorSheetV2:SheetMock,ItemSheetV2:SheetMock}}};
installTemplateMock();
const {FastNRICharacterSheet,FastNRINPCSheet}=await import('../module/sheets/sheets.mjs');
assert.equal(BASE_SELF_DEFENSE.id,'builtin:selfDefense');
assert.equal(BASE_SELF_DEFENSE.nameKey,'Damage.selfDefense');

function actor(type){
  const items={contents:[],get(){return undefined;},*[Symbol.iterator](){yield* this.contents;}};
  const system={hp:{current:10,max:10,temp:0},ac:{partial:10,success:13,great:16},
    defenses:{awareness:0,reflex:4,fortitude:3,will:1},combatDie:'d8',attackModifier:5,
    skills:{},resources:{},equipment:{leftHand:'',rightHand:'',armor:''},equipmentSlots:{}};
  return {id:'actor',name:'Test',type,items,system,effects:{contents:[]},
    toObject(){return {system:structuredClone(system)};},getFlag(){return null;}};
}
for (const [type,Sheet] of [['character',FastNRICharacterSheet],['npc',FastNRINPCSheet]]) {
  const a=actor(type);
  assert.equal(availableInterventions(a).length,1,'base defense available without Items');
  assert.equal(availableInterventions(a)[0].id,BASE_SELF_DEFENSE.id);
  const sheet=new Sheet({actor:a,editable:type==='npc'?false:true});
  const ctx=await sheet._prepareContext({});
  assert.equal(ctx.builtinSelfDefense.id,'builtin:selfDefense');
  assert.equal(ctx.builtinSelfDefense.name,'Самозащита');
  assert.equal(ctx.abilityItems.length,0,'built-in ability is not an owned Item');
  const action=sheetOptions(Sheet).actions.viewBuiltinSelfDefense;
  assert.equal(typeof action,'function');
  const button={closest:sel=>sel==='[data-fnri-builtin-action]'?{dataset:{fnriBuiltinAction:BASE_SELF_DEFENSE.id}}:null};
  await action.call(sheet,null,button);
  assert.equal(shown.length, type==='character'?1:2);
  const {window,content}=shown.at(-1);
  assert.equal(window.title,'Самозащита');
  assert.match(content,/1 Вмешательство/);
  assert.match(content,/Защитное/);
  assert.match(content,/Направленную защиту/);
  assert.match(content,/Встроенная способность/);
  assert.ok(!content.includes('<input'),'viewing must not expose an edit form');
  if(type==='npc')assert.match(content,/модификатор атаки/);
  else assert.match(content,/Куб боя/);
  assert.equal(a.items.contents.length,0,'view must not create an embedded Item');
  await action.call(sheet,null,{closest:()=>null});
  assert.equal(shown.length,type==='character'?1:2,'only the built-in action may open this dialog');
  const html=readFileSync(new URL(`../templates/${type==='npc'?'npc':'character'}.hbs`,import.meta.url),'utf8');
  assert.ok(html.includes('{{> fnri-actor-actions}}'));
  const section=ctx.actionSections.flatMap(s=>s.cards).find(c=>c.builtinId===BASE_SELF_DEFENSE.id);
  assert.ok(section,'built-in ability must be in actions');
  assert.equal(section.context,true);
  const row=readFileSync(new URL('../templates/actor-standard-action.hbs',import.meta.url),'utf8');
  assert.match(row,/data-action="openInterventionSource"/);
  assert.match(row,/data-action="openSheetAction"/);
  assert.doesNotMatch(row,/data-action="deleteItem"|data-item-id=/);
  assert.match(html,/\{\{#each abilityItems\}\}/,'owned abilities are still displayed');
}
for(const [code,locale] of [['ru',ru],['en',en]]){
  for(const key of ['selfDefenseCost','selfDefenseTraits','selfDefenseTarget',
    'selfDefenseDescription','selfDefenseCharacterFormula','selfDefenseNpcFormula',
    'selfDefenseResolution','selfDefenseLimits','readOnly','view','close'])
    assert.ok(locale.Builtin?.[key],`${code}: ${key}`);
}
assert.equal(selfDefenseFormula(actor('npc'),'melee').expression,'1d20 + 3 + 5',
  'Bestiary creatures use attack modifier, not the optional character Combat Die');
console.log('PASS: built-in read-only Self-Defense in character/NPC abilities; viewer opens, no Item or writes');
