import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {readTempHpState,planManualTempHpEdit,tempHpStateUpdate} from '../module/damage/temporary-hp-layers.mjs';
import {applyHp,applyCardDamage,revertHpReport,actorForToken} from '../module/damage/hp-actions.mjs';
const ID='fast-nri-v14',messages=[];let seq=0;
const actor={documentName:'Actor',type:'npc',uuid:'Actor.x',name:'Воин',isOwner:true,system:{hp:{current:20,max:25,temp:5}},flags:{},effects:{contents:[]},
  getFlag(scope,key){return this.flags[scope]?.[key];},canUserModify(){return true;},async update(patch){for(const [k,v] of Object.entries(patch)){
    const keys=k.split('.');let target=this;for(const key of keys.slice(0,-1))target=target[key]??={};const last=keys.at(-1);if(last.startsWith('-='))delete target[last.slice(2)];else target[last]=structuredClone(v);}return this;}};
const token={name:'Токен',actor,document:{uuid:'Scene.x.Token.y'}};
const source={id:'attack-damage',getFlag(scope,key){if(scope===ID&&key==='weaponDamage')return this.card;},
  card:{version:2,revision:0,parts:[{id:'A',kind:'die',value:7,original:7,excluded:false},
    {id:'C',kind:'fixed',value:5,original:5,excluded:false}],naturalD20:12,adjustments:{}}};
messages.push(source);
function makeMsg(obj) {const m={id:`msg${++seq}`,isAuthor:true,flags:obj.flags??{},...obj,
  getFlag(scope,key){return this.flags?.[scope]?.[key];},
  async update(patch){for(const [path,v] of Object.entries(patch)){
    const keys=path.split('.');let ptr=this;for(const k of keys.slice(0,-1))ptr=ptr[k]??={};ptr[keys.at(-1)]=v;
  }return this;}};messages.push(m);return m;}
const lookups={'Scene.x.Token.y':{actor},'Actor.x':actor};
globalThis.fromUuid=async uuid=>lookups[uuid];
globalThis.canvas={tokens:{controlled:[token]}};
globalThis.ui={notifications:{warn(){},error(s){throw Error('unexpected notification '+s)}}};
let confirmationCalls=0;globalThis.foundry={utils:{equals:isDeepStrictEqual,randomID:()=>`layer${++seq}`},applications:{api:{DialogV2:{confirm:async()=>{confirmationCalls++;return true;}}}}};
let currentMessageMode='public',appliedModes=0;
globalThis.game={user:{id:'gm',isGM:true},messages:{contents:messages,get:id=>messages.find(m=>m.id===id)},
  settings:{get:(scope,key)=>{assert.equal(scope,'core');assert.equal(key,'messageMode');return currentMessageMode;}},
  i18n:{localize:x=>x}};
globalThis.ChatMessage={
  getSpeaker(){return {actor:'x'}},
  applyMode(data,mode) {
    assert.equal(mode,undefined,'use the initiating client current mode');
    appliedModes++;
    const selected=game.settings.get('core','messageMode');
    // Return a new object to ensure the production call uses the returned value.
    return {...data,
      whisper:selected==='self' ? [game.user.id] : ['gm','blind'].includes(selected) ? ['gm-user'] : [],
      blind:selected==='blind'};
  },
  async create(data){return makeMsg(data)}
};
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
// Reapplying the same card must never prompt. Both reports have independent undo.
const again=await applyCardDamage(source);
const twice=await applyCardDamage(source);
assert.equal(confirmationCalls,0,'no repeat-damage confirmation');
assert.equal(again.getFlag(ID,'hpReport').requested,12);
assert.equal(twice.getFlag(ID,'hpReport').requested,12);
assert.equal(actor.system.hp.current,1);
assert.equal(await revertHpReport(twice),true);
assert.equal(await revertHpReport(again),true);
assert.equal(actor.system.hp.current,20);
assert.equal(actor.system.hp.temp,5);
const criticalReport=await applyCardDamage(source,{critical:true});
assert.equal(criticalReport.getFlag(ID,'hpReport').requested,24);
assert.equal(criticalReport.getFlag(ID,'hpReport').critical,true);
assert.equal(criticalReport.getFlag(ID,'hpReport').multiplier,2);
assert.equal(actor.system.hp.current,1);
assert.equal(await revertHpReport(criticalReport),true);
assert.equal(actor.system.hp.current,20);
assert.equal(actor.system.hp.temp,5);

const healed=await applyHp({kind:'heal',amount:20,token});
assert.equal(healed.getFlag(ID,'hpReport').actual,5);
assert.equal(actor.system.hp.current,25);
const temporary=await applyHp({kind:'temp',amount:3,token});
assert.equal(temporary.getFlag(ID,'hpReport').actual,0);
const temp=await applyHp({kind:'temp',amount:8,token});
assert.equal(temp.getFlag(ID,'hpReport').actual,3);
assert.equal(actor.system.hp.temp,8);
assert.equal(await revertHpReport(temp),true,'clean layer undo restores the prior sources');
assert.equal(actor.system.hp.temp,5);
const later=await applyHp({kind:'temp',amount:8,token});
// Manual HP edit is a layer-aware operation in 0.1.16, not a direct stale scalar assignment.
const manual=planManualTempHpEdit(readTempHpState(actor),7);
await actor.update({'system.hp.temp':7,...tempHpStateUpdate(actor,manual)});
assert.equal(await revertHpReport(later),null,'changed layer receipts require manual correction rather than unsafe undo');
assert.equal(actor.system.hp.temp,7);
assert.equal(later.getFlag(ID,'hpReport').reverted,false);
console.log('PASS stage 5 HP: selected actor, saved deltas, heal/temp, changes after application, single-use reversal');

