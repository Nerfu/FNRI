import assert from 'node:assert/strict';
import {configurationControl,applySheetLock} from '../module/sheets/sheet-lock.mjs';
const field=name=>({name,dataset:{},disabled:false});
const action=action=>({dataset:{action},disabled:false});
const current=field('system.hp.current'), max=field('system.hp.max'), roll=action('rollSkill'), skill=action('openSkillEditor'), equip=action('toggleEquipment'), resource=action('adjustResource');
const readonly=field('system.speed');readonly.disabled=true;
const add=action('addSkill'), addSpec=action('addSpecialization'), remove=action('removeSkill');
const editorRemove={dataset:{skillAction:'remove'},disabled:false}, editorAdd={dataset:{skillAction:'addSpecialization'},disabled:false};
const alreadyHidden=action('addSkill');alreadyHidden.hidden=true;
const rows=[current,max,roll,skill,equip,resource,readonly,add,addSpec,remove,editorRemove,editorAdd,alreadyHidden];
const root={querySelectorAll:()=>rows,classList:{toggle(){}}};
applySheetLock(root,true);
assert.equal(current.disabled,false);assert.equal(max.disabled,true);assert.equal(skill.disabled,true);
assert.equal(roll.disabled,false);assert.equal(equip.disabled,false);assert.equal(resource.disabled,false);
for(const control of [add,addSpec,remove,editorRemove,editorAdd]) {assert.equal(control.hidden,true);assert.equal(control.disabled,true);}
assert.notEqual(roll.hidden,true);
applySheetLock(root,false);
for(const control of [add,addSpec,remove,editorRemove,editorAdd]) {assert.equal(control.hidden,false);assert.equal(control.disabled,false);}
assert.equal(alreadyHidden.hidden,true);
assert.equal(max.disabled,false);assert.equal(skill.disabled,false);assert.equal(readonly.disabled,true);
assert.equal(configurationControl({dataset:{rowCollection:'resources',rowField:'current'}}),false);
assert.equal(configurationControl({dataset:{rowCollection:'resources',rowField:'max'}}),true);
assert.equal(configurationControl({name:'system.hp.temp'}),false);
assert.equal(configurationControl({dataset:{action:'createItem',type:'ability'}}),true);
assert.equal(configurationControl({dataset:{action:'createItem',type:'gear'}}),false);
console.log('PASS: sheet lock preserves gameplay and native disabled controls');
