import assert from 'node:assert/strict';
import {abilityCostPreview,resourceCostPlan,recordCardUse,publishAreaUse,retryCardAccounting,accountingJournal,resourceAssignment} from '../module/data/ability-accounting.mjs';
import {registerClassLifecycle} from '../module/data/class-lifecycle.mjs';
const S='fast-nri-v14',messages=new Map();
const patch=(obj,changes)=>{for(const [path,value] of Object.entries(changes)){const keys=path.split('.');let p=obj;for(const k of keys.slice(0,-1))p=p[k]??={};const k=keys.at(-1);if(k.startsWith('-='))delete p[k.slice(2)];else p[k]=structuredClone(value);}};
function actor(resources={},type='character',uuid='Actor.test') {return {type,uuid,id:'test',isOwner:true,system:{resources},flags:{},items:[],getFlag(s,k){return this.flags?.[s]?.[k]},async update(p){patch(this,p);}};}
function item(costs){return {id:'spell',uuid:'Actor.test.Item.spell',type:'ability',name:'Spell',system:{mechanics:{accounting:{resourceCosts:costs}}}};}
const msg=id=>({id,uuid:`ChatMessage.${id}`,isAuthor:true,whisper:[],getFlag:(s,k)=>k==='areaIntervention'?{}:null});
globalThis.game={user:{id:'owner',isGM:true},messages, time:{serverTime:1000},i18n:{localize:k=>k},settings:{get:()=> 'public'}};
globalThis.foundry={utils:{randomID:()=> 'abcdefgh12345678'}};
const reaction={kind:'intervention',name:'Renamed',current:1,max:1},magic={kind:'class',resourceKey:'class_magic',name:'Renamed magic',current:4,max:4};
const execution={isIntervention:true};
const spell=item([{resourceName:'Магическая сила',kind:'class',amount:2}]);
const reasons=(a,i,e)=>abilityCostPreview(a,i,e).map(x=>[x.scope,x.reason,x.amount]);
assert.deepEqual(reasons(actor(),null,execution),[['common','missing',1]]);
assert.deepEqual(reasons(actor({x:{name:'Вмешательства',current:1}}),null,execution),[['common','missing',1]]);
assert.deepEqual(reasons(actor({a:reaction,b:reaction}),null,execution),[['common','ambiguous',1]]);
assert.deepEqual(reasons(actor({a:{...reaction,current:0}}),null,execution),[['common','insufficient',1]]);
assert.deepEqual(reasons(actor({a:{...reaction,current:null}}),null,execution),[['common','unavailable',1]]);
assert.deepEqual(reasons(actor(),null,null),[]);
assert.deepEqual(reasons(actor(),item([{kind:'intervention',amount:0}]),execution),[]);
const projection=actor({},'npc');projection.documentName='Actor';projection.flags[S]={projectionTemplate:true};assert.deepEqual(reasons(projection,null,execution),[]);
assert.deepEqual(reasons(actor({a:{kind:'class',name:'Магическая сила',current:4}}),spell),[['individual','missing',2]]);
assert.deepEqual(reasons(actor({a:magic,b:magic}),spell),[['individual','ambiguous',2]]);
assert.deepEqual(reasons(actor({class_magic:{...reaction}}),spell),[['individual','kindMismatch',2]]);
assert.equal(resourceAssignment('class_magic',{kind:'class'}),'class_magic');
const a=actor({a:{...reaction},m:{...magic}});
assert.deepEqual(resourceCostPlan(a,spell,execution).map(x=>[x.scope,x.resourceId,x.amount,x.current,x.reason]),[['individual','m',2,4,null],['common','a',1,1,null]]);
const first=await recordCardUse({actor:a,item:spell,message:msg('one'),isIntervention:true,execution});assert.equal(a.system.resources.m.current,2);assert.equal(a.system.resources.a.current,0);assert.equal(first.classResourceChanges.length,1);
await recordCardUse({actor:a,item:spell,message:msg('one'),isIntervention:true,execution});assert.equal(a.system.resources.m.current,2);
const next=await recordCardUse({actor:a,item:spell,message:msg('two'),isIntervention:true,execution});assert.equal(a.system.resources.m.current,0);assert.equal(next.skippedCosts[0].reason,'insufficient');assert.equal(accountingJournal(a).length,2);
const wrong=item([{resourceId:'a',kind:'class',amount:1}]);a.system.resources.a.current=1;
const result=await recordCardUse({actor:a,item:wrong,message:msg('three')});assert.equal(result.skippedCosts[0].reason,'kindMismatch');assert.equal(a.system.resources.a.current,1);assert.equal(accountingJournal(a).length,2);
// Variants replace price, but do not waive the common cost of a genuine intervention.
assert.deepEqual(resourceCostPlan(a,spell,{isIntervention:true,accounting:{resourceCosts:[]}}).map(x=>x.scope),['common']);
assert.deepEqual(resourceCostPlan(a,spell,{isIntervention:false,accounting:{resourceCosts:[]}}),[]);
// Explicit same-row costs combine before checking sufficiency.
assert.equal(resourceCostPlan(a,item([{resourceId:'a',kind:'intervention',amount:1},{resourceId:'a',kind:'intervention',amount:1}]),execution)[0].amount,2);
// Prepared resource values do not become persisted base values on spending.
const eff=actor({m:{...magic,current:6}});eff.toObject=()=>({system:{resources:{m:{...magic,current:4}}}});
await recordCardUse({actor:eff,item:spell,message:msg('eff')});assert.equal(eff.system.resources.m.current,2);
// Area receipt records identity and price before publication; no historical repricing.
const zone=actor({a:{...reaction},m:{...magic}});const area=await publishAreaUse({actor:zone,item:spell,execution,isIntervention:true,messageId:'areause123456789',publish:async id=>{const m=msg(id);messages.set(id,m);spell.system.mechanics.accounting.resourceCosts[0].amount=4;return m;}});
assert.equal(zone.system.resources.m.current,2);assert.equal(zone.system.resources.a.current,0);
assert.ok(await retryCardAccounting(area,{actor:zone,item:spell,isIntervention:true}));assert.equal(zone.system.resources.m.current,2);
assert.equal(await publishAreaUse({actor:zone,item:spell,execution,isIntervention:true,messageId:'cancel1234567890',publish:async()=>null}),null);assert.equal(zone.system.resources.m.current,2);
// Two synthetic Actor instances never share an assignment or use receipt.
const other=actor({a:{...reaction}},'npc','Scene.s.Token.b.Actor');await recordCardUse({actor:other,message:msg('one'),isIntervention:true});assert.equal(other.system.resources.a.current,0);assert.equal(zone.system.resources.m.current,2);
const hooks=new Map();globalThis.Hooks={on:(k,v)=>hooks.set(k,v)};foundry.utils.expandObject=p=>{const result={};patch(result,p);return result;};registerClassLifecycle();
for(const type of ['character','npc']){const fresh=actor({},type);fresh.items={contents:[]};fresh.toObject=()=>({system:structuredClone(fresh.system)});fresh.updateSource=x=>Object.assign(fresh.system,x.system);hooks.get('preCreateActor')(fresh,{},{},'owner');assert.equal(fresh.system.resources.intervention?.current,type==='character'?1:undefined);}
console.log('PASS A.1 assignments: explicit identity, all reasons, variants, common/individual, duplicate, base/derived, private area receipt, cancellation, synthetic actors, new PC/NPC');
