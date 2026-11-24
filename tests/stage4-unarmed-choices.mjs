import {acceptPreroll} from './foundry-test-helpers.js';
import {sheetOptions} from './foundry-test-helpers.js';
import assert from 'node:assert/strict';
import { availableUnarmedActions, resolveUnarmedAction, sendUnarmedAttack } from '../module/rolls/unarmed.mjs';
const baseSystem={equipment:{leftHand:'',rightHand:'',armor:''},equipmentSlots:{},combatDie:'d8'};
const ability = (id, mode, name, A='1d6')=>({id,name,type:'ability',uuid:`Actor.A.Item.${id}`,
  system:{mechanics:{unarmedAttack:{mode,name,damageType:'физический',damageProfile:{A,B:'1d4',C:2}}}}});
const a={id:'A',type:'character',system:baseSystem,items:{contents:[]},flags:{'fast-nri-v14':{}},
  getFlag(ns,key){return this.flags[ns]?.[key];},getRollData(){return {}}};
assert.equal(resolveUnarmedAction(a).selectedKey,'base');
assert.equal(resolveUnarmedAction(a).hasChoices,false);
const fighter=ability('fighter','replace','Боец');
a.items.contents=[fighter];
assert.equal(resolveUnarmedAction(a).selectedKey,'item:fighter','single legacy replacer defaults to its profile');
assert.equal(resolveUnarmedAction(a).choices.length,2);
a.flags['fast-nri-v14'].selectedUnarmedAttack='base';
assert.equal(resolveUnarmedAction(a).selectedKey,'base','base remains an explicit choice');
a.flags['fast-nri-v14'].selectedUnarmedAttack='item:fighter';
assert.equal(resolveUnarmedAction(a).damageProfile.A,'1d6');
const claws=ability('claws','option','Когти','1d8');
a.items.contents.push(claws);
assert.equal(resolveUnarmedAction(a).choices.length,3);
assert.equal(resolveUnarmedAction(a).name,'Боец');
assert.equal(resolveUnarmedAction(a, 'base').selectedKey,'base',
  'base stays manually selectable even when a fighter replacement exists');
a.flags['fast-nri-v14'].selectedUnarmedAttack='base';
assert.equal(resolveUnarmedAction(a).selectedKey,'base',
  'an explicitly selected base must never be overridden by new cards');
a.flags['fast-nri-v14'].selectedUnarmedAttack='item:fighter';
a.flags['fast-nri-v14'].selectedUnarmedAttack='item:claws';
assert.equal(resolveUnarmedAction(a).damageProfile.A,'1d8');
const inactive=ability('inactive','option','Неактивная');
inactive.system.mechanics.unarmedAttack.active=false;
a.items.contents.push(inactive);
assert.equal(availableUnarmedActions(a).length,3);
const gear= {...ability('gloves','option','Перчатки'),'type':'gear'};
a.items.contents.push(gear);
assert.equal(availableUnarmedActions(a).length,3,'unequipped gear cannot add attacks');
a.system.equipmentSlots={extra:{name:'Слот',itemId:'gloves'}};
assert.equal(availableUnarmedActions(a).length,4,'equipped gear can add an option');
a.system.equipmentSlots={};
a.items.contents=a.items.contents.filter(i=>i.id!=='claws');
assert.equal(resolveUnarmedAction(a).selectedKey,'base','deleted card safely falls back');
const messages=[];
class RollMock {static validate(){return true;}constructor(formula){this.formula=formula;this.total=14;this.dice=[{faces:20,number:1,results:[{result:12}]}];}async evaluate(){return this;}async toMessage(m){messages.push(m);return m;}}
globalThis.Roll=RollMock;
globalThis.ChatMessage={getSpeaker:()=>({alias:'Герой'})};
globalThis.game={i18n:{localize:x=>x},user:{targets:new Set()},settings:{get:()=> 'public'}};
a.flags['fast-nri-v14'].selectedUnarmedAttack='item:fighter';
globalThis.foundry={applications:{api:{DialogV2:{wait:acceptPreroll}}}};
await sendUnarmedAttack(a);
assert.equal(messages.at(-1).flags['fast-nri-v14'].weaponAttack.profile.A,'1d6');
a.flags['fast-nri-v14'].selectedUnarmedAttack='base';
await sendUnarmedAttack(a);
assert.equal(messages.at(-1).flags['fast-nri-v14'].weaponAttack.profile.A,'1d4');

// UI action: persist only an authorized, currently available choice.
class SheetMock { async _prepareContext(){return {}}; }
globalThis.foundry={applications:{api:{HandlebarsApplicationMixin:Parent=>Parent,DialogV2:{}},sheets:{ActorSheetV2:SheetMock,ItemSheetV2:SheetMock}}};
const {FastNRICharacterSheet}=await import('../module/sheets/sheets.mjs');
assert.equal(typeof sheetOptions(FastNRICharacterSheet).actions.selectUnarmedAttack,'function');
const saves=[];
const editable={isEditable:true,actor:{...a,async update(changes){saves.push(changes);return this;}},_queueWrite:operation=>operation()};
const trigger=key=>({dataset:{unarmedChoice:key}});
await sheetOptions(FastNRICharacterSheet).actions.selectUnarmedAttack.call(editable,null,trigger('item:fighter'));
assert.deepEqual(saves[0],{'flags.fast-nri-v14.selectedUnarmedAttack':'item:fighter'});
await sheetOptions(FastNRICharacterSheet).actions.selectUnarmedAttack.call(editable,null,trigger('item:missing'));
assert.equal(saves.length,1,'no save of nonexistent choice');
editable.isEditable=false;
await sheetOptions(FastNRICharacterSheet).actions.selectUnarmedAttack.call(editable,null,trigger('base'));
assert.equal(saves.length,1,'read-only sheet does not change Actor');

console.log('PASS: selectable base, legacy replacement, additional options, saved choice, stale fallback, equipped source and chat snapshot');
