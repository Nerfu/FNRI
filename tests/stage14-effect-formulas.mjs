import assert from 'node:assert/strict';
import {
  evaluateEffectFormula, readEffectChangeRows, calculateEffectChangePlan, recalculationPatch, refreshActorDependentFormulas
} from '../module/effects/effect-formulas.mjs';
import { readEffectState, writeEffectState } from '../module/effects/effect-state.mjs';
import { updateEffectFormulaEditorPreview, openEffectParametersEditor } from '../module/effects/effect-parameters-editor.mjs';

const state={strength:3,effectLevel:8,magnitude:-5};
const actor={documentName:'Actor',isOwner:true,system:{abilities:{str:12},level:8},
  toObject:()=>({system:{abilities:{str:12},level:8}})};
assert.equal(evaluateEffectFormula('-1 * @strength',{state}),-3);
assert.equal(evaluateEffectFormula('max(2, @effectLevel / 2) + abs(@magnitude)',{state}),9);
assert.equal(evaluateEffectFormula('floor(@actor.system.abilities.str / 5) + round(1.6)',{state,actor}),4);
assert.equal(evaluateEffectFormula('clamp(@strength * 3, 0, 5)',{state}),5);
for(const formula of ['@strength+foo','1/0','process.exit()','@actor.__proto__.x',
    '@actor.system.abilities.str.constructor','1 + (2*3','@unknown','@actor.system.bad.value',
    '1; globalThis.injection()', '1e999', 'round(1,2)', 'min(1)']) {
  assert.throws(()=>evaluateEffectFormula(formula,{state,actor}),undefined,formula);
}
assert.throws(()=>evaluateEffectFormula('@effectLevel',{state:{strength:3}}));
assert.throws(()=>evaluateEffectFormula('2'.repeat(257)));
assert.throws(()=>evaluateEffectFormula('('.repeat(60)+'1'+')'.repeat(60)));

const effect={uuid:'Actor.A.ActiveEffect.E1',parent:actor,
  flags:{'fast-nri-v14':{}},
  system:{changes:[
    {key:'system.speed',type:'add',value:'0',phase:'initial',priority:0},
    {key:'system.defense',type:'add',value:'-5',phase:'initial',priority:0},
    {key:'system.attributes.hp.max',type:'add',value:'8',phase:'initial',priority:0}
  ]},
  setFlag:async function(scope,key,value){this.flags[scope]??={};this.flags[scope][key]=value;},
  update:async function(patch){
    this.lastPatch=patch;
    if(patch['system.changes']) this.system.changes=patch['system.changes'];
    for(const [key,value] of Object.entries(patch)) {
      const prefix='flags.fast-nri-v14.';
      if(key.startsWith(prefix)) this.flags['fast-nri-v14'][key.slice(prefix.length)]=value;
    }
  }
};
const legacy=readEffectChangeRows(effect);
assert.deepEqual(legacy.map(r=>r.auto),[false,false,false]);
assert.deepEqual(legacy.map(r=>r.manualValue),['0','-5','8']);
const inputRows=legacy.map(r=>({...r}));
inputRows[0].formula='@strength'; inputRows[0].auto=true;
inputRows[2].formula='@effectLevel';inputRows[2].auto=true;
let plan=calculateEffectChangePlan(effect,{rows:inputRows,state,actor});
assert.deepEqual(plan.changes.map(r=>r.value),['3','-5','8']);
assert.deepEqual(plan.metadata.rows.map(r=>r.auto),[true,false,true]);
await effect.update({'system.changes':plan.changes,'flags.fast-nri-v14.changeCalculations':plan.metadata});
assert.deepEqual(readEffectChangeRows(effect).map(r=>r.auto),[true,false,true]);
await writeEffectState(effect,{...readEffectState(effect),strength:4,effectLevel:9,magnitude:-5});
assert.deepEqual(effect.system.changes.map(r=>r.value),['4','-5','9'], 'only auto rows recalculate');
assert.equal(effect.flags['fast-nri-v14'].effectState.strength,4);
assert.equal(effect.flags['fast-nri-v14'].effectState.magnitude,-5);
let rows=readEffectChangeRows(effect);
assert.equal(rows[1].manualValue,'-5');
rows[1].formula='-1 * @strength'; rows[1].auto=false;
plan=calculateEffectChangePlan(effect,{rows,state:{...state,strength:4,effectLevel:9},actor});
assert.equal(plan.changes[1].value,'-5','unchecked formula preserves manual value');
rows[1].auto=true;
plan=calculateEffectChangePlan(effect,{rows,state:{...state,strength:4,effectLevel:9},actor});
assert.equal(plan.changes[1].value,'-4','returning to Auto recalculates only its row');
assert.equal(plan.changes[0].value,'4');
assert.equal(plan.changes[2].value,'9');
rows[0].formula='@actor.system.speed';
assert.throws(()=>calculateEffectChangePlan(effect,{rows,state,actor}),/own target/);
rows[0].formula='@strength';
rows[0].auto=true;
// Native editor modifying one value manually detaches old Auto metadata safely.
effect.system.changes[0].value='77';
rows=readEffectChangeRows(effect);
assert.equal(rows[0].auto,false);
assert.equal(rows[0].manualValue,'77');
assert.equal(rows[0].detached,true);
assert.equal(rows[2].auto,true,'other rows preserve their config');
// Invalid formulas must not break strength updates; preserve last valid values.
effect.system.changes[0].value='4';
rows=readEffectChangeRows(effect);
rows[2].formula='@missing';rows[2].auto=true;
const invalid=calculateEffectChangePlan(effect,{rows,state,strict:false,actor});
assert.equal(invalid.errors.length,1);
assert.equal(invalid.changes[2].value,'9');
assert.throws(()=>calculateEffectChangePlan(effect,{rows,state,strict:true,actor}));

