import assert from 'node:assert/strict';
import {
  sendWeaponAttack,sendWeaponDamage,selectedTargetSnapshot,naturalAttackingD20,
  registerWeaponChatControls
} from '../module/weapon/weapon-attack.mjs';
const item={id:'xyz',name:'Меч',type:'weapon',uuid:'Actor.abc.Item.xyz',system:{attackKind:'melee',damageProfile:{A:'1d10',B:'1d4',C:4},proficiencyMode:'yes',damageType:'физический'}};
const actor={documentName:'Actor',system:{className:'Воин',combatDie:'d10'},getRollData(){return {}}};
const messages=[];let nextD20=12;let nextTotal=19;
class RollMock {
  static validate(formula){return formula.length>0;}
  constructor(formula){this.formula=formula;this.dice=[...formula.matchAll(/(\d+)d(\d+)/g)].map(([,count,faces])=>({faces:Number(faces),number:Number(count),results:Array.from({length:Number(count)},()=>({result:Number(faces)===20?nextD20:Number(faces)===10?7:3,active:true}))}));this.total=nextTotal;}
  async evaluate(){return this;}
  async toMessage(data,opts){
    const message={id:'msg'+(messages.length+1),isAuthor:true,speaker:data.speaker,
      flags:data.flags,whisper:data.whisper??[],blind:data.blind??false,opts,formula:this.formula,
      getFlag(scope,key){return this.flags?.[scope]?.[key]}};
    messages.push(message);return message;
  }
}
globalThis.Roll=RollMock;
globalThis.ChatMessage={getSpeaker({actor}={}){return actor?{actor:'abc'}:{alias:'World'}}};
globalThis.game={user:{isGM:false,targets:new Set()},settings:{get(){return 'public'}},i18n:{localize(x){return x}}};
const guard={actor:{system:{ac:{partial:10,success:18,great:22}}},name:'Guard'};
game.user.targets=new Set([guard]);
let attack=await sendWeaponAttack(item,actor);
let data=attack.getFlag('fast-nri-v14','weaponAttack');
assert.equal(attack.formula,'1d20 + 1d10');
assert.equal(data.attackDegree,'success');
assert.equal(data.suggestedDegree,'success');
assert.equal(data.targetName,'Guard');
assert.equal(data.ac,undefined,'AC is not leaked via chat flags');
assert.equal(data.profile.C,4);
const first=await sendWeaponDamage(attack,'partial');
const second=await sendWeaponDamage(attack,'success');
const third=await sendWeaponDamage(attack,'great');
assert.equal(first.formula,'1d10');
assert.equal(second.formula,'1d10 + 1d4');
assert.equal(third.formula,'1d10 + 1d4 + 4');
assert.equal(third.getFlag('fast-nri-v14','weaponDamage').naturalTwenty,false);
assert.deepEqual(third.getFlag('fast-nri-v14','weaponDamage').parts.map(x=>x.value),[7,3,4]);
assert.equal(messages.length,4);
nextD20=1;nextTotal=99;
attack=await sendWeaponAttack(item,actor);
assert.equal(attack.getFlag('fast-nri-v14','weaponAttack').attackDegree,'failure');
assert.equal(attack.getFlag('fast-nri-v14','weaponAttack').suggestedDegree,null);
nextD20=20;nextTotal=25;
attack=await sendWeaponAttack(item,actor);
assert.equal(attack.getFlag('fast-nri-v14','weaponAttack').attackDegree,'great');
assert.equal(attack.getFlag('fast-nri-v14','weaponAttack').naturalTwenty,true);
const critical=await sendWeaponDamage(attack,'great');
assert.equal(critical.formula,'1d10 + 1d4 + 4','critical 20 is post-defense, not doubled here');
nextD20=12;nextTotal=19;
game.user.targets=new Set();
attack=await sendWeaponAttack(item,actor);
assert.equal(attack.getFlag('fast-nri-v14','weaponAttack').suggestedDegree,null);
assert.equal(attack.getFlag('fast-nri-v14','weaponAttack').targetStatus,'none');
game.user.targets=new Set([guard,{...guard,name:'Guard2'}]);
attack=await sendWeaponAttack(item,actor);
assert.equal(attack.getFlag('fast-nri-v14','weaponAttack').targetStatus,'multiple');
assert.equal(attack.getFlag('fast-nri-v14','weaponAttack').suggestedDegree,null);
game.user.targets=new Set([{actor:{system:{ac:{partial:10}}},name:'Incomplete'}]);
assert.equal(selectedTargetSnapshot(game.user.targets).status,'missingAC');
assert.equal(naturalAttackingD20({dice:[{faces:20,number:2,results:[{result:20}]}]}),null);
item.system.mechanics={attack:{criticalThreshold:19,criticalMultiplier:3}};
nextD20=19;nextTotal=24;
game.user.targets=new Set([guard]);
const thresholdAttack=await sendWeaponAttack(item,actor);
assert.equal(thresholdAttack.getFlag('fast-nri-v14','weaponAttack').criticalThreshold,19);
const thresholdDamage=await sendWeaponDamage(thresholdAttack,'success');
assert.equal(thresholdDamage.getFlag('fast-nri-v14','weaponDamage').criticalTriggered,true);
assert.equal(thresholdDamage.getFlag('fast-nri-v14','weaponDamage').naturalCritMultiplier,3);
delete item.system.mechanics;
nextD20=12;nextTotal=19;

// A tiny DOM shim validates the v14 HTML hook generates three *unblocked* buttons.
const listeners={};
class MiniNode{
  constructor(tag){this.tagName=tag;this.dataset={};this.children=[];this.className='';this.textContent='';this.attrs={};this.list=new Set();this.classList={add:x=>this.list.add(x),contains:x=>this.list.has(x)};}
  append(...nodes){this.children.push(...nodes)}
  querySelector(sel){return sel==='.message-content'?this:null}
  addEventListener(type,fn){this.listeners??={};this.listeners[type]=fn;}
}
globalThis.document={createElement:tag=>new MiniNode(tag)};
globalThis.Hooks={on(name,callback){listeners[name]=callback;}};
globalThis.ui={notifications:{warn(){throw Error('unexpected damage warning')}}};
registerWeaponChatControls();
const root=new MiniNode('div');
const inputMessage=messages[0];
listeners.renderChatMessageHTML(inputMessage,root);
const container=root.children[0],buttons=container.children[1].children;
assert.equal(buttons.length,3);
assert.equal(buttons.filter(x=>x.classList.contains('fnri-weapon-suggested')).length,1);
assert.equal(buttons[1].classList.contains('fnri-weapon-suggested'),true);
assert.equal(buttons.every(x=>!('disabled' in x)),true);
await buttons[2].listeners.click();
assert.equal(messages.at(-1).formula,'1d10 + 1d4 + 4');
inputMessage.flags['fast-nri-v14'].rollEdit={currentTotal:31};
const correctedDamage=await sendWeaponDamage(inputMessage,'partial');
assert.equal(correctedDamage.getFlag('fast-nri-v14','weaponDamage').attackTotal,31,
  'new damage card uses corrected attack result without touching original');
console.log('PASS: native weapon attack with/without target, 3 unblocked chat damage buttons, no AC leak');
