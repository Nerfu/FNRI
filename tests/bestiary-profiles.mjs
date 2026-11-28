import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readGameZip} from '../module/data/game-archive.mjs';
import {abilityExecution,executeAbilityFromChat} from '../module/abilities/ability-chat.mjs';
import {sendWeaponAttack,sendWeaponDamage} from '../module/weapon/weapon-attack.mjs';
import {sendUnarmedAttack} from '../module/rolls/unarmed.mjs';
import {physicalAttackPartsForDegree} from '../module/rolls/attack-core.mjs';
import {parseMagicAttackProfile,magicAttackPartsForDegree} from '../module/rolls/magic-attack-profile.mjs';
import {calculateDamage,damageAtReducedDegree,selfDefenseOutcome} from '../module/damage/damage-core.mjs';
import {renderDamageCard} from '../module/damage/damage-chat.mjs';
import {attackOutcomeForDamageCard} from '../module/equipment/attack-outcomes.mjs';
import {applyAttackOutcomeEffects} from '../module/equipment/attack-outcome-application.mjs';
import {captureSourceTurnExpiry,expireSourceTurnEffects,registerSourceTurnExpiry} from '../module/effects/source-turn-expiry.mjs';

const id = 'fast-nri-v14';
const degrees = ['failure','partial','success','great'];
const physical = {degrees:{failure:'0',partial:'1',success:'2d4',great:'2d4+1'}};
const magic = {failure:'0',partial:'1d4',success:'1d6+1d4',great:'1d6+1d4+2'};
const doc = (relativePath)=>JSON.parse(readFileSync(new URL(relativePath,import.meta.url),'utf8'));
const templates = [
  doc('../packs/_source/conditions/zamedlen--fci06z8101cy2waz.json'),
  doc('../packs/_source/conditions/oslablen--fci2pzwaekhrzrbp.json')
];
let rawActors = ['B1M','B1R'].map((notes,index)=>({
  name:notes,system:{notes,attackModifier:1},
  items:[
    {_id:'a000000000000001',name:notes,type:'weapon',system:{attackKind:index?'ranged':'melee',damageProfile:physical}},
    {_id:'a000000000000002',name:'Unarmed',type:'ability',system:{mechanics:{unarmedAttack:{mode:'replace',damageProfile:physical}}}}
  ]
}));
const execution = {id:'bolt',type:'attack',label:'Bolt',attack:{
  kind:'magic',attackKind:'ranged',spellEnergy:null,spellRange:8,targetDefense:'ac',
  properties:'Заклинание',damageProfile:magic,outcomes:templates.map((template,index)=>({
    kind:'condition',minEffectDegree:index?'great':'success',untilSourceTurnStart:true,
    effectRefs:[{contentId:template.flags[id].contentId,effectId:template.effects[0]._id}]
  }))
}};
rawActors.push({name:'Фея Разлома',system:{attackModifier:3},items:[
  {_id:'a000000000000003',name:'Разряд Разлома',type:'ability',
    system:{tags:'Заклинание',mechanics:{executions:[execution]}}}
]});
if (process.argv[2]) {
  const file = readFileSync(process.argv[2]);
  const entries = await readGameZip(new Uint8Array(file).buffer);
  rawActors = JSON.parse(new TextDecoder().decode(entries.get('game.json').bytes)).documents.Actor;
}

const documents = new Map(), messages = new Map();
const readFlag = function(scope,key){return this.flags?.[scope]?.[key]};
const makeActor = (raw,key)=>{
  const actor = {...raw,uuid:`Actor.${key}`,documentName:'Actor',type:'npc',isOwner:true,
    getRollData:()=>({}),getFlag:readFlag};
  const items = (raw.items??[]).map(row=>({...row,id:row._id,uuid:`${actor.uuid}.Item.${row._id}`,
    documentName:'Item',parent:actor,getFlag:readFlag}));
  for (const item of items) documents.set(item.uuid,item);
  actor.items = {contents:items,get:key=>items.find(item=>item.id===key)};
  documents.set(actor.uuid,actor);
  return actor;
};
globalThis.fromUuid = async uuid=>documents.get(uuid);
globalThis.game = {
  user:{isGM:true,targets:new Set()},messages:{get:key=>messages.get(key),get contents(){return [...messages.values()];}},
  settings:{get:()=> 'gm'},i18n:{localize:key=>key},items:{contents:[]}
};
globalThis.foundry = {applications:{api:{}}};
globalThis.ui = {notifications:{warn:message=>{throw Error(message)}}};
globalThis.ChatMessage = {
  getSpeaker:()=>({}),
  async create(data) {
    const message = {...data,id:`msg${messages.size}`,getFlag:readFlag,isAuthor:true};
    messages.set(message.id,message);
    return message;
  }
};
globalThis.Roll = class {
  static validate(formula){return /^(?:\d+(?:d\d+)?)(?:\s*\+\s*\d+(?:d\d+)?)*$/.test(formula);}
  constructor(formula) {
    this.formula = formula;
    this.dice = [...formula.matchAll(/(\d+)d(\d+)/g)].map(([,number,faces])=>({
      number:Number(number),faces:Number(faces),results:Array.from({length:Number(number)},()=>({
        result:faces==='20'?15:faces==='6'?5:3,active:true
      }))
    }));
    const fixed = formula.split('+').map(term=>Number(term.trim())).filter(Number.isFinite);
    this.total = this.dice.flatMap(die=>die.results.map(result=>result.result)).concat(fixed).reduce((a,b)=>a+b,0);
  }
  async evaluate(){return this;}
  async toMessage(data,{create=true}={}) {
    const message={...data,rolls:[this]};
    return create ? ChatMessage.create(message) : message;
  }
};

