globalThis.game={i18n:{localize:k=>k}};
import assert from 'node:assert/strict';
import {
  applicableRollEffects,renderRollPreparation,computeRollPreview,prepareRoll,
  finalizeRollEffects,visibleRollInfluences,applyDirectRollModifiers
} from '../module/rolls/roll-context.mjs';

// Foundry-like source/clone contract: data preparation always replays native
// changes from source data, without mutating the original Actor.
const clone = v => structuredClone(v);
const sources = {
  effects:[
    {_id:'plus',name:'Благословение',disabled:false,system:{changes:[
      {key:'system.skills.test.modifier',value:'2',mode:2}]}},
    {_id:'over',name:'Замена значения',disabled:false,system:{changes:[
      {key:'system.skills.test.modifier',value:'10',mode:5}]}},
  ],
  items:[{_id:'staff',name:'Посох',effects:[{
    _id:'itemBuff',name:'Переносимый эффект',disabled:false,system:{changes:[
      {key:'system.skills.test.modifier',value:'2',mode:1}]}
  }]}]
};
const parent={documentName:'Actor',uuid:'Actor.A',isOwner:true,effects:null};
function collection(contents) {
  return {contents,get(id){return this.contents.find(e=>e.id===id)??null}};
}
function asEffect(source,owner,parentKind='Actor') {
  return {id:source._id,uuid:`Actor.A${parentKind==='Item'?'.Item.staff':''}.ActiveEffect.${source._id}`,
    name:source.name,disabled:source.disabled,system:source.system,
    parent:owner,flags:source.flags??{},duration:{expired:false}};
}
function prepared(src) {
  const actorEffectDocs=src.effects.map(e=>asEffect(e,parent));
  const item={documentName:'Item',id:'staff',uuid:'Actor.A.Item.staff',isOwner:true};
  item.effects=collection(src.items[0].effects.map(e=>asEffect(e,item,'Item')));
  const actor={id:'A',uuid:'Actor.A',documentName:'Actor',isOwner:true,
    effects:collection(actorEffectDocs),items:collection([item]),
    toObject(){return clone(src)},
    allApplicableEffects(){return [...this.effects.contents,...item.effects.contents]},
    clone(update){return prepared({...clone(src),...clone(update)})},
    getRollData(){return {skills:this.system.skills}}
  };
  let score=1;
  for(const effect of actor.allApplicableEffects()) {
    if(effect.disabled)continue;
    for(const change of effect.system.changes??[]) {
      const n=Number(change.value);
      if(change.mode===1)score*=n;
      if(change.mode===2)score+=n;
      if(change.mode===5)score=n;
    }
  }
  actor.system={skills:{test:{dice:'',modifier:score}}};
  parent.effects=actor.effects;
  return actor;
}
const actor=prepared(sources);
const formulaForActor=a=>`1d20 + (${a.system.skills.test.modifier})`;
const available=applicableRollEffects(actor,{kind:'skill',skillId:'test'});
assert.equal(available.length,3);
assert.deepEqual(available.map(e=>e.name),['Благословение','Замена значения','Переносимый эффект']);
assert.ok(available.every(e=>e.nativeChanges.length===1));
const full=await computeRollPreview({actor,available,selected:available,formula:'1d20 + (20)',formulaForActor});
assert.equal(full.expression,'1d20 + (20)');
const withoutOverride=await computeRollPreview({actor,available,selected:[available[0],available[2]],formulaForActor});
assert.equal(withoutOverride.expression,'1d20 + (6)','native add and multiply re-evaluated, no flat subtraction');
const withoutAddAndOverride=await computeRollPreview({actor,available,selected:[available[2]],formulaForActor});
assert.equal(withoutAddAndOverride.expression,'1d20 + (2)');
const withoutItem=await computeRollPreview({actor,available,selected:[available[0],available[1]],formulaForActor});
assert.equal(withoutItem.expression,'1d20 + (10)');
assert.equal(actor.system.skills.test.modifier,20,'live actor never mutated');
assert.equal(actor.effects.get('over').disabled,false);
assert.equal(actor.items.get('staff').effects.get('itemBuff').disabled,false);
assert.equal((await computeRollPreview({actor,available,selected:[available[0]],formulaForActor,
  manual:[{value:-3,comment:'Укрытие'}]})).expression,'1d20 + (3) + (-3)');
await assert.rejects(()=>computeRollPreview({actor,available,selected:available,formulaForActor,
  manual:[{value:'2+7',comment:'Invalid'}]}),/invalid/i);
const html=renderRollPreparation([{...available[0],name:'<img src=x onerror=alert(1)>',
  nativeChanges:[{key:'<script>',value:'5&8'}]}],{label:'A&B',formula:'1d20'});
assert.ok(html.includes('&lt;img'), 'escapes injected effect names');
assert.ok(!html.includes('<script>'));
assert.ok(html.includes('fnri-preroll-preview'));
assert.ok(!html.includes('Выбрано эффектов'));
const cardSource = {...available[0],native:false,modifier:2,replacement:{from:'1d8',to:'1d10'},
  parts:[{id:'modifier',kind:'modifier',value:2},{id:'replacement',kind:'replacement',from:'1d8',to:'1d10'}]};
