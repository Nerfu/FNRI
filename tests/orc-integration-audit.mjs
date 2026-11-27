// R125: exercise shared functions at the C1 boundaries without making a new
// ruling about Ferocity's final area degree or blocking an unresolved path.
import assert from 'node:assert/strict';
import {planPeriodicHp} from '../module/damage/periodic-damage.mjs';
import {planHpChange,damageAtReducedDegree} from '../module/damage/damage-core.mjs';
import {resolveAreaResults} from '../module/damage/area-attack.mjs';
import {accountingRule,abilityAccountingStatus} from '../module/data/ability-accounting.mjs';
const ID='fast-nri-v14';
globalThis.game={user:{id:'gm',isGM:true},i18n:{localize:k=>k}};
const hp={current:2,max:10,temp:5};
assert.equal(planHpChange(hp,2,'damage').after.current,2);
assert.equal(planHpChange(hp,7,'damage',{preventZero:true}).after.current,1);
const tick=planPeriodicHp(hp,2);
assert.equal(tick.after.temp,5);
assert.equal(tick.reachedZero,true);
// Explicit observation: the periodic calculator does not receive the voluntary
// prevention decision. A subsequent shared lifecycle integration needs approval.
console.log('OPEN Orc periodic: current tick reaches',tick.after.current,'HP; prevention input not connected');
const die=(id,value,extra={})=>({id,kind:'die',faces:6,formula:'1d6',value,original:value,...extra});
const directed={version:2,degree:'success',effectDegree:'success',profile:{A:'1d6',B:'1d6',C:3},parts:[die('A',4),die('B',5),die('bonus',1,{ferocityDamage:true})]};
const before=structuredClone(directed);
const reduced=damageAtReducedDegree(directed,'partial');
assert.equal(reduced.parts.find(p=>p.id==='bonus').excluded,true);
assert.deepEqual(directed,before);
const targets=['a','b'].map(key=>({key,uuid:`Scene.s.Token.${key}`,name:key,initialDegree:'success'}));
const area={...directed,attackTotal:20,originalAttackTotal:20,areaAttack:{version:1,attackTotal:20,naturalD20:12,targets}};
const root={id:'root',getFlag:(s,k)=>s===ID&&k==='weaponDamage'?area:null};
const areaBefore=structuredClone(area);
const original=resolveAreaResults(root);
const changed=resolveAreaResults(root,[{targetKey:'a',kindKey:'degreeReduction',success:true,degreeReduction:1}]);
assert.deepEqual(changed[1],original[1]);
assert.deepEqual(area,areaBefore);
console.log('OPEN Orc area: success pool bonus value 1; included parts',original[0].includedPartIds,'; after reduction degree',changed[0].degree,'; no canon decision encoded by this audit');
// Existing daily accounting is rest-based; this is not a per-combat reset.
const item={type:'ability',uuid:'Actor.a.Item.flight',system:{mechanics:{accounting:{frequency:{uses:1}}}}};
const actor={uuid:'Actor.a',flags:{[ID]:{accountingEvents:{a:{type:'use',sourceItemUuid:item.uuid,combatId:'old'}}}}};
assert.equal(accountingRule(item).frequency.uses,1);
assert.equal(abilityAccountingStatus(actor,item).remaining,0);
game.combat={id:'new',started:true,round:1,combatants:[{actor}]};
console.log('OPEN Flight: daily schema on new combat remaining',abilityAccountingStatus(actor,item).remaining,'; cannot represent per-combat frequency');
console.log('PASS R125 boundary audit: native calculators, immutable source and independent recipients');
