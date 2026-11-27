import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {CLASSES} from '../module/data/classes.mjs';
import {attackOutcomePreview} from '../module/equipment/attack-outcomes.mjs';
import {declaredPeriodicDefenses,calculatePeriodicTick} from '../module/damage/periodic-damage.mjs';
import {reconcileCreatureSize} from '../module/data/creature-size.mjs';
const scope='fast-nri-v14',dir=new URL('../packs/_source/abilities/',import.meta.url);
const cards=readdirSync(dir).filter(f=>f.startsWith('druid-')).map(f=>JSON.parse(readFileSync(new URL(f,dir),'utf8')));
assert.equal(cards.length,13);assert.deepEqual(new Set(cards.map(c=>c.flags[scope].contentId)),new Set(CLASSES.druid.abilityIds));
const get=n=>cards.find(c=>c.name===n),bear=get('Большой зверь'),grasp=get('Хищная хватка');
assert.deepEqual(bear.system.mechanics.executions[1].attack.damageProfile,{A:'1d6',B:'1d8',C:3});
assert.deepEqual(grasp.system.mechanics.executions[0].attack.damageProfile,{A:'1d6',B:'1d6',C:3});
for(const degree of ['failure','partial','success','great']){
 const out=attackOutcomePreview(grasp,{effectDegree:degree,executionId:'attack'}).applicable;
 assert.equal(out.length,['success','great'].includes(degree)?1:0);
 if(out.length)assert.equal(out[0].effectRefs[0].contentId,'fnri7.rulebook.condition.grabbed');
}
const effect={...bear.effects[0],uuid:'Actor.test.ActiveEffect.bear',active:true};
const actor={type:'character',system:{size:'small'},items:{contents:[get('Природная стойкость')]},effects:{contents:[]},canUserModify:()=>true,async update(p){this.system.size=p['system.size'];this.system.sizeState=p['system.sizeState'];}};
const resistance=()=>calculatePeriodicTick({value:10,traits:['Физический']},declaredPeriodicDefenses(actor)).resistance;
assert.equal(resistance(),1);actor.effects.contents=[effect];assert.equal(resistance(),3);
assert.equal(await reconcileCreatureSize(actor),true);assert.equal(actor.system.size,'large');
actor.effects.contents=[];assert.equal(resistance(),1);assert.equal(await reconcileCreatureSize(actor),true);assert.equal(actor.system.size,'small');
console.log('PASS Druid: 13 class cards, exact attack profiles, linked grab outcome, form size and nonstacking resistance');