for (const note of ['B1M','B1R']) {
  const actor = makeActor(rawActors.find(row=>row.system.notes===note),note);
  const weapon = actor.items.contents.find(item=>item.type==='weapon');
  for (const attack of [await sendWeaponAttack(weapon,actor,{skipPreroll:true}),await sendUnarmedAttack(actor,{skipPreroll:true})]) {
    const profile = attack.getFlag(id,'weaponAttack').profile;
    assert.deepEqual(degrees.map(degree=>physicalAttackPartsForDegree(profile,degree).parts.map(part=>part.formula)),
      [[],['1'],['1d4','1d4'],['1d4','1d4','1']]);
    const result = [];
    for (const degree of degrees.slice(1)) {
      const message = await sendWeaponDamage(attack,degree,{skipPreroll:true});
      result.push(message.getFlag(id,'weaponDamage'));
    }
    assert.deepEqual(result.map(card=>calculateDamage(card).total),[1,6,7]);
    const lower = damageAtReducedDegree(result[1],'partial');
    assert.equal(calculateDamage(lower).total,1);
    assert.deepEqual(selfDefenseOutcome({card:result[0],defenseTotal:20,naturalD20:15}).choices.map(part=>part.value),[1]);
  }
}

const fairy = makeActor(rawActors.find(row=>row.name==='Фея Разлома'),'fairy');
const bolt = fairy.items.contents.find(item=>item.name==='Разряд Разлома');
assert.equal(abilityExecution(bolt,'bolt').attack.spellRange,8);
assert.equal(parseMagicAttackProfile({...magic,great:'1d8+1d2'}).ok,false);
const first = {id:'first',actor:fairy,token:{uuid:'token.one'}};
const second = {id:'second',actor:fairy,token:{uuid:'token.two'}};
fairy.getActiveTokens=()=>[{actor:fairy,document:first.token}];
const combat = {id:'combat',started:true,round:1,turn:0,turns:[first,second]};
Object.defineProperty(combat,'combatant',{get(){return this.turns[this.turn]}});
game.combat = combat;
const target = {uuid:'Actor.target',documentName:'Actor',isOwner:true,
  system:{ac:{partial:5,success:10,great:17}},effects:new Map(),
  async createEmbeddedDocuments(_type,data){
    return data.map(row=>{
      const effect=Object.assign(new CONFIG.ActiveEffect.documentClass(),row,{uuid:`Actor.target.ActiveEffect.${row._id}`,getFlag:readFlag});
      this.effects.set(row._id,effect);
      return effect;
    });
  }
};
const targetToken = {uuid:'token.target',actor:target};
game.user.targets = new Set([targetToken]);
documents.set(targetToken.uuid,targetToken);
const publication = await ChatMessage.create({whisper:['gm'],flags:{[id]:{abilityPublication:{
  version:1,actorUuid:fairy.uuid,itemUuid:bolt.uuid
}}}});
const attack = await executeAbilityFromChat(publication,'bolt',{skipPreroll:true});
const attackCard = attack.getFlag(id,'weaponAttack');
assert.match(attack.rolls[0].formula,/^1d20\s*\+\s*3$/);
assert.equal(attackCard.attackDegree,'great');
assert.deepEqual(attackCard.sourceTurnDegrees,['success','great']);
assert.deepEqual(attack.whisper,['gm']);
assert.deepEqual(degrees.map(degree=>magicAttackPartsForDegree(attackCard.profile,degree).parts.map(part=>part.formula)),
  [[],['1d4'],['1d6','1d4'],['1d6','1d4','2']]);
