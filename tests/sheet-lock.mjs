import assert from 'node:assert/strict';
import {configurationControl,applySheetLock} from '../module/sheets/sheet-lock.mjs';
const field=name=>({name,dataset:{},disabled:false});
const action=action=>({dataset:{action},disabled:false});
const current=field('system.hp.current'), max=field('system.hp.max'), roll=action('rollSkill'), skill=action('resetSkillDice'), equip=action('toggleEquipment'), resource=action('adjustResource');
const readonly=field('system.speed');readonly.disabled=true;
const add=action('addSkill'), addSpec=action('addSpecialization'), remove=action('removeSkill');
const editorRemove={dataset:{skillAction:'remove'},disabled:false}, editorAdd={dataset:{skillAction:'addSpecialization'},disabled:false};
const alreadyHidden=action('addSkill');alreadyHidden.hidden=true;
const allocationSections=Array.from({length:3},()=>({dataset:{fnriLockSection:''},hidden:false}));
const previouslyHiddenSection={dataset:{fnriLockSection:''},hidden:true};
const assignedDie={dataset:{skillDie:'stealth'},disabled:false,hidden:false};
const rows=[current,max,roll,skill,equip,resource,readonly,add,addSpec,remove,editorRemove,editorAdd,alreadyHidden,...allocationSections,previouslyHiddenSection,assignedDie];
const root={querySelectorAll:()=>rows,classList:{toggle(){}}};
applySheetLock(root,true);
assert.equal(current.disabled,false);assert.equal(max.disabled,true);assert.equal(skill.disabled,true);
assert.equal(roll.disabled,false);assert.equal(equip.disabled,false);assert.equal(resource.disabled,false);
for(const control of [add,addSpec,remove,editorRemove,editorAdd]) {assert.equal(control.hidden,true);assert.equal(control.disabled,true);}
assert.notEqual(roll.hidden,true);
for(const section of allocationSections) {assert.equal(section.hidden,true);assert.equal('disabled' in section,false);}
assert.equal(assignedDie.hidden,false);assert.equal(assignedDie.disabled,true);
applySheetLock(root,false);
for(const control of [add,addSpec,remove,editorRemove,editorAdd]) {assert.equal(control.hidden,false);assert.equal(control.disabled,false);}
assert.equal(alreadyHidden.hidden,true);
for(const section of allocationSections) assert.equal(section.hidden,false);
assert.equal(previouslyHiddenSection.hidden,true);
assert.equal(assignedDie.disabled,false);
assert.equal(max.disabled,false);assert.equal(skill.disabled,false);assert.equal(readonly.disabled,true);
assert.equal(configurationControl({dataset:{rowCollection:'resources',rowField:'current'}}),false);
assert.equal(configurationControl({dataset:{rowCollection:'resources',rowField:'max'}}),true);
assert.equal(configurationControl({name:'system.hp.temp'}),false);
assert.equal(configurationControl({dataset:{action:'createItem',type:'ability'}}),true);
assert.equal(configurationControl({dataset:{action:'createItem',type:'gear'}}),false);
// Final B audit: classify configuration vs gameplay for both actor sheets.
const configFields=['name','system.level','system.rank','system.role','system.weight','system.hp.max','system.speed','system.combatDie','system.attackModifier','system.ac.partial','system.ac.success','system.ac.great','system.defenses.awareness','system.defenses.reflex','system.defenses.fortitude','system.defenses.will','system.description','system.potionsBaseMax'];
const liveFields=['system.hp.current','system.hp.temp','system.potionsUsed','system.wealth','system.notes'];
const configActions=['chooseIdentity','chooseTradition','editRacialProperties','changeRacialSubproperty','addResource','removeResource','addEquipmentSlot','removeEquipmentSlot'];
const liveActions=['rollSkill','rollAbility','declareSheetAction','restActor','toggleEquipment','useInventoryItem','openItem','createEffect','editEffect','toggleEffect','deleteEffect','chooseActorSide','openProjectionOwner','toggleProjectionFull'];
const inventoryCreate={dataset:{action:'createItem',type:'weapon'},disabled:false};
const inventoryDelete={...action('deleteItem'),closest:()=>null};
const abilityDelete={...action('deleteItem'),closest:()=>({})};
const slotField=key=>({dataset:{rowCollection:'equipmentSlots',rowField:key},disabled:false});
const config=[...configFields.map(field),...configActions.map(action),abilityDelete,slotField('name')];
const live=[...liveFields.map(field),...liveActions.map(action),inventoryCreate,inventoryDelete,slotField('itemId')];
for(const c of config) assert.equal(configurationControl(c),true,JSON.stringify(c));
for(const c of live) assert.equal(configurationControl(c),false,JSON.stringify(c));
const auditRoot={querySelectorAll:()=>[...config,...live],classList:{toggle(){}}};
for(const locked of [true,false,true,false]) {
  applySheetLock(auditRoot,locked);
  for(const c of config) assert.equal(c.disabled,locked,JSON.stringify(c));
  for(const c of live) assert.equal(c.disabled,false,JSON.stringify(c));
}
console.log('PASS: sheet lock preserves gameplay and native disabled controls');
