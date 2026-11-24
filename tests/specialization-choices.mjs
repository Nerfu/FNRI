import assert from 'node:assert/strict';
import {specializationChoices, skillGroupForRow} from '../module/data/specializations.mjs';
const skills = {
  core_stealth: {kind:'skill',name:'Скрытность',dice:'1d8'},
  locksmith: {kind:'specialization',name:'Взломщик',group:'practical',dice:'1d6'},
  scout: {kind:'specialization',name:'Лазутчик',group:'physical',dice:'1d4'},
  hunter: {kind:'specialization',name:'Охотник',group:'field',dice:'1d6'},
  unnamed: {kind:'specialization',name:'',group:'physical',dice:'1d4'},
  extra: {kind:'skill',name:'Особый навык',dice:'1d6'}
};
assert.equal(skillGroupForRow('core_stealth',skills.core_stealth),'physical');
assert.deepEqual(specializationChoices(skills,'core_stealth').map(x=>x.id),['scout','locksmith','hunter']);
assert.deepEqual(specializationChoices(skills,'core_medicine').map(x=>x.id),['locksmith','scout','hunter']);
assert.deepEqual(specializationChoices(skills,'extra').map(x=>x.id),['locksmith','scout','hunter']);
assert.deepEqual(specializationChoices(skills,'scout').map(x=>x.id),['locksmith','hunter']);
assert.deepEqual(specializationChoices({},'core_stealth'),[]);
console.log('PASS: specialization choices across all groups');
