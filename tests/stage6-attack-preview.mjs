import assert from 'node:assert/strict';
import {compactPhysicalProfile,attackCardDetails} from '../module/sheets/attack-preview.mjs';
import {resolveUnarmedAction} from '../module/rolls/unarmed.mjs';

assert.equal(compactPhysicalProfile({A:'1d10',B:'1d10',C:4}),'1d10/1d10/+4');
assert.equal(compactPhysicalProfile({A:'1d4',B:'1d4',C:1}),'1d4/1d4/+1');
assert.equal(compactPhysicalProfile({A:'2d6',B:'1d6',C:3}),'','no guess for non-standard profile');
assert.equal(attackCardDetails({distance:'Ближняя',properties:'Рубящее'}),'Ближняя · Рубящее');
assert.equal(attackCardDetails({distance:'',range:12,properties:'Точное',rangeLabel:'Дистанция'}),'Дистанция: 12 · Точное');
assert.equal(attackCardDetails({properties:'Воздействие, Атака'}),'Воздействие, Атака');

const items=[{id:'claws',name:'Когти',type:'ability',system:{mechanics:{unarmedAttack:{mode:'option',active:true,
  damageProfile:{A:'1d8',B:'1d6',C:5},properties:'Ближняя, рубящая'}}}}];
const actor={type:'npc',system:{equipment:{leftHand:'',rightHand:'',armor:''},equipmentSlots:{}},items:{contents:items},
  getFlag(scope,key){return key==='selectedUnarmedAttack'?'item:claws':null}};
const choice=resolveUnarmedAction(actor);
assert.equal(compactPhysicalProfile(choice.damageProfile),'1d8/1d6/+5',
  'selected unarmed variant must control the displayed profile');
assert.equal(choice.properties,'Ближняя, рубящая');
assert.equal(resolveUnarmedAction(actor,'base').name,'Безоружная атака');
console.log('PASS: compact attack preview is card-derived and respects active unarmed choice');
