import {acceptPreroll} from './foundry-test-helpers.js';
import assert from 'node:assert/strict';
import {rollAreaIntervention,resolveAreaResults} from '../module/damage/area-attack.mjs';
import {hasIntervened} from '../module/damage/cover-ally-state.mjs';
import {selfDefenseFormula,initiateIntervention,availableInterventions} from '../module/damage/interventions.mjs';
const actor={name:'Страж',uuid:'Actor.x',type:'character',system:{defenses:{fortitude:3,reflex:5,will:6},combatDie:'d8'},
  items:[],getRollData(){return {};}};
const token={actor,name:'Страж',document:{uuid:'Scene.x.Token.1'}};
assert.equal(selfDefenseFormula(actor,'melee').expression,'1d20 + 3 + 1d8');
assert.equal(selfDefenseFormula(actor,'ranged').expression,'1d20 + 5 + 1d8');
assert.equal(selfDefenseFormula({type:'npc',system:{defenses:{fortitude:2},attackModifier:4}},'melee').expression,'1d20 + 2 + 4');
actor.items=[{id:'a',uuid:'Actor.x.Item.a',name:'Защита союзника',type:'ability',
  system:{trigger:'Вмешательство',rollFormula:'1d20+2'}}];
globalThis.game={user:{id:'gm',isGM:true,getFlag(){return false;},async setFlag(){}},i18n:{localize:k=>k}};
assert.equal(availableInterventions(actor).length,2);
const ID='fast-nri-v14';let seq=0;
const messages=[];
function msg(data){const m={id:`m${++seq}`,flags:data.flags??{},whisper:data.whisper??[],blind:data.blind??false,
  getFlag(scope,key){return this.flags?.[scope]?.[key];}};messages.push(m);return m;}
const root=msg({flags:{[ID]:{weaponDamage:{version:2,name:'Меч',degree:'great',effectDegree:'great',
  attackTotal:18,attackKind:'melee',naturalD20:13,originalTargetUuid:token.document.uuid,
  cancelled:false,parts:[{id:'A',kind:'die',value:6,original:6,excluded:false,formula:'1d6'},
    {id:'B',kind:'die',value:3,original:3,excluded:false,formula:'1d8'},
    {id:'C',kind:'fixed',value:6,original:6,excluded:false,formula:'6'}],
  history:[],revision:0}}}});
