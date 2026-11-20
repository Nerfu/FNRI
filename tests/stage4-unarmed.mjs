import assert from 'node:assert/strict';
import { BASE_UNARMED_ATTACK } from '../module/data/core-actions.mjs';
import { resolveUnarmedAction,unarmedExpression,sendUnarmedAttack } from '../module/rolls/unarmed.mjs';
import { damageFormulaForDegree } from '../module/weapon/weapon-attack.mjs';
assert.deepEqual(BASE_UNARMED_ATTACK.damageProfile,{A:'1d4',B:'1d4',C:1});
assert.equal(damageFormulaForDegree(BASE_UNARMED_ATTACK.damageProfile,'partial').formula,'1d4');
assert.equal(damageFormulaForDegree(BASE_UNARMED_ATTACK.damageProfile,'success').formula,'1d4 + 1d4');
assert.equal(damageFormulaForDegree(BASE_UNARMED_ATTACK.damageProfile,'great').formula,'1d4 + 1d4 + 1');
const actor={type:'character',name:'Герой',system:{combatDie:'d10',equipment:{leftHand:'weapon',rightHand:'dagger'},equipmentSlots:{}},
  items:{contents:[]},getRollData(){return {}}};
assert.equal(unarmedExpression(actor).expression,'1d20 + 1d10');
assert.equal(resolveUnarmedAction(actor).name,'Безоружная атака');
const npc={...actor,type:'npc',system:{attackModifier:-2},items:{contents:[]}};
assert.equal(unarmedExpression(npc).expression,'1d20 - 2');
const mod={id:'power',name:'Замена',type:'ability',uuid:'Actor.X.Item.power',system:{mechanics:{unarmedAttack:{mode:'replace',
  damageProfile:{A:'1d6',B:'1d10',C:3},name:'Усиленная безоружная атака'}}}};
actor.items.contents.push(mod);
assert.equal(resolveUnarmedAction(actor).damageProfile.C,3);
actor.items.contents.push({...mod,id:'other'});
assert.equal(resolveUnarmedAction(actor).hasChoices,true,'two replacements can be selected');
assert.equal(resolveUnarmedAction(actor).selectedKey,'base','multiple replacements do not force an arbitrary priority');
actor.items.contents.pop();
const messages=[];let d20=12;
class RollMock{
  static validate(f){return !!f;}
  constructor(formula){this.formula=formula;this.total=18;this.dice=[{faces:20,number:1,results:[{result:d20}]}];}
  async evaluate(){return this;}
  async toMessage(obj){messages.push(obj);return obj;}
}
globalThis.Roll=RollMock;
globalThis.ChatMessage={getSpeaker({actor}={}){return actor?{alias:'Герой'}:{};}};
globalThis.game={user:{targets:new Set()},settings:{get(){return 'public'}},i18n:{localize:x=>x}};
const attack=await sendUnarmedAttack(actor);
assert.equal(attack.flags['fast-nri-v14'].weaponAttack.sourceKind,'unarmed');
assert.equal(attack.flags['fast-nri-v14'].weaponAttack.profile.C,3);
assert.equal(attack.flags['fast-nri-v14'].weaponAttack.suggestedDegree,null);
const guard={name:'Стражник',actor:{system:{ac:{partial:8,success:15,great:21}}}};
game.user.targets=new Set([guard]);
const withTarget=await sendUnarmedAttack(actor);
assert.equal(withTarget.flags['fast-nri-v14'].weaponAttack.suggestedDegree,'success');
assert.equal(messages.length,2);
const vanilla={...actor,items:{contents:[]}};
const base=await sendUnarmedAttack(vanilla);
assert.equal(base.flags['fast-nri-v14'].weaponAttack.profile.C,1);
console.log('PASS: always-available unarmed, card-based override, NPC modifier, target highlight, no target');
