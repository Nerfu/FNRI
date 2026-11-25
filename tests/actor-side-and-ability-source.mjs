import assert from 'node:assert/strict';
import {actorSideContext, defaultActorSide, registerActorSides, setActorSide, synchronizePCSide, tokenSide} from '../module/data/actor-side.mjs';
import {abilitySource} from '../module/data/ability-source.mjs';
import {WARLOCK_SPELL_IDS} from '../module/data/classes.mjs';
import {formationForTarget} from '../module/spatial/formation.mjs';
import {coverRecipients} from '../module/damage/cover-ally-state.mjs';
const scope='fast-nri-v14';
const hooks=new Map();
globalThis.Hooks={on:(name,fn)=>hooks.set(name,fn)};
globalThis.CONST={TOKEN_DISPOSITIONS:{FRIENDLY:1,HOSTILE:-1,NEUTRAL:0,SECRET:-2}};
globalThis.game={user:{id:'u',targets:new Set()},i18n:{localize:k=>k}};
const warnings=[];globalThis.ui={notifications:{warn:s=>warnings.push(s)}};
registerActorSides();
const hook=(name,...args)=>hooks.get(name)(...args);
let seq=0;
function actor(type,side,system={}){
  const id=String(++seq);return {id,uuid:`Actor.${id}`,type,system:{hp:{current:10},equipment:{},...system},prototypeToken:{disposition:side},items:{contents:[]},tokens:[],writes:[],allowed:true,
    canUserModify(){return this.allowed;},getDependentTokens(options){assert.equal(options.concreteOnly,true);return this.tokens;},
    updateSource(data){Object.assign(this.prototypeToken,data.prototypeToken);},
    async update(data,options={}){this.writes.push(data);this.prototypeToken.disposition=data['prototypeToken.disposition'];hook('updateActor',this,data,options,'u');return this;}};
}
const scene={id:'s',grid:{size:100,distance:1}};
function token(a,side,x=0,parent=scene){
  const id=String(++seq);const t={id,uuid:`Scene.${parent.id}.Token.${id}`,actor:a,baseActor:a,actorId:a.id,disposition:side,parent,x:x*100,y:0,width:1,height:1,allowed:true,writes:[],
    canUserModify(){return this.allowed;},updateSource(data){Object.assign(this,data);},async update(data,options={}){this.writes.push(data);Object.assign(this,data);hook('updateToken',this,data,options,'u');return this;}};
  a.tokens.push(t);return t;
}
const pc=actor('character',-1),npc=actor('npc',1),explicit=actor('npc',0);
hook('preCreateActor',pc,{type:'character'}, {},'u');hook('preCreateActor',npc,{type:'npc'}, {},'u');hook('preCreateActor',explicit,{prototypeToken:{disposition:0}}, {},'u');
assert.equal(pc.prototypeToken.disposition,1);assert.equal(npc.prototypeToken.disposition,-1);assert.equal(explicit.prototypeToken.disposition,0);assert.equal(defaultActorSide('other'),undefined);
const p1=token(pc,-1),p2=token(pc,-1,0,{id:'other'}),n1=token(npc,-1,1),n2=token(npc,1,2);
assert.equal(tokenSide(p1),1);assert.equal(tokenSide(n1),-1);assert.equal(tokenSide(n2),1);assert.equal(p1.disposition,-1,'no migration on read');
hook('preCreateToken',p1,{}, {},'u');assert.equal(p1.disposition,1);
assert.equal(actorSideContext(pc,p1).document,pc);assert.equal(actorSideContext(npc,n1).document,n1);assert.equal(actorSideContext(npc).kind,'prototype');assert.equal(actorSideContext(npc,p1),null);
const synthetic={type:'character',isToken:true,token:p1,prototypeToken:{disposition:0}};assert.equal(actorSideContext(synthetic).document,pc);
assert.equal(await setActorSide(pc,p1,0),true);await synchronizePCSide(pc);assert.equal(p1.disposition,0);assert.equal(p2.disposition,0);assert.equal(n1.disposition,-1);
assert.equal(await setActorSide(npc,n1,1),true);assert.equal(n1.disposition,1);assert.equal(npc.prototypeToken.disposition,-1);assert.equal(n2.writes.length,0);
await setActorSide(npc,undefined,0);assert.equal(npc.prototypeToken.disposition,0);assert.equal(n1.disposition,1);
await p1.update({disposition:-1});await synchronizePCSide(pc);assert.equal(pc.prototypeToken.disposition,-1);assert.equal(p2.disposition,-1);
p2.allowed=false;await setActorSide(pc,p1,1);await synchronizePCSide(pc);assert.equal(p2.disposition,-1);assert.equal(tokenSide(p2),1);assert.ok(warnings.length);
pc.allowed=false;assert.equal(await setActorSide(pc,p1,0),false);assert.equal(pc.prototypeToken.disposition,1);
assert.equal(await setActorSide(npc,n1,99),false);
// A stale PC token's native side cannot turn an ally into a formation enemy.
const other=actor('character',1);const t2=token(other,-1,1);const place=d=>({actor:d.actor,document:d,center:{x:d.x+50,y:50},visible:true});
const pp=place(p1),qq=place(t2);globalThis.canvas={grid:{size:100,isSquare:true},tokens:{placeables:[pp,qq]}};
const grid={size:100,isSquare:true};const form=formationForTarget(pp,[pp,qq],{grid});assert.equal(form.threats,0);assert.equal(form.formation,2);assert.deepEqual(coverRecipients(pp),[qq]);
// Class action membership is exact, not a title or provenance match.
const warlock=actor('character',1,{className:'Колдун',race:'Эльф'});
const ability=(id,rule,source='rulebook text')=>({type:'ability',id,system:{mechanics:rule?{racialProperty:rule}:{}},getFlag:(s,k)=>s===scope?({contentId:id,source})[k]:undefined});
const classCard=ability(WARLOCK_SPELL_IDS[0]);assert.deepEqual(abilitySource(warlock,classCard),{kind:'class',label:'Колдун',contentOrigin:'rulebook text'});
assert.equal(abilitySource(warlock,{name:'Мистический заряд',type:'ability',flags:{[scope]:{source:'Колдун'}}}).kind,'unknown');
assert.equal(abilitySource(warlock,{type:'ability'},{classContentId:WARLOCK_SPELL_IDS[0]}).label,'Колдун');
assert.equal(abilitySource(warlock,{type:'ability',[`flags.${scope}.source`]:'index origin'},{classContentId:WARLOCK_SPELL_IDS[0]}).contentOrigin,'index origin');
const racial=ability('fnri7.rulebook.racial.elf-test',{races:['elf']});assert.equal(abilitySource(warlock,racial).label,'Эльф');
assert.equal(abilitySource(warlock,ability('x',{universal:true,races:['elf']})).label,'FASTNRI.AbilitySource.racial');
assert.equal(abilitySource(npc,racial).kind,'racial');assert.equal(abilitySource(npc,classCard).kind,'unknown');
console.log('PASS Actor/Token side lifecycle, cross-scene sync, native rights, formation and cover, structured ability sources');
