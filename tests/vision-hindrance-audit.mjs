/** P.3.1 regression on real pack sources and shared roll preparation; native canvas is not simulated. */
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {attackVision,targetHindranceEntries} from '../module/rolls/attack-hindrance.mjs';
import {prepareRoll,fixedRollComponents} from '../module/rolls/roll-context.mjs';
import {rollSnapshot,computedRollTotal} from '../module/damage/roll-editor.mjs';
const S='fast-nri-v14';
const cards=dir=>readdirSync(new URL(`../packs/_source/${dir}/`,import.meta.url)).filter(x=>x.endsWith('.json')).map(file=>JSON.parse(readFileSync(new URL(`../packs/_source/${dir}/${file}`,import.meta.url))));
const conditions=new Map(cards('conditions').map(c=>[c.system.mechanics.condition.id,c.effects[0]]));
const traits=cards('abilities').filter(c=>c.flags?.[S]?.visionKind);
const effect=(id,extra={})=>({...structuredClone(conditions.get(id)),...extra});
const actor=(items=[],effects=[])=>({uuid:'Actor.test',name:'Test',system:{},items:{contents:items},effects:{contents:effects}});
const low=traits.find(c=>c.flags[S].visionKind==='low-light'),dark=traits.find(c=>c.flags[S].visionKind==='darkvision');
assert.ok(low&&dark);
const normal=actor(),twilight=actor([low]),night=actor([dark]),both=actor([low,dark]);
globalThis.game={user:{isGM:true},i18n:{localize:k=>k},messages:new Map()};
const token={visible:true,document:{hidden:false}};
const entries=(a,ids,extra={})=>targetHindranceEntries({attacker:a,target:actor([],ids.map(id=>effect(id))),targetToken:token,...extra});
const values=(...args)=>entries(...args).map(e=>Number(e.parts[0].value));
for(const [a,kind,dim,darkness] of [[normal,'normal',[-4],[-10]],[twilight,'low-light',[],[-4]],[night,'darkvision',[],[]],[both,'darkvision',[],[]]]){
 assert.equal(attackVision(a),kind);
 assert.deepEqual(values(a,[]),[]);assert.deepEqual(values(a,['dim-light']),dim);assert.deepEqual(values(a,['darkness']),darkness);
 assert.deepEqual(values(a,['invisible','partial-cover','poor-visibility']),[-10,-4,-4]);
 assert.deepEqual(values(a,['darkness','invisible'],{area:true}),[]);
}
const v={flags:{[S]:{visionKind:'darkvision'}}};
assert.equal(attackVision(actor([low],[v])),'darkvision');
for(const inactive of [{disabled:true},{active:false},{isSuppressed:true},{expired:true},{duration:{expired:true}},{flags:{[S]:{visionKind:'darkvision',effectState:{strength:0}}}}]){
 assert.equal(attackVision(actor([low],[{...v,...inactive}])),'low-light');
 assert.equal(targetHindranceEntries({attacker:normal,target:actor([],[effect('darkness',{...inactive})])}).length,0);
}
const darkTarget=actor([],[effect('darkness')]);
for(const hiddenToken of [{visible:false},{visible:true,document:{hidden:true}},{hidden:true}])assert.deepEqual(targetHindranceEntries({attacker:normal,target:darkTarget,targetToken:hiddenToken}),[]);
for(const privateEffect of [{showIcon:0},{hidden:true},{flags:{[S]:{conditionId:'darkness',privateToGm:true}}},{flags:{[S]:{conditionId:'darkness',attackOutcomeApplication:true}}},{flags:{[S]:{conditionId:'darkness',abilityResultMessageId:'missing'}}}]){
 for(const isGM of [true,false]){game.user.isGM=isGM;const target={...actor([],[effect('darkness',privateEffect)]),testUserPermission:()=>true};assert.deepEqual(targetHindranceEntries({attacker:normal,target,targetToken:token}),[]);}
}
game.user.isGM=false;
assert.deepEqual(values(normal,['darkness']),[-10]); // publicly displayed icon
assert.deepEqual(values(normal,['darkness'],{targetToken:null}),[]);
assert.deepEqual(values(normal,['darkness'],{targetToken:null,target:{...darkTarget,testUserPermission:()=>true}}),[-10]);
game.user.isGM=true;
const target=actor([],[effect('darkness'),effect('partial-cover'),effect('darkness')]);
const range={uuid:'range',name:'Вторая дистанция',parts:[{id:'range',kind:'modifier',value:'-6',nonStackingGroup:'hindrance'}]};
const run=(a,extra={})=>prepareRoll({actor:a,kind:'attack',formula:'1d20',targetActor:target,targetToken:token,extraEntries:[range],skipDialog:true,...extra});
for(const [a,value] of [[normal,-10],[twilight,-6],[night,-6]]){
 const ctx=await run(a);assert.equal(ctx.hindrance.value,value);assert.equal(ctx.expression,`1d20 + (${value})`);
 const fixed=fixedRollComponents(ctx);assert.equal(fixed.length,1);assert.equal(fixed[0].value,value);
 const state=rollSnapshot({rolls:[{total:15+value,dice:[]}],getFlag:(_,k)=>k==='fixedRollComponents'?fixed:undefined});
 state.components[0].excluded=true;assert.equal(computedRollTotal(state),15);
}
for(const properties of ['Область действия','area','Атака, Область действия']){
 const ctx=await run(normal,{attackProperties:properties});assert.equal(ctx.hindrance,null);assert.equal(ctx.expression,'1d20');
}
assert.equal((await run(normal,{attackProperties:'areal'})).hindrance.value,-10);
assert.equal((await run(normal,{attackProperties:'Наводимое'})).expression,'1d20');
for(const kind of ['skill','ability','intervention','damage','heal'])assert.equal((await run(normal,{kind})).expression,'1d20');
console.log('PASS P.3.1 vision matrix, active sources, privacy, area/guided, strongest hindrance and roll-editor correction');

// Ranger's actual timed effect uses the same selected hindrance in formula and editor.
const senses=cards('abilities').find(c=>c._id==='fnriranger000007');
assert.equal(senses.effects[0].duration.expiry,'turnEnd');
const senseEffect={...senses.effects[0],uuid:'Actor.test.ActiveEffect.senses'};
const keen=actor([],[senseEffect]);
let ctx=await run(keen);assert.equal(ctx.hindrance.value,-6);assert.equal(ctx.expression,'1d20 + (-6)');
assert.equal(fixedRollComponents(ctx)[0].value,-6);
ctx=await run(keen,{targetActor:actor([],[effect('partial-cover')]),extraEntries:[]});
assert.equal(ctx.hindrance.value,0);assert.equal(ctx.expression,'1d20');assert.deepEqual(fixedRollComponents(ctx),[]);
ctx=await run(keen,{targetActor:null,extraEntries:[]});assert.equal(ctx.expression,'1d20');
ctx=await run(keen,{kind:'skill'});assert.equal(ctx.expression,'1d20');
senseEffect.disabled=true;assert.equal((await run(keen)).hindrance.value,-10);
console.log('PASS Ranger heightened senses: winning penalty only, no positive bonus, editor, disabled and non-attack');
