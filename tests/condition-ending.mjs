import assert from 'node:assert/strict';
import {CONDITION_STATUSES,CONDITION_CARD_LINKS} from '../module/effects/condition-statuses.generated.mjs';
import {eligibleForGeneralEnding,effectEndingMode,supportsEndingChoice,hasParticularDuration} from '../module/effects/effect-ending.mjs';
import {settleGeneralEffectEndTurn} from '../module/effects/effect-ending-turn.mjs';
const S='fast-nri-v14';
const messages=new Map();
globalThis.game={user:{id:'gm',isGM:true},system:{id:S},users:{contents:[{id:'gm',isGM:true},{id:'owner'},{id:'other'}]},messages,i18n:{localize:k=>k.split('.').at(-1)}};
globalThis.foundry={applications:{ux:{TextEditor:{async enrichHTML(s){return s;}}}}};
let rolls=[],formulae=[],failChat=false,failDelete=false;
globalThis.Roll=class{constructor(formula){this.formula=formula;}async evaluate(opts){assert.equal(opts.allowInteractive,false);formulae.push(this.formula);assert.ok(rolls.length);this.total=rolls.shift();return this;}toJSON(){return {formula:this.formula,total:this.total};}};
globalThis.ChatMessage={getSpeaker:({actor})=>({alias:actor.name}),async create(data){if(failChat){failChat=false;throw Error('mock chat failure');}messages.set(data._id,{...data,getFlag(s,k){return this.flags?.[s]?.[k];}});}};
const actor={uuid:'Actor.pc',documentName:'Actor',name:'PC',flags:{[S]:{}},testUserPermission:u=>u.id==='owner',effects:{contents:[],get(id){return this.contents.find(e=>e.id===id);}},getFlag(s,k){return this.flags?.[s]?.[k]},async update(patch,opts){assert.equal(opts.fnriJournal.skip,true);for(const [path,value] of Object.entries(patch)){const keys=path.split('.');let obj=this;for(const key of keys.slice(0,-1))obj=obj[key]??={};const key=keys.at(-1);if(key.startsWith('-='))delete obj[key.slice(2)];else obj[key]=structuredClone(value);}},async deleteEmbeddedDocuments(type,ids){assert.equal(type,'ActiveEffect');if(failDelete){failDelete=false;throw Error('mock delete failure');}this.effects.contents=this.effects.contents.filter(e=>!ids.includes(e.id));}};
let seq=0;
function effect(condition,id,extra={}){return {...structuredClone(CONDITION_STATUSES['fnri7-'+condition]??{name:'Custom',flags:{[S]:{}},showIcon:2}),id,parent:actor,_stats:{createdTime:++seq},...extra};}
function add(...effects){actor.effects.contents.push(...effects);}
const flags=(conditionId,extra={})=>({[S]:{conditionId,...extra}});
for(const c of Object.keys(CONDITION_CARD_LINKS))assert.equal(eligibleForGeneralEnding(effect(c,c)),['frightened','slowed','weakened','immobilized'].includes(c),c);
assert.equal(effectEndingMode(effect('slowed','old',{flags:flags('slowed')})),'general');
assert.equal(effectEndingMode(effect('slowed','old',{flags:flags('slowed',{abilityResultMessageId:'old'})})),'');
assert.equal(eligibleForGeneralEnding(effect('slowed','part',{flags:flags('slowed',{effectEnding:'particular'})})),false);
assert.equal(eligibleForGeneralEnding(effect('slowed','time',{duration:{value:2,units:'rounds'}})),false);
assert.equal(hasParticularDuration({duration:{value:Infinity,seconds:Infinity,expiry:null}}),false);
assert.equal(eligibleForGeneralEnding(effect('slowed','event',{duration:{value:null,expiry:'turnEnd'}})),false);
assert.equal(supportsEndingChoice(effect('prone','p')),false);
assert.equal(eligibleForGeneralEnding(effect('unknown','one-use',{flags:flags('unknown',{effectEnding:'general',rollInfluence:{onUse:'remove'}})})),false);
assert.equal(eligibleForGeneralEnding(effect('unknown','u')),false);
assert.equal(eligibleForGeneralEnding(effect('unknown','u',{flags:flags('unknown',{effectEnding:'general'})})),true);
assert.equal(eligibleForGeneralEnding(effect('prone','p',{flags:flags('prone',{effectEnding:'general'})})),false);
const f=effect('frightened','f'),f2=effect('frightened','f2'),s=effect('slowed','s'),w=effect('weakened','w');
const excluded=[effect('grabbed','g'),effect('prone','p'),effect('unconscious','u'),effect('sustained','su'),effect('stunned','st'),effect('slowed','disabled',{disabled:true}),effect('slowed','expired',{duration:{expired:true}}),effect('slowed','suppressed',{isSuppressed:true}),effect('slowed','inherited',{parent:{documentName:'Item'}}),effect('slowed','transfer',{transfer:true}),effect('slowed','timed',{duration:{value:1}}),effect('slowed','special',{flags:flags('slowed',{effectEnding:'particular'})}),effect('slowed','periodic',{flags:flags('slowed',{effectEnding:'general',periodicDamage:{version:1}})})];
add(f,f2,s,w,...excluded);
const combat={id:'combat',started:true},cb={id:'pc',actor};
rolls=[15,14,20,1];
await settleGeneralEffectEndTurn(combat,cb,{round:1,skipped:true});assert.equal(formulae.length,0);
await settleGeneralEffectEndTurn(combat,cb,{round:1});assert.deepEqual(actor.effects.contents,[f2,w,...excluded]);
assert.equal(messages.size,1);let message=[...messages.values()][0];assert.deepEqual(message.whisper,['gm','owner']);assert.equal(message.rolls.length,4);assert.deepEqual(message.rolls.map(r=>r.total),[15,14,20,1]);assert.equal((message.content.match(/Напуган/g)??[]).length,2);assert.ok(message.content.includes(CONDITION_CARD_LINKS.slowed.uuid));assert.ok(!message.content.includes('15)'));assert.deepEqual(formulae,['1d20','1d20','1d20','1d20']);
await settleGeneralEffectEndTurn(combat,cb,{round:1});assert.equal(messages.size,1);assert.equal(rolls.length,0);
// Durable receipt survives a failing report and prevents a second check.
const log=console.error;console.error=()=>{};
try{
  rolls=[15,17];failChat=true;
  await settleGeneralEffectEndTurn(combat,cb,{round:2});assert.deepEqual(actor.effects.contents,excluded);assert.equal(messages.size,1);assert.equal(Object.keys(actor.getFlag(S,'effectEndingPending')).length,1);
  await settleGeneralEffectEndTurn(combat,cb,{round:2});assert.equal(messages.size,2);assert.equal(Object.keys(actor.getFlag(S,'effectEndingPending')).length,0);
  // A stable HUD id can be reused. Recovery never deletes the replacement.
  const original=effect('slowed','hud',{_stats:undefined,flags:flags('slowed',{effectEnding:'general',hudCondition:'fnri7-slowed',effectEndingInstance:'first'})});add(original);rolls=[19];failDelete=true;
  await settleGeneralEffectEndTurn(combat,cb,{round:3});assert.equal(actor.effects.get('hud'),original);assert.equal(messages.size,2);
  await actor.deleteEmbeddedDocuments('ActiveEffect',['hud']);const replacement=effect('slowed','hud',{_stats:undefined,flags:flags('slowed',{effectEnding:'general',hudCondition:'fnri7-slowed',effectEndingInstance:'second'})});add(replacement);
  const {settleGeneralEffectEndTurn:reloaded}=await import('../module/effects/effect-ending-turn.mjs?reload');
  await reloaded(combat,cb,{round:3});assert.equal(actor.effects.get('hud'),replacement);assert.ok([...messages.values()].at(-1).content.includes('manual'));
}finally{console.error=log;}
// Private details are not written into Actor flags, including missing source.
const hidden=effect('frightened','private',{flags:flags('frightened',{effectEnding:'general',abilityResultMessageId:'missing'})});add(hidden);rolls=[12,13];failChat=true;console.error=()=>{};
try{await settleGeneralEffectEndTurn(combat,cb,{round:4});const pending=Object.values(actor.getFlag(S,'effectEndingPending'))[0];assert.equal(pending.gmOnly,true);assert.equal(pending.details,undefined);assert.ok(!JSON.stringify(pending).includes('Напуган'));await settleGeneralEffectEndTurn(combat,cb,{round:4});}finally{console.error=log;}
message=[...messages.values()].at(-1);assert.deepEqual(message.whisper,['gm']);assert.equal(message.rolls.length,2);
assert.equal(rolls.length,0);assert.ok(formulae.every(x=>x==='1d20'));
// Non-GM never runs the native end-turn settlement.
game.user.isGM=false;await settleGeneralEffectEndTurn(combat,cb,{round:5});game.user.isGM=true;
console.log('PASS general effect ending DC15, individual sources, explicit expiry/particular exclusions, native unmodified rolls, linked report, retry and private visibility (mocks)');
