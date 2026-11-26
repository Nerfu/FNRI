import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {isSlowed,prepareConditionSpeed} from '../module/effects/condition-calculations.mjs';
import {modifierGroups} from '../module/sheets/modifier-view.mjs';
class Field {constructor(...args){this.args=args;}}
class Model {prepareBaseData(){} prepareDerivedData(){}}
globalThis.foundry={data:{fields:{StringField:Field,NumberField:Field,SchemaField:Field,TypedObjectField:Field,ObjectField:Field}},abstract:{TypeDataModel:Model}};
const {CharacterModel,NPCModel}=await import('../module/data/models.mjs');
const load=(folder,stem)=>{
 const dir=new URL(`../packs/_source/${folder}/`,import.meta.url);
 const file=readdirSync(dir).find(n=>n.startsWith(stem+'--'));
 const obj=JSON.parse(readFileSync(new URL(file,dir),'utf8'));obj.id=obj._id;return obj;
};
const scope='fast-nri-v14';
const card=load('conditions','zamedlen');
const slow=structuredClone(card.effects[0]);
const hud={...structuredClone(slow),flags:{[scope]:{...slow.flags[scope],hudCondition:true}}};
const statusOnly={statuses:new Set(['fnri7-slowed'])};
const flagOnly={flags:{[scope]:{conditionId:'slowed'}}};
for(const effect of [slow,hud,statusOnly,flagOnly])assert.equal(isSlowed({effects:{contents:[effect]}}),true);
for(const effect of [{...slow,disabled:true},{...slow,active:false},{...slow,isSuppressed:true},{...slow,expired:true},{...slow,duration:{expired:true}},{...slow,flags:{[scope]:{conditionId:'slowed',effectState:{strength:0}}}},{name:'Замедлен',img:slow.img}])assert.equal(isSlowed({effects:{contents:[effect]}}),false);
for(const [initial,expected] of [[-5,1],[0,1],[0.5,1],[1,1],[2,1],[3,1],[4,2],[5,2],[6,3],[7,3],[8,4],[9,4],[2.5,1],[null,null],[undefined,undefined]]){
 const sys={speed:initial,parent:{effects:{contents:[slow,hud]}}};prepareConditionSpeed(sys);assert.equal(sys.speed,expected);
}
for(const [initial,expected] of [[-5,1],[0,1],[0.5,1],[1,1],[2.5,2.5],[7,7],[null,null],[undefined,undefined]]){
 const sys={speed:initial,parent:{effects:{contents:[]}}};prepareConditionSpeed(sys);assert.equal(sys.speed,expected);
}
const raw={className:'Воин',role:'',speed:null,hp:{current:null,max:null,temp:null},ac:{partial:null,success:null,great:null},defenses:{awareness:null,reflex:null,fortitude:null,will:null},resources:{},skills:{}};
const racial=load('abilities','nechelovecheskaia-skorost');
const native={name:'Бонус скорости',system:{changes:[{key:'system.speed',type:'add',value:'2'}]}};
function makeActor(type,source,items=[]){
 const actor={type,items:{contents:items},effects:{contents:[]},toObject:()=>({system:structuredClone(source)})};
 actor.prepare=(delta=0)=>{
  const model=new (type==='character'?CharacterModel:NPCModel)();Object.assign(model,structuredClone(source));model.parent=actor;actor.system=model;
  model.prepareBaseData();if(Number.isFinite(model.speed))model.speed+=delta; // simulate native AE preparation between phases
  model.prepareDerivedData();
 };
 return actor;
}
const pc=makeActor('character',raw,[racial]);
const rawBefore=JSON.stringify(raw),effectsBefore=JSON.stringify([slow,hud,native]);
pc.effects.contents=[slow,hud,native];
for(let i=0;i<3;i++){pc.prepare(2);assert.equal(pc.system.speed,5);}
// Odd final value distinguishes halving last from adding racial speed afterwards.
pc.prepare(1);assert.equal(pc.system.speed,4);pc.prepare(2);
const before=pc.system.speed;
const group=modifierGroups(pc).find(g=>g.name==='Fields.speed');
assert.equal(group.total,'5');assert.equal(group.sources.filter(s=>s.source==='ModifierView.slowed').length,1);
assert.deepEqual(group.sources.at(-1),{source:'ModifierView.slowed',value:'÷ 2',note:'ModifierView.once'});
assert.ok(group.sources.some(s=>s.source===racial.name));assert.ok(group.sources.some(s=>s.source===native.name));assert.equal(pc.system.speed,before);
pc.effects.contents=[hud,native];pc.prepare(2);assert.equal(pc.system.speed,5);
pc.effects.contents=[native];pc.prepare(2);assert.equal(pc.system.speed,10);assert.ok(!modifierGroups(pc).find(g=>g.name==='Fields.speed').sources.some(s=>s.source==='ModifierView.slowed'));
assert.equal(JSON.stringify(raw),rawBefore);assert.equal(JSON.stringify([slow,hud,native]),effectsBefore);
const npc=makeActor('npc',{...raw,speed:7});
npc.effects.contents=[slow];npc.prepare(-2);assert.equal(npc.system.speed,2);
// Transferred Item effects are visible even with no Actor-owned effects.
npc.effects.contents=[];npc.allApplicableEffects=function*(){yield statusOnly;};npc.prepare(2);assert.equal(npc.system.speed,4);
assert.equal(modifierGroups(npc).find(g=>g.name==='Fields.speed').total,'4');
npc.allApplicableEffects=function*(){yield {...slow,disabled:true};};npc.prepare();assert.equal(npc.system.speed,7);
const unset=makeActor('npc',{...raw,speed:null});unset.effects.contents=[slow];unset.prepare();assert.equal(unset.system.speed,null);
assert.ok(!modifierGroups(unset).some(g=>g.name==='Fields.speed'));
// P.4: the final minimum applies both with and without slowing, after native
// changes, on both actual model preparation paths. Raw actor data stays intact.
for(const type of ['character','npc']){
 const source={...raw,speed:1};
 const actor=makeActor(type,source);
 for(const effects of [[slow,hud],[],[{statuses:new Set(['fnri7-immobilized'])}]]){
  actor.effects.contents=effects;
  for(const delta of [0,-1,-5]){
   actor.prepare(delta);assert.equal(actor.system.speed,1);
   const overview=modifierGroups(actor).find(g=>g.name==='Fields.speed');
   if(overview)assert.equal(overview.total,'1');
   assert.equal(actor.toObject().system.speed,1);
  }
 }
 actor.effects.contents=[slow];actor.prepare(2);assert.equal(actor.system.speed,1);
 assert.equal(modifierGroups(actor).find(g=>g.name==='Fields.speed').total,'1');
 actor.effects.contents=[];actor.prepare(2);assert.equal(actor.system.speed,3);
}
console.log('PASS P.4 / A2.1 slowed: card/HUD/status/flag, inactive and transferred AE, PC/NPC preparation, native + racial before halving, rounding, independent removal, source-safe read-only overview');