let natural=12;let total=19;let choice=0;
class RollMock {
 static validate(s){return !!s;}
 constructor(expression){this.formula=expression;this.total=total;this.dice=[{faces:20,number:1,results:[{result:natural,active:true}]}];}
 async evaluate(){return this;}
 toJSON(){return {formula:this.formula,total:this.total};}
}
globalThis.Roll=RollMock;
globalThis.canvas={tokens:{controlled:[token]}};
globalThis.game={user:{id:'gm',isGM:true,getFlag(){return false;},async setFlag(){}},i18n:{localize:k=>k}};
let warning=null;globalThis.ui={notifications:{warn(s){warning=s;},error(s){throw Error(s)}}};
globalThis.ChatMessage={getSpeaker(){return {actor:'x'}},create:async data=>msg(data)};
// Emulate the real dynamic choice menu, including its render callback.
globalThis.Option=class {constructor(text,value){this.text=text;this.value=value;}};
game.messages={contents:messages,get:id=>messages.find(m=>m.id===id)};
game.settings={get:()=> 'public'};
game.i18n.format=k=>k;
RollMock.prototype.toMessage=async function(data){return msg({...data,rolls:[this.toJSON()]});};
let menuWarnings=[],menuCloses=0;
const node=()=>({children:[],textContent:'',append(...nodes){this.children.push(...nodes);},replaceChildren(...nodes){this.children=nodes;}});
globalThis.foundry={applications:{api:{DialogV2:{wait:async cfg=>{
  if(!cfg.content.includes('data-fnri-intervention-show-all'))return acceptPreroll(cfg);
  assert.doesNotMatch(cfg.content,/<select|name="choice"/);
  assert.equal(cfg.buttons.length,1);assert.equal(cfg.buttons[0].action,'cancel');
  const list=node(),common=node(),toggle={checked:false},label=node();list.ownerDocument={createElement:node};
  const dialog={element:{querySelector(q){return q==='[data-fnri-button-choices]'?list:q==='[data-fnri-intervention-warnings]'?common:q==='[data-fnri-intervention-show-all]'?toggle:label;}},close(){menuCloses++;}};
  cfg.render(null,dialog);menuWarnings=common.children.map(n=>n.textContent);
  const button=list.children[choice];button?.onclick?.();button?.onclick?.();
  return null;
},input:async ({content})=>{
  if(content.includes('name="defense"'))return {defense:'will'};
  return {part:'C'};
},confirm:async()=>true}}}};
const newCard=await initiateIntervention(root);
const result=newCard.getFlag(ID,'weaponDamage');
assert.equal(result.previousMessageId,root.id);
assert.equal(result.attackTotal,18);
assert.equal(result.parts[2].excluded,true,'defender chooses tied fixed part');
assert.equal(root.getFlag(ID,'weaponDamage').parts[2].excluded,false,'old card is unchanged');
assert.equal(result.effectDegree,'success');
assert.equal(result.intervention.initiatorActorUuid,'Actor.x');
assert.equal(result.history.length,2);
natural=20;total=30;
const fresh=msg({flags:{[ID]:{weaponDamage:structuredClone(root.getFlag(ID,'weaponDamage'))}}});
const cancel=await initiateIntervention(fresh);
assert.equal(cancel.getFlag(ID,'weaponDamage').cancelled,true);
assert.equal(cancel.getFlag(ID,'weaponDamage').attackTotal,18);
choice=1;natural=8;total=9;
// A second deliberate intervention remains linked to the selected snapshot.
choice=0;
const unautomated=await initiateIntervention(newCard);
assert.ok(unautomated,'repeat remains available');
assert.equal(newCard.getFlag(ID,'weaponDamage').effectDegree,'success');
assert.equal(unautomated.getFlag(ID,'weaponDamage').previousMessageId,newCard.id);
assert.equal(unautomated.getFlag(ID,'weaponDamage').effectDegree,'success');
assert.equal(unautomated.getFlag(ID,'weaponDamage').intervention.success,false);
assert.ok(menuWarnings.includes('⚠ FASTNRI.Damage.repeatIntervention'));
assert.notEqual(warning,'FASTNRI.Damage.repeatIntervention','repeat is not notified twice');
assert.equal(menuCloses,3,'double click closes once per menu');
assert.equal(result.intervention.damageReduction,6);
assert.equal(result.intervention.success,true);
// Unknown incoming attack kind opens defense-stat choice instead of silently using Fortitude.
const unknown=msg({flags:{[ID]:{weaponDamage:{...root.getFlag(ID,'weaponDamage'),attackKind:null}}}});
choice=0;natural=10;total=17;
const statChoice=await initiateIntervention(unknown);
assert.equal(statChoice.getFlag(ID,'weaponDamage').intervention.defenseStat,'will');
assert.equal(selfDefenseFormula(actor,'unknown','will').expression,'1d20 + 6 + 1d8');
// Both natural twenties remain an ordinary successful defense and preserve crit.
const critical=msg({flags:{[ID]:{weaponDamage:{...structuredClone(root.getFlag(ID,'weaponDamage')),naturalD20:20}}}});
natural=20;total=30;
const doubleTwenty=(await initiateIntervention(critical)).getFlag(ID,'weaponDamage');
assert.equal(doubleTwenty.cancelled,false);assert.equal(doubleTwenty.naturalD20,20);assert.equal(doubleTwenty.effectDegree,'success');
assert.equal(doubleTwenty.intervention.damageReduction,12);
const unlucky=msg({flags:{[ID]:{weaponDamage:structuredClone(root.getFlag(ID,'weaponDamage'))}}});
natural=1;total=100;
const failed=(await initiateIntervention(unlucky)).getFlag(ID,'weaponDamage');
assert.equal(failed.intervention.success,false);assert.equal(failed.effectDegree,'great');assert.equal(failed.intervention.damageReduction,0);
// Two deliberate defenses of the same area action remain independent linked records.
actor.documentName='Actor';actor.isOwner=true;actor.items={contents:[]};actor.getFlag=()=>null;
token.document.actor=actor;token.document.hidden=false;
globalThis.foundry.utils={fromUuidSync:uuid=>uuid===token.document.uuid?token.document:null,randomID:()=>`test${seq}`};
RollMock.prototype.toMessage=async function(data,opts){const payload={...data,rolls:[this.toJSON()]};return opts?.create===false?payload:msg(payload);};
const areaRoot=msg({flags:{[ID]:{weaponDamage:{...structuredClone(root.getFlag(ID,'weaponDamage')),targetDefense:'reflex',
  areaAttack:{version:1,attackTotal:18,naturalD20:13,targets:[{uuid:token.document.uuid,key:token.document.uuid,name:token.name,status:'one',initialDegree:'great'}]}}}}});
