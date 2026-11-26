/** 0.2.1 audit: preserve verified existing condition and periodic rules.
 * These are deliberately document mocks, not native Foundry lifecycle tests. */
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {isOffGuard,prepareConditionDefenses} from '../module/effects/condition-calculations.mjs';
import {hasCondition,standingConscious} from '../module/spatial/geometry.mjs';
import {targetHindranceEntries} from '../module/rolls/attack-hindrance.mjs';
import {calculatePeriodicTick,orderedPeriodicEffects,planPeriodicHp,periodicEndPlan} from '../module/damage/periodic-damage.mjs';
import {planDeathTransition,advanceDeathEndTurn} from '../module/damage/death-lifecycle.mjs';
import {settlePeriodicEndTurn,retryPeriodicOutbox} from '../module/damage/periodic-turn.mjs';
const S='fast-nri-v14';
const cards=new Map(readdirSync(new URL('../packs/_source/conditions/',import.meta.url)).filter(x=>x.endsWith('.json')).map(file=>{
 const card=JSON.parse(readFileSync(new URL('../packs/_source/conditions/'+file,import.meta.url),'utf8'));
 const id=card.system.mechanics.condition.id;
 if(id==='stunned'){assert.equal(card.effects[0].flags[S].informationalMarker,true);assert.equal(card.effects[0].system.changes.length,0);}assert.equal(card.effects.length,1);assert.equal(card.effects[0].flags[S].conditionId,id);assert.ok(card.effects[0].statuses.includes('fnri7-'+id));
 return [id,card];
}));
assert.equal(cards.size,16);
const effect=(id,extra={})=>({...structuredClone(cards.get(id).effects[0]),statuses:new Set(['fnri7-'+id]),...extra});
const ac={partial:10,success:15,great:20},defenses={awareness:10,reflex:12,fortitude:14,will:16};
const actor={system:{hp:{current:10}},allApplicableEffects:()=>[effect('prone'),effect('grabbed'),effect('offguard')]};
const system={parent:actor,ac:{...ac},defenses:{...defenses}};
assert.ok(isOffGuard(actor));prepareConditionDefenses(system);
assert.deepEqual(system.ac,{partial:8,success:13,great:18});assert.deepEqual(system.defenses,{awareness:8,reflex:10,fortitude:12,will:14});
assert.equal(standingConscious({actor}),false);
actor.allApplicableEffects=()=>[effect('prone',{active:false}),effect('offguard',{disabled:true}),effect('grabbed',{isSuppressed:true})];
assert.equal(isOffGuard(actor),false);assert.equal(hasCondition(actor,['prone','grabbed']),false);assert.equal(standingConscious({actor}),true);
actor.allApplicableEffects=()=>[effect('grabbed')];assert.ok(standingConscious({actor}));assert.equal(standingConscious({actor},{forFormation:true}),false);
// Explicit visibility circumstances, not guessed lighting or hidden source details.
globalThis.game={user:{id:'gm',isGM:true},system:{id:S},i18n:{localize:k=>k},messages:new Map(),users:{contents:[]}};
const target={allApplicableEffects:()=>[effect('darkness'),effect('partial-cover')]};
const hindrance=attacker=>targetHindranceEntries({target,attacker}).map(x=>x.parts[0].value);
assert.deepEqual(hindrance({}),['-10','-4']);assert.deepEqual(hindrance({flags:{[S]:{visionKind:'low-light'}}}),['-4','-4']);assert.deepEqual(hindrance({flags:{[S]:{visionKind:'darkvision'}}}),['-4']);
assert.deepEqual(targetHindranceEntries({target,area:true}),[]);
game.user.isGM=false;assert.deepEqual(hindrance({}),[]);game.user.isGM=true;
const data={value:8,traits:['Физический','Огонь']};
const calc=calculatePeriodicTick(data,[{resistances:[{trait:'Огонь',value:3},{trait:'Физический',value:4}],vulnerabilities:[{trait:'Огонь',value:2},{trait:'Физический',value:1}]}]);
assert.equal(calc.total,6);assert.equal(data.value,8);assert.equal(calculatePeriodicTick(data,[{immunities:['Огонь']}]).total,0);
assert.equal(calculatePeriodicTick({value:5,traits:['Огонь']}).resolved,false);
assert.deepEqual(planPeriodicHp({current:4,temp:12},6).after,{current:0,temp:12});
assert.deepEqual(periodicEndPlan({durationTicks:2,end:{bonuses:[2,3],penalties:[1,2]}},1),{durationEnded:false,needsCheck:true,dc:11,modifier:1});
assert.equal(periodicEndPlan({durationTicks:2},2).needsCheck,false);
let rolls=[];let rolled=[];
globalThis.Roll=class {constructor(formula){this.formula=formula;}async evaluate(){rolled.push(this.formula);assert.ok(rolls.length,'unexpected roll '+this.formula);this.total=rolls.shift();return this;}toJSON(){return {formula:this.formula,total:this.total};}static fromData(data){return Object.assign(new Roll(data.formula),data);}async toMessage(data){return {...data,rolls:[this.toJSON()]};}};
function writePath(root,path,value){const parts=path.split('.');let node=root;for(const part of parts.slice(0,-1)){node[part]??={};node=node[part];}const key=parts.at(-1);if(key.startsWith('-='))delete node[key.slice(2)];else node[key]=structuredClone(value);}
function makeActor(id,type='npc',hp=20){const a={uuid:'Actor.'+id,name:id,documentName:'Actor',type,system:{hp:{current:hp,temp:9}},flags:{[S]:{}},items:{contents:[]},isOwner:true,canUserModify:()=>true,getFlag(s,k){return this.flags[s]?.[k]},async update(changes){for(const [k,v] of Object.entries(changes))writePath(this,k,v);return this;},effects:{contents:[],get(id){return this.contents.find(x=>x.id===id);}},async deleteEmbeddedDocuments(_,ids){this.effects.contents=this.effects.contents.filter(x=>!ids.includes(x.id));}};return a;}
const pc=makeActor('pc','character',5);rolls=[6];let death=await planDeathTransition(pc,{before:5,after:0,kind:'damage',hitPointsDamage:5,periodic:true});assert.equal(death.after.remaining,5);await pc.update({...death.patch,'system.hp.current':0});
const identity={combatId:'c',combatantId:'p',round:1,key:'c:p:1'};assert.equal((await advanceDeathEndTurn(pc,identity)).remaining,4);assert.equal(await advanceDeathEndTurn(pc,identity),null);
death=await planDeathTransition(pc,{before:0,after:0,kind:'damage',hitPointsDamage:1,naturalD20:20,degree:'great'});assert.equal(death.after.remaining,1);
death=await planDeathTransition(pc,{before:0,after:4,kind:'heal'});assert.equal(death.after,null);
const npc=makeActor('npc');const add=(id,value,createdTime,extra={})=>{const e={id,name:'same-name',parent:npc,_stats:{createdTime},flags:{[S]:{periodicDamage:{version:1,value,traits:['Физический'],...extra}}},getFlag(s,k){return this.flags[s]?.[k]}};npc.effects.contents.push(e);return e;};
add('small',2,1,{durationTicks:1});add('large-late',4,3,{end:{skipCheck:true}});add('large-early',4,2,{durationTicks:1});
assert.deepEqual(orderedPeriodicEffects(npc).map(x=>x.id),['large-early','large-late','small']);
let failNext=true;
globalThis.ChatMessage={applyMode:data=>({...data,whisper:[],blind:false}),getSpeaker:()=>({}),async create(data){if(failNext){failNext=false;throw Error('simulated chat failure');}const message={...data,getFlag(s,k){return this.flags[s]?.[k]}};game.messages.set(data._id,message);return message;}};
const c={id:'combat',started:true},cb={id:'npc',actor:npc};
const log=console.error;console.error=(...args)=>{if(!String(args[0]).includes('periodic outbox requires retry'))log(...args);};
try {const r=await settlePeriodicEndTurn(c,cb,{round:1});assert.deepEqual(r.results.map(x=>x.id),['large-early','large-late','small']);assert.equal(npc.system.hp.current,10);assert.equal(npc.system.hp.temp,9);assert.deepEqual(npc.effects.contents.map(x=>x.id),['large-late']);assert.equal((await retryPeriodicOutbox(npc)).pending,0);assert.equal(game.messages.size,3);await settlePeriodicEndTurn(c,cb,{round:1});assert.equal(npc.system.hp.current,10);assert.equal(game.messages.size,3);await settlePeriodicEndTurn(c,cb,{round:2,skipped:true});assert.equal(npc.system.hp.current,10);await settlePeriodicEndTurn(c,cb,{round:2});assert.equal(npc.system.hp.current,6);assert.equal(game.messages.size,4);}finally{console.error=log;}
assert.deepEqual(rolled,['1d4+3']);assert.equal(rolls.length,0);
console.log('PASS condition templates, off-guard, visibility, periodic ordering/defenses/HP, death planning and turn/outbox replay (mock)');
