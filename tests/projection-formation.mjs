import assert from 'node:assert/strict';
import {linkProjectionActor,unlinkProjectionActor,isProjectionActor,resolveSpellOrigin,PROJECTION_SCOPE as scope} from '../module/projection/projection.mjs';
import {formationForTarget} from '../module/spatial/formation.mjs';
const scene={id:'scene'}, grid={size:100,isSquare:true};
globalThis.canvas={scene,grid,tokens:{controlled:[]}};
globalThis.game={user:{isGM:true},actors:{contents:[]}};
function actor(id,side=0,flags={}){
 const a={id,uuid:`Actor.${id}`,documentName:'Actor',name:id,prototypeToken:{disposition:side},system:{hp:{current:1},equipment:{}},items:new Map(),flags, tokens:[],getActiveTokens(){return this.tokens},getFlag(s,k){return this.flags[k]},async update(data){for(const [k,v] of Object.entries(data)){if(k.startsWith(`flags.${scope}.`))this.flags[k.split('.').at(-1)]=v;else if(k.startsWith('prototypeToken.'))this.prototypeToken[k.split('.').at(-1)]=v;}},async unsetFlag(s,k){delete this.flags[k]}};
 game.actors.contents.push(a);return a;
}
function token(a,x,y,side=1,parent=scene){return {actor:a,document:{uuid:`Token.${a.id}.${x}.${y}`,x:x*100,y:y*100,width:1,height:1,disposition:side,parent,actorLink:false},center:{x:x*100+50,y:y*100+50}}}
const caster=actor('caster',-1); const item={id:'ability',uuid:'Actor.caster.Item.ability',documentName:'Item',type:'ability',parent:caster,system:{mechanics:{executions:[{type:'projection'}]}}};caster.items.set(item.id,item);
const p=actor('p',0,{projectionTemplate:true}); const placed=token(p,1,0,0);p.tokens=[placed];caster.tokens=[token(caster,0,0,1)];
await linkProjectionActor(item,p);assert.equal(p.prototypeToken.disposition,1);assert.equal(placed.document.disposition,0);assert.equal(p.prototypeToken.actorLink,false);
p.prototypeToken.disposition=-1;await linkProjectionActor(item,p);assert.equal(p.prototypeToken.disposition,-1);await unlinkProjectionActor(item,p);await linkProjectionActor(item,p);assert.equal(p.prototypeToken.disposition,-1);
const fallback=actor('fallback');caster.tokens=[token(caster,0,0,1,{id:'other'})];await linkProjectionActor(item,fallback);assert.equal(fallback.prototypeToken.disposition,-1);
const ambiguous=actor('ambiguous',0);caster.tokens=[token(caster,0,0,1),token(caster,1,1,-1)];await linkProjectionActor(item,ambiguous);assert.equal(ambiguous.prototypeToken.disposition,0);
const neutral=actor('neutral',-1);caster.tokens=[token(caster,0,0,0)];await linkProjectionActor(item,neutral);assert.equal(neutral.prototypeToken.disposition,-1);
const sameSide=actor('sameSide');caster.tokens=[token(caster,0,0,1),token(caster,1,1,1)];await linkProjectionActor(item,sameSide);assert.equal(sameSide.prototypeToken.disposition,1);
const t=token(caster,0,0,1), enemy=actor('enemy'), e=token(enemy,1,0,-1), projection=token(p,0,1,1);const calc=(...ts)=>formationForTarget(t,ts,{grid});
assert.deepEqual(calc(e,projection),{threats:1,formation:2,surrounded:false,uncertain:false,standing:true});
projection.document.disposition=-1;assert.equal(calc(projection).threats,0);
// Synthetic unlinked token resolves the identity through its base actor.
const synthetic={documentName:'Actor',isToken:true,token:{baseActor:p},system:{hp:{current:1},equipment:{}}};const synth=token(synthetic,1,1,-1);assert.equal(isProjectionActor(synthetic),true);assert.equal(calc(synth).threats,0);
projection.document.disposition=0;assert.equal(calc(projection).uncertain,true);projection.document.x=200;assert.equal(calc(projection).uncertain,false);
projection.document.x=100;projection.document.disposition=-2;assert.equal(calc(projection).uncertain,true);projection.document.hidden=true;assert.equal(calc(projection).uncertain,false);
const reach=token(enemy,2,0,-1);enemy.system.equipment.leftHand='w';enemy.items.set('w',{type:'weapon',system:{attackKind:'melee',distance:2}});assert.equal(calc(reach).threats,1);reach.document.parent={id:'other'};assert.equal(calc(reach).threats,0);
const n=token(enemy,1,1,0);assert.equal(calc(n).uncertain,true);n.document.disposition=-2;assert.equal(calc(n).uncertain,true);
const hostileTarget=token(enemy,0,0,-1);assert.equal(formationForTarget(hostileTarget,[token(p,1,0,-1)],{grid}).formation,2);
const origin=resolveSpellOrigin(caster,{controlled:[token(p,1,0,1)],scene});assert.equal(origin.kind,'projection');
caster.tokens=[token(caster,0,0,1)];
grid.measurePath=([a,b])=>({spaces:Math.abs(a.x-b.x)/100});
const far=resolveSpellOrigin(caster,{controlled:[token(p,13,0,1)],scene});assert.equal(far.kind,'projection');assert.equal(far.warning,null);
console.log('projection-formation: OK');
