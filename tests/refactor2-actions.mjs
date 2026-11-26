import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
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
const counterRoot=await ChatMessage.create({whisper:['p','gm'],flags:{[ID]:{checkRoll:{version:1,targetDefense:'reflex',result:{degree:'great',total:5,targetUuid:'Scene.s.Token.t'}}}}});
const firstCounter=await initiateCounteraction(counterRoot,{target:actor,skipPreroll:true});
assert.equal(firstCounter.getFlag(ID,'checkRoll').result.degree,'success');
const secondCounter=await initiateCounteraction(firstCounter,{target:actor,skipPreroll:true});
assert.equal(secondCounter.getFlag(ID,'checkRoll').previousMessageId,firstCounter.id);
assert.equal(secondCounter.getFlag(ID,'checkRoll').result.degree,'partial');
assert.ok(warnings.includes('FASTNRI.Damage.repeatIntervention'));
assert.equal(counterRoot.getFlag(ID,'checkRoll').result.degree,'great');
// Cover: no context or a stale selected die declares instead of manufacturing a transfer.
const coverSource=await ChatMessage.create({whisper:['p','gm'],flags:{[ID]:{weaponDamage:{version:2,parts:[{id:'A',kind:'die',formula:'1d6',value:5},{id:'B',kind:'die',formula:'1d6',value:3}],revision:0}}}});
const defender={actor,name:'Hero',document:{uuid:'Scene.s.Token.def'}};
const ally={actor:{uuid:'Actor.ally'},name:'Ally',document:{uuid:'Scene.s.Token.ally'}};
let candidates=[{ally,card:coverSource.getFlag(ID,'weaponDamage')}];
foundry.applications.api.DialogV2.input=async()=>({choice:'0'});actor.system.resources.reaction.current=2;
const linkedCover=await chooseCoverAlly({source:coverSource,defender,candidates:()=>candidates});assert.equal(linkedCover.getFlag(ID,'coverAlly').amount,5);assert.equal(actor.system.resources.reaction.current,1);assert.deepEqual(readyHp(linkedCover),{kind:'damage',amount:5});
const firstSource=coverSource.getFlag(ID,'weaponDamage');
candidates=[{ally,card:{...firstSource,parts:firstSource.parts.map(p=>({...p,excluded:p.id==='A'}))}}];
const secondCover=await chooseCoverAlly({source:coverSource,defender,candidates:()=>candidates});
assert.equal(secondCover.getFlag(ID,'coverAlly').amount,3);
assert.notEqual(secondCover.id,linkedCover.id);
assert.equal(actor.system.hp.current,20,'cover publication never applies HP');
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
// Blade is a contribution to an attack, never an independent expenditure.
const bladePublication=await publishAbility(invocationBlade);
assert.equal(actor.system.resources.magic.current,4);
const bladeManual=await executeAbilityFromChat(bladePublication,'manual-use',{skipPreroll:true});
assert.deepEqual(abilityExecutions(invocationBlade),[]);
assert.equal(bladeManual,null);
assert.equal(actor.system.resources.magic.current,4);
console.log('PASS invocation entrypoints: PC/NPC announcements without selectors, no independent Blade accounting');

// A blank level-1 Warlock can open and publish the original Compendium cards.
const {CLASSES, WARLOCK_SPELL_IDS}=await import('../module/data/classes.mjs');
const {missingClassAbilityRows}=await import('../module/sheets/class-abilities.mjs');
const abilitiesPath=new URL('../packs/_source/abilities/', import.meta.url);
const cardData=readdirSync(abilitiesPath).map(file=>JSON.parse(readFileSync(new URL(file,abilitiesPath),'utf8')));
const catalog=cardData.filter(data=>CLASSES.warlock.abilityIds.includes(data.flags[ID].contentId));
assert.equal(catalog.length,7);
let openedCard, ownedCreations=0;
const cardFromData=data=>({...data,id:data._id,documentName:'Item',
  getFlag(scope,key){return this.flags?.[scope]?.[key];},
  toObject(){return structuredClone(data);},sheet:{render:()=>{openedCard=data._id;}}});
