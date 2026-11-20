import assert from 'node:assert/strict';
import {snapshotDamageParts,calculateDamage,changePart,biggestDamageParts,selfDefenseOutcome,
  planHpChange,reverseHpChange} from '../module/damage/damage-core.mjs';
const defs=[{id:'A',kind:'die',faces:6,formula:'1d6'},
  {id:'B',kind:'die',faces:8,formula:'1d8'},
  {id:'C',kind:'fixed',value:6,formula:'6'}];
const parts=snapshotDamageParts({dice:[{faces:6,results:[{result:6}]},{faces:8,results:[{result:4}]}]},defs,
  {damageType:'физический',properties:'Огонь, Святой'});
assert.deepEqual(parts.map(p=>p.value),[6,4,6]);
assert.equal(parts[2].kind,'fixed');
assert.deepEqual(parts[0].traits,['Огонь','Святой']);
const card={version:2,parts,degree:'great',effectDegree:'great',attackTotal:19,naturalD20:12,
  adjustments:{penalty:1,resistance:4,vulnerability:2},manualCritical:true,manualCritMultiplier:2};
assert.deepEqual(biggestDamageParts(card).map(p=>p.id),['A','C']);
assert.equal(calculateDamage(card).total,28, '(16-1)*2 -4 +2');
const removed=changePart(card,'C','exclude');
assert.equal(removed.next.parts[2].excluded,true);
assert.equal(card.parts[2].excluded,false,'original is untouched');
assert.equal(calculateDamage(removed.next).total,16);
const zero=changePart(card,'C','set',0);
assert.equal(zero.next.parts[2].excluded,false);
assert.deepEqual(zero.next.parts[2].traits,['Огонь','Святой']);
assert.throws(()=>changePart(card,'C','reroll',3));
assert.throws(()=>snapshotDamageParts({dice:[]},defs));
assert.equal(selfDefenseOutcome({card,defenseTotal:18,naturalD20:10}).success,false);
assert.equal(selfDefenseOutcome({card,defenseTotal:19,naturalD20:10}).success,true);
assert.equal(selfDefenseOutcome({card,defenseTotal:19,naturalD20:1}).success,false);
assert.equal(selfDefenseOutcome({card,defenseTotal:0,naturalD20:20}).cancelled,true);
const double20={...card,naturalD20:20};
assert.equal(selfDefenseOutcome({card:double20,defenseTotal:0,naturalD20:20}).cancelled,false);
assert.equal(selfDefenseOutcome({card,defenseTotal:19,naturalD20:10}).effectDegree,'success');
assert.equal(calculateDamage({...card,cancelled:true}).total,0);
const damage=planHpChange({current:10,max:21,temp:5},12,'damage');
assert.deepEqual(damage.after,{current:3,temp:0});
assert.deepEqual(damage.delta,{current:-7,temp:-5});
assert.equal(damage.actual,12);
const heal=planHpChange({current:19,max:21,temp:0},9,'heal');
assert.equal(heal.actual,2);
const thp=planHpChange({current:19,max:21,temp:4},3,'temp');
assert.equal(thp.actual,0);
assert.equal(planHpChange({current:19,max:21,temp:4},8,'temp').after.temp,8);
assert.deepEqual(reverseHpChange({current:3,max:21,temp:0},damage),{changedSince:false,current:10,temp:5});
assert.deepEqual(reverseHpChange({current:2,max:21,temp:0},damage),{changedSince:true,current:9,temp:5});
console.log('PASS stage 5 core: parts, ties, immunity representation, defense 1/20, critical order, HP channels & delta undo');
