import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {registerConditionStatuses} from '../module/effects/condition-statuses.mjs';
import {CONDITION_STATUSES} from '../module/effects/condition-statuses.generated.mjs';
import {createCardEffectData,applyCardEffect} from '../module/effects/apply-card-effect.mjs';
import {isOffGuard,prepareConditionDefenses} from '../module/effects/condition-calculations.mjs';
import {applicablePanelEffects,getEffectByIdentity} from '../module/effects/effects-panel-core.mjs';

execFileSync(process.execPath,[fileURLToPath(new URL('../scripts/generate-condition-statuses.mjs',import.meta.url)),'--check']);
const scope='fast-nri-v14';
const dir=new URL('../packs/_source/conditions/',import.meta.url);
const cards=readdirSync(dir).filter(n=>n.endsWith('.json')).map(n=>JSON.parse(readFileSync(new URL(n,dir),'utf8')));
const original={dead:{id:'dead',name:'Dead'},other:{id:'other',name:'Module effect'}};
const specials={DEFEATED:'dead',INVISIBLE:'invisible'};
const config={statusEffects:{...original},specialStatusEffects:specials};
registerConditionStatuses(config);
assert.equal(Object.keys(config.statusEffects).length,18);
assert.equal(config.statusEffects.dead,original.dead);
assert.deepEqual(config.statusEffects.other,{...original.other,hud:false});
assert.equal(original.other.hud,undefined);
assert.notEqual(config.statusEffects.dead.hud,false);
assert.equal(config.specialStatusEffects,specials);
assert.equal(config.statusEffects['fnri7-stunned'].flags[scope].informationalMarker,true);
const actor={documentName:'Actor',type:'character',isOwner:true,uuid:'Actor.test',effects:{contents:[]}};
for(const card of cards){
  const id=`fnri7-${card.system.mechanics.condition.id}`;
  const configData=config.statusEffects[id];
  if(!card.effects.length){assert.equal(configData,undefined);continue;}
  const raw=card.effects[0];
  const template={...raw,parent:card,uuid:`Compendium.test.Item.${card._id}.ActiveEffect.${raw._id}`,toObject:()=>structuredClone(raw)};
  const applied=createCardEffectData(card,template,actor);
  // Registry data is identical to the card application payload except for
  // the native HUD metadata and the optional source UUID of a card use.
  const {id:status,hud,...payload}=configData;
  assert.equal(status,id);assert.equal(hud,true);
  delete applied.origin;
  assert.deepEqual(payload,applied,card.name);
  assert.equal(payload.flags[scope].conditionId,card.system.mechanics.condition.id);
  assert.equal(payload.img,card.img);assert.equal(payload.showIcon,2);
  assert.equal(payload._id,undefined);assert.deepEqual(payload.duration,{});
  assert.deepEqual(payload.statuses,[id]);
  assert.notEqual(configData,CONDITION_STATUSES[id]);
}
// This is a document mock, not a claim about native TokenHUD click behavior.
const mockEffect=(id,instance)=>({...structuredClone(config.statusEffects[id]),id:instance,uuid:`Actor.test.ActiveEffect.${instance}`,parent:actor,active:true});
const hud=mockEffect('fnri7-grabbed','hud');
const independent=mockEffect('fnri7-offguard','independent');
actor.effects.contents=[hud,independent];
assert.equal(isOffGuard(actor),true);
const system={parent:actor,ac:{partial:10,success:14,great:18},defenses:{awareness:12,reflex:12,fortitude:12,will:12}};
prepareConditionDefenses(system);assert.deepEqual(system.ac,{partial:8,success:12,great:16});
assert.equal(applicablePanelEffects(actor).length,2);
assert.equal(getEffectByIdentity(actor,actor.uuid,hud.uuid),hud);
actor.effects.contents=actor.effects.contents.filter(e=>e!==hud);
assert.equal(isOffGuard(actor),true);assert.equal(applicablePanelEffects(actor).length,1);
actor.effects.contents=[];assert.equal(isOffGuard(actor),false);
registerConditionStatuses(config);assert.equal(Object.keys(config.statusEffects).length,18);
// Independent sources of the SAME condition: actual card application logic,
// document API mocked. This does NOT test native HUD clicks or deletion.
const grabbed=cards.find(c=>c.system.mechanics.condition.id==='grabbed');
let sequence=0;
actor.createEmbeddedDocuments=async (kind,rows)=>{
  assert.equal(kind,'ActiveEffect');
  return rows.map(row=>{
    const id=`instance${++sequence}`;
    const effect={...structuredClone(row),id,uuid:`${actor.uuid}.ActiveEffect.${id}`,parent:actor,active:true,getFlag(s,k){return this.flags?.[s]?.[k];}};
    actor.effects.contents.push(effect);return effect;
  });
};
const raw=grabbed.effects[0];
const t1={...raw,parent:grabbed,uuid:'Actor.orc.Item.grab.ActiveEffect.template',toObject:()=>structuredClone(raw)};
const t2={...raw,parent:grabbed,uuid:'Actor.troll.Item.grab.ActiveEffect.template',toObject:()=>structuredClone(raw)};
const a=await applyCardEffect(grabbed,t1,actor,{resultMessageId:'orc-result'});
const b=await applyCardEffect(grabbed,t2,actor,{resultMessageId:'troll-result'});
const c=mockEffect('fnri7-grabbed','hud');actor.effects.contents.push(c);
assert.equal(new Set(actor.effects.contents.map(e=>e.uuid)).size,3);
assert.notEqual(a.origin,b.origin);
assert.equal(await applyCardEffect(grabbed,t1,actor,{resultMessageId:'orc-result'}),a);
assert.equal(applicablePanelEffects(actor).length,3);
assert.equal(getEffectByIdentity(actor,actor.uuid,c.uuid),c);
actor.effects.contents=actor.effects.contents.filter(e=>e.uuid!==c.uuid);
assert.deepEqual(actor.effects.contents,[a,b]);assert.equal(isOffGuard(actor),true);
actor.effects.contents=actor.effects.contents.filter(e=>e.uuid!==a.uuid);
assert.equal(isOffGuard(actor),true);actor.effects.contents=[];assert.equal(isOffGuard(actor),false);
console.log('PASS native v14 status registry, source parity, panel identity and non-stacking condition calculations (mock)');