game.packs=new Map([[`${ID}.abilities`,{getIndex:async()=>({contents:catalog}),
  getDocument:async id=>cardFromData(catalog.find(data=>data._id===id))}]]);
const warlock={...actor,id:'warlock',uuid:'Actor.warlock',system:{...actor.system,className:'Колдун'},items:new Map()};
Object.defineProperty(warlock.items,'contents',{get(){return [...this.values()];}});
warlock.createEmbeddedDocuments=async (type,[data])=>{
  assert.equal(type,'Item');
  const card={...cardFromData(data),parent:warlock,uuid:warlock.uuid+'.Item.'+data._id};
  ownedCreations++;
  warlock.items.set(card.id,card);
  return [card];
};
const warlockSheet=new FastNRICharacterSheet({actor:warlock});
const actions=sheetOptions(FastNRICharacterSheet).actions;
const rows=await missingClassAbilityRows(warlock);
assert.equal(rows.length,7);
const spell=WARLOCK_SPELL_IDS[0];
const button={closest:()=>({dataset:{classContentId:spell}})};
await actions.openItem.call(warlockSheet,null,button);
assert.equal(openedCard,catalog.find(data=>data.flags[ID].contentId===spell)._id);
assert.equal(ownedCreations,0,'viewing a class card does not write');
game.settings.get=()=> 'gm';
await actions.publishAbility.call(warlockSheet,null,button);
const publishedSpell=[...messages.values()].at(-1);
assert.deepEqual(publishedSpell.whisper,['gm']);
assert.match(publishedSpell.content,/Мистический заряд/);
assert.equal(ownedCreations,1);
assert.equal((await missingClassAbilityRows(warlock)).length,6);
await actions.publishAbility.call(warlockSheet,null,button);
assert.equal(ownedCreations,1,'a subsequent publication reuses the existing owned Item');
game.settings.get=()=> 'blind';
await actions.restActor.call(warlockSheet,null,{isConnected:true});
assert.equal([...messages.values()].at(-1).blind,true,'the Rest report uses the chat mode');
game.settings.get=()=> 'public';
assert.deepEqual(await missingClassAbilityRows(actor),[]);
console.log('PASS class spells: six original spells and Double Invocation, read-only view, owned publication without duplicates, current chat mode');

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

