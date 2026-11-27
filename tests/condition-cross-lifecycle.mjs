/** A2.5: cross-subsystem regression on mocked documents and native Combat base. */
import assert from 'node:assert/strict';
import {CONDITION_STATUSES} from '../module/effects/condition-statuses.generated.mjs';
import {isOffGuard,isSlowed,isFrightened,isWeakened,prepareConditionDefenses,prepareConditionSpeed} from '../module/effects/condition-calculations.mjs';
import {conditionReminderEntries} from '../module/effects/condition-turn.mjs';
import {eligibleForGeneralEnding} from '../module/effects/effect-ending.mjs';
import {hasCondition,standingConscious} from '../module/spatial/geometry.mjs';
import {targetHindranceEntries} from '../module/rolls/attack-hindrance.mjs';
import {applicableRollEffects} from '../module/rolls/roll-context.mjs';
import {isActivePeriodicEffect,declaredPeriodicDefenses} from '../module/damage/periodic-damage.mjs';
const S='fast-nri-v14';
const messages=new Map(),events=[],rolls=[];
globalThis.game={user:{id:'gm',isGM:true},system:{id:S},users:{contents:[{id:'gm',isGM:true},{id:'owner'},{id:'other'}]},messages,i18n:{localize:k=>k}};
globalThis.foundry={documents:{Combat:class{async _onStartTurn(){events.push('native:start')}async _onEndTurn(){events.push('native:end')}}},applications:{ux:{TextEditor:{async enrichHTML(s){return s}}}}};
globalThis.Roll=class{constructor(formula){this.formula=formula;}async evaluate(){events.push(this.formula);assert.ok(rolls.length);this.total=rolls.shift();return this;}toJSON(){return {formula:this.formula,total:this.total}}static fromData(data){return Object.assign(new Roll(data.formula),data)}async toMessage(data){return {...data,rolls:[this.toJSON()]}}};
globalThis.ChatMessage={applyMode:data=>({...data,whisper:[],blind:false}),getSpeaker:({actor})=>({alias:actor.uuid}),async create(data){messages.set(data._id,{...data,getFlag(s,k){return this.flags?.[s]?.[k]}})}};
function writePath(root,path,value){const keys=path.split('.');let node=root;for(const key of keys.slice(0,-1))node=node[key]??={};const key=keys.at(-1);if(key.startsWith('-='))delete node[key.slice(2)];else node[key]=structuredClone(value);}
function actor(uuid){return {uuid,documentName:'Actor',type:'npc',isOwner:true,system:{hp:{current:20,temp:9}},flags:{[S]:{}},items:{contents:[]},effects:{contents:[],get(id){return this.contents.find(e=>e.id===id)}},allApplicableEffects(){return [...this.effects.contents]},testUserPermission:u=>u.id==='owner',getFlag(s,k){return this.flags[s]?.[k]},async update(patch){for(const [k,v] of Object.entries(patch))writePath(this,k,v);},async deleteEmbeddedDocuments(_,ids){events.push(...ids.map(id=>'delete:'+id));this.effects.contents=this.effects.contents.filter(e=>!ids.includes(e.id));}};}
const a=actor('Scene.s.Token.t.Actor.a'), base=actor('Actor.prototype');
function condition(id,instance=id,extra={}){const e={...structuredClone(CONDITION_STATUSES['fnri7-'+id]),id:instance,parent:a,_stats:{createdTime:1},...extra};e.flags[S]??={};return e;}
function periodic(id,extra={}){return {id,parent:a,name:id,flags:{[S]:{periodicDamage:{version:1,value:3,traits:['Физический'],durationTicks:1}}},getFlag(s,k){return this.flags[s]?.[k]},...extra};}
// Every runtime reader ignores the same inactive states, including raw status arrays.
for(const inactive of [{disabled:true},{active:false},{isSuppressed:true},{expired:true},{duration:{expired:true}},{zero:true}]){
 const rows=['prone','slowed','frightened','weakened','darkness'].map(id=>condition(id,id,inactive));
 const tick=periodic('tick',inactive);
 const custom={id:'custom',parent:a,uuid:'Actor.a.ActiveEffect.custom',flags:{[S]:{damageDefenses:{resistances:[{trait:'Физический',value:4}]},rollInfluence:{kinds:['skill'],modifier:'2'}}},...inactive};
 if(inactive.zero)for(const e of [...rows,tick,custom])e.flags[S].effectState={strength:0};
 a.effects.contents=[...rows,tick,custom];
 assert.equal(isOffGuard(a),false);assert.equal(isSlowed(a),false);assert.equal(isFrightened(a),false);assert.equal(isWeakened(a),false);
 assert.equal(hasCondition(a,['prone']),false);assert.equal(standingConscious({actor:a}),true);
 assert.deepEqual(targetHindranceEntries({target:a}),[]);assert.deepEqual(conditionReminderEntries(a),[]);
 assert.equal(eligibleForGeneralEnding(rows[1]),false);assert.equal(Boolean(isActivePeriodicEffect(tick)),false);
 assert.deepEqual(declaredPeriodicDefenses(a),[]);assert.deepEqual(applicableRollEffects(a,{kind:'skill'}),[]);
}
const prone=condition('prone'), grab=condition('grabbed'), slow=condition('slowed','s1'), slow2=condition('slowed','s2'), fear=condition('frightened'), weak=condition('weakened'), stun=condition('stunned'), tick=periodic('tick');
a.effects.contents=[prone,grab,slow,slow2,fear,weak,stun,tick];
const system={parent:a,speed:9,ac:{partial:10,success:15,great:20},defenses:{awareness:10,reflex:12,fortitude:14,will:16}};
prepareConditionDefenses(system);prepareConditionSpeed(system);assert.equal(system.speed,4);assert.deepEqual(system.ac,{partial:8,success:13,great:18});assert.ok(isFrightened(a)&&isWeakened(a));
assert.equal(standingConscious({actor:a}),false);
const hidden=condition('slowed','private');hidden.flags[S].attackOutcomeApplication=true;
a.effects.contents.push(hidden);assert.ok(conditionReminderEntries(a).find(e=>e.name==='Замедлен').gmOnly);a.effects.contents.pop();
// Run actual subclass hook with synthetic Actor preference, independent sources,
// periodic tick before clean DC15 checks, and the informational marker last.
const {FastNRICombat}=await import('../module/combat/fnri-combat.mjs');
const combat=Object.assign(new FastNRICombat(),{id:'c',round:1,started:true});
const cb={id:'cb',actor:base,token:{actor:a}};
await combat._onStartTurn(cb,{round:1});await combat._onStartTurn(cb,{round:1});assert.equal(messages.size,1);
await combat._onEndTurn(cb,{round:1,skipped:true});assert.equal(a.system.hp.current,20);
rolls.push(15,14,20,1);await combat._onEndTurn(cb,{round:1});
assert.equal(a.system.hp.current,17);assert.equal(a.system.hp.temp,9);assert.equal(base.system.hp.current,20);
assert.deepEqual(a.effects.contents.map(e=>e.id),['prone','grabbed','s2','weakened']);assert.ok(events.indexOf('delete:tick')<events.indexOf('1d20'));assert.ok(events.indexOf('delete:stunned')>events.lastIndexOf('1d20'));assert.equal(rolls.length,0);
const messageCount=messages.size;await combat._onEndTurn(cb,{round:1});assert.equal(messages.size,messageCount);assert.equal(a.system.hp.current,17);
// Even if the periodic subsystem fails before processing its first effect,
// general checks and marker cleanup still execute, without swallowing native errors.
a.effects.contents.push(condition('stunned','stun2'));const original=a.effects.contents;let fail=true;
Object.defineProperty(a.effects,'contents',{configurable:true,get(){if(fail){fail=false;throw Error('mock periodic read failure')}return original},set(v){original.splice(0,original.length,...v)}});
const log=console.error;const errors=[];console.error=(...args)=>errors.push(args);
try{rolls.push(15,15);await combat._onEndTurn(cb,{round:2});}finally{console.error=log;}
assert.equal(errors.length,1);assert.match(errors[0][0],/periodic damage end-turn failed/);assert.deepEqual(a.effects.contents.map(e=>e.id),['prone','grabbed']);assert.equal(rolls.length,0);
console.log('PASS A2.5 cross lifecycle: uniform inactive sources, combined conditions, native hook order, replay and isolated failure (mocks)');

