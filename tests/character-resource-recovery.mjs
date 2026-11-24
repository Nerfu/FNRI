import assert from 'node:assert/strict';
import {CLASSES,combatStartResourceUpdate} from '../module/data/classes.mjs';
import {restActor} from '../module/data/ability-accounting.mjs';
let seq=0;const notices=[];
globalThis.game={user:{id:'gm',isGM:true},time:{worldTime:100},i18n:{localize:x=>x}};
globalThis.ui={notifications:{warn:x=>notices.push(x)}};
globalThis.foundry={utils:{randomID:()=>`id${++seq}`},documents:{Combat:class {
 constructor(combatants){this.combatants=combatants;this.started=false;}
 async startCombat(){if(this.fail)throw Error('native failed');this.started=true;return this;}
}}};
const {FastNRICombat}=await import('../module/combat/fnri-combat.mjs');
const patch=(doc,changes)=>{for(const [key,value] of Object.entries(changes)){const path=key.split('.');let target=doc;for(const k of path.slice(0,-1))target=target[k]??={};target[path.at(-1)]=structuredClone(value);}return doc;};
function actor(id,rule,{type='character',rowId=rule.resource.id,current=1,max=rule.resource.max}={}){
 const {id:_,...r}=rule.resource;return {uuid:id,type,isOwner:true,system:{className:rule.name,hp:{current:3,max:20,temp:0},potionsUsed:2,resources:{[rowId]:{...r,current,max},other:{name:'Прочее',current:1,max:2}}},effects:{contents:[]},items:{contents:[]},flags:{},writes:[],getFlag(s,k){return this.flags?.[s]?.[k];},async update(p,opts){this.writes.push([p,opts]);return patch(this,p);}};
}
const w=actor('Actor.w',CLASSES.warlock,{max:6}),b=actor('Actor.b',CLASSES.bard,{current:3}),c=actor('Actor.c',CLASSES.cleric),d=actor('Actor.d',CLASSES.druid),m=actor('Actor.m',CLASSES.wizard),n=actor('Actor.n',CLASSES.warlock,{type:'npc'}),p=actor('Actor.p',CLASSES.bard,{type:'projection'}),outside=actor('Actor.out',CLASSES.warlock),synthetic=actor('Scene.s.Token.t.Actor.w',CLASSES.warlock),custom=actor('Actor.custom',CLASSES.bard,{rowId:'custom',current:2});
const missing=actor('Actor.missing',CLASSES.warlock);delete missing.system.resources.class_magic;
const encounter=new FastNRICombat([w,w,b,c,d,m,n,p,synthetic,custom,missing].map(actor=>({actor})));
assert.equal(await encounter.startCombat(),encounter);assert.equal(w.system.resources.class_magic.current,6);assert.equal(b.system.resources.class_rhythm.current,0);assert.equal(synthetic.system.resources.class_magic.current,4);assert.equal(custom.system.resources.custom.current,0);
assert.equal(w.writes.length,1);assert.equal(w.writes[0][1].fnriJournal.kind,'combatStart');
for(const a of [c,d,m,n,p,outside,missing])assert.equal(a.writes.length,0);
assert.equal(w.system.potionsUsed,2);assert.equal(w.system.hp.current,3);assert.equal(w.system.resources.other.current,1);
w.system.resources.class_magic.current=1;b.system.resources.class_rhythm.current=2;await encounter.startCombat();assert.equal(w.system.resources.class_magic.current,1);assert.equal(b.system.resources.class_rhythm.current,2);
encounter.started=false;await encounter.startCombat();assert.equal(w.system.resources.class_magic.current,6);assert.equal(b.system.resources.class_rhythm.current,0);
const failed=new FastNRICombat([{actor:outside}]);failed.fail=true;await assert.rejects(failed.startCombat(),/native failed/);assert.equal(outside.writes.length,0);
const blocked=actor('Actor.blocked',CLASSES.warlock);blocked.update=async()=>{throw Error('denied');};const oldError=console.error;console.error=()=>{};await new FastNRICombat([{actor:blocked},{actor:outside}]).startCombat();console.error=oldError;assert.equal(notices.length,1);assert.equal(outside.system.resources.class_magic.current,4);
const amb=actor('Actor.amb',CLASSES.bard,{rowId:'one'});amb.system.resources.two={...amb.system.resources.one};assert.deepEqual(combatStartResourceUpdate(amb),{});
for(const a of [w,b,c,d,m,n,custom]){
 const [id,row]=Object.entries(a.system.resources)[0];row.current=1;a.system.hp.current=3;a.system.potionsUsed=2;
 const result=await restActor(a);const target=a===b||a===custom?0:row.max;
 assert.equal(row.current,target);assert.equal(result.resourceChanges.find(r=>r.resourceId===id)?.after,target);assert.equal(a.system.hp.current,20);assert.equal(a.system.potionsUsed,0);assert.equal(a.system.resources.other.current,2);assert.equal(a.writes.at(-1)[1].fnriJournal.kind,'rest');
}
console.log('PASS class resource recovery: native start, repeated/failed starts, linked/synthetic actors, unaffected classes/NPC/projection, manual max, missing/ambiguous rows, Rest and potion/HP preservation');