// D.2: first publication chooses an explicit weapon instance. No dialog may
// replace that declaration, even when the selected compatible item is not held.
const {abilityChatVariants}=await import('../module/abilities/ability-chat.mjs');
const loadCard=(folder,prefix)=>{const dir=new URL(`../packs/_source/${folder}/`,import.meta.url);return JSON.parse(readFileSync(new URL(readdirSync(dir).find(n=>n.startsWith(prefix+'--')),dir),'utf8'));};
const ownedFocus=(id,prefix)=>{const card=loadCard('weapons',prefix);const doc=item(id,card.system.mechanics,card.system);doc.type='weapon';doc.name=card.name;return doc;};
const focusWand=ownedFocus('focusWand','volshebnaia-palochka'),focusRod=ownedFocus('focusRod','zhezl'),focusSymbol=ownedFocus('focusSymbol','bozhestvennyi-simvol');
actor.system.className='Волшебник';actor.system.spellRange=4;actor.system.equipment={leftHand:focusWand.id};
actor.system.resources.magic.current=4;
const spellCard=loadCard('abilities','razrushenie-misticheskii-zariad');
const wizardRule=structuredClone(spellCard.system.mechanics.executions[0]);wizardRule.attack.spellEnergy='wizard';wizardRule.accounting={resourceCosts:[{resourceId:'magic',kind:'class',amount:1}]};
const wizardSpell=item('wizardSpell',{executions:[wizardRule]}, {tags:'Заклинание'});wizardSpell.type='ability';
const spellRows=()=>abilityChatVariants(actor,wizardSpell);
assert.deepEqual(spellRows().map(r=>r.spellWeaponId),[focusWand.id,focusRod.id,focusRod.id,null]);
assert.deepEqual(spellRows()[1].warnings,['FASTNRI.AbilityChat.notHeld']);
focusWand.system.proficiencyMode='no';assert.ok(spellRows()[0].warnings.includes('FASTNRI.AbilityChat.notProficient'));focusWand.system.proficiencyMode='auto';
const spellPublication=await publishAbility(wizardSpell);assert.equal(actor.system.resources.magic.current,4);
foundry.applications.api.DialogV2.input=async()=>{throw Error('extra weapon dialog after chat declaration');};
foundry.applications.api.DialogV2.wait=async()=>null;
assert.equal(await executeAbilityFromChat(spellPublication,wizardRule.id,{spellWeaponId:focusRod.id}),null);
assert.equal(actor.system.resources.magic.current,4);
failPublish=true;assert.equal(await executeAbilityFromChat(spellPublication,wizardRule.id,{spellWeaponId:focusRod.id,skipPreroll:true}),null);failPublish=false;
assert.equal(actor.system.resources.magic.current,4);
const notesBefore=warnings.length;
const rodCast=await executeAbilityFromChat(spellPublication,wizardRule.id,{spellWeaponId:focusRod.id,skipPreroll:true});
assert.equal(rodCast.getFlag(ID,'weaponAttack').weaponItemUuid,focusRod.uuid);
assert.ok(rodCast.getFlag(ID,'weaponAttack').weaponTraitIds.includes('spellweapon'));
assert.ok(!rodCast.getFlag(ID,'weaponAttack').weaponTraitIds.includes('guided'));
assert.ok(warnings.slice(notesBefore).some(w=>w.includes('FASTNRI.AbilityChat.notHeld')));
assert.equal(actor.system.resources.magic.current,3);
assert.deepEqual(actor.system.equipment,{leftHand:focusWand.id});
const noWeaponCast=await executeAbilityFromChat(spellPublication,wizardRule.id,{spellWeaponId:null,skipPreroll:true});
assert.equal(noWeaponCast.getFlag(ID,'weaponAttack').weaponItemUuid,undefined);assert.equal(actor.system.resources.magic.current,2);
assert.equal(await executeAbilityFromChat(spellPublication,wizardRule.id,{spellWeaponId:focusSymbol.id,skipPreroll:true}),null);
assert.equal(actor.system.resources.magic.current,2);
actor.isOwner=false;assert.equal(await executeAbilityFromChat(spellPublication,wizardRule.id,{spellWeaponId:focusWand.id,skipPreroll:true}),null);actor.isOwner=true;
spellPublication.isContentVisible=false;assert.equal(await executeAbilityFromChat(spellPublication,wizardRule.id,{spellWeaponId:focusWand.id,skipPreroll:true}),null);spellPublication.isContentVisible=true;
actor.system.equipment={leftHand:focusRod.id};assert.deepEqual(spellRows().map(r=>r.spellWeaponId),[focusRod.id,focusRod.id,focusWand.id,null]);
console.log('PASS D.2 chat spell variant: inventory order, warnings, explicit source, no extra dialog, no equipment writes, costs only on success, privacy and stale choice');

