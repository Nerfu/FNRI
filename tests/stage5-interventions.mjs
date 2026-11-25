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
globalThis.foundry={applications:{api:{DialogV2:{wait:acceptPreroll,input:async ({content,render})=>{
  if(content.includes('name="choice"')){
    assert.doesNotMatch(content,/<select/);
    assert.ok(content.indexOf('data-fnri-intervention-show-all') < content.indexOf('data-fnri-button-choices'),'show-all switch precedes choices');
    const input={value:''};
    const list={ownerDocument:{createElement(tag){return {tag,setAttribute(k,v){this[k]=v;}};}},replaceChildren(...buttons){this.buttons=buttons;}};
    const toggle={checked:false},label={};
    render(null,{element:{querySelector(q){return q==='input[name="choice"]'?input:q==='[data-fnri-button-choices]'?list:q==='[data-fnri-intervention-show-all]'?toggle:label;}}});
    list.buttons[choice]?.onclick?.();
    return {choice:input.value};
  }
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
assert.equal(result.history.length,1);
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
assert.equal(warning,'FASTNRI.Damage.repeatIntervention');
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
