globalThis.game={i18n:{localize:k=>k}};
import assert from 'node:assert/strict';
import {
  applicableRollEffects, renderRollPreparation, selectedRollParts, selectRollParts,
  computeRollPreview, prepareRoll, finalizeRollEffects, visibleRollInfluences
} from '../module/rolls/roll-context.mjs';

const copy = x => structuredClone(x);
const source = {
  effects:[{
    _id:'compound',name:'Комплексный эффект',disabled:false,
    flags:{'fast-nri-v14':{rollInfluence:{kinds:['skill'],skillId:'test',modifier:4,
      replace:{from:'1d8',to:'1d10'},onUse:'remove'}}},
    system:{changes:[
      {key:'system.skills.test.modifier',type:'add',value:2},
      {key:'system.skills.test.modifier',type:'multiply',value:3},
      {key:'system.skills.other.modifier',type:'add',value:100}
    ]}
  }],
  items:[{_id:'ring',effects:[{_id:'ringEffect',name:'Кольцо',disabled:false,
    system:{changes:[
      {key:'system.skills.test.modifier',type:'add',value:5},
      {key:'system.skills.test.modifier',type:'add',value:7}
    ]}}]}]
};
function coll(contents){return {contents,get(id){return contents.find(e=>e.id===id)??null}};}
function build(src) {
  const parent={documentName:'Actor',id:'a',uuid:'Actor.a',isOwner:true,effects:null};
  const ring={documentName:'Item',id:'ring',uuid:'Actor.a.Item.ring',isOwner:true,effects:null};
  const asDoc=(e,parent)=>({
    id:e._id,uuid:`${parent.uuid}.ActiveEffect.${e._id}`,name:e.name,
    disabled:e.disabled??false,system:e.system,flags:e.flags??{},duration:{expired:false},parent
  });
  parent.effects=coll(src.effects.map(e=>asDoc(e,parent)));
  ring.effects=coll(src.items[0].effects.map(e=>asDoc(e,ring)));
  let mod=1,other=0;
  for(const effect of [...parent.effects.contents,...ring.effects.contents]) {
    if(effect.disabled)continue;
    for(const change of effect.system?.changes??[]) {
      const t=Number(change.value);
      const path=change.key;
      const before=path==='system.skills.test.modifier'?mod:other;
      const after=change.type==='multiply'?before*t:change.type==='override'?t:before+t;
      if(path==='system.skills.test.modifier')mod=after;else if(path==='system.skills.other.modifier')other=after;
    }
  }
  const actor={uuid:'Actor.a',isOwner:true,documentName:'Actor',
    system:{skills:{test:{modifier:mod},other:{modifier:other}}},
    effects:parent.effects,items:coll([ring]),
    allApplicableEffects(){return [...this.effects.contents,...ring.effects.contents]},
    toObject(){return copy(src)}, clone(update){return build({...copy(src),...copy(update)})}
  };
  return actor;
}
const actor=build(source);
const params={kind:'skill',skillId:'test',formula:'1d20 + 1d8'};
const available=applicableRollEffects(actor,params);
assert.equal(available.length,2);
assert.deepEqual(available[0].parts.map(p=>p.id),['native-0','native-1','modifier','replacement']);
assert.deepEqual(available[1].parts.map(p=>p.id),['native-0','native-1']);
assert.equal(available[0].nativeChanges.length,2,'unrelated native change not listed as a roll modifier');
const formulaForActor=a=>`1d20 + (${a.system.skills.test.modifier}) + 1d8`;
const all=await computeRollPreview({actor,available,selected:available,formulaForActor});
assert.equal(all.expression,'1d20 + (21) + 1d10 + (4)');
const disabledOne=selectRollParts(available,{[available[0].uuid]:['native-0','modifier','replacement']});
const one=await computeRollPreview({actor,available,selected:disabledOne,formulaForActor});
assert.equal(one.expression,'1d20 + (15) + 1d10 + (4)', 'native multiply excluded without subtracting a prepared number');
assert.equal(one.actor.system.skills.other.modifier,100, 'non-roll change from partially enabled effect remains');
const directOnly=selectRollParts(available,{[available[0].uuid]:['modifier','replacement']});
const direct=await computeRollPreview({actor,available,selected:directOnly,formulaForActor});
assert.equal(direct.expression,'1d20 + (13) + 1d10 + (4)');
const withoutDirect=selectRollParts(available,{[available[0].uuid]:['native-0','native-1'],[available[1].uuid]:['native-0']});
const noDirect=await computeRollPreview({actor,available,selected:withoutDirect,formulaForActor});
assert.equal(noDirect.expression,'1d20 + (14) + 1d8');
const noRing=selectRollParts(available,{[available[1].uuid]:[]});
const noRingPreview=await computeRollPreview({actor,available,selected:noRing,formulaForActor});
assert.equal(noRingPreview.expression,'1d20 + (9) + 1d10 + (4)');
assert.equal(actor.system.skills.test.modifier,21,'original Actor was not modified');
assert.equal(source.effects[0].system.changes.length,3);
assert.equal(source.items[0].effects[0].system.changes.length,2);
const html=renderRollPreparation(available,{formula:'1d20 + 1d8'});
assert.ok(html.includes('name="part_0_0"') && html.includes('name="part_0_3"'));
assert.ok(!html.includes('name="effect_0"') && !html.includes('name="effect_1"'));
assert.ok(!html.includes('Выбрано эффектов'));

