import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {applyIndependentHp,calculateSelectedDice,openPartialDice,openFreeHp,readyHp,selectableDice} from '../module/damage/free-hp.mjs';
import {applyHp,revertHpReport} from '../module/damage/hp-actions.mjs';
import {readTempHpState,tempHpMax,settleTempHpTurnStart} from '../module/damage/temporary-hp-layers.mjs';
import {applyResultToSelectedActor} from '../module/abilities/ability-chat.mjs';
import {applyDrainRestoration} from '../module/abilities/damage-recovery.mjs';
import {recordPotionReceipt,potionResource} from '../module/data/potion-resource.mjs';
import {restActor} from '../module/data/ability-accounting.mjs';
const ID='fast-nri-v14',messages=new Map(),uuids=new Map(),notices=[],reports=[];
let counter=0,dialogInput=async()=>null,dialogConfirm=async()=>true;
// Match the native dotted-key flag/HP updates, including deletion of a layer.
function patch(doc,changes){for(const [key,value] of Object.entries(changes)){const path=key.split('.');let target=doc;for(const k of path.slice(0,-1))target=target[k]??={};const last=path.at(-1);if(last.startsWith('-='))delete target[last.slice(2)];else target[last]=structuredClone(value);}return doc;}
function message(id,flags={},extra={}){const m={id,flags:{[ID]:structuredClone(flags)},rolls:[],isAuthor:true,whisper:[],blind:false,...extra,getFlag(s,k){return this.flags?.[s]?.[k];},canUserModify(){return true;},async update(changes){return patch(this,changes);}};messages.set(id,m);return m;}
function actor(id,defenses={}){const a={documentName:'Actor',type:'npc',id,uuid:`Actor.${id}`,name:id,isOwner:true,system:{hp:{current:50,max:60,temp:0},resources:{power:{value:3}}},flags:{[ID]:{damageDefenses:defenses}},effects:{contents:[]},items:{contents:[]},getFlag(s,k){return this.flags?.[s]?.[k];},canUserModify(){return this.isOwner;},async update(changes){return patch(this,changes);}};uuids.set(a.uuid,a);return a;}
function token(a,hidden=false){const doc={uuid:`Scene.s.Token.${a.id}`,actor:a,hidden};uuids.set(doc.uuid,doc);return {name:a.name,actor:a,document:doc};}
const owner=actor('newTarget',{immunities:['fire'],resistances:[{trait:'physical',value:2}],vulnerabilities:[{trait:'physical',value:1}]}),other=actor('original'),t=token(owner),old=token(other);
const collection={get:id=>messages.get(id),get contents(){return [...messages.values()]}};
globalThis.game={user:{id:'player',isGM:false},users:{contents:[{id:'gm',isGM:true}]},messages:collection,time:{worldTime:100},i18n:{localize:k=>k}};
globalThis.canvas={tokens:{controlled:[t]}};
globalThis.ui={notifications:{warn:s=>notices.push(s),error:s=>notices.push(s)}};
globalThis.foundry={utils:{randomID:()=>`id${++counter}`,equals:isDeepStrictEqual},applications:{api:{DialogV2:{input:cfg=>dialogInput(cfg),confirm:cfg=>dialogConfirm(cfg)}}}};
globalThis.fromUuid=async uuid=>uuids.get(uuid);
globalThis.ChatMessage={getSpeaker:()=>({}),applyMode:data=>data,async create(data){const m=message(data._id??`report${++counter}`,data.flags?.[ID],{...data});reports.push(m);return m;}};
const dice=[{id:'fire',kind:'die',faces:6,formula:'1d6',value:5,original:5,damageType:'magical',traits:['fire']},{id:'physical',kind:'die',faces:6,formula:'1d6',value:4,original:4,damageType:'physical',immune:true},{id:'fixed',kind:'fixed',value:20,original:20,formula:'20',damageType:'physical'},{id:'excluded',kind:'die',faces:6,value:6,original:6,excluded:true},{id:'pending',kind:'die',faces:6,value:null,pending:true}];
const source=message('damage',{weaponDamage:{version:2,parts:dice,adjustments:{resistance:99,vulnerability:99,penalty:99},naturalD20:20,revision:1,history:[],sourceActorUuid:other.uuid,damageRules:{}}},{whisper:['player','gm']});
const snapshot=structuredClone(source.flags);
assert.deepEqual(selectableDice(source).map(p=>p.id),['fire','physical']);
let calc=calculateSelectedDice(source,['fire','physical'],owner);
assert.deepEqual(calc.immunePartIds,['fire']);assert.equal(calc.resistance,2);assert.equal(calc.vulnerability,1);assert.equal(calc.multiplier,2);assert.equal(calc.total,7,'new target immunity/resistance/vulnerability apply only to chosen dice, critical once');
assert.equal(calculateSelectedDice(source,['fire'],owner).total,0,'only chosen die is immune');
assert.equal(calculateSelectedDice(source,['physical'],owner,{kind:'heal',modifier:1,penalty:1}).total,5,'no damage defenses or critical applied to healing');
assert.equal(calculateSelectedDice(source,['physical'],owner,{modifier:1,critical:false}).total,4,'manual modifier and new target defenses, no fixed original or previous target modifiers');
assert.equal(calculateSelectedDice(source,[],owner).total,0);
const withPenalty=message('sourcePenalty',{weaponDamage:{...source.flags[ID].weaponDamage,penaltyComponents:[{value:-1}]}});
assert.equal(calculateSelectedDice(withPenalty,['physical'],owner,{critical:false}).total,2,'explicit source penalty survives, old target adjustments do not');
assert.equal(calculateSelectedDice(withPenalty,['physical'],owner,{critical:false,penalty:0}).total,3,'participants can allocate the penalty manually');
assert.deepEqual(source.flags,snapshot,'calculations do not mutate source');
// Run real dialog handlers. Selection is pre-checked, result shown BEFORE applying.
let previews=0;dialogInput=async cfg=>{assert.match(cfg.content,/name="die0" checked/);assert.match(cfg.content,/name="die1" checked/);assert.doesNotMatch(cfg.content,/name="die2"/);return {kind:'damage',die0:true,die1:true};};
dialogConfirm=async cfg=>{previews++;assert.match(cfg.content,/damage: 7/);assert.equal(owner.system.hp.current,50);return true;};
const r=await openPartialDice(source);assert.equal(previews,1);assert.ok(r);assert.equal(owner.system.hp.current,43);assert.equal(other.system.hp.current,50);assert.equal(r.getFlag(ID,'hpReport').requested,7);assert.equal(r.getFlag(ID,'hpReport').independent,true);assert.deepEqual(r.whisper,source.whisper);assert.deepEqual(source.flags,snapshot);assert.equal(owner.system.resources.power.value,3);assert.equal(other.system.resources.power.value,3);
assert.equal(await revertHpReport(r),true);assert.equal(owner.system.hp.current,50);assert.equal(await revertHpReport(r),null,'undo only once');
// Cancellation and stale GM edits never mutate HP.
dialogConfirm=async()=>false;assert.equal(await openPartialDice(source),undefined);assert.equal(owner.system.hp.current,50);
dialogConfirm=async()=>{source.flags[ID].weaponDamage.parts[1].value=5;return true;};assert.equal(await openPartialDice(source),undefined);assert.equal(owner.system.hp.current,50);source.flags=structuredClone(snapshot);
// The published standalone Cover result survives missing original attack and defender.
const cover=message('cover',{coverAlly:{version:1,amount:5,sourceId:'removedAttack',defenderToken:'removedToken'}});
assert.deepEqual(readyHp(cover),{kind:'damage',amount:5});
dialogInput=async cfg=>{assert.match(cfg.content,/value="5"/);return {kind:'damage',amount:'5'};};
const first=await openFreeHp(cover);const second=await openFreeHp(cover);assert.ok(first&&second);assert.notEqual(first.id,second.id);assert.equal(owner.system.hp.current,40);assert.equal(other.system.hp.current,50);assert.equal(owner.system.resources.power.value,3);
assert.equal(await revertHpReport(second),true);assert.equal(await revertHpReport(first),true);assert.equal(owner.system.hp.current,50);
// Native Roll: choose only a subset and apply as healing to the selected token.
const native=message('healRoll',{}, {rolls:[{formula:'2d6 + 8',total:15,dice:[{faces:6,results:[{result:3,active:true},{result:4,active:true}]}]}]});
const raw=structuredClone(native.rolls);
dialogInput=async cfg=>{assert.match(cfg.content,/name="die1" checked/);return {kind:'heal',die1:'on'};};
dialogConfirm=async cfg=>{assert.match(cfg.content,/heal: 4/);return true;};
const healed=await openPartialDice(native);assert.ok(healed);assert.equal(owner.system.hp.current,54);assert.deepEqual(native.rolls,raw);
// Temporary HP uses existing layers and can be independently undone.
const shield=message('shield',{abilityResult:{version:1,kind:'temporaryHp',amount:6}});
assert.deepEqual(readyHp(shield),{kind:'temp',amount:6});
const temporary=await applyIndependentHp(shield,{kind:'temp',amount:6});assert.ok(temporary);assert.equal(owner.system.hp.temp,6);assert.equal(tempHpMax(readTempHpState(owner)),6);
assert.equal(await revertHpReport(temporary),true);assert.equal(owner.system.hp.temp,0);
const rawHp=owner.system.hp.current;
// No actor permission, no target, no hidden source, no ambiguous selection.
owner.isOwner=false;assert.equal(await applyIndependentHp(cover,{kind:'damage',amount:2}),null);owner.isOwner=true;
canvas.tokens.controlled=[];assert.equal(await applyIndependentHp(cover,{kind:'damage',amount:2}),null);
canvas.tokens.controlled=[old,t];assert.equal(await applyIndependentHp(cover,{kind:'damage',amount:2}),null);canvas.tokens.controlled=[t];
cover.isContentVisible=false;assert.equal(await applyIndependentHp(cover,{kind:'damage',amount:2}),null);assert.equal(readyHp(cover),null);cover.isContentVisible=true;
assert.equal(owner.system.hp.current,rawHp);
// Hidden GM-owned token -> report is not widened to public.
game.user={id:'gm',isGM:true};t.document.hidden=true;const hidden=await applyIndependentHp(cover,{kind:'damage',amount:1});assert.ok(hidden);assert.deepEqual(hidden.whisper,['gm']);assert.equal(hidden.blind,true);t.document.hidden=false;
// A revision change after the HP write should NOT roll back independent HP.
const prevUpdate=owner.update;owner.update=async function(changes){await prevUpdate.call(this,changes);source.flags[ID].weaponDamage.revision++;return this;};
const before=owner.system.hp.current;const revisionReport=await applyIndependentHp(source,{kind:'damage',amount:2});assert.ok(revisionReport);assert.equal(owner.system.hp.current,before-2);owner.update=prevUpdate;
// Existing connected applyHp still observes expected revision, independent mode doesn't.
assert.equal(await applyHp({kind:'damage',amount:2,sourceMessage:source,token:t,expectedRevision:-1}),null);
assert.equal(owner.system.hp.current,before-2);
assert.equal(other.system.hp.current,50);assert.ok(reports.length>=7);
console.log('PASS refactor 1: real HP transactions, repeat/undo, independent cover, ordinary Roll heal, temp layers, new target defenses, source and role privacy, cancel/stale selection');