// Updated Orc marker is shared by normal and automatic periodic HP paths.
const orc=actor('Actor.orc');orc.system.hp={current:2,max:10,temp:9};
orc.items.contents=[{type:'ability',name:'Неукротимость',uuid:'Actor.orc.Item.orc',img:'icons/magic/life/heart-cross-strong-flame-green.webp',system:{mechanics:{preventZeroHpMarker:true}}}];
orc.createEmbeddedDocuments=async(type,rows)=>rows.map(row=>{const e={...row,id:'marker',parent:orc,getFlag(s,k){return this.flags?.[s]?.[k]}};orc.effects.contents.push(e);return e;});
const orcCb={id:'orc',actor:orc};const effect=periodic('orcTick',{parent:orc});orc.effects.contents=[effect];
await combat._onEndTurn(orcCb,{round:2});assert.equal(orc.system.hp.current,1);assert.equal(orc.system.hp.temp,9);assert.equal(orc.effects.contents.length,1);assert.equal(orc.effects.contents[0].getFlag(S,'zeroHpPreventionUsed'),true);
orc.effects.contents.push(periodic('orcTick2',{parent:orc}));await combat._onEndTurn(orcCb,{round:3});assert.equal(orc.system.hp.current,0);
console.log('PASS updated Orc marker on periodic damage and second lethal hit');