choice=2;natural=12;total=19;
const areaFirst=await rollAreaIntervention(areaRoot,{skipPreroll:true});
assert.equal(areaFirst.getFlag(ID,'areaIntervention').rootMessageId,areaRoot.id);
assert.ok(hasIntervened(areaRoot,actor));
const areaSecond=await rollAreaIntervention(areaRoot,{skipPreroll:true});
assert.equal(areaSecond.getFlag(ID,'areaIntervention').rootMessageId,areaRoot.id);
assert.notEqual(areaSecond.id,areaFirst.id);
assert.equal(resolveAreaResults(areaRoot,[areaFirst,areaSecond].map(m=>m.getFlag(ID,'areaIntervention')))[0].degree,'partial');
assert.equal(areaRoot.getFlag(ID,'weaponDamage').areaAttack.targets[0].initialDegree,'great');
console.log('PASS stage 5 interventions: defense formula, tied maximum selection, linked immutable snapshot, natural20 cancellation, card-owned unknown');
// C1 Battle Scars: use the real card, actual directed Self-Defense path and
// optional preroll checkbox, not a fabricated result or changed source Roll.
const {readFileSync}=await import('node:fs');
const {selfDefenseReplacementEntries,replaceSurvivingDamage,replacementCandidates}=await import('../module/damage/self-defense-damage-replacement.mjs');
const {abilityAccountingStatus,restActor}=await import('../module/data/ability-accounting.mjs');
const {changePart}=await import('../module/damage/damage-core.mjs');
const {weaponRerollEligible}=await import('../module/equipment/weapon-traits.mjs');
const scars=JSON.parse(readFileSync(new URL('../packs/_source/abilities/boevye-shramy--fnri03efc669794a.json',import.meta.url)));
scars.id=scars._id;scars.uuid=`${actor.uuid}.Item.${scars.id}`;
actor.items={contents:[scars]};actor.flags={[ID]:{}};actor.getFlag=(s,k)=>actor.flags[s]?.[k];
actor.system.resources={};actor.system.hp={current:10,max:10,temp:0};actor.effects={contents:[]};
actor.update=async changes=>{for(const [path,val] of Object.entries(changes)){let target=actor;const keys=path.split('.');for(const k of keys.slice(0,-1))target=target[k]??={};target[keys.at(-1)]=val;}};
let acceptScars=true, chosenPart='B', replacementDialogs=0, lastReplacementContent='';
const dialog=foundry.applications.api.DialogV2,oldWait=dialog.wait;
dialog.wait=async cfg=>cfg.content.includes('data-fnri-intervention-show-all')?oldWait(cfg):acceptPreroll({...cfg,content:acceptScars?cfg.content.replace(/<label\b[^>]*>[\s\S]*?<\/label>/g,row=>row.includes('replaceSurvivingDie')?row.replace(/<input\b/,'<input checked'):row):cfg.content});
dialog.input=async cfg=>{if(!cfg.content.includes('replaceSurvivingDie'))return {part:'C'};replacementDialogs++;lastReplacementContent=cfg.content;return chosenPart?{part:chosenPart}:null;};
const makeAttack=(edit=()=>{})=>{const card=structuredClone(root.getFlag(ID,'weaponDamage'));edit(card.parts);return msg({flags:{[ID]:{weaponDamage:card}}});};
const mixed=parts=>{parts[0].traits=['Огонь'];parts[2].traits=['Холод'];};
const first=makeAttack();choice=0;natural=12;total=19;
const entry=selfDefenseReplacementEntries(actor,first.getFlag(ID,'weaponDamage'))[0];assert.equal(entry.parts[0].defaultEnabled,false);
const defended=(await initiateIntervention(first)).getFlag(ID,'weaponDamage');
assert.equal(defended.parts[2].excluded,true);assert.equal(defended.parts[0].value,1);assert.equal(defended.parts[0].original,6);assert.equal(defended.parts[0].noReroll,true);
assert.equal(defended.parts[1].value,3);assert.equal(replacementDialogs,0);
assert.equal(first.getFlag(ID,'weaponDamage').parts[0].value,6);assert.equal(abilityAccountingStatus(actor,scars).remaining,0);
assert.throws(()=>changePart(defended,'A','reroll',5),/cannot be rerolled/);
assert.equal(weaponRerollEligible({...defended.parts[0],faces:6},'sweeping','physical'),false);
assert.ok(selfDefenseReplacementEntries(actor,first.getFlag(ID,'weaponDamage'))[0].parts[0].warning);
// Failure is still Self-Defense: no new success requirement, warn but do not block.
natural=1;total=10;chosenPart='C';const failedScars=(await initiateIntervention(makeAttack(mixed))).getFlag(ID,'weaponDamage');
assert.equal(replacementDialogs,1);assert.match(lastReplacementContent,/Огонь/);assert.match(lastReplacementContent,/Холод/);assert.doesNotMatch(lastReplacementContent,/value="B"/);
assert.equal(failedScars.intervention.success,false);assert.equal(failedScars.parts[2].value,1);assert.equal(failedScars.parts[2].noReroll,true);assert.equal(abilityAccountingStatus(actor,scars).used,2);
// Cancellation of attack or replacement selection never consumes another use.
natural=20;total=40;assert.equal((await initiateIntervention(makeAttack())).getFlag(ID,'weaponDamage').cancelled,true);assert.equal(abilityAccountingStatus(actor,scars).used,2);
natural=1;total=10;chosenPart=null;await initiateIntervention(makeAttack(mixed));assert.equal(abilityAccountingStatus(actor,scars).used,2);
acceptScars=false;await initiateIntervention(makeAttack());assert.equal(abilityAccountingStatus(actor,scars).used,2);
acceptScars=true;chosenPart='B';await initiateIntervention(makeAttack(),{skipPreroll:true});assert.equal(abilityAccountingStatus(actor,scars).used,2);
await restActor(actor);assert.equal(abilityAccountingStatus(actor,scars).remaining,1);
assert.equal(replaceSurvivingDamage(defended,'C'),null);assert.equal(replaceSurvivingDamage(defended,'A'),null);
assert.equal(replacementCandidates({...defended,cancelled:true}).length,0);
// Equivalent tied maximum: different die size / fixed bonus do not require a choice.
natural=1;total=10;const beforeDialogs=replacementDialogs;
const equal=(await initiateIntervention(makeAttack(parts=>{parts[0].traits=['Огонь','Яд'];parts[2].traits=[' яд ','огонь','Яд'];}))).getFlag(ID,'weaponDamage');
assert.equal(equal.parts[0].value,1);assert.equal(equal.parts[2].value,6);assert.equal(replacementDialogs,beforeDialogs);
chosenPart='C';const typed=(await initiateIntervention(makeAttack(parts=>{parts[0].damageType='physical';parts[2].damageType='magic';}))).getFlag(ID,'weaponDamage');
assert.equal(replacementDialogs,beforeDialogs+1);assert.match(lastReplacementContent,/physical/);assert.match(lastReplacementContent,/magic/);assert.equal(typed.parts[0].value,6);assert.equal(typed.parts[2].value,1);
const largerResult=(await initiateIntervention(makeAttack(parts=>{parts[0].value=6;parts[1].value=4;parts[1].formula='1d12';parts[1].faces=12;parts[2].value=5;}))).getFlag(ID,'weaponDamage');
assert.equal(largerResult.parts[0].value,1);assert.equal(largerResult.parts[1].value,4);
const fixedMax=(await initiateIntervention(makeAttack(parts=>{parts[2].value=7;}))).getFlag(ID,'weaponDamage');
assert.equal(fixedMax.parts[2].value,1);assert.equal(replacementDialogs,beforeDialogs+1);
assert.equal(replaceSurvivingDamage(makeAttack().getFlag(ID,'weaponDamage'),'B'),null);
console.log('PASS Battle Scars: optional preroll, selection after Self-Defense, immutable source, fixed bonus, no reroll, warning, cancelled/no selection/skip, rest');

