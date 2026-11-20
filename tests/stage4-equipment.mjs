import assert from 'node:assert/strict';
import {equipmentKind,itemGrip,itemSlot,planEquipmentChange,hasFreeSecondHand}
  from '../module/equipment/equipment.mjs';
import {isPhysicalOtherItemAttack} from '../module/weapon/weapon-attack.mjs';
const make=(id,type='weapon',grip='1',more={})=>({id,type,system:{grip,...more}});
const sword=make('sword'), dagger=make('dagger'), axe=make('axe');
const great=make('great','weapon','2'), bow=make('bow','weapon','1+');
const armor=make('armor','armor'), shield=make('shield','gear','1',{category:'Щит'});
const ring=make('ring','gear','1',{category:'Кольцо'});
const bomb=make('bomb','gear','1',{mechanics:{attack:{kind:'physical',damageProfile:{A:'1d4',B:'1d4',C:1},rollFormula:'1d20'}}});
const ability=make('ability','ability');
const sys={equipment:{leftHand:'',rightHand:'',armor:''},equipmentWear:{sequence:0,leftHand:0,rightHand:0},equipmentSlots:{}};
function apply(updates){
  const next=structuredClone(sys);
  for (const [path,value] of Object.entries(updates)) {
    const parts=path.split('.').slice(1);let target=next;
    while (parts.length>1) target=target[parts.shift()] ??= {};
    target[parts[0]]=value;
  }
  Object.assign(sys,next);
}
function equip(item,on=true) {const planned=planEquipmentChange(sys,item,on);assert.equal(planned.ok,true,planned.reason);apply(planned.updates);return planned;}
assert.equal(equipmentKind(ability),null);
assert.equal(equipmentKind(shield),'hand');
assert.equal(itemGrip(bow),'1+');
equip(sword);assert.equal(sys.equipment.leftHand,'sword');
equip(dagger);assert.equal(sys.equipment.rightHand,'dagger');
equip(axe);assert.equal(sys.equipment.leftHand,'axe','oldest hand replaced');
assert.equal(sys.equipment.rightHand,'dagger');
equip(sword);assert.equal(sys.equipment.rightHand,'sword','now right hand was older');
equip(great);assert.equal(sys.equipment.leftHand,'great');assert.equal(sys.equipment.rightHand,'great');
assert.deepEqual(itemSlot('great',sys).positions,['leftHand','rightHand']);
equip(bow);assert.equal(sys.equipment.leftHand,'bow');assert.equal(sys.equipment.rightHand,'');
assert.equal(hasFreeSecondHand(sys,'leftHand'),true);
equip(shield);assert.equal(hasFreeSecondHand(sys,'leftHand'),false);
equip(shield,false);assert.equal(sys.equipment.rightHand,'');
equip(great);equip(great,false);assert.equal(sys.equipment.leftHand,'');assert.equal(sys.equipment.rightHand,'');
equip(armor);assert.equal(sys.equipment.armor,'armor');
equip(ring);assert.equal(itemSlot('ring',sys).kind,'other');assert.equal(sys.equipment.leftHand,'');
assert.equal(Object.keys(sys.equipmentSlots).length,1);
equip(ring,false);assert.equal(itemSlot('ring',sys),null);
assert.equal(Object.keys(sys.equipmentSlots).length,1,'custom slot record survives');
equip(bomb);assert.equal(itemSlot('bomb',sys).kind,'other');assert.equal(isPhysicalOtherItemAttack(bomb),true);
assert.equal(isPhysicalOtherItemAttack(ring),false);
assert.equal(planEquipmentChange(sys,ability).ok,false);
assert.equal(planEquipmentChange(sys,{id:'invalid.dot',type:'gear'}).ok,false);
assert.equal(itemSlot('missing',sys),null);
assert.equal(sys.equipmentWear.sequence>0,true,'wear age persisted');
console.log('PASS: automatic hand order, two hands, 1+, shield, armor, other items, unequip, no item mutation');
