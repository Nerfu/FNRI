import assert from 'node:assert/strict';
import {selfDefenseFormula,initiateIntervention,availableInterventions} from '../module/damage/interventions.mjs';
const actor={name:'Страж',uuid:'Actor.x',type:'character',system:{defenses:{fortitude:3,reflex:5,will:6},combatDie:'d8'},
  items:[],getRollData(){return {};}};
const token={actor,name:'Страж',document:{uuid:'Scene.x.Token.1'}};
assert.equal(selfDefenseFormula(actor,'melee').expression,'1d20 + 3 + 1d8');
assert.equal(selfDefenseFormula(actor,'ranged').expression,'1d20 + 5 + 1d8');
assert.equal(selfDefenseFormula({type:'npc',system:{defenses:{fortitude:2},attackModifier:4}},'melee').expression,'1d20 + 2 + 4');
actor.items=[{id:'a',uuid:'Actor.x.Item.a',name:'Защита союзника',type:'ability',
  system:{trigger:'Вмешательство',rollFormula:'1d20+2'}}];
globalThis.game={user:{id:'gm',isGM:true},i18n:{localize:k=>k}};
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
globalThis.game={user:{id:'gm',isGM:true},i18n:{localize:k=>k}};
let warning=null;globalThis.ui={notifications:{warn(s){warning=s;},error(s){throw Error(s)}}};
globalThis.ChatMessage={getSpeaker(){return {actor:'x'}},create:async data=>msg(data)};
globalThis.foundry={applications:{api:{DialogV2:{input:async ({content})=>
  content.includes('name="choice"')?{choice:String(choice)}:
  content.includes('name="defense"')?{defense:'will'}:{part:'C'},confirm:async()=>true}}}};
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
const cancel=await initiateIntervention(root);
assert.equal(cancel.getFlag(ID,'weaponDamage').cancelled,true);
assert.equal(cancel.getFlag(ID,'weaponDamage').attackTotal,18);
choice=1;natural=8;total=9;
assert.equal(await initiateIntervention(newCard),null,'intervention cannot create a further intervention');
assert.equal(warning,'FASTNRI.Damage.interventionBlocked');
newCard.flags[ID].interventionOverride=false; // GM reopened intervention window
const unautomated=await initiateIntervention(newCard);
assert.equal(unautomated.getFlag(ID,'weaponDamage').effectDegree,'success','unknown intervention is not guessed');
assert.equal(unautomated.getFlag(ID,'weaponDamage').previousMessageId,newCard.id);
// Unknown incoming attack kind opens defense-stat choice instead of silently using Fortitude.
const unknown=msg({flags:{[ID]:{weaponDamage:{...root.getFlag(ID,'weaponDamage'),attackKind:null}}}});
choice=0;natural=10;total=17;
const statChoice=await initiateIntervention(unknown);
assert.equal(statChoice.getFlag(ID,'weaponDamage').intervention.defenseStat,'will');
assert.equal(selfDefenseFormula(actor,'unknown','will').expression,'1d20 + 6 + 1d8');
console.log('PASS stage 5 interventions: defense formula, tied maximum selection, linked immutable snapshot, natural20 cancellation, card-owned unknown');