// Native Shield and universal HP paths share the same caster-relative deadline.
const expiry={worldTime:600,turnStart:{combatId:'combat',combatantId:'caster',notBeforeRound:2}};
const shield2=message('shadow-shield',{abilityResult:{version:1,kind:'temporaryHp',amount:5,target:'self',sourceItemUuid:'deletedItem',actorUuid:other.uuid,expiry}},{whisper:['player','gm']});
const caster={id:'caster',actor:other},receiver={id:'receiver',actor:owner};
game.combat={id:'combat',started:true,round:1,turn:0,turns:[caster,receiver]};
canvas.tokens.controlled=[t];
const shieldReport=await applyResultToSelectedActor(shield2);assert.ok(shieldReport);assert.equal(owner.system.hp.temp,5);assert.equal(other.system.hp.temp,0);
assert.deepEqual(Object.values(readTempHpState(owner).layers)[0].expiry,expiry);
assert.deepEqual(shieldReport.whisper,shield2.whisper);
assert.equal(await revertHpReport(shieldReport),true);
dialogInput=async()=>({kind:'temp',amount:5});assert.ok(await openFreeHp(shield2));
assert.deepEqual(Object.values(readTempHpState(owner).layers)[0].expiry,expiry);
// Distinct manual layer must survive caster expiry. The shield is on a
// scene token, deliberately not present in the combat's turns or world Actors.
assert.ok(await applyHp({kind:'temp',amount:2,token:t}));
game.scenes={contents:[{tokens:{contents:[t.document]}}]};
game.combat.round=2;game.combat.turns=[caster];game.combat.turn=0;
await settleTempHpTurnStart(game.combat,caster);
assert.equal(owner.system.hp.temp,2);assert.equal(other.system.hp.temp,0);
assert.equal(Object.values(readTempHpState(owner).layers).length,1);
// Already-published Drain healing stays usable even without its original
// attack, caster Item, or HP report; repeat and undo affect only selected HP.
const drain=message('drain',{damageRecovery:{version:1,hp:3,resource:2,sourceActorUuid:'Actor.deleted',hpReportId:'missing',damageMessageId:'missing'}},{whisper:['player','gm']});
game.user={id:'player',isGM:false};const health=owner.system.hp.current;
const d1=await applyDrainRestoration(drain,'hp');assert.ok(d1);assert.equal(owner.system.hp.current,health+3);assert.deepEqual(d1.whisper,drain.whisper);
const d2=await applyDrainRestoration(drain,'hp');assert.ok(d2);assert.equal(owner.system.hp.current,health+6);assert.equal(await revertHpReport(d2),true);assert.equal(owner.system.hp.current,health+3);
assert.equal(await applyDrainRestoration(drain,'resource'),null);assert.equal(other.system.resources.power.value,3);assert.equal(owner.system.resources.power.value,3);
canvas.tokens.controlled=[];assert.equal(await applyDrainRestoration(drain,'hp'),null);assert.equal(await applyResultToSelectedActor(shield2),null);
canvas.tokens.controlled=[t];drain.isContentVisible=false;assert.equal(await applyDrainRestoration(drain,'hp'),null);
console.log('PASS Warlock: selected Shield, fixed caster deadline across Actors/scenes, ordinary layer survives, independent Drain healing, repeat/undo, privacy and resource isolation');