// Regression: a GM must not be accused of lacking permissions when a Token
// placeable has no direct Actor but its TokenDocument does.
const documentActorOnly={name:'Существо со связью через TokenDocument',actor:null,document:{uuid:'Scene.x.Token.z',actor}};
assert.equal(actorForToken(documentActorOnly),actor);
const newReport=await applyHp({kind:'damage',amount:1,token:documentActorOnly});
assert.ok(newReport?.getFlag(ID,'hpReport'),'GM can apply damage to TokenDocument Actor');
assert.equal(actor.system.hp.current,25);
assert.equal(actor.system.hp.temp,6);
// A selected Token without ANY Actor must produce a distinct diagnostic, not
// an incorrect permission error. There must be no HP write.
let notified='';const originalError=ui.notifications.error;
ui.notifications.error=(text)=>{notified=text;};
try{
  const noActorToken={name:'Токен без Actor',actor:null,document:{uuid:'Scene.x.Token.empty',actor:null,actorId:null}};
  assert.equal(await applyHp({kind:'damage',amount:10,token:noActorToken}),null);
  assert.equal(notified,'FASTNRI.Damage.missingTokenActor');
  assert.equal(actor.system.hp.current,25);
assert.equal(actor.system.hp.temp,6);
}finally {ui.notifications.error=originalError;}
console.log('PASS GM HP target: TokenDocument Actor fallback and honest missing Actor diagnostic');

// HP report with a source inherits exactly the source visibility, regardless
// of the initiating client's current mode. Source-less reports use that mode.
currentMessageMode='blind';
const beforeDerived=appliedModes;
for (const [mode,whisper,blind] of [
  ['public',[],false], ['gm',['gm'],false], ['blind',['gm'],true], ['self',['player-one'],false]
]) {
  const sourceVisibility=makeMsg({id:'source-'+mode,whisper,blind});
  const derived=await applyHp({kind:'heal',amount:1,token,sourceMessage:sourceVisibility});
  assert.deepEqual(derived.whisper,whisper,mode+' inherits the exact recipients');
  assert.equal(derived.blind,blind,mode+' inherits the blind marker');
  assert.equal(derived.getFlag(ID,'hpReport').sourceMessageId,sourceVisibility.id);
}
assert.equal(appliedModes,beforeDerived,'derived reports never apply client mode');
for (const [mode,whisper,blind] of [
  ['public',[],false],['gm',['gm-user'],false],['blind',['gm-user'],true],
  ['self',['gm'],false],['ic',[],false]
]) {
  currentMessageMode=mode;
  const standalone=await applyHp({kind:'heal',amount:1,token});
  assert.deepEqual(standalone.whisper,whisper,mode+' source-less report recipients');
  assert.equal(standalone.blind,blind,mode+' source-less blind flag');
  assert.equal(standalone.getFlag(ID,'hpReport').sourceMessageId,null);
}
assert.equal(appliedModes,beforeDerived+5,'apply current client mode once per source-less report');
console.log('PASS stage 14 HP visibility: derived preserves source; source-less uses current public/gm/blind/self/ic');

// Separate post-defense damage reads defenses for the selected recipient,
// never inherits a critical or consumes a new attack/ability use.
const spark=makeMsg({flags:{[ID]:{weaponDamage:{version:2,revision:0,noCritical:true,
  isIntervention:true,postDefenseOrigin:{rootMessageId:'attack',parentMessageId:'defense',targetUuid:'other'},
  parts:[{id:'p1',kind:'die',value:3,damageType:'магический'},{id:'p2',kind:'die',value:4,damageType:'магический'}],
  naturalD20:20,manualCritical:true,adjustments:{}}}}});
actor.flags[ID]={...(actor.flags[ID]??{}),damageDefenses:{resistances:[{trait:'магический',value:2}],vulnerabilities:[{trait:'магический',value:1}]}};
const sparked=await applyCardDamage(spark,{critical:true});
assert.equal(sparked.getFlag(ID,'hpReport').requested,6);assert.equal(sparked.getFlag(ID,'hpReport').critical,false);
assert.equal(sparked.getFlag(ID,'hpReport').multiplier,1);assert.equal(await revertHpReport(sparked),true);
actor.flags[ID].damageDefenses={immunities:['магический'],vulnerabilities:[{trait:'магический',value:10}]};
const immune=await applyCardDamage(spark);assert.equal(immune.getFlag(ID,'hpReport').requested,0);
console.log('PASS post-defense damage: per-recipient mitigation, no critical, independent HP and undo');
