import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
import {CLASSES,DOUBLE_INVOCATION_ID,WARLOCK_SPELL_IDS} from '../module/data/classes.mjs';
import {extraAbilityActions} from '../module/sheets/action-catalog.mjs';
import {attackAugmentRule,attackAugmentDamageParts} from '../module/rolls/attack-augmentations.mjs';
import {selectAreaDamageParts} from '../module/damage/area-damage-profile.mjs';
const scope='fast-nri-v14', prefix='fnri7.rulebook.ability.warlock.';
const dir=new URL('../packs/_source/abilities/',import.meta.url);
const cards=readdirSync(dir).filter(f=>f.endsWith('.json')).map(f=>JSON.parse(readFileSync(new URL(f,dir),'utf8'))).filter(d=>d.flags?.[scope]?.contentId?.startsWith(prefix));
const get=id=>cards.find(d=>d.flags[scope].contentId===prefix+id);
assert.equal(cards.length,7);assert.equal(WARLOCK_SPELL_IDS.length,6);
assert.deepEqual(cards.map(d=>d.flags[scope].contentId).sort(),[...CLASSES.warlock.abilityIds].sort());
assert.equal(CLASSES.warlock.resource.current,4);assert.equal(CLASSES.warlock.resource.max,4);assert.equal(CLASSES.warlock.spellRange,8);
globalThis.game={i18n:{localize:k=>k}};
const actions=extraAbilityActions(cards.map(d=>({...d,id:d._id,getFlag:(s,k)=>d.flags?.[s]?.[k]})));
assert.deepEqual(actions.map(a=>a.id),['invocation','doubleInvocation']);assert.equal(actions[1].itemId,get('double-invocation')._id);
assert.equal(get('double-invocation').system.mechanics.passive,true);assert.equal(get('double-invocation').flags[scope].contentId,DOUBLE_INVOCATION_ID);
const execution=(id,index=0)=>get(id).system.mechanics.executions[index];
const cost=e=>e.accounting.resourceCosts[0];
for(const id of ['eldritch-blast','shadow-shield','projection','drain']) {assert.equal(cost(execution(id)).amount,1);assert.equal(cost(execution(id)).resourceKey,'class_magic');}
assert.deepEqual(execution('eldritch-blast').attack.damageProfile,{failure:'0',partial:'1d6',success:'2d6',great:'3d6'});
const blade=get('blade'),rule=attackAugmentRule(blade);assert.equal(rule.requirements.attackKind,'melee');assert.equal(rule.parts[0].formula,'1d8');assert.equal(rule.parts[0].damageType,'магический');assert.equal(blade.system.mechanics.accounting.resourceCosts[0].amount,1);
assert.equal(attackAugmentDamageParts([{item:blade,rule}])[0].spellDamage,true);
const manual=structuredClone(blade);delete manual.system.mechanics.attackAugment.spellDamage;assert.equal(attackAugmentDamageParts([{item:manual,rule}])[0].spellDamage,false,'spell damage is declared by the card, not its ID');
const shield=execution('shadow-shield');assert.equal(shield.amount,5);assert.equal(shield.target,'self');assert.equal(shield.duration.kind,'nextOwnTurn');
assert.equal(execution('projection').type,'projection');assert.match(get('projection').system.description,/каждый его эффект, который должен подействовать на вас/);
const needles=execution('black-needles');assert.equal(cost(needles).amount,3);assert.equal(cost(needles).resourceKey,'class_magic');assert.equal(needles.attack.damageProfile.great,'2d6');
const pool=[{id:'a',value:2,damageType:'физический'},{id:'b',value:5,damageType:'физический'}];
for(const [degree,ids] of [['failure',[]],['partial',['a']],['success',['b']],['great',['a','b']]]) {const result=selectAreaDamageParts(pool,degree,needles.attack.areaDamageProfile);assert.equal(result.ok,true);assert.deepEqual(result.includedPartIds,ids);}
assert.equal(needles.attack.outcomes[0].minEffectDegree,'great');assert.equal(needles.attack.outcomes[0].formula,'1d6');
for(const e of get('drain').system.mechanics.executions){assert.deepEqual(e.attack.damageRules,{ignoreResistance:true,ignoreTempHp:true});assert.deepEqual(e.onDamageApplied.resourceByEffectDegree,{failure:0,partial:1,success:2,great:3});assert.equal(cost(e).amount,1);}
assert.equal(execution('drain',1).isIntervention,true);assert.equal(execution('drain',1).onDamageApplied.spellCancellation,true);
console.log('PASS Warlock actual pack: seven Items + system Invocation, resource costs, optional Blade, Shield, Projection, Needles area, Drain');
