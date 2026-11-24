import assert from 'node:assert/strict';
import {useItem} from '../module/equipment/item-use.mjs';
import {declareAction} from '../module/rolls/action-declaration.mjs';
import {standaloneIntervention} from '../module/damage/standalone-intervention.mjs';
import {initiateCounteraction} from '../module/damage/counteraction.mjs';
import {chooseCoverAlly} from '../module/damage/cover-ally.mjs';
import {abilityExecutions,publishAbility,executeAbilityFromChat} from '../module/abilities/ability-chat.mjs';
import {readyHp} from '../module/damage/free-hp.mjs';
const ID='fast-nri-v14', messages=new Map(), warnings=[];let n=0, rolls=0, failPublish=false, onRoll=null;
function patch(doc,changes){for(const [key,value] of Object.entries(changes)){let target=doc;const path=key.split('.');for(const k of path.slice(0,-1))target=target[k]??={};const last=path.at(-1);if(last.startsWith('-='))delete target[last.slice(2)];else target[last]=structuredClone(value);}return doc;}
const actor={id:'actor',uuid:'Actor.actor',documentName:'Actor',type:'character',name:'Hero',isOwner:true,hasPlayerOwner:true,system:{hp:{current:20,max:30},combatDie:'d6',defenses:{fortitude:2,reflex:3,will:1},resources:{reaction:{kind:'intervention',current:2,max:2}}},flags:{},effects:{contents:[]},items:new Map(),getFlag(s,k){return this.flags?.[s]?.[k];},getRollData(){return {};},async update(c){return patch(this,c);}};
const uuids=new Map([[actor.uuid,actor]]);globalThis.fromUuid=async uuid=>uuids.get(uuid);
Object.defineProperty(actor.items,'contents',{get(){return [...this.values()];}});
function item(id,mechanics={},extra={}){const i={id,uuid:`Actor.actor.Item.${id}`,documentName:'Item',parent:actor,type:'equipment',name:id,system:{mechanics,quantity:1,description:'<test>',...extra},async update(c){return patch(this,c);}};actor.items.set(id,i);uuids.set(i.uuid,i);return i;}
globalThis.game={user:{id:'p',isGM:false,targets:new Set()},users:{contents:[{id:'gm',isGM:true}],get:id=>({isGM:id==='gm'})},messages:{get:id=>messages.get(id),get contents(){return [...messages.values()];}},settings:{get:()=> 'public'},i18n:{localize:k=>k,format:k=>k},time:{worldTime:1,serverTime:1}};
globalThis.ui={notifications:{warn:s=>warnings.push(s),error:s=>warnings.push(s)}};
globalThis.foundry={utils:{randomID:()=>`r${++n}`},applications:{api:{DialogV2:{input:async()=>({defense:'reflex'})}}}};
globalThis.canvas={tokens:{controlled:[]}};
globalThis.ChatMessage={getSpeaker:()=>({actor:actor.id}),applyMode:(data,mode)=>({...data,whisper:mode==='gm'?['gm']:[],blind:mode==='blind'}),async create(data){if(failPublish)return null;const m={id:data._id??`m${++n}`,whisper:[],blind:false,...data,getFlag(s,k){return this.flags?.[s]?.[k];}};messages.set(m.id,m);return m;}};
globalThis.Roll=class{static validate(f){return f!=='INVALID';}constructor(f){this.formula=f;this.total=0;}async evaluate(){rolls++;this.total=7;this.dice=[{faces:20,number:1,results:[{result:7,active:true}]}];this.terms=this.dice;onRoll?.();return this;}toJSON(){return {formula:this.formula,total:this.total,dice:this.dice};}async toMessage(data,opts){const payload={...data,rolls:[this.toJSON()]};return opts?.create===false?payload:ChatMessage.create(payload);}};
const potion=item('potion',{potion:{limitPerDayText:'legacy'},use:{consume:{field:'quantity',amount:1},operations:[{kind:'healHp',formula:'2d6'}]}});
let result=await useItem(potion);assert.equal(result.message.getFlag(ID,'itemUseResult').potion,true);assert.equal(actor.system.potionsUsed,undefined);assert.equal(result.results[0].amount,7);assert.equal(potion.system.quantity,0);assert.equal(actor.system.hp.current,20);assert.equal(result.message.rolls.length,1);assert.deepEqual(readyHp(result.message),{kind:'heal',amount:7});
result=await useItem(potion);assert.equal(result.results[0].amount,7);assert.equal(potion.system.quantity,0);assert.ok(result.skipped.includes('insufficient-stack'));assert.ok(warnings.length);assert.equal(actor.system.hp.current,20);
const empty=item('manual');result=await useItem(empty);assert.ok(result.message);assert.equal(result.message.rolls.length,0);assert.match(result.message.content,/manualConsequences/);
const mixed=item('mixed',{use:{consume:{field:'quantity',amount:1},operations:[{kind:'restoreResource',formula:'1d6',classes:['other']},{kind:'addTempHp',amount:4}]}});result=await useItem(mixed);assert.equal(result.results[0].manual,true);assert.equal(result.results[0].amount,7);assert.deepEqual(readyHp(result.message),{kind:'temp',amount:4});assert.equal(actor.system.hp.current,20);
const cancel=item('cancel',{use:{consume:{field:'quantity',amount:1},operations:[{kind:'healHp',amount:3}]}});failPublish=true;assert.equal(await useItem(cancel),null);assert.equal(cancel.system.quantity,1);failPublish=false;
const before=messages.size;actor.isOwner=false;assert.equal(await useItem(cancel),null);assert.equal(await declareAction({actor,label:'denied'}),null);assert.equal(messages.size,before);actor.isOwner=true;
const privateSource={whisper:['p','gm'],blind:false};const dec=await declareAction({actor,label:'<manual>',source:privateSource});assert.match(dec.content,/&lt;manual&gt;/);assert.deepEqual(dec.whisper,privateSource.whisper);assert.equal(await declareAction({actor,label:'hidden',source:{isContentVisible:false}}),null);
const cover=item('cover',{grantsAction:'coverAlly'},{description:'cover'});cover.type='ability';let m=await standaloneIntervention(actor,'coverAlly',{skipPreroll:true});assert.ok(m.getFlag(ID,'manualAction').isIntervention);assert.equal(m.rolls,undefined);assert.equal(actor.system.resources.reaction.current,1);
let check=await standaloneIntervention(actor,'selfDefense',{stat:'fortitude',skipPreroll:true});assert.ok(check.message);assert.equal(check.result,null);assert.match(check.roll.formula,/1d20/);assert.equal(actor.system.resources.reaction.current,0);
check=await standaloneIntervention(actor,'counteraction',{stat:'reflex',skipPreroll:true,source:privateSource});assert.ok(check.message);assert.deepEqual(check.message.whisper,privateSource.whisper);assert.equal(actor.system.resources.reaction.current,0);
check=await standaloneIntervention(actor,'dodge',{choice:{kind:'dodge',stat:'reflex',label:'Dodge'},skipPreroll:true});assert.ok(check.message);assert.equal(check.result,null);
const legacy=item('legacy',{}, {rollFormula:'1d8'});result=await useItem(legacy);assert.equal(result.results[0].kind,'roll');assert.equal(result.message.rolls[0].formula,'1d8');
const passive=item('passive',{passive:true});passive.type='ability';assert.deepEqual(abilityExecutions(passive),[]);
const active=item('manual-ability',{accounting:{resourceCosts:[{resourceId:'reaction',amount:1}]}});active.type='ability';assert.equal(abilityExecutions(active)[0].id,'manual-use');actor.system.resources.reaction.current=2;const pub=await publishAbility(active);assert.equal(actor.system.resources.reaction.current,2);const action=await executeAbilityFromChat(pub,'manual-use',{skipPreroll:true});assert.ok(action.getFlag(ID,'manualAction'));assert.equal(actor.system.resources.reaction.current,1);
const activeRoll=item('manual-roll',{}, {rollFormula:'1d8'});activeRoll.type='ability';const pubRoll=await publishAbility(activeRoll);const r=await executeAbilityFromChat(pubRoll,'manual-use',{skipPreroll:true});assert.equal(r.formula,'1d8');
assert.equal(await standaloneIntervention(actor,'selfDefense',{stat:'fortitude',skipPreroll:true,source:{isContentVisible:false}}),null);
const awareness=await standaloneIntervention(actor,'counteraction',{stat:'awareness',skipPreroll:true});assert.match(awareness.roll.formula,/1d6/);
const attack=await ChatMessage.create({whisper:['p','gm'],flags:{[ID]:{checkRoll:{version:1,targetDefense:'reflex',result:{degree:'success',total:10,targetUuid:'Scene.s.Token.t'}}}}});globalThis.fromUuid=async uuid=>uuid==='Scene.s.Token.t'?{actor}:uuids.get(uuid);const oldRolls=rolls;onRoll=()=>messages.delete(attack.id);m=await initiateCounteraction(attack,{target:actor,skipPreroll:true});onRoll=null;assert.ok(m.getFlag(ID,'manualAction'));assert.deepEqual(m.whisper,attack.whisper);assert.equal(rolls,oldRolls+1);assert.equal(m.rolls.length,1);
// Cover: no context or a stale selected die declares instead of manufacturing a transfer.
const coverSource=await ChatMessage.create({whisper:['p','gm'],flags:{[ID]:{weaponDamage:{version:2,parts:[{id:'A',kind:'die',formula:'1d6',value:5}],revision:0}}}});
const defender={actor,name:'Hero',document:{uuid:'Scene.s.Token.def'}};
const ally={actor:{uuid:'Actor.ally'},name:'Ally',document:{uuid:'Scene.s.Token.ally'}};
let candidates=[{ally,card:coverSource.getFlag(ID,'weaponDamage')}];
foundry.applications.api.DialogV2.input=async()=>({choice:'0'});actor.system.resources.reaction.current=2;
const linkedCover=await chooseCoverAlly({source:coverSource,defender,candidates:()=>candidates});assert.equal(linkedCover.getFlag(ID,'coverAlly').amount,5);assert.equal(actor.system.resources.reaction.current,1);assert.deepEqual(readyHp(linkedCover),{kind:'damage',amount:5});
const standaloneCover=await chooseCoverAlly({source:coverSource,defender,candidates:()=>[]});assert.ok(standaloneCover.getFlag(ID,'manualAction'));assert.equal(actor.system.resources.reaction.current,0);
console.log('PASS refactor2: item use without targets, exhausted stack, manual consequences, denied publication, standalone interventions, preserved roll and audience on lost source');

