import assert from 'node:assert/strict';
import {projectionArmorForActor,resolveSpellOrigin} from '../module/projection/projection.mjs';
import {selectedTargetSnapshot} from '../module/rolls/attack-properties.mjs';
import {modifierGroups} from '../module/sheets/modifier-view.mjs';
import {targetHindranceEntries} from '../module/rolls/attack-hindrance.mjs';
import {formationForTarget} from '../module/spatial/formation.mjs';
import {spatialAttackContext} from '../module/spatial/spatial-context.mjs';
import {planDeathTransition} from '../module/damage/death-lifecycle.mjs';
class Field {}
class Model {prepareBaseData(){} prepareDerivedData(){}}
globalThis.foundry={data:{fields:{StringField:Field,NumberField:Field,SchemaField:Field,TypedObjectField:Field,ObjectField:Field}},abstract:{TypeDataModel:Model}};
const {NPCModel}=await import('../module/data/models.mjs');
const scene={id:'s'},grid={size:100,isSquare:true,measurePath:([a,b])=>({spaces:Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y))/100})};
const status=id=>({statuses:new Set(['fnri7-'+id])});
const raw={className:'',hp:{current:1,max:1,temp:0},speed:0,ac:{partial:null,success:null,great:null},defenses:{reflex:10},resources:{},skills:{}};
const make=(id,type='npc')=>({id,uuid:'Actor.'+id,documentName:'Actor',type,name:id,system:structuredClone(raw),items:{contents:[]},effects:{contents:[]},getFlag(){return null;},toObject(){return {system:structuredClone(raw)}}});
const caster=make('warlock','character');caster.system.ac={partial:8,success:13,great:19};caster.system.hp={current:19,max:19,temp:0};caster.flags={'fast-nri-v14':{visionKind:'darkvision'}};
const base=make('projection');base.getFlag=(_,key)=>key==='projection'?{version:2,casterUuid:caster.uuid}:null;
function synthetic(id){const a=make(id);a.isToken=true;a.token={baseActor:base};return a;}
const a=synthetic('p1'),b=synthetic('p2');
function token(actor,x,y,side=1){return {name:'same',actor,document:{uuid:`Scene.s.Token.${actor.id}`,name:`Token ${actor.id}`,parent:scene,x:x*100,y:y*100,width:1,height:1,actorLink:false,disposition:side},center:{x:x*100+50,y:y*100+50}};}
const p=token(a,10,0),p2=token(b,10,1),c=token(caster,0,0),e=token(make('enemy'),13,0,-1);
const prepare=actor=>{const model=new NPCModel();Object.assign(model,structuredClone(raw));model.parent=actor;actor.system=model;model.prepareBaseData();model.prepareDerivedData();};
globalThis.game={user:{isGM:true},actors:{contents:[caster,base]},i18n:{localize:k=>k}};
globalThis.canvas={scene,grid,tokens:{placeables:[p,p2,c,e],controlled:[p]}};
caster.getActiveTokens=()=>[c];
a.effects.contents=[status('offguard'),status('grabbed')];prepare(a);prepare(b);
assert.deepEqual(a.system.ac,{partial:6,success:11,great:17});assert.equal(a.system.defenses.reflex,8);assert.equal(b.system.ac.partial,8);
assert.deepEqual(selectedTargetSnapshot([p]).ac,a.system.ac);
const group=modifierGroups(a).find(g=>g.name==='Fields.acShort · Fields.partial');assert.equal(group.total,'6');assert.equal(group.sources.filter(r=>r.source==='ModifierView.offGuard').length,1);
// Caster off-guard is not borrowed; the projection's own sources still apply once.
caster.effects.contents=[status('offguard')];caster.system.ac={partial:6,success:11,great:17};prepare(a);prepare(b);
assert.deepEqual(a.system.ac,{partial:6,success:11,great:17});assert.deepEqual(b.system.ac,{partial:8,success:13,great:19});
assert.deepEqual(selectedTargetSnapshot([p2]).ac,b.system.ac);
const ownGroup=modifierGroups(a).find(g=>g.name==='Fields.acShort · Fields.partial');
assert.equal(ownGroup.sources.filter(r=>r.source==='ModifierView.offGuard').length,1);
assert.equal(ownGroup.sources.find(r=>r.source==='ModifierView.projection').value,'8');
assert.equal(modifierGroups(b).find(g=>g.name==='Fields.acShort · Fields.partial').sources.filter(r=>r.source==='ModifierView.offGuard').length,0);
for(const id of ['prone','grabbed','offguard']){
  caster.effects.contents=[status(id)];
  assert.deepEqual(projectionArmorForActor(b),{partial:8,success:13,great:19});
}
// Other caster AC contributions still transfer, including while off-guard.
caster.system.ac={partial:9,success:14,great:20};assert.equal(projectionArmorForActor(b).partial,11);assert.equal(projectionArmorForActor(a).partial,9);
caster.effects.contents=[];caster.system.ac={partial:10,success:15,great:21};assert.equal(projectionArmorForActor(a).partial,8);assert.equal(selectedTargetSnapshot([p]).ac.partial,8);
a.effects.contents=[];prepare(a);assert.equal(a.system.ac.partial,10);assert.equal(a.system.hp.current,1);assert.equal(caster.system.hp.current,19);
const origin=resolveSpellOrigin(caster);assert.equal(origin.kind,'projection');assert.equal(origin.tokenName,'Token p1');assert.equal(origin.warning,null);assert.equal(spatialAttackContext({origin,targetTokens:[e],attackKind:'ranged',spellRange:8}).distanceSpaces,3);
assert.equal(resolveSpellOrigin(caster,{allowProjection:false}).kind,'caster');p.document.hidden=true;assert.equal(resolveSpellOrigin(caster).hidden,true);p.document.hidden=false;
e.actor.effects.contents=[status('darkness'),status('invisible')];assert.deepEqual(targetHindranceEntries({attacker:caster,target:e.actor,targetToken:e}).map(x=>x.parts[0].value),['-10']);
assert.equal(formationForTarget(p,[p2],{grid}).formation,2);a.system.hp.current=0;assert.equal(formationForTarget(p2,[p],{grid}).formation,1);assert.equal(b.system.hp.current,1);assert.equal((await planDeathTransition(a,{before:1,after:0,hitPointsDamage:1})).changed,false);
console.log('PASS P.3.4 projection: synthetic HP, current caster AC and own conditions, read-only overview, origin/token name, caster vision, formation, no PC death counter');