// Player-side choice relocates an already applied rule without accounting again.
const {componentChoices,moveComponentChoice,openComponentChoice,canMoveComponentChoice,registerDamageComponentChoice}=await import('../module/damage/damage-component-choice.mjs');
const editable=msg({flags:{[ID]:{weaponDamage:structuredClone(defended)}}});
editable.isAuthor=true;editable.canUserModify=()=>editable.isAuthor||game.user.isGM;
editable.update=async patch=>{editable.flags[ID].weaponDamage=structuredClone(patch[`flags.${ID}.weaponDamage`]);return editable;};
game.user.isGM=false;
assert.equal(canMoveComponentChoice(editable),true);
const firstChoice=componentChoices(defended).find(c=>c.kind==='set');assert.equal(firstChoice.currentId,'A');assert.deepEqual(firstChoice.candidates.map(p=>p.id),['B']);
assert.equal(moveComponentChoice(defended,firstChoice.index,'C'),null,'Scars only chooses surviving dice');
const swapRemoval=componentChoices(defended).find(c=>c.kind==='exclude');const swapped=moveComponentChoice(defended,swapRemoval.index,'A');assert.ok(swapped);assert.equal(swapped.parts[0].excluded,true);assert.equal(swapped.parts[2].value,1);assert.equal(swapped.parts[2].excluded,false);
const removal=componentChoices(defended).find(c=>c.kind==='exclude');assert.ok(removal);const manualDefense=moveComponentChoice(defended,removal.index,'B');assert.equal(manualDefense.parts[1].excluded,true);assert.equal(manualDefense.parts[2].excluded,false);assert.equal(manualDefense.parts[0].value,1);
const originalSnapshot=structuredClone(defended),usedBefore=abilityAccountingStatus(actor,scars).used;
let contextOptions=[];globalThis.Hooks={on(name,callback){if(name==='getChatMessageContextOptions')callback(null,contextOptions);}};
registerDamageComponentChoice();assert.equal(contextOptions.length,1);
const element={dataset:{messageId:editable.id}};assert.equal(contextOptions[0].visible(element),true);
dialog.input=async cfg=>{assert.match(cfg.content,/1d8 · 3/);assert.doesNotMatch(cfg.content,/1d6 · 1/);return {choice:`${firstChoice.index}:0`};};
const moved=await openComponentChoice(editable);assert.ok(moved);assert.equal(moved.parts[0].value,6);assert.equal(!!moved.parts[0].noReroll,false);assert.equal(moved.parts[1].value,1);assert.equal(moved.parts[1].noReroll,true);assert.equal(moved.parts[1].original,3);assert.equal(moved.parts[2].excluded,true);assert.equal(moved.revision,defended.revision+1);assert.equal(moved.intervention.damageReduction,8);assert.deepEqual(defended,originalSnapshot);assert.equal(abilityAccountingStatus(actor,scars).used,usedBefore);
const back=moveComponentChoice(moved,firstChoice.index,'A');assert.equal(back.parts[1].value,3);assert.equal(!!back.parts[1].noReroll,false);assert.equal(back.parts[0].value,1);assert.equal(back.intervention.damageReduction,defended.intervention.damageReduction);
// Repeated moves, another rule with the same declared contract.
assert.deepEqual(defended.history[firstChoice.index].selection,{kind:"set",value:1,noReroll:true});
const generic=structuredClone(defended);generic.history[firstChoice.index].rule='futureDamageRule';assert.equal(componentChoices(generic).length,2);
const subsequent=structuredClone(defended);subsequent.history.push({action:'intervention',source:'another'});assert.equal(componentChoices(subsequent).length,0);
const overridden=structuredClone(defended);overridden.parts[0].value=2;assert.equal(componentChoices(overridden).some(c=>c.kind==='set'),false);
editable.isAuthor=false;assert.equal(canMoveComponentChoice(editable),false);assert.equal(await openComponentChoice(editable),null);
editable.isAuthor=true;editable.isContentVisible=false;assert.equal(canMoveComponentChoice(editable),false);editable.isContentVisible=true;
dialog.input=async()=>null;assert.equal(await openComponentChoice(editable),null);assert.deepEqual(editable.getFlag(ID,'weaponDamage'),moved);
dialog.input=async()=>{editable.flags[ID].weaponDamage.revision++;return {choice:`${firstChoice.index}:0`};};assert.equal(await openComponentChoice(editable),null);assert.equal(editable.flags[ID].weaponDamage.parts[1].value,1);
console.log('PASS player component choice: native permissions, current generic descriptors, restore and move, no extra accounting, stale and cancelled dialog');