const result = await sendWeaponDamage(attack,'great',{skipPreroll:true});
const great = result.getFlag(id,'weaponDamage');
assert.deepEqual(great.parts.map(part=>[part.kind,part.value]),[['die',5],['die',3],['fixed',2]]);
assert.equal(calculateDamage(damageAtReducedDegree(great,'partial')).total,3);

for (const template of templates) {
  const item={...template,documentName:'Item',uuid:`Compendium.conditions.${template._id}`};
  const effect=template.effects[0];
  item.effects = new Map([[effect._id,{...effect,parent:item,uuid:`${item.uuid}.ActiveEffect.${effect._id}`,toObject:()=>effect}]]);
  game.items.contents.push(item);
}
class NativeEffect { isExpiryEvent(){return 'native';} }
globalThis.CONFIG = {ActiveEffect:{documentClass:NativeEffect,expiryEvents:{}}};
registerSourceTurnExpiry();
const event = Object.keys(CONFIG.ActiveEffect.expiryEvents)[0];
const defense = selfDefenseOutcome({card:great,defenseTotal:20,naturalD20:15});
assert.equal(defense.effectDegree,'success');
assert.deepEqual(defense.choices.map(part=>part.value),[5]);
assert.equal((await attackOutcomeForDamageCard(result)).applicable.length,2);
const after = await ChatMessage.create({whisper:['gm'],flags:{[id]:{weaponDamage:{
  ...great,isIntervention:true,previousMessageId:result.id,effectDegree:defense.effectDegree,parts:great.parts.map(part=>({...part,excluded:part.value===5}))
}}}});
assert.equal((await attackOutcomeForDamageCard(after)).applicable.length,1);
const effectButtonLabel = 'FASTNRI.Damage.applyEffect';
class Element {
  constructor(){this.children=[];this.dataset={};this.classList={add(){}};}
  append(...children){this.children.push(...children);}
  querySelector(){return null;}
  addEventListener(_event,handler){this.click=handler;}
  find(text){return this.textContent===text?this:this.children.map(child=>child.find(text)).find(Boolean);}
}
globalThis.document={createElement:()=>new Element()};
let information=[];
ui.notifications.info=text=>information.push(text);
const previousHtml=new Element();
renderDamageCard(result,previousHtml);
await previousHtml.find(effectButtonLabel).click();
assert.deepEqual(information,['FASTNRI.Damage.latestEffectResult']);
assert.equal(target.effects.size,0);
game.user.isGM=false;
const playerHtml=new Element();
renderDamageCard(after,playerHtml);
assert.equal(playerHtml.find(effectButtonLabel),undefined);
game.user.isGM=true;
const afterHtml=new Element();
renderDamageCard(after,afterHtml);
await afterHtml.find(effectButtonLabel).click();
assert.equal(target.effects.size,1);
assert.equal((await applyAttackOutcomeEffects(after,{target,index:0})).alreadyAppliedCount,1);
assert.equal((await applyAttackOutcomeEffects(after,{target,index:1})).appliedCount,0);

const firstEffect = [...target.effects.values()][0];
assert.equal(firstEffect.duration.expiry,event);
assert.equal(firstEffect.getFlag(id,'effectEnding'),'particular');
const secondExpiry = captureSourceTurnExpiry(fairy,combat,{uuid:second.token.uuid});
const secondEffect = Object.assign(new CONFIG.ActiveEffect.documentClass(),firstEffect,{
  flags:{[id]:{sourceTurnExpiry:secondExpiry}}
});
foundry.documents={ActiveEffect:{registry:{async refresh(eventName,context){
  for(const effect of [firstEffect,secondEffect]) {
    if(effect.isExpiryEvent(eventName,context))effect.expired=true;
  }
}}}};
combat.turn=1;
await expireSourceTurnEffects(combat,second,{});
assert.equal(firstEffect.expired,undefined);
assert.equal(secondEffect.expired,true);
combat.round=2;
combat.turn=0;
await expireSourceTurnEffects(combat,first,{skipped:true});
assert.equal(firstEffect.expired,undefined);
await expireSourceTurnEffects(combat,first,{});
assert.equal(firstEffect.expired,true);
assert.equal((await applyAttackOutcomeEffects(after,{target,index:0})).reason,'source-turn-unavailable');
console.log('PASS D.3: B1M/B1R weapons and unarmed, Fairy attack, self-defense, conditions and independent source turns');