// Charged variants belong to each Item instance and use the existing Actor ledger.
const {chargedWeaponRemaining,restActor,recordCardUse,retryCardAccounting}=await import('../module/data/ability-accounting.mjs');
const secondRod=ownedFocus('secondRod','zhezl');
const chargeRow=weapon=>spellRows().find(r=>r.spellWeaponId===weapon.id&&r.charged);
actor.system.resources.magic.current=0;actor.system.resources.reaction.current=2;
wizardRule.accounting.resourceCosts.push({resourceId:'reaction',kind:'intervention',amount:1});
assert.ok(!chargeRow(focusRod).warnings.some(w=>w.includes('FASTNRI.AbilityChat.insufficient')));
assert.equal(chargedWeaponRemaining(actor,focusRod),1);
foundry.applications.api.DialogV2.wait=async cfg=>{assert.doesNotMatch(cfg.content,/trait-charged/);return null;};
assert.equal(await executeAbilityFromChat(spellPublication,wizardRule.id,{spellWeaponId:focusRod.id,charged:true}),null);
assert.equal(chargedWeaponRemaining(actor,focusRod),1);
failPublish=true;assert.equal(await executeAbilityFromChat(spellPublication,wizardRule.id,{spellWeaponId:focusRod.id,charged:true,skipPreroll:true}),null);failPublish=false;
assert.equal(chargedWeaponRemaining(actor,focusRod),1);assert.equal(actor.system.resources.reaction.current,2);
const chargedCast=await executeAbilityFromChat(spellPublication,wizardRule.id,{spellWeaponId:focusRod.id,charged:true,skipPreroll:true});
assert.equal(chargedCast.getFlag(ID,'abilityExecution').chargedWeaponUuid,focusRod.uuid);
assert.ok(chargedCast.getFlag(ID,'weaponAttack').weaponTraitIds.includes('charged'));
assert.equal(actor.system.resources.magic.current,0);assert.equal(actor.system.resources.reaction.current,1);
assert.equal(chargedWeaponRemaining(actor,focusRod),0);assert.equal(chargedWeaponRemaining(actor,secondRod),1);
assert.ok(chargeRow(focusRod).warnings.includes('FASTNRI.AbilityChat.chargedExhausted'));
await recordCardUse({actor,item:wizardSpell,message:chargedCast,execution:wizardRule,chargedWeaponUuid:focusRod.uuid});
assert.equal(actor.system.resources.reaction.current,1,'idempotent accounting');
const repeat=await executeAbilityFromChat(spellPublication,wizardRule.id,{spellWeaponId:focusRod.id,charged:true,skipPreroll:true});assert.ok(repeat);assert.equal(actor.system.resources.reaction.current,0);
assert.equal(chargedWeaponRemaining(actor,focusRod),0);assert.equal(chargedWeaponRemaining(actor,secondRod),1);
assert.equal(await executeAbilityFromChat(spellPublication,wizardRule.id,{spellWeaponId:focusWand.id,charged:true,skipPreroll:true}),null);
await restActor(actor);assert.equal(chargedWeaponRemaining(actor,focusRod),1);assert.equal(chargedWeaponRemaining(actor,secondRod),1);
// Recovery uses the declared charged source from the already published result,
// not the current inventory or a fresh resource-cost selection.
const updateActor=actor.update;
actor.update=async()=>{throw Error('simulated accounting write failure');};
const pendingCharge=await executeAbilityFromChat(spellPublication,wizardRule.id,{spellWeaponId:secondRod.id,charged:true,skipPreroll:true});
actor.update=updateActor;
assert.ok(pendingCharge);assert.equal(chargedWeaponRemaining(actor,secondRod),1);
assert.equal(actor.system.resources.magic.current,4);
pendingCharge.isAuthor=true;
await retryCardAccounting(pendingCharge,{actor,item:wizardSpell});
assert.equal(actor.system.resources.magic.current,4);
assert.equal(actor.system.resources.reaction.current,1);
assert.equal(chargedWeaponRemaining(actor,secondRod),0);
await retryCardAccounting(pendingCharge,{actor,item:wizardSpell});
assert.equal(actor.system.resources.reaction.current,1);
console.log('PASS Charged: separate instances, class costs only, intervention cost, cancellation, failed publication, repeated use warning, idempotency, Rest');