assert.equal(applyDirectRollModifiers('1d20 + 1d8',[cardSource]),'1d20 + 1d10 + (2)');
assert.throws(()=>applyDirectRollModifiers('1d20 + 1d80',[cardSource]),/required die/);

// This mock exercises DialogV2.wait's v14 render callback and the very same
// computeRollPreview() used to produce the final roll context.
const fields=new Map();
for(const [i,e] of available.entries()) for(const [j] of e.parts.entries()) fields.set(`part_${i}_${j}`,{checked:true});
fields.set('situational',{value:''});fields.set('situationalName',{value:''});
const manual=[];
const form={elements:{namedItem(name){return fields.get(name)}},querySelectorAll(){return manual}};
const previewFormula={textContent:''},errorOutput={textContent:''};
const rollButton={disabled:false};
const root={dataset:{},handler:null,closest(){return form},
  querySelectorAll(){return []},
  querySelector(name){return {'[data-fnri-preview-formula]':previewFormula,
    '[data-fnri-preview-error]':errorOutput}[name]??null},
  addEventListener(name,handler){if(name==='change')this.handler=handler}}
const dialog={element:{querySelector(name){return {
  '[data-fnri-preroll]':root,'button[data-action="roll"]':rollButton}[name]??null}}};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
let shown=0;
globalThis.foundry={applications:{api:{DialogV2:{wait:async cfg=>{
  shown++; assert.ok(cfg.content.includes('Подготовка')===false || typeof cfg.content==='string');
  cfg.render({},dialog);
  await flush();
  assert.equal(previewFormula.textContent,'1d20 + (20)');
  fields.get('part_1_0').checked=false;
  root.handler();await flush();
  assert.equal(previewFormula.textContent,'1d20 + (6)', 'immediate preview recalculation');
  manual.push({querySelector(sel){return {value:sel==='[data-fnri-manual-value]'?'-2':'Помеха'}}});
  root.handler();await flush();
  assert.equal(previewFormula.textContent,'1d20 + (6) + (-2)');
  assert.equal(errorOutput.textContent,'');
  assert.equal(rollButton.disabled,false);
  return cfg.buttons[0].callback({}, {form});
}}}}};
const chosenContext=await prepareRoll({actor,kind:'skill',skillId:'test',formulaForActor,
  formula:'1d20',label:'Проверка'});
assert.equal(shown,1);
assert.equal(chosenContext.expression,'1d20 + (6) + (-2)');
assert.deepEqual(chosenContext.excluded,[available[1].uuid]);
assert.equal(chosenContext.snapshot.at(-1).name,'Помеха');
assert.equal(chosenContext.selected.length,2);
const fast=await prepareRoll({actor,kind:'skill',skillId:'test',formulaForActor,
  formula:'1d20',label:'Проверка',skipDialog:true});
assert.equal(shown,1,'Shift path skips dialog');
assert.equal(fast.expression,'1d20 + (20)');
foundry.applications.api.DialogV2.wait=async cfg=>{shown++;return cfg.buttons[0].callback({}, {form:{elements:{namedItem(){return null}},querySelectorAll(){return []}}})};
const nonMatching=await prepareRoll({actor,kind:'ability',formula:'1d20',label:'Разное'});
assert.equal(nonMatching.expression,'1d20');
assert.equal(shown,2,'manual modifiers remain available without effects');
foundry.applications.api.DialogV2.wait=async()=>null;
assert.equal(await prepareRoll({actor,kind:'skill',skillId:'test',formulaForActor,formula:'1d20'}),null,
  'cancel does not roll or spend effects');

// Each one-use effect is only consumed after a real message was created.
const disposable={...available[0],onUse:'remove',actorOwned:true};
let removed=0;
disposable.effect.delete=async()=>{removed++;disposable.effect.disabled=true};
await finalizeRollEffects({selected:[disposable]},null);
await finalizeRollEffects({selected:[disposable]},{content:'not persisted'});
assert.equal(removed,0);
await finalizeRollEffects({selected:[disposable]},{id:'created'});
await finalizeRollEffects({selected:[disposable]},{id:'created-again'});
assert.equal(removed,1);
// Items are never deleted by the Actor one-use cleanup.
const transferable={...available[2],onUse:'remove',actorOwned:false};
transferable.effect.delete=async()=>{throw Error('not allowed')};
await finalizeRollEffects({selected:[transferable]},{id:'chat'});
const visible={snapshot:[{uuid:'secret',name:'Секретный бафф',native:true,
  nativeChanges:[{key:'system.hidden',value:'5'}]},
  {uuid:null,name:'Ветер',kind:'situational',modifier:-2}]};
assert.equal(visibleRollInfluences(visible,{hasPlayerOwner:false},'public')[0].name,'FASTNRI.Preroll.hiddenInfluence');
assert.equal(visibleRollInfluences(visible,{hasPlayerOwner:false},'public')[0].uuid,undefined);
assert.equal(visibleRollInfluences(visible,{hasPlayerOwner:false},'gm')[0].uuid,'secret');
assert.equal(visibleRollInfluences(visible,{hasPlayerOwner:true},'public')[0].uuid,'secret');
assert.equal(visibleRollInfluences(visible,{hasPlayerOwner:false},'public')[1].name,'Ветер');
console.log('PASS stage14 preroll: per-effect contributions, live preview, native ADD/OVERRIDE/MULTIPLY, item transfers, situational, cancel, Shift, spend after message');
