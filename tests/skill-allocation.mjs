import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {classNames,mandatoryClassSkills} from '../module/data/classes.mjs';
import {initialSkillEntries} from '../module/data/skills-catalog.mjs';
import {initialSkillAllocation,resolveSkillAllocation,planSkillDie,planSkillAssignment,planSkillUpgrade,skillDieEditPatch,resetSkillDicePatch,prepareSkillAllocation,skillPoolEditPatch,skillFormulaOverridePatch,resetSkillAssignmentsPatch} from '../module/data/skill-allocation.mjs';
import {skillFormula} from '../module/rolls/checks.mjs';
const dir=new URL('../packs/_source/abilities/',import.meta.url);
const load=stem=>{const f=readdirSync(dir).find(n=>n.startsWith(stem+'--'));assert.ok(f,stem);const card=JSON.parse(readFileSync(new URL(f,dir),'utf8'));card.id=card._id;card.getFlag=(s,k)=>card.flags?.[s]?.[k];return card;};
const human=load('umelyi'),advanced=load('prodvinutyi'),elf=load('elfiiskii-erudit'),worker=load('rabotyaga'),scars=load('boevye-shramy'),quiet=load('tikhie-shagi');
const fresh=(className='Воин',classTradition='')=>({className,classTradition,skills:initialSkillEntries(),skillAllocation:initialSkillAllocation()});
const result=(s,items=[])=>resolveSkillAllocation(s,items);
const set=(s,items,skill,value)=>{s.skillAllocation=planSkillDie(s,items,skill,value);};
const patch=(s,updates)=>{for(const [key,v] of Object.entries(updates)){const parts=key.split('.').slice(1);let obj=s;while(parts.length>1){const part=parts.shift();obj=obj[part]??={};}obj[parts[0]]=v;}};
const sizes=a=>a.map(d=>d.face).sort((a,b)=>a-b);
for(const name of classNames()){
 const s=fresh(name,'mysticism');const r=result(s);const required=mandatoryClassSkills(s);
 assert.equal(r.dice.length,3+required.length,name);assert.deepEqual(sizes(r.free),[6,6,8]);
 for(const id of required)assert.equal(r.rows[id].formula,'1d10');
}
const s=fresh('Колдун');assert.equal(result(s).needsTradition,true);assert.equal(result(s).rows.mysticism.formula,'');s.classTradition='mysticism';
const items=[human,advanced];assert.deepEqual(sizes(result(s,items).free),[6,6,6,6,8]);assert.equal(result(s,[human,human]).dice.length,6);
set(s,items,'craft','1d6');set(s,items,'stealth','1d8');set(s,items,'society','1d6');assert.deepEqual(sizes(result(s,items).free),[6,6]);
let r=result(s,[...items,worker]);assert.equal(r.rows.craft.formula,'1d8');assert.deepEqual(sizes(r.free),[6,6,6]);assert.equal(r.dice.length,7);
// Stronger or equal existing cube, including the mandatory class d10, leaves the new grant free.
r=result(s,[...items,quiet]);assert.equal(r.rows.stealth.formula,'1d8');assert.deepEqual(sizes(r.free),[6,6,8]);assert.ok(r.free.find(d=>d.source===quiet.name)?.displaced);
const e=fresh('Боец');r=result(e,[worker,scars,quiet]);assert.equal(r.rows.athletics.formula,'1d10');assert.equal(r.rows.acrobatics.formula,'1d10');assert.equal(r.rows.craft.formula,'1d8');assert.equal(r.rows.intimidation.formula,'1d6');assert.equal(r.rows.stealth.formula,'1d8');
// Equal existing cube stays; the new named grant becomes free.
const f=fresh();set(f,[],'intimidation','1d6');r=result(f,[scars]);assert.equal(r.rows.intimidation.formula,'1d6');assert.equal(r.free.length,3);
const displaced=r.free.find(d=>d.source===scars.name);assert.ok(displaced?.displaced);f.skillAllocation=planSkillAssignment(f,displaced.id,'medicine');assert.equal(result(f,[scars]).rows.medicine.formula,'1d6');
// Weaker named grant becomes unrestricted when a stronger cube is already assigned.
const g=fresh();set(g,[],'intimidation','1d8');r=result(g,[scars]);const named=r.free.find(d=>d.source===scars.name);assert.equal(named.displaced,true);g.skillAllocation=planSkillAssignment(g,named.id,'medicine');assert.equal(result(g,[scars]).rows.medicine.formula,'1d6');set(g,[scars],'intimidation','');assert.equal(result(g,[scars]).rows.medicine.formula,'1d6');assert.equal(result(g,[scars]).rows.intimidation.formula,'');
// Restricted source remains accessible, with a warning outside the permitted list.
const h=fresh('Волшебник');r=result(h,[elf]);const limited=r.free.find(d=>d.source===elf.name);h.skillAllocation=planSkillAssignment(h,limited.id,'nature');assert.equal(result(h,[elf]).warnings.length,0);h.skillAllocation=planSkillAssignment(h,limited.id,'medicine');assert.ok(result(h,[elf]).warnings.some(w=>w.code==='restricted'&&w.skill==='medicine'));
// Restricted grants are used first for eligible skills so generic dice remain free.
const h2=fresh();set(h2,[elf],'society','1d6');assert.equal(result(h2,[elf]).dice.find(d=>d.skill==='society').source,elf.name);
// A manual change to an already fixed racial die is advisory, not a second grant.
const fixed=fresh();set(fixed,[scars],'intimidation','1d8');assert.equal(result(fixed,[scars]).rows.intimidation.formula,'1d8');assert.ok(result(fixed,[scars]).warnings.some(w=>w.code==='manualOverride'));
// Promotions attach to original die, don't increase count; second upgrade cannot use same d6.
const u=fresh();set(u,items,'medicine','1d6');set(u,items,'craft','1d8');r=result(u,items);const d6=r.rows.medicine.die,d8=r.rows.craft.die;const up6=r.upgrades.find(x=>x.size===6),up8=r.upgrades.find(x=>x.size===8);
u.skillAllocation=planSkillUpgrade(u,up6.id,d6);u.skillAllocation=planSkillUpgrade(u,up8.id,d6);r=result(u,items);assert.equal(r.rows.medicine.formula,'1d8');assert.equal(r.rows.craft.formula,'1d8');assert.ok(r.warnings.some(w=>w.code==='invalidUpgrade'));
u.skillAllocation=planSkillUpgrade(u,up8.id,d8);r=result(u,items);assert.equal(r.rows.craft.formula,'1d10');assert.equal(r.dice.length,6);assert.equal(r.upgrades.filter(x=>x.target).length,2);
// Removing a single assignment returns the promoted die unchanged. The full reset clears upgrades.
const detached=structuredClone(u);set(detached,items,'medicine','');assert.ok(result(detached,items).free.some(d=>d.id===d6&&d.face===8));
set(u,items,'athletics','');r=result(u,items);assert.equal(r.rows.athletics.formula,'');assert.ok(r.warnings.some(w=>w.code==='mandatoryOverride'));
set(u,items,'persuasion','1d12');r=result(u,items);assert.equal(r.rows.persuasion.formula,'1d12');assert.ok(r.warnings.some(w=>w.code==='manualOverride'));
set(u,items,'deception','2d6 + 1d8');assert.equal(result(u,items).rows.deception.formula,'2d6 + 1d8');
u.skills.starter_primary.name='Лес';u.skills.starter_primary.dice='2d6';u.skills.core_stealth.dice='1d4';const reset=resetSkillDicePatch(u);patch(u,reset);r=result(u,items);assert.equal(r.rows.athletics.formula,'1d10');assert.equal(r.rows.craft.formula,'');assert.equal(r.rows.stealth.formula,'');assert.equal(r.rows.deception.formula,'');assert.equal(r.free.length,5);assert.ok(r.upgrades.every(x=>!x.target));assert.equal(u.skills.starter_primary.name,'Лес');
// Class switch retains free die identities; no writing to source during preparation.
set(u,items,'nature','1d8');u.className='Друид';r=result(u,items);assert.equal(r.rows.nature.formula,'1d10');assert.ok(r.free.some(d=>d.size===8));u.className='Воин';assert.equal(result(u,items).rows.nature.formula,'1d8');
const before=structuredClone(u);const model={...structuredClone(u),parent:{items:{contents:items},toObject:()=>({system:u})}};prepareSkillAllocation(model);assert.equal(skillFormula(model.skills.core_athletics),'1d20 + (1d10)');assert.equal(skillFormula(model.skills.core_nature),'1d20 + (1d8)');assert.equal(skillFormula(model.skills.core_deception),'1d20');assert.deepEqual(u,before);prepareSkillAllocation(model);assert.equal(model.skills.core_nature.dice,'1d8');
patch(u,skillDieEditPatch(u,items,'nature','1d6'));assert.equal(result(u,items).rows.nature.formula,'1d6');assert.ok(result(u,items).free.some(d=>d.size===8));
// A repeated size still selects one exact die. Transfers and upgrades follow
// that die, while both affected skills' manual formulas remain independent.
const pool = fresh('Колдун','mysticism');
const poolItems = [advanced];
const edit = (skill, dieId, from, previous) => {
  const updates = skillPoolEditPatch(pool, poolItems, skill, {dieId, from, previous});
  assert.ok(updates);
  patch(pool, updates);
};
edit('medicine','free_1',null,null);
edit('stealth','free_0',null,null);
r = result(pool,poolItems);
assert.deepEqual(sizes(r.free),[6]);
const promote = r.upgrades.find(upgrade=>upgrade.size===6);
pool.skillAllocation = planSkillUpgrade(pool,promote.id,'free_1');
patch(pool,skillFormulaOverridePatch(pool,'medicine','2d6'));
assert.equal(result(pool,poolItems).rows.medicine.die,'free_1','a manual formula leaves the allocated die in place');
edit('stealth','free_1','medicine','free_0');
r = result(pool,poolItems);
assert.equal(r.rows.stealth.die,'free_1');
assert.equal(r.rows.stealth.formula,'1d8');
assert.equal(r.rows.medicine.die,null);
assert.equal(r.rows.medicine.formula,'2d6');
assert.ok(r.free.some(die=>die.id==='free_0'));
assert.equal(skillPoolEditPatch(pool,poolItems,'intimidation',{dieId:'free_1',from:'medicine',previous:null}),null);
assert.equal(skillPoolEditPatch(pool,poolItems,'mysticism',{dieId:'free_0',from:null,previous:'class_mysticism'}),null);
assert.equal(skillPoolEditPatch(pool,poolItems,'intimidation',{dieId:'class_mysticism',from:'mysticism',previous:null}),null);
edit('stealth',null,null,'free_1');
assert.ok(result(pool,poolItems).free.some(die=>die.id==='free_1'&&die.face===8));
patch(pool,skillFormulaOverridePatch(pool,'mysticism',''));
assert.equal(result(pool,poolItems).rows.mysticism.formula,'','blank overrides an automatic assignment');
patch(pool,skillFormulaOverridePatch(pool,'mysticism',null));
assert.equal(result(pool,poolItems).rows.mysticism.formula,'1d10');
edit('stealth','free_1',null,null);
patch(pool,resetSkillAssignmentsPatch(pool));
r = result(pool,poolItems);
assert.equal(r.rows.stealth.die,null);
assert.equal(r.rows.medicine.formula,'2d6');
assert.equal(r.upgrades.find(upgrade=>upgrade.size===6).target,'free_1');
patch(pool,skillFormulaOverridePatch(pool,'medicine',null));
assert.equal(result(pool,poolItems).rows.medicine.formula,'');

// Explicit return of a displaced racial die should not immediately assign it
// back to its original, now-vacant skill. Reset restores initial grants.
const returned = fresh();
set(returned,[],'intimidation','1d8');
const spawn = result(returned,[scars]).free.find(die=>die.source===scars.name);
patch(returned,skillPoolEditPatch(returned,[scars],'medicine',{dieId:spawn.id,from:null,previous:null}));
patch(returned,skillPoolEditPatch(returned,[scars],'intimidation',{dieId:null,from:null,previous:'free_0'}));
patch(returned,skillPoolEditPatch(returned,[scars],'medicine',{dieId:null,from:null,previous:spawn.id}));
assert.ok(result(returned,[scars]).free.some(die=>die.id===spawn.id));
assert.equal(result(returned,[scars]).rows.intimidation.die,null);
patch(returned,resetSkillAssignmentsPatch(returned));
assert.equal(result(returned,[scars]).rows.intimidation.die,spawn.id);
console.log('PASS source-aware skill grants, all classes, traditions, displacement, restricted dice, promotions, warnings, reset, source-safe roll data');