// D.2-P4: shared spell declaration for non-attack execution types. These are
// technical fixtures, not new rulebook cards. Test the existing owned-item
// publication and execution entry points, including a manual fallback.
const spellCosts={resourceCosts:[{resourceId:'magic',kind:'class',amount:1}]};
const modes=[
  {id:'check',label:'Check',type:'roll',formula:'1d20'},
  {id:'fixed',label:'Fixed',type:'temporaryHp',amount:5,target:'self'},
  {id:'rolled',label:'Rolled',type:'temporaryHp',formula:'1d6',target:'selected'},
  {id:'effect',label:'Effect',type:'effect',effectId:'test-effect'},
  {id:'projection',label:'Projection',type:'projection'}
];
const nonAttack=item('nonAttack',{spell:{spellEnergy:'wizard',spellRange:'current'},executions:modes,accounting:spellCosts},{tags:'Заклинание'});
nonAttack.type='ability';nonAttack.effects=new Map([['test-effect',{id:'test-effect',name:'Test effect',transfer:false}]]);
const manualSpell=item('manualSpell',{spell:{spellEnergy:'wizard'},accounting:spellCosts},{tags:'Заклинание'});manualSpell.type='ability';
const unmarked=item('unmarked',{executions:[modes[0]],accounting:spellCosts},{tags:'Заклинание'});unmarked.type='ability';
assert.equal(abilityChatVariants(actor,unmarked).length,1,'unknown non-attack energy is not inferred from the main class');
const nonAttackPub=await publishAbility(nonAttack),manualPub=await publishAbility(manualSpell);
assert.equal(abilityChatVariants(actor,nonAttack).filter(row=>row.executionId==='check').length,6);
assert.equal(abilityChatVariants(actor,manualSpell).filter(row=>row.spellWeaponId===focusRod.id).length,2);
assert.ok(!abilityChatVariants(actor,manualSpell).some(row=>row.details?.includes('spellDistance')),'no fictional range for an unmarked self/manual execution');
const latestMessage=()=>[...messages.values()].at(-1);
for(const mode of [...modes,{id:'manual-use'}]){
 const source=mode.id==='manual-use'?manualSpell:nonAttack;
 const pub=source===manualSpell?manualPub:nonAttackPub;
 await restActor(actor);
 const before=actor.system.resources.magic.current;
 const hp=actor.system.hp.current;
 const count=messages.size;
 failPublish=true;
 await executeAbilityFromChat(pub,mode.id,{spellWeaponId:focusRod.id,charged:true,skipPreroll:true});
 failPublish=false;
 assert.equal(messages.size,count);assert.equal(chargedWeaponRemaining(actor,focusRod),1);
 assert.equal(actor.system.resources.magic.current,before);
 await executeAbilityFromChat(pub,mode.id,{spellWeaponId:focusRod.id,charged:true,skipPreroll:true});
 const result=latestMessage(),receipt=result.getFlag(ID,'abilityExecution');
 assert.equal(receipt.executionId,mode.id);assert.equal(receipt.chargedWeaponUuid,focusRod.uuid);
 assert.equal(receipt.spellWeaponUuid,focusRod.uuid);
 assert.equal(chargedWeaponRemaining(actor,focusRod),0);assert.equal(actor.system.resources.magic.current,before);
 assert.equal(actor.system.hp.current,hp,'execution must not automatically apply HP');
 // Ordinary variant still spends the class resource, despite exhausted charge.
 await executeAbilityFromChat(pub,mode.id,{spellWeaponId:focusRod.id,skipPreroll:true});
 assert.equal(actor.system.resources.magic.current,before-1);
}
await restActor(actor);
foundry.applications.api.DialogV2.wait=async cfg=>{assert.doesNotMatch(cfg.content,/trait-charged/);return null;};
assert.equal(await executeAbilityFromChat(nonAttackPub,'check',{spellWeaponId:focusRod.id,charged:true}),null);
assert.equal(chargedWeaponRemaining(actor,focusRod),1);
// Non-attack recovery retains the price and explicit source on a failed write.
actor.update=async()=>{throw Error('simulated non-attack write failure');};
const failedEffect=await executeAbilityFromChat(nonAttackPub,'effect',{spellWeaponId:focusRod.id,charged:true,skipPreroll:true});
actor.update=updateActor;failedEffect.isAuthor=true;
const beforeRetry=actor.system.resources.magic.current;
await retryCardAccounting(failedEffect,{actor,item:nonAttack});
await retryCardAccounting(failedEffect,{actor,item:nonAttack});
assert.equal(actor.system.resources.magic.current,beforeRetry);assert.equal(chargedWeaponRemaining(actor,focusRod),0);
// A card with a tag and authored energy but no attack range uses current range.
const implicitRule=structuredClone(wizardRule);delete implicitRule.attack.spellRange;
const implicitSpell=item('implicitSpell',{executions:[implicitRule]},{tags:'Заклинание'});implicitSpell.type='ability';
assert.ok(abilityChatVariants(actor,implicitSpell).some(row=>row.spellWeaponId===focusRod.id));
const implicitPub=await publishAbility(implicitSpell);
assert.ok(await executeAbilityFromChat(implicitPub,implicitRule.id,{spellWeaponId:focusRod.id,skipPreroll:true}));
console.log('PASS shared spell variants: check, fixed/rolled temporary HP, effect, projection, manual, no energy inference, charge recovery and attack range default');