// A lightweight UI mock: checked Auto locks only its own row, with live preview.
function field(value=''){return {value:String(value),dataset:{manualValue:String(value)},checked:false,disabled:false,readOnly:false};}
const formFields=new Map([
  ['effectLevel',field(8)],['strength',field(3)],['magnitude',field(-5)],
  // The strength range and zero-handling options are no longer editable.
]);
const makeRow=(formula,manual,auto)=>{
  const fs={formula:field(formula),auto:field(''),value:field(manual),error:{textContent:''}};
  fs.auto.checked=auto;
  return {fs,querySelector(query){return ({'[data-fnri-formula]':fs.formula,
    '[data-fnri-auto]':fs.auto,'[data-fnri-value]':fs.value,
    '[data-fnri-row-error]':fs.error})[query];}};
};
const r1=makeRow('-1 * @strength','-5',true);
const r2=makeRow('','2',false);
const ui={querySelector:selector=>formFields.get(selector.match(/name="([^"]+)"/)?.[1]),
  querySelectorAll:selector=> selector==='[data-fnri-calculation-row]'?[r1,r2]:[]};
assert.equal(updateEffectFormulaEditorPreview(ui,{actor}),true);
assert.equal(r1.fs.value.value,'-3');assert.equal(r1.fs.value.readOnly,true);
assert.equal(r2.fs.value.value,'2');assert.equal(r2.fs.value.readOnly,false);
formFields.get('strength').value='4';
assert.equal(updateEffectFormulaEditorPreview(ui,{actor}),true);
assert.equal(r1.fs.value.value,'-4');
assert.equal(r2.fs.value.value,'2');
r1.fs.auto.checked=false;
updateEffectFormulaEditorPreview(ui,{actor});
assert.equal(r1.fs.value.readOnly,false);assert.equal(r1.fs.value.value,'-5');
r1.fs.auto.checked=true;r1.fs.formula.value='@notallowed';
assert.equal(updateEffectFormulaEditorPreview(ui,{actor}),false);
assert.equal(r1.fs.value.readOnly,false,'invalid formula must not trap user in readonly');
assert.match(r1.fs.error.textContent,/Unsupported/);

// Dynamic Actor source is refreshed only after an actual system update, once.
effect.system.changes[0].value='4';
let refreshed=readEffectChangeRows(effect);
refreshed[0].formula='@actor.system.level';
refreshed[0].auto=true;
let newPlan=calculateEffectChangePlan(effect,{rows:refreshed,state:{...state,strength:4,effectLevel:9},actor});
await effect.update({'system.changes':newPlan.changes,'flags.fast-nri-v14.changeCalculations':newPlan.metadata});
actor.allApplicableEffects=function*(){yield effect;};
actor.items={get:()=>null};
actor.system.level=13;
actor.toObject=()=>({system:{abilities:{str:12},level:13}});
assert.deepEqual(await refreshActorDependentFormulas(actor,{name:'Unrelated'}),{updated:0,errors:[]});
assert.deepEqual(await refreshActorDependentFormulas(actor,{system:{level:13}}),{updated:1,errors:[]});
assert.equal(effect.system.changes[0].value,'13');
assert.equal((await refreshActorDependentFormulas(actor,{'system.level':13})).updated,0,'no redundant effect writes');


// Exercise the actual DialogV2 save callback through a minimal v14 form stub.
effect.parent=actor;
effect.duration={value:3,units:'rounds'};
effect.name='Тестовый эффект';
const fields={effectLevel:'8',strength:'3',magnitude:'-5',durationValue:'3',durationUnits:'rounds'};
const nativeForm={elements:{namedItem(name){
  if(name in fields) return {value:fields[name]};
  if(name==='formula_0') return {value:'@strength * -2'};
  if(name==='auto_0') return {checked:true};
  if(name==='value_0') return {value:'-6',dataset:{manualValue:'77'}};
  if(name.startsWith('formula_')) return {value:''};
  if(name.startsWith('auto_')) return {checked:false};
  if(name.startsWith('value_')) {
    const i=Number(name.split('_')[1]);
    const value=String(effect.system.changes[i].value);
    return {value,dataset:{manualValue:value}};
  }
  return null;
}}};
const OriginalFormData=globalThis.FormData;
globalThis.FormData=class {
  constructor(form){assert.equal(form,nativeForm);}
  *entries(){yield* Object.entries(fields);}
};
globalThis.game={i18n:{localize:key=>key}};
globalThis.foundry={applications:{api:{DialogV2:{wait:async config=>{
  assert.match(config.content,/data-fnri-auto/);
  assert.match(config.content,/data-fnri-formula/);
  return config.buttons[0].callback({}, {form:nativeForm});
}}}}};
await openEffectParametersEditor(actor,effect);
assert.equal(effect.system.changes[0].value,'-6');
assert.equal(effect.flags['fast-nri-v14'].changeCalculations.rows[0].formula,'@strength * -2');
assert.equal(effect.flags['fast-nri-v14'].changeCalculations.rows[0].manualValue,'77');
assert.equal(effect.flags['fast-nri-v14'].changeCalculations.rows[0].auto,true);
assert.equal(effect.flags['fast-nri-v14'].changeCalculations.rows[1].auto,false);
globalThis.FormData=OriginalFormData;

console.log('PASS stage14 effect formulas: safe parsing, multi-row Auto/manual, native edit guard, state changes, per-row readonly UI');
