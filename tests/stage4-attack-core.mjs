import assert from 'node:assert/strict';
import {resolveAttackDegree,resolveDirectedEffectDegree,parseStandardPhysicalProfile,standardPhysicalPartsForDegree} from '../module/rolls/attack-core.mjs';
const ac={partial:10,success:20,great:30};
for(const [total,degree] of [[9,'failure'],[10,'partial'],[19,'partial'],[20,'success'],[29,'success'],[30,'great'],[100,'great']]) {
  const result=resolveAttackDegree({total,naturalD20:10,ac});
  assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.degree,degree);
}
const nat1=resolveAttackDegree({total:100,naturalD20:1,ac,attackerDegreeShift:3});
assert.equal(nat1.degree,'failure');assert.equal(nat1.naturalOne,true);
const nat20=resolveAttackDegree({total:20,naturalD20:20,ac});
assert.equal(nat20.degree,'success','Natural 20 cannot raise the degree');
assert.equal(nat20.attackNaturalTwentyDamageMultiplier,2);
assert.equal(resolveAttackDegree({total:9,naturalD20:12,ac,attackerDegreeShift:1}).degree,'partial');
assert.equal(resolveAttackDegree({total:29,naturalD20:9,ac,attackerDegreeShift:-1}).degree,'partial');
assert.equal(resolveAttackDegree({total:8,naturalD20:10,ac:{partial:12,success:10,great:20}}).ok,false);
assert.equal(resolveAttackDegree({total:8,naturalD20:null,ac}).ok,false);
assert.equal(resolveAttackDegree({total:8,naturalD20:10,ac:{partial:10,success:null,great:20}}).ok,false);
assert.equal(resolveAttackDegree({total:30,naturalD20:10,ac:{partial:10,success:10,great:10}}).degree,'great');
for(const [count,effect] of [[0,'great'],[1,'success'],[2,'partial'],[3,'failure'],[6,'failure']]){
  const r=resolveDirectedEffectDegree({attackDegree:'great',successfulDefenses:count});
  assert.equal(r.ok,true);assert.equal(r.effectDegree,effect);
}
assert.equal(resolveDirectedEffectDegree({attackDegree:'great',fullyCancelled:true}).effectDegree,'failure');
assert.equal(resolveDirectedEffectDegree({attackDegree:'invalid'}).ok,false);
const profile={A:'1d6',B:'1d8',C:'+3'};
assert.equal(parseStandardPhysicalProfile(profile).ok,true);
for(const [degree,parts] of [['failure',[]],['partial',['A']],['success',['A','B']],['great',['A','B','C']]]){
  const r=standardPhysicalPartsForDegree(profile,degree);
  assert.equal(r.ok,true);assert.deepEqual(r.parts.map(x=>x.id),parts);
}
const p=standardPhysicalPartsForDegree(profile,'great');
assert.deepEqual(p.parts,[
  {id:'A',kind:'die',faces:6,formula:'1d6'},
  {id:'B',kind:'die',faces:8,formula:'1d8'},
  {id:'C',kind:'fixed',value:3,formula:'3'}
]);
assert.equal(standardPhysicalPartsForDegree({A:'2d6',B:'1d8',C:3},'great').ok,false);
assert.equal(standardPhysicalPartsForDegree({A:'1d6',B:'1d8',C:0},'partial').ok,false);
assert.equal(standardPhysicalPartsForDegree({A:'1d6',B:'1d8',C:'1d6'},'great').ok,false);
assert.equal(standardPhysicalPartsForDegree(profile,'spell').ok,false);
console.log('PASS: stage 4 pure attack degrees, directed effect degrees, strict physical A/B/+C');