// C3: real Defender cards, a held shield and the shared defensive roll path.
const loadCard=(path)=>{const item=JSON.parse(readFileSync(new URL(path,import.meta.url)));item.id=item._id;item.uuid=`${actor.uuid}.Item.${item.id}`;return item;};
const ready=loadCard('../packs/_source/abilities/defender-always-ready--fnri21615603c8bc.json');
const shieldBlock=loadCard('../packs/_source/abilities/defender-shield-block--fnric6e9da6bbcdd.json');
const shield=loadCard('../packs/_source/equipment/shchit--fci2ac24kkhxdaq9.json');
const {extraDefenseRemovalEntries}=await import('../module/damage/interventions.mjs');
const {counteractionFormula}=await import('../module/damage/counteraction.mjs');
game.user.isGM=true;actor.items.contents=[ready,shieldBlock,shield];actor.system.equipment={leftHand:shield.id};
assert.equal(selfDefenseFormula(actor,'melee').expression,'1d20 + 3 + 2d6');
assert.equal(counteractionFormula(actor,'will'),'1d20 + (6) + 2d6');
assert.equal(extraDefenseRemovalEntries(actor,root.getFlag(ID,'weaponDamage')).length,1);
actor.system.equipment={};assert.equal(extraDefenseRemovalEntries(actor,root.getFlag(ID,'weaponDamage')).length,0);actor.system.equipment={leftHand:shield.id};
dialog.wait=async cfg=>cfg.content.includes('data-fnri-intervention-show-all')?oldWait(cfg):acceptPreroll({...cfg,content:cfg.content.replace(/<label\b[^>]*>[\s\S]*?<\/label>/g,row=>row.includes('Блок щитом')?row.replace(/<input\b/,'<input checked'):row)});
dialog.input=async()=>({part:'C'});choice=0;natural=12;total=19;
const blocked=(await initiateIntervention(makeAttack())).getFlag(ID,'weaponDamage');
assert.equal(blocked.parts[2].excluded,true);assert.equal(blocked.parts[0].excluded,true);assert.equal(blocked.parts[1].excluded,false);
assert.equal(componentChoices(blocked).filter(c=>c.kind==='exclude').length,2);
assert.equal(abilityAccountingStatus(actor,shieldBlock).used,1);
natural=1;total=10;await initiateIntervention(makeAttack());assert.equal(abilityAccountingStatus(actor,shieldBlock).used,1);
console.log('PASS Defender: protective 2d6, held shield, second removal, common choice history, accounting on success');
const allyDefense=loadCard('../packs/_source/abilities/defender-ally-defense--fnria16eb05827f1.json');
const rushDefense=loadCard('../packs/_source/abilities/defender-rush-defense--fnri0694d2da3d42.json');
actor.items.contents=[ready,allyDefense,rushDefense];
const allyAttack={...root.getFlag(ID,'weaponDamage'),originalTargetUuid:'Scene.x.Token.ally'};
const offered=availableInterventions(actor,{card:allyAttack,tokenUuid:token.document.uuid,allyTarget:true});
assert.deepEqual(offered.map(o=>o.item?.id),[allyDefense.id,rushDefense.id]);
assert.deepEqual(offered.map(o=>o.item.system.mechanics.accounting.resourceCosts[0].amount),[1,2]);
assert.equal(availableInterventions(actor,{card:allyAttack,tokenUuid:token.document.uuid}).length,0);
assert.ok(availableInterventions(actor,{card:allyAttack,tokenUuid:token.document.uuid,showAll:true}).find(o=>o.item===rushDefense).independent);
console.log('PASS Defender ally defense menu and card costs');

