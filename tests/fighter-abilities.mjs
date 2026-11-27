import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {CLASSES} from '../module/data/classes.mjs';
import {resolveUnarmedAction,availableUnarmedActions} from '../module/rolls/unarmed.mjs';
import {standardManeuverFormula} from '../module/rolls/standard-actions.mjs';
import {situationalCombatDice,degreeDamageEntries,damageFormulaForDegree} from '../module/weapon/weapon-attack.mjs';
import {applyDirectRollModifiers,preparedDamageDefinitions} from '../module/rolls/roll-context.mjs';
import {accountingRule} from '../module/data/ability-accounting.mjs';
const ID='fast-nri-v14',dir=new URL('../packs/_source/abilities/',import.meta.url);
const cards=readdirSync(dir).filter(f=>f.startsWith('fighter-')).map(f=>{const c=JSON.parse(readFileSync(new URL(f,dir),'utf8'));return {...c,id:c._id,uuid:`Actor.fighter.Item.${c._id}`};});
assert.equal(cards.length,9);assert.deepEqual(new Set(cards.map(c=>c.flags[ID].contentId)),new Set(CLASSES.fighter.abilityIds));
const get=n=>cards.find(c=>c.name===n);
globalThis.game={i18n:{localize:k=>k},user:{isGM:true}};
globalThis.canvas={grid:{isSquare:true,size:100}};
const actor={type:'character',system:{className:'Боец',combatDie:'d8',equipment:{}},items:{contents:cards},effects:{contents:[]}};
const p={A:'1d6',B:'1d12',C:4};
assert.deepEqual(resolveUnarmedAction(actor).damageProfile,p);assert.equal(resolveUnarmedAction(actor).selectedKey,'fighter');assert.equal(availableUnarmedActions({...actor,system:{className:'Воин'}}).some(a=>a.key==='fighter'),false);
for(const name of ['Бью этим','Швыряю']){const a=get(name).system.mechanics.attack;assert.deepEqual(a.damageProfile,p);assert.equal(a.unarmed,true);assert.equal(a.requiresHeldItem,true);}
assert.equal(get('Швыряю').system.mechanics.attack.attackRange,4);
const data={name:'Бью этим',...get('Бью этим').system.mechanics.attack};
for(const [d,count,formula] of [['partial',1,''],['success',3,'1d12'],['great',5,'2d12']]){
 const base=damageFormulaForDegree(p,d).parts, entries=degreeDamageEntries(data,d);
 assert.equal(entries[0]?.parts[0].value??'',formula);
 const expression=base.map(p=>p.formula).join(' + ')+(formula?` + (${formula})`:'');
 assert.equal(preparedDamageDefinitions(base,{selected:entries,manual:[],expression}).length,count);
}
assert.match(standardManeuverFormula(actor),/1d12/);actor.system.equipment.leftHand='held';assert.match(standardManeuverFormula(actor),/1d8/);delete actor.system.equipment.leftHand;
const doc=x=>({x,y:0,width:1,height:1,parent:{id:'s'}});
const target={document:doc(100),actor:{effects:{contents:[{flags:{[ID]:{conditionId:'prone'}}}]}}};const originToken={document:doc(0)};
const opts={target,originToken,attackKind:'melee',expression:'1d20 + 1d8',usesCombatDie:true};
assert.equal(applyDirectRollModifiers(opts.expression,situationalCombatDice(actor,opts)),'1d20 + 1d12');
const master={name:'another',parts:[{id:'r',kind:'replacement',from:'1d8',to:'1d10'}]};assert.equal(applyDirectRollModifiers(opts.expression,[master,...situationalCombatDice(actor,opts)]),'1d20 + 1d12');
target.actor.effects.contents=[];assert.equal(situationalCombatDice(actor,opts).length,0);
const weapon={type:'weapon',system:{proficiency:'untrained',mechanics:{attack:{traitOptions:[{id:'firearm',label:'Огнестрельное'}]}}}};
const close={...opts,weapon,attackKind:'ranged',expression:'1d20'};
const choice=situationalCombatDice(actor,close)[0];assert.equal(choice.parts[0].value,'1d8');assert.equal(choice.parts[0].defaultEnabled,false);assert.equal(applyDirectRollModifiers('1d20',[choice]),'1d20');assert.equal(applyDirectRollModifiers('1d20',[{...choice,enabledPartIds:['combat']}]),'1d20 + (1d8)');
target.document.x=200;assert.equal(situationalCombatDice(actor,close).length,0);
for(const name of ['Щас помогу','Иди туда']){const card=get(name);assert.equal(accountingRule(card).resourceCosts[0].amount,1);assert.equal(card.system.mechanics.executions.length,2);assert.ok(card.system.mechanics.executions.every(e=>e.isIntervention&&e.standardActionId));}
console.log('PASS Fighter: nine cards, unarmed profile, degree-specific damage, free hands, target conditions, point-blank bonus and intervention contracts');