// Invocation entrypoints: actual sheet actions, using existing chat publication.
class SheetMock {constructor({actor}){this.actor=actor;this.isEditable=true;}}
foundry.applications.api.HandlebarsApplicationMixin=Parent=>class extends Parent{};
foundry.applications.sheets={ActorSheetV2:SheetMock,ItemSheetV2:SheetMock};
foundry.applications.handlebars={loadTemplates:async()=>({})};
const {FastNRICharacterSheet,FastNRINPCSheet}=await import('../module/sheets/sheets.mjs');
const {sheetOptions}=await import('./foundry-test-helpers.js');
const invocationBlade=item('blade',{invocation:true,attackAugment:{id:'blade',damageParts:[{formula:'1d8',damageType:'magic'}]},accounting:{resourceCosts:[{resourceId:'magic',amount:1}]}});invocationBlade.type='ability';invocationBlade.getFlag=()=>null;
const double=item('double',{doubleInvocation:true,passive:true},{description:'Resolve both spells independently.'});double.type='ability';double.getFlag=()=>null;
for(const owned of actor.items.values())owned.getFlag??=()=>null;
actor.system.resources.magic={kind:'class',name:'Magic',current:4,max:4};
for(const Sheet of [FastNRICharacterSheet,FastNRINPCSheet]){
 const sheet=new Sheet({actor});
 const invoke=sheetOptions(Sheet).actions.invokeFromSheet;
 let calls=0;
 foundry.applications.api.DialogV2.input=async()=>{calls++;return {choice:'0'};};
 let result=await invoke.call(sheet,null,{dataset:{id:'doubleInvocation'}});
 assert.ok(result.getFlag(ID,'manualAction'));
 assert.match(result.content,/Resolve both spells independently/);
 assert.equal(calls,0,'double invocation must not force choice of a single spell');
 assert.equal(actor.system.resources.magic.current,4);
 const count=messages.size;
 result=await invoke.call(sheet,null,{dataset:{id:'invocation'}});
 assert.ok(result.getFlag(ID,'manualAction'));
 assert.equal(calls,0,'neither invocation opens a spell selector');
 assert.equal(messages.size,count+1);
 assert.equal(actor.system.resources.magic.current,4,'announcement must not spend magic');
}
// Independent manual Blade execution spends its own cost only after publication.
const bladePublication=await publishAbility(invocationBlade);
assert.equal(actor.system.resources.magic.current,4);
const bladeManual=await executeAbilityFromChat(bladePublication,'manual-use',{skipPreroll:true});
assert.ok(bladeManual.getFlag(ID,'manualAction'));
assert.equal(actor.system.resources.magic.current,3);
console.log('PASS invocation entrypoints: PC/NPC announcements without selectors, independent Blade accounting');