// Hidden new weapon provenance stays on the original Actor, including after
// a failed accounting write. The public message must not expose the weapon UUID.
await restActor(actor);
actor.hasPlayerOwner=false;game.user.isGM=true;game.actors={contents:[actor]};
foundry.utils.randomID=()=>String(++n).padStart(16,'0');
let failAccounting=true;
actor.update=async changes=>{
 if(failAccounting&&Object.keys(changes).some(key=>key.includes('accountingEvents')))throw Error('simulated hidden charge write failure');
 return updateActor.call(actor,changes);
};
const hiddenResult=await executeAbilityFromChat(manualPub,'manual-use',{spellWeaponId:focusRod.id,charged:true,skipPreroll:true});
assert.equal(hiddenResult.getFlag(ID,'spellCastRedacted'),true);
assert.ok(!JSON.stringify(hiddenResult.flags).includes(focusRod.uuid));
assert.equal(chargedWeaponRemaining(actor,focusRod),1);
failAccounting=false;hiddenResult.isAuthor=true;
const hiddenCost=actor.system.resources.magic.current;
assert.ok(await retryCardAccounting(hiddenResult,{actor,item:manualSpell}));
assert.equal(actor.system.resources.magic.current,hiddenCost);assert.equal(chargedWeaponRemaining(actor,focusRod),0);
actor.update=updateActor;actor.hasPlayerOwner=true;game.user.isGM=false;
console.log('PASS private non-attack spell receipt: no public weapon UUID, correct recovery');

// Non-attack targeted spells share only the range advisory, not combat penalties.
const rangeScene={id:'rangeScene'},rangeGrid={size:100,isSquare:true,measurePath:([a,b])=>({spaces:Math.abs(a.x-b.x)/100})};
const rangeSource={actor,document:{uuid:'Token.source',parent:rangeScene,x:0,y:0,width:1,height:1}};
const rangeTarget={actor:{system:{}},document:{uuid:'Token.target',parent:rangeScene,x:1300,y:0,width:1,height:1}};
canvas={scene:rangeScene,grid:rangeGrid,tokens:{controlled:[rangeSource],placeables:[rangeSource,rangeTarget]}};
game.user.targets=new Set([rangeTarget]);
const warningCount=warnings.length;
await executeAbilityFromChat(nonAttackPub,'rolled',{spellWeaponId:focusRod.id,skipPreroll:true});
assert.ok(warnings.slice(warningCount).includes('Цель вне дистанции заклинания'));
assert.equal(latestMessage().rolls[0].formula,'1d6');
foundry.applications.api.DialogV2.wait=async cfg=>{assert.match(cfg.content,/13 \/ 6 клеток/);assert.doesNotMatch(cfg.content,/Угрозы:|Строй:/);return null;};
assert.equal(await executeAbilityFromChat(nonAttackPub,'rolled',{spellWeaponId:focusRod.id}),null);
const countBeforeSelf=warnings.filter(s=>s==='Цель вне дистанции заклинания').length;
await executeAbilityFromChat(nonAttackPub,'fixed',{spellWeaponId:focusRod.id,skipPreroll:true});
assert.equal(warnings.filter(s=>s==='Цель вне дистанции заклинания').length,countBeforeSelf);
game.user.targets=new Set();canvas={tokens:{controlled:[]}};
console.log('PASS targeted non-attack spell: range advisory in preroll/Shift, no attack penalty or self warning');