// Revised Shield: actual embedded effect, recipient end turn, deletion and undo.
const {settleTempHpTurnEnd,settleTempHpWorldTime,registerTempHpManualEdits}=await import('../module/damage/temporary-hp-layers.mjs');
const hooks={};globalThis.Hooks={on:(name,fn)=>{hooks[name]=fn;}};registerTempHpManualEdits();
owner.createEmbeddedDocuments=async function(type,rows){assert.equal(type,'ActiveEffect');return rows.map(row=>{const e={...structuredClone(row),id:`effect${++counter}`,parent:this,getFlag(s,k){return this.flags?.[s]?.[k];}};this.effects.contents.push(e);return e;});};
owner.deleteEmbeddedDocuments=async function(type,ids,options={}){assert.equal(type,'ActiveEffect');const gone=this.effects.contents.filter(e=>ids.includes(e.id));this.effects.contents=this.effects.contents.filter(e=>!ids.includes(e.id));for(const e of gone)await hooks.deleteActiveEffect(e,options,game.user.id);return gone;};
const shield3=message('shield-recipient-end',{abilityResult:{version:1,kind:'temporaryHp',amount:5,expiry:{recipientTurnEnd:true}}});
assert.ok(await applyResultToSelectedActor(shield3));assert.equal(owner.effects.contents.length,1);assert.equal(owner.system.hp.temp,5);
let layer=owner.effects.contents[0].getFlag(ID,'shieldLayer');assert.equal(readTempHpState(owner).layers[layer].expiry.recipientTurnEnd,true);
game.user={id:'gm',isGM:true};game.combat.turns=[caster,receiver];
await settleTempHpTurnEnd(game.combat,caster);assert.equal(owner.system.hp.temp,5);
await settleTempHpTurnStart(game.combat,receiver);assert.equal(owner.system.hp.temp,5);
await settleTempHpTurnEnd(game.combat,receiver,{skipped:true});assert.equal(owner.system.hp.temp,5);
await settleTempHpTurnEnd(game.combat,receiver);assert.equal(owner.system.hp.temp,2);assert.equal(owner.effects.contents.length,0);
const sr=await applyResultToSelectedActor(shield3);assert.ok(sr);assert.equal(owner.effects.contents.length,1);
assert.equal(await revertHpReport(sr),true);assert.equal(owner.system.hp.temp,2);assert.equal(owner.effects.contents.length,0);
assert.ok(await applyResultToSelectedActor(shield3));const effect=owner.effects.contents[0];await owner.deleteEmbeddedDocuments('ActiveEffect',[effect.id]);assert.equal(owner.system.hp.temp,2);assert.equal(owner.effects.contents.length,0);
assert.ok(await applyResultToSelectedActor(shield3));await settleTempHpWorldTime(owner,701);assert.equal(owner.system.hp.temp,0);assert.equal(owner.effects.contents.length,0);
console.log('PASS revised Shield: recipient end, skipped turn, native effect deletion, undo, independent layers, time cap');