// Every common action works without targets; the full route publishes native
// checks or declarations, and does not silently apply their consequences.
const {STANDARD_ACTIONS,rollStandardAction}=await import('../module/rolls/standard-actions.mjs');
const hpBefore=actor.system.hp.current, reactionBefore=actor.system.resources.reaction.current;
for(const action of Object.values(STANDARD_ACTIONS)){
 const result=await rollStandardAction(actor,action.id,{targetTokens:[],skipPreroll:true});
 assert.ok(result.message,`${action.id}: message without target`);
 if(action.skillId){
   assert.ok(result.roll,`${action.id}: roll without target`);
   if(action.defenseStat)assert.equal(result.result,null,`${action.id}: unknown target is not invented`);
 }else{
   assert.ok(result.message.getFlag(ID,'manualAction'));
   assert.equal(result.roll,null,`${action.id}: no invented roll`);
 }
}
assert.equal(actor.system.hp.current,hpBefore);
assert.equal(actor.system.resources.reaction.current,reactionBefore);
console.log(`PASS common actions: ${Object.keys(STANDARD_ACTIONS).length} routes without targets`);

// The Heir contribution reaches the actual named social actions as well as
// direct basic-skill checks. It is opt-in, not a second automatic modifier.
const {acceptPreroll}=await import('./foundry-test-helpers.js');
actor.system.role='Наследник';
actor.system.skills={core_deception:{name:'Обман',dice:'1d6'},core_intimidation:{name:'Запугивание',dice:'1d6'}};
let socialDialogs=0;
foundry.applications.api.DialogV2.wait=async cfg=>{
 socialDialogs++;assert.match(cfg.content,/Наследник/);
 const content=cfg.content.replace(/<label\b[^>]*>[\s\S]*?<\/label>/g,row=>row.includes('Наследник')?row.replace(/<input\b/,'<input checked'):row);
 return acceptPreroll({...cfg,content});
};
for(const id of ['distract','demoralize']){
 const selected=await rollStandardAction(actor,id,{targetTokens:[]});assert.equal(selected.roll.formula,'1d20 + (1d6) + (1d10)');assert.equal(selected.result,null);
 const skipped=await rollStandardAction(actor,id,{targetTokens:[],skipPreroll:true});assert.equal(skipped.roll.formula,'1d20 + (1d6)');
}
assert.equal(socialDialogs,2);
console.log('PASS Heir named actions: distraction and demoralization, optional d10, no selected target required');

