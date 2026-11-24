import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolveCardEffectTarget,createCardEffectData,applyCardEffect}
  from '../module/effects/apply-card-effect.mjs';
import {applicableRollEffects,selectRollParts,finalizeRollEffects,prepareRoll}
  from '../module/rolls/roll-context.mjs';

globalThis.game={i18n:{localize:key=>key}};
let counter = 0;
const actor = {
  documentName:'Actor',id:'T',uuid:'Actor.T',name:'Цель',isOwner:true,
  system:{level:12,skills:{test:{modifier:0,dice:''}}},
  toObject(){return {system:structuredClone(this.system)}},
  effects:{contents:[],get(id){return this.contents.find(x=>x.id===id)}},
  async createEmbeddedDocuments(documentName, data){
    assert.equal(documentName,'ActiveEffect');
    assert.equal(data.length,1);
    const row=structuredClone(data[0]);const id=`applied${++counter}`;
    const effect={id,uuid:`Actor.T.ActiveEffect.${id}`,parent:this,name:row.name,
      system:row.system,flags:row.flags,disabled:row.disabled,transfer:row.transfer,
      duration:row.duration,origin:row.origin,
      async delete(){this.parent.effects.contents=this.parent.effects.contents.filter(x=>x!==this)},
      async update(patch){Object.assign(this,patch)}};
    this.effects.contents.push(effect);
    return [effect];
  },
  allApplicableEffects(){return this.effects.contents}
};
const item={documentName:'Item',id:'C',name:'Мастер боя',uuid:'Actor.T.Item.C',parent:actor};
const templateSource={
  _id:'templateId',_stats:{createdTime:1},name:'Точный выпад',type:'base',transfer:false,
  disabled:true,img:'icons/svg/aura.svg',origin:'Item.OTHER',
  start:{value:100},duration:{value:3,units:'rounds',startTime:100,startRound:2},
  system:{changes:[
    {key:'system.skills.test.modifier',type:'add',phase:'initial',priority:0,value:'2'},
    {key:'system.speed',type:'add',phase:'initial',priority:0,value:'-5'}]},
  flags:{'fast-nri-v14':{
    effectState:{effectLevel:7,strength:3,magnitude:null},
    rollInfluence:{kinds:['skill'],skillId:'test',onUse:'remove'},
    changeCalculations:{schema:1,rows:[
      {id:'skill-row',index:0,anchor:JSON.stringify(['system.skills.test.modifier','add','initial',0]),
        formula:'@strength + @actor.system.level',auto:true,manualValue:'2',appliedValue:'2'},
      {id:'speed-row',index:1,anchor:JSON.stringify(['system.speed','add','initial',0]),
        formula:'',auto:false,manualValue:'-5',appliedValue:'-5'}
    ]}
  }}
};
const template={id:'templateId',uuid:'Actor.T.Item.C.ActiveEffect.templateId',parent:item,
  transfer:false,toObject:()=>structuredClone(templateSource)};
item.effects={get:id=>id===template.id?template:null};
const token=actorArg=>({actor:actorArg});
assert.equal(resolveCardEffectTarget(item,{targets:[token(actor)]}),actor);
assert.equal(resolveCardEffectTarget(item,{controlled:[token(actor)]}),actor);
assert.equal(resolveCardEffectTarget(item,{}),actor);
assert.equal(resolveCardEffectTarget({...item,parent:null},{}),null);
assert.throws(()=>resolveCardEffectTarget(item,{targets:[token(actor),token(actor)]}),/несколько целей/);
assert.throws(()=>resolveCardEffectTarget(item,{controlled:[token(actor),token(actor)]}),/несколько токенов/);
assert.equal(resolveCardEffectTarget(item,{targets:[token(actor)],controlled:[token({name:'другой'})]}),actor);

const data=createCardEffectData(item,template,actor);
assert.equal(data._id,undefined);
assert.equal(data._stats,undefined);
assert.equal(data.start,undefined);
assert.equal(data.duration.startTime,undefined);
assert.equal(data.duration.startRound,undefined);
assert.equal(data.duration.value,3);
assert.equal(data.disabled,false);
assert.equal(data.transfer,false);
assert.equal(data.origin,template.uuid);
assert.deepEqual(data.system.changes.map(c=>String(c.value)),['15','-5']);
assert.equal(data.flags['fast-nri-v14'].changeCalculations.rows[0].appliedValue,'15');
assert.equal(data.flags['fast-nri-v14'].changeCalculations.rows[1].manualValue,'-5');
assert.equal(data.flags['fast-nri-v14'].rollInfluence.onUse,'remove');
assert.equal(templateSource.system.changes[0].value,'2','template remains untouched');
assert.equal(templateSource.start.value,100);
assert.throws(()=>createCardEffectData(item,{...template,parent:null},actor),/не принадлежит/);
assert.throws(()=>createCardEffectData(item,{...template,transfer:true},actor),/Переносимый/);
await assert.rejects(applyCardEffect(item,template,{...actor,isOwner:false}),/Нет прав/);
const created=await applyCardEffect(item,template,actor);
assert.equal(created.system.changes[0].value,'15');
assert.equal(actor.effects.contents.length,1);
assert.equal(templateSource.system.changes[0].value,'2');
const createdAgain=await applyCardEffect(item,template,actor);
assert.notEqual(created.uuid,createdAgain.uuid,'repeat application creates a new instance without a recovery log');
await createdAgain.delete();