// Control Warlock: linked Drain damage -> one recovery card -> independent HP
// and original caster's resource. Load the actual compendium contract.
const {readFileSync}=await import('node:fs');
const {ensureDamageRecovery,recoveryRuleForDamage,planDamageRecovery}=await import('../module/abilities/damage-recovery.mjs');
const {calculateDamage}=await import('../module/damage/damage-core.mjs');
const drainCard=JSON.parse(readFileSync(new URL('../packs/_source/abilities/razrushenie-pokhishchenie--fci3gbdrs6si22i1.json',import.meta.url),'utf8'));
const casterActor=actor('drainCaster'),victim=actor('drainVictim');
const victimToken=token(victim),casterToken=token(casterActor);
casterActor.system.hp.current=20;casterActor.system.resources={magic:{name:'Магическая сила',kind:'class',resourceKey:'class_magic',current:1,max:4}};
const drainItem={...drainCard,uuid:'Actor.drainCaster.Item.drain',parent:casterActor};uuids.set(drainItem.uuid,drainItem);
const attack={version:2,revision:0,sourceUuid:drainItem.uuid,sourceActorUuid:casterActor.uuid,executionId:'invocation',degree:'great',effectDegree:'success',damageRules:drainCard.system.mechanics.executions[0].attack.damageRules,parts:[{id:'m1',kind:'die',faces:4,profilePart:'M1',value:2},{id:'m2',kind:'die',faces:4,profilePart:'M2',value:4},{id:'m3',kind:'die',faces:4,profilePart:'M3',value:3,excluded:true}],adjustments:{resistance:100}};
const linked=message('drainLinked',{weaponDamage:attack},{whisper:['player','gm']});
const rule=recoveryRuleForDamage(attack,drainItem);assert.ok(rule);assert.equal(calculateDamage(attack,{critical:false}).total,6);
assert.ok(await applyHp({kind:'temp',amount:10,token:victimToken}));
const applied=await applyHp({kind:'damage',amount:6,sourceMessage:linked,token:victimToken,expectedRevision:0});assert.ok(applied);assert.equal(victim.system.hp.current,44);assert.equal(victim.system.hp.temp,10);
const recovery=await ensureDamageRecovery(applied);assert.ok(recovery);assert.equal(recovery.getFlag(ID,'damageRecovery').hp,4);assert.equal(recovery.getFlag(ID,'damageRecovery').resource,2);assert.deepEqual(recovery.whisper,linked.whisper);
assert.equal((await ensureDamageRecovery(applied)).id,recovery.id);assert.equal(reports.filter(m=>m.getFlag(ID,'damageRecovery')?.hpReportId===applied.id).length,1);
assert.equal(casterActor.system.hp.current,20);assert.equal(casterActor.system.resources.magic.current,1);
canvas.tokens.controlled=[casterToken];assert.ok(await applyDrainRestoration(recovery,'hp'));assert.equal(casterActor.system.hp.current,24);
assert.ok(await applyDrainRestoration(recovery,'resource'));assert.equal(casterActor.system.resources.magic.current,3);assert.ok(await applyDrainRestoration(recovery,'resource'));assert.equal(casterActor.system.resources.magic.current,3);
const hpReceipt=applied.getFlag(ID,'hpReport');const resolved={...attack,messageId:linked.id};
for(const [degree,resource] of [['partial',1],['success',2],['great',3]])assert.equal(planDamageRecovery(hpReceipt,{...resolved,effectDegree:degree},rule).resource,resource);
assert.equal(planDamageRecovery(hpReceipt,{...resolved,effectDegree:'failure'},rule),null);assert.equal(planDamageRecovery({...hpReceipt,hitPointsDamage:0},resolved,rule),null);
const steal=recoveryRuleForDamage({...attack,executionId:'steal-spell'},drainItem);assert.equal(planDamageRecovery(hpReceipt,resolved,steal).spellCancellation,true);assert.equal(planDamageRecovery(hpReceipt,{...resolved,effectDegree:'partial'},steal).spellCancellation,false);
console.log('PASS Warlock Drain: real HP transaction, bypass temp HP and resistance, effect degree recovery, published result, idempotent resource, no damage/no recovery');