// Exercise real-form click semantics of the dialog's v14 render callback.
const fields=new Map();
for (const [i,e] of available.entries()) {
  fields.set(`effect_${i}`,{checked:true,dataset:{fnriEffect:String(i)}});
  for(const [j] of e.parts.entries()) fields.set(`part_${i}_${j}`,{checked:true,dataset:{fnriPart:String(i)}});
}
fields.set('situational',{value:''});fields.set('situationalName',{value:''});
const form={elements:{namedItem(name){return fields.get(name)??null}}};
const preview={textContent:''},error={textContent:''},rollButton={disabled:false};
const handlers={};
const root={dataset:{},closest:()=>form,
  querySelectorAll(){return []},
  querySelector(q){return {'[data-fnri-preview-formula]':preview,'[data-fnri-preview-error]':error}[q]??null},
  addEventListener(t,cb){handlers[t]=cb}}
const dialog={element:{querySelector(q){return {'[data-fnri-preroll]':root,'button[data-action="roll"]':rollButton}[q]??null}}};
const tick=()=>new Promise(res=>setImmediate(res));
globalThis.foundry={applications:{api:{DialogV2:{wait:async cfg=>{
  cfg.render({},dialog);await tick();
  assert.equal(preview.textContent,'1d20 + (21) + 1d10 + (4)');
  const toggle=fields.get('part_0_1');toggle.checked=false;
  handlers.change({target:toggle});await tick();
  assert.equal(preview.textContent,'1d20 + (15) + 1d10 + (4)');
  const direct=fields.get('part_0_2');direct.checked=false;
  handlers.change({target:direct});await tick();
  assert.equal(preview.textContent,'1d20 + (15) + 1d10');
  // Current UI has independent component switches, not a master toggle.
  for (const [j] of available[0].parts.entries()) fields.get(`part_0_${j}`).checked=false;
  handlers.change();await tick();
  assert.equal(preview.textContent,'1d20 + (13) + 1d8');
  for (const [j] of available[0].parts.entries()) fields.get(`part_0_${j}`).checked=true;
  handlers.change();await tick();
  assert.equal(preview.textContent,'1d20 + (21) + 1d10 + (4)');
  assert.equal(error.textContent,'');assert.equal(rollButton.disabled,false);
  return cfg.buttons[0].callback({}, {form});
}}}}};
const context=await prepareRoll({actor,...params,formulaForActor});
assert.equal(context.expression,'1d20 + (21) + 1d10 + (4)');
assert.equal(context.snapshot[0].components.length,4);
assert.equal(context.excludedComponents.length,0);
assert.equal(context.selected.length,2);
let deleteCalls=0;
const disposable={...context.selected[0],effect:{...context.selected[0].effect,
  delete:async()=>{deleteCalls++}}};
await finalizeRollEffects({selected:[disposable]},{id:'saved-message'});
assert.equal(deleteCalls,1,'chosen components still trigger one-use cleanup once');
assert.equal(visibleRollInfluences(context,{hasPlayerOwner:false},'public')[0].components,undefined,
  'private per-component paths not exposed on GM-controlled public card');
console.log('PASS stage14 components: independent native/direct, transferable Item, independent toggles, live preview, no mutations, one-use after saved roll');