const available=applicableRollEffects(actor,{kind:'skill',skillId:'test',formula:'1d20 + (15)'});
assert.equal(available.length,1);
assert.equal(available[0].actorOwned,true);
assert.equal(available[0].nativeChanges[0].value,'15');
assert.equal(available[0].onUse,'remove');
const skipped=await prepareRoll({actor,kind:'skill',skillId:'test',formula:'1d20 + (15)',skipDialog:true});
assert.ok(skipped?.contributions?.some(x=>x.sourceUuid===created.uuid));
assert.equal(skipped.snapshot[0].components[0].value,'15');
await finalizeRollEffects(skipped,null);
assert.equal(actor.effects.contents.length,1,'unsaved result must not spend');
await finalizeRollEffects({...skipped,selected:selectRollParts(available,{[created.uuid]:[]})},{id:'message-1'});
assert.equal(actor.effects.contents.length,1,'unchecked effect must not spend');
await finalizeRollEffects(skipped,{id:'message-2'});
assert.equal(actor.effects.contents.length,0,'used effect is removed after committed roll');
assert.equal(item.effects.get(template.id),template,'template remains reusable');

const badTemplate={...template,toObject:()=>{
  const v=structuredClone(templateSource);v.flags['fast-nri-v14'].changeCalculations.rows[0].formula='process.exit()';return v;
}};
assert.throws(()=>createCardEffectData(item,badTemplate,actor),/Change 1/);
assert.equal(actor.effects.contents.length,0,'invalid formula does not create an effect');
const chat=readFileSync(new URL('../module/abilities/ability-chat.mjs',import.meta.url),'utf8');
// The current release moved this execution from the Item sheet to its
// published chat result. Retain a check of the real application entry.
assert.match(chat,/resolveCardEffectTarget\(item,/);
assert.match(chat,/applyCardEffect\(item,template,actor,\{resultMessageId:live.id\}\)/);
assert.match(chat,/fnriAbilityApply/);
assert.match(chat,/applyResultToSelectedActor\(message\)/);

// Standalone world Item authoring: formulas may depend on a future target.
const worldItem={documentName:'Item',id:'WORLD',name:'Мировая карточка',isOwner:true,parent:null};
const worldTemplate={...template,parent:worldItem,
  toObject:()=>structuredClone(templateSource)};
const {readEffectChangeRows,calculateEffectChangePlan,evaluateEffectFormula}=await import('../module/effects/effect-formulas.mjs');
const worldEffect={parent:worldItem,system:structuredClone(templateSource.system),
  flags:structuredClone(templateSource.flags)};
const proposed=readEffectChangeRows(worldEffect);
proposed[0].formula='@actor.system.level + @strength';
proposed[0].auto=true;
const deferredPlan=calculateEffectChangePlan(worldEffect,{rows:proposed,
  state:worldEffect.flags['fast-nri-v14'].effectState,actor:null,deferActor:true});
assert.equal(deferredPlan.changes[0].value,'2','without a target the placeholder is preserved, not 1+strength');
assert.equal(deferredPlan.metadata.rows[0].auto,true,'the card keeps the formula for later application');
assert.equal(deferredPlan.metadata.rows[0].formula,'@actor.system.level + @strength');
assert.equal(evaluateEffectFormula('@actor.system.level + @strength',
  {state:{strength:3},deferActor:true}),4,'deferred preview validates syntax without persisting placeholder');
assert.throws(()=>calculateEffectChangePlan(worldEffect,{rows:[{...proposed[0],formula:'process.exit()'},proposed[1]],
  state:worldEffect.flags['fast-nri-v14'].effectState,actor:null,deferActor:true}));
const {openEffectParametersEditor}=await import('../module/effects/effect-parameters-editor.mjs');
let editorOpened=false;
globalThis.game={i18n:{localize:key=>key}};
globalThis.foundry={applications:{api:{DialogV2:{wait:async spec=>{
  editorOpened=true;
  assert.ok(spec.content.includes("data-fnri-calculation-row"));
  return {action:'cancel'};
}}}}};
const editableWorld={...worldEffect,name:'Шаблон мира',duration:{value:3,units:'rounds'},sheet:{render(){throw Error('Native editor used instead of extended editor')}}};
await openEffectParametersEditor(null,editableWorld);
assert.equal(editorOpened,true,'world Item template can open extended editor without an Actor');
console.log('PASS stage14 card effects: Item template -> owned Actor -> independently evaluated rows -> preroll -> use -> remove; no source mutation');