// Item preroll: explicit healing contribution, cancellation, Shift defaults,
// and an unmodified d20 still asks for preparation.
actor.system.role='';
const med=item('med',{use:{consume:{field:'quantity',amount:1},operations:[{kind:'healHp',formula:'2d6'}]},rollContributions:[{kinds:['heal'],kind:'modifier',value:'1d4',label:'Healing bonus',defaultEnabled:false}]});
let medDialogs=0;
foundry.applications.api.DialogV2.wait=async cfg=>{medDialogs++;assert.match(cfg.content,/Healing bonus/);return null;};
let beforeCount=messages.size, beforeRollCount=rolls;
assert.equal(await useItem(med),null);assert.equal(med.system.quantity,1);assert.equal(messages.size,beforeCount);assert.equal(rolls,beforeRollCount);
foundry.applications.api.DialogV2.wait=async cfg=>{medDialogs++;return acceptPreroll({...cfg,content:cfg.content.replace('name="part_0_0">','name="part_0_0" checked>')});};
result=await useItem(med);assert.equal(result.message.rolls[0].formula,'2d6 + (1d4)');assert.equal(med.system.quantity,0);
result=await useItem(med,{skipPreroll:true});assert.equal(result.message.rolls[0].formula,'2d6');assert.equal(medDialogs,2);
const checkItem=item('checkItem',{}, {rollFormula:'1d20'});
foundry.applications.api.DialogV2.wait=async cfg=>{medDialogs++;return acceptPreroll(cfg);};
result=await useItem(checkItem);assert.equal(result.message.rolls[0].formula,'1d20');assert.equal(medDialogs,3);
result=await useItem(checkItem,{skipPreroll:true});assert.equal(medDialogs,3);
console.log('PASS Item preroll: d20, optional healing, cancellation and Shift');