// Wizard shield: use the same defense path at spell range, remove two maxima,
// reduce the Effect by two, preserve the original and spend both resources.
const magicShield=loadCard('../packs/_source/abilities/wizard-shield--fnriwizard000007.json');
actor.items.contents=[magicShield];actor.system.className='Волшебник';actor.system.spellRange=4;
actor.system.resources={intervention:{kind:'intervention',current:2,max:2},class_wizard:{kind:'class',current:7,max:7}};
Object.assign(token.document,{parent:{id:'scene'},x:0,y:0,width:1,height:1,disposition:1});
const ally={actor:{uuid:'Actor.ally',type:'npc'},document:{uuid:'Scene.x.Token.ally',parent:{id:'scene'},x:300,y:0,width:1,height:1,disposition:1}};
canvas.tokens.placeables=[token,ally];canvas.grid={isSquare:true,size:100,measurePath:([a,b])=>({spaces:Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y))/100})};
const linked=msg({flags:{[ID]:{weaponDamage:{...structuredClone(allyAttack),targetDefense:'ac',defenseRemovalOrder:'lowest'}}}});
choice=0;natural=12;total=19;dialog.input=async()=>({part:'C'});
const magicResult=await initiateIntervention(linked,{skipPreroll:true});
assert.ok(magicResult);const shielded=magicResult.getFlag(ID,'weaponDamage');assert.equal(shielded.effectDegree,'partial');assert.equal(shielded.parts.filter(p=>p.excluded).length,2);assert.equal(shielded.parts[1].excluded,false);assert.equal(linked.getFlag(ID,'weaponDamage').parts.filter(p=>p.excluded).length,0);
assert.equal(actor.system.resources.class_wizard.current,6);assert.equal(actor.system.resources.intervention.current,1);
console.log('PASS Wizard Shield: spell range, two greatest results, degree minus two, both costs');
