import assert from 'node:assert/strict';
import {numericDistance,hasComputedReach,effectiveWeaponProperties,normalizeAttackKind,
  explicitInterventionFromCard,messageIntervention} from '../module/rolls/attack-properties.mjs';
import {resolveDefenseContext} from '../module/damage/defense-context.mjs';
import {selfDefenseFormula} from '../module/damage/interventions.mjs';
import {setMessageIntervention} from '../module/damage/roll-editor.mjs';
const ID='fast-nri-v14';
globalThis.game={user:{id:'GM',isGM:true},i18n:{localize:k=>k}};
assert.equal(numericDistance(''),0);
assert.equal(numericDistance('2,5'),2.5);
assert.equal(numericDistance('только вблизи'),null);
assert.equal(normalizeAttackKind('ranged'),'ranged');
assert.equal(normalizeAttackKind('unknown'),null);
for(const [attackKind,distance,expected] of [
  ['melee','',false],['melee','0',false],['melee',0,false],
  ['melee','2',true],['melee','2,5',true],['ranged','30',false],
  ['ranged','0',false],['focus','10',false],['','10',false]
]) assert.equal(hasComputedReach({attackKind,distance}),expected,`${attackKind}:${distance}`);
assert.equal(effectiveWeaponProperties({attackKind:'melee',distance:'5',properties:'Бронебойность'}),'Бронебойность, Досягаемость');
assert.equal(effectiveWeaponProperties({attackKind:'ranged',distance:'5',properties:'Досягаемость, Лёгкое'}),'Лёгкое');
const item={system:{mechanics:{isIntervention:true}}};
assert.equal(explicitInterventionFromCard(item),true);
item.system.mechanics.isIntervention='true';
assert.equal(explicitInterventionFromCard(item),true);
item.system.mechanics.isIntervention='false';
assert.equal(explicitInterventionFromCard(item),false);
const passive={id:'b',type:'ability',sort:10,system:{mechanics:{selfDefense:{activation:'passive',mode:'set',stat:'fortitude'}}}};
const selected={id:'c',type:'ability',system:{mechanics:{selfDefense:{activation:'intervention',mode:'choose',options:'fortitude, will'}}}};
const defender={items:[passive],system:{defenses:{will:9,fortitude:1,reflex:4},combatDie:'d6'},type:'character'};
let context=resolveDefenseContext({attack:{attackKind:'ranged',selfDefenseRule:{mode:'set',stat:'will'}},defender,selectedItem:selected});
assert.deepEqual(context.options,['fortitude','will']);
assert.equal(context.requiresChoice,true);
assert.deepEqual(context.trace.map(t=>t.source),['default','attack','b','c']);
context=resolveDefenseContext({attack:{attackKind:'ranged',selfDefenseRule:{mode:'set',stat:'will'}},defender});
assert.equal(context.stat,'fortitude','later defender passive wins over attack special rule');
context=resolveDefenseContext({attack:{attackKind:'melee',selfDefenseRule:{mode:'set',stat:'will'}},defender:null});
assert.equal(context.stat,'will','attack override wins over generic melee default');
context=resolveDefenseContext({attack:{attackKind:'unrecognized'},defender:null});
assert.deepEqual(context.options,['fortitude','reflex','will']);
assert.equal(context.requiresChoice,true,'no silent Fortitude fallback');
assert.equal(selfDefenseFormula(defender,'mystery').expression,null);
assert.equal(selfDefenseFormula(defender,'mystery','will').expression,'1d20 + 9 + 1d6');
// GM-level change is per-message only; original card/source is untouched.
globalThis.game={user:{id:'GM',isGM:true}};
const m={flags:{[ID]:{weaponDamage:{version:2,isIntervention:true}}},
 canUserModify(){return true;},getFlag(scope,key){return this.flags?.[scope]?.[key];},
 async update(patch){for(const [path,value] of Object.entries(patch)) {
   const keys=path.split('.');let target=this;
   for(const k of keys.slice(0,-1))target=target[k]??={};
   target[keys.at(-1)]=value;
 }}};
assert.equal(messageIntervention(m),true);
assert.equal(await setMessageIntervention(m,false),true);
assert.equal(messageIntervention(m),false);
assert.equal(m.flags[ID].weaponDamage.isIntervention,true);
assert.equal(await setMessageIntervention(m,false),false,'no redundant flag entry');
assert.equal(m.flags[ID].interventionHistory.length,1);
game.user={id:'player',isGM:false};
await assert.rejects(setMessageIntervention(m,true),/Only GM/);
console.log('PASS stage 6: attack kind, computed reach, defense precedence and choice, GM intervention override');
