import assert from 'node:assert/strict';
import {specializationEntries,preparedSpecializationEntry} from '../module/data/specializations.mjs';
import {selectRollParts, computeRollPreview, prepareRoll, renderRollPreparation} from '../module/rolls/roll-context.mjs';
import {skillFormula} from '../module/rolls/checks.mjs';
globalThis.game={i18n:{localize:k=>k}};
const actor={id:'a',uuid:'Actor.a',system:{skills:{
  core_stealth:{kind:'skill',name:'Скрытность',dice:'1d8',modifier:1},
  locksmith:{kind:'specialization',name:'Взломщик',group:'practical',dice:'1d6',modifier:2},
  scout:{kind:'specialization',name:'Лазутчик',group:'physical',dice:'1d4',modifier:-1}
}}};
const formula=skillFormula(actor.system.skills.core_stealth);
const available=specializationEntries(actor,'core_stealth');
assert.deepEqual(available.map(x=>x.id),['scout','locksmith']);
assert.equal(selectRollParts(available).length,0);
const single=selectRollParts(available,{'specialization:locksmith':['specialization']});
const both=selectRollParts(available,{'specialization:locksmith':['specialization','specialization'],'specialization:scout':['specialization']});
assert.equal((await computeRollPreview({actor,available,selected:single,formula})).expression,'1d20 + (1d8) + (1) + (1d6 + 2)');
const result=await computeRollPreview({actor,available,selected:both,formula});
assert.equal(result.expression,'1d20 + (1d8) + (1) + (1d4 + -1) + (1d6 + 2)');
assert.equal((result.expression.match(/1d20/g)??[]).length,1);
assert.equal((await prepareRoll({actor,kind:'skill',skillId:'core_stealth',formula,skipDialog:true})).expression,formula);
assert.equal((await prepareRoll({actor,kind:'skill',skillId:'scout',formula:skillFormula(actor.system.skills.scout),skipDialog:true})).expression,'1d20 + (1d4) + (-1)');
const html=renderRollPreparation(available,{formula});
assert.ok(html.includes('FASTNRI.Preroll.specializations'));
assert.ok(html.includes('name="part_0_0"')&&html.includes('name="part_1_0"'));
assert.ok(!html.includes('name="part_0_0" checked'));
const adjusted=structuredClone(actor); adjusted.system.skills.locksmith.modifier=4;
assert.equal(preparedSpecializationEntry(single[0],adjusted).parts[0].value,'1d6 + 4');
assert.equal(actor.system.skills.locksmith.modifier,2);
console.log('PASS: shared skill preroll, multiple cross-group specializations, default off, one d20');
