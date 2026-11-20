import assert from 'node:assert/strict';
import {applyHp,applyCardDamage,revertHpReport} from '../module/damage/hp-actions.mjs';
const ID='fast-nri-v14',messages=[];let seq=0;
const actor={uuid:'Actor.x',name:'Воин',isOwner:true,system:{hp:{current:20,max:25,temp:5}},
  canUserModify(){return true;},async update(patch){for(const [k,v] of Object.entries(patch)){
    const key=k.split('.').at(-1);this.system.hp[key]=v;}return this;}};
const token={name:'Токен',actor,document:{uuid:'Scene.x.Token.y'}};
const source={id:'attack-damage',getFlag(scope,key){if(scope===ID&&key==='weaponDamage')return this.card;},
  card:{version:2,revision:0,parts:[{id:'A',kind:'die',value:7,original:7,excluded:false},
    {id:'C',kind:'fixed',value:5,original:5,excluded:false}],naturalD20:12,adjustments:{}}};
function makeMsg(obj) {const m={id:`msg${++seq}`,isAuthor:true,flags:obj.flags??{},...obj,
  getFlag(scope,key){return this.flags?.[scope]?.[key];},
  async update(patch){for(const [path,v] of Object.entries(patch)){
    const keys=path.split('.');let ptr=this;for(const k of keys.slice(0,-1))ptr=ptr[k]??={};ptr[keys.at(-1)]=v;
  }return this;}};messages.push(m);return m;}
const lookups={'Scene.x.Token.y':{actor},'Actor.x':actor};
globalThis.fromUuid=async uuid=>lookups[uuid];
globalThis.canvas={tokens:{controlled:[token]}};
globalThis.ui={notifications:{warn(){},error(s){throw Error('unexpected notification '+s)}}};
globalThis.foundry={applications:{api:{DialogV2:{confirm:async()=>true}}}};
globalThis.game={user:{id:'gm',isGM:true},messages:{contents:messages,get:id=>messages.find(m=>m.id===id)},
  i18n:{localize:x=>x}};
globalThis.ChatMessage={getSpeaker(){return {actor:'x'}},async create(data){return makeMsg(data)}};
const report=await applyCardDamage(source);
assert.equal(report.getFlag(ID,'hpReport').requested,12);
assert.equal(actor.system.hp.current,13);
assert.equal(actor.system.hp.temp,0);
assert.equal(report.getFlag(ID,'hpReport').actual,12);
assert.equal(await revertHpReport(report),true);
assert.equal(actor.system.hp.current,20);
assert.equal(actor.system.hp.temp,5);
assert.equal(report.getFlag(ID,'hpReport').reverted,true);
assert.equal(await revertHpReport(report),null,'idempotent undo');
const healed=await applyHp({kind:'heal',amount:20,token});
assert.equal(healed.getFlag(ID,'hpReport').actual,5);
assert.equal(actor.system.hp.current,25);
const temporary=await applyHp({kind:'temp',amount:3,token});
assert.equal(temporary.getFlag(ID,'hpReport').actual,0);
const temp=await applyHp({kind:'temp',amount:8,token});
assert.equal(temp.getFlag(ID,'hpReport').actual,3);
assert.equal(actor.system.hp.temp,8);
actor.system.hp.temp=7; // another action occurred after the application
await revertHpReport(temp);
assert.equal(actor.system.hp.temp,4,'reverse the delta, not stale before snapshot');
assert.equal(temp.getFlag(ID,'hpReport').reverted,true);
console.log('PASS stage 5 HP: selected actor, saved deltas, heal/temp, changes after application, single-use reversal');