// Shared potion limit belongs to the recipient, not the source item owner.
canvas.tokens.controlled=[t];game.user={id:'player',isGM:false};owner.isOwner=true;
owner.system.potionsUsed=0;owner.system.hp.current=40;
const potion=message('potionReceipt',{itemUseResult:{version:1,potion:true,actorUuid:other.uuid,results:[{kind:'healHp',amount:2,manual:false}]}});
assert.equal(potionResource(owner).max,3);assert.equal(potionResource(other).used,0);
assert.ok(await applyIndependentHp(potion,{kind:'heal',amount:2}));assert.equal(owner.system.potionsUsed,1);assert.equal(other.system.potionsUsed,undefined);
assert.ok(await applyIndependentHp(potion,{kind:'heal',amount:2}));assert.equal(owner.system.potionsUsed,1);
assert.equal((await recordPotionReceipt(owner,potion)).duplicate,true);
const manual=message('manualPotion',{itemUseResult:{version:1,potion:true,results:[]}});
await Promise.all([recordPotionReceipt(owner,manual),recordPotionReceipt(owner,manual)]);assert.equal(owner.system.potionsUsed,2);
owner.system.potionsUsed=3;const fourth=message('fourthPotion',{itemUseResult:{version:1,potion:true,results:[]}});
assert.equal((await recordPotionReceipt(owner,fourth)).over,true);assert.equal(owner.system.potionsUsed,4);assert.ok(notices.includes('FASTNRI.Potions.over'));
owner.items.contents.push({type:'ability',flags:{[ID]:{contentId:'fnri7.rulebook.racial.ustoichivyi'}}});assert.deepEqual(potionResource(owner),{used:4,max:4,over:false});
owner.items.contents=[];assert.equal(potionResource(owner).over,true);
owner.isOwner=false;assert.equal(await recordPotionReceipt(owner,potion),null);owner.isOwner=true;
const secret=message('secretPotion',{itemUseResult:{potion:true}},{isContentVisible:false});assert.equal(await recordPotionReceipt(owner,secret),null);
assert.equal(await recordPotionReceipt(owner,source),null);
await restActor(owner);assert.equal(owner.system.potionsUsed,0);assert.equal((await recordPotionReceipt(owner,potion)).duplicate,true);
console.log('PASS recipient potion accounting, repeat protection, manual receipt, warnings, Stable and Rest');
