globalThis.game={i18n:{localize:k=>k}};
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  itemRollContributions,cardContributionEntry,buildRollContributionCatalog
} from '../module/rolls/roll-contributions.mjs';
import {
  applicableRollContributions,selectRollParts,computeRollPreview,
  renderRollPreparation,prepareRoll,finalizeRollEffects,visibleRollInfluences
} from '../module/rolls/roll-context.mjs';

const item={id:'card',uuid:'Actor.A.Item.card',name:'Разящая способность',system:{
  rollFormula:'1d20 + 1d8',mechanics:{rollContributions:[
    {label:'Подготовка',kind:'modifier',value:2,kinds:['attack']},
    {label:'Усилить куб',kind:'replacement',from:'1d8',to:'1d10',kinds:['attack']},
    {label:'Скрытный эффект',kind:'modifier',value:50,kinds:['skill']},
    {label:'Некорректное значение',kind:'modifier',value:'hack()',kinds:['attack']},
    {label:'Обязательная область',kind:'modifier',value:90},
  ]}
}};
const actor={id:'A',uuid:'Actor.A',name:'Испытатель',system:{attackModifier:1},
  effects:{contents:[]},items:{contents:[]},allApplicableEffects(){return []}};
const p={kind:'attack',formula:'1d20 + 1d8'};
const parts=itemRollContributions(item,p);
assert.deepEqual(parts.map(x=>x.id),['card-0','card-1']);
assert.deepEqual(parts.map(x=>x.label),['Подготовка','Усилить куб']);
assert.equal(itemRollContributions(item,{kind:'ability'}).length,0);
assert.equal(cardContributionEntry(item,{kind:'skill'}).parts[0].value,'50');
assert.equal(cardContributionEntry({...item,uuid:null},p),null);
const available=applicableRollContributions(actor,{...p,sourceItem:item});
assert.equal(available.length,1);
const card=available[0];
assert.equal(card.sourceType,'item');
assert.equal(card.effect,null);
assert.equal(card.onUse,'none');
const base=buildRollContributionCatalog({actor,sourceItem:item,formula:p.formula,available,selected:available});
assert.equal(base.length,3);
assert.equal(base[0].kind,'base');
assert.equal(base[0].selectable,false);
assert.equal(base[0].sourceName,'Разящая способность');
assert.equal(base[1].sourceType,'item');
assert.deepEqual(base.slice(1).map(x=>x.enabled),[true,true]);
const all=await computeRollPreview({actor,available,selected:available,formula:p.formula});
assert.equal(all.expression,'1d20 + 1d10 + (2)');
const onlyBonus=selectRollParts(available,{[card.uuid]:['card-0']});
const preview=await computeRollPreview({actor,available,selected:onlyBonus,formula:p.formula});
assert.equal(preview.expression,'1d20 + 1d8 + (2)');
const omitted=selectRollParts(available,{[card.uuid]:[]});
assert.equal((await computeRollPreview({actor,available,selected:omitted,formula:p.formula})).expression,p.formula);
assert.equal(buildRollContributionCatalog({actor,sourceItem:item,formula:p.formula,available,selected:onlyBonus})[2].enabled,false);
assert.equal(actor.system.attackModifier,1,'original Actor unchanged');
assert.deepEqual(item.system.mechanics.rollContributions.map(x=>x.label),
  ['Подготовка','Усилить куб','Скрытный эффект','Некорректное значение','Обязательная область']);
const html=renderRollPreparation(available,{formula:p.formula,baseSource:item.name});
assert.ok(html.includes('data-fnri-preview-formula') && html.includes(p.formula));
assert.ok(html.includes('Подготовка') && html.includes('Усилить куб'));
assert.ok(html.includes('Разящая способность'));
assert.ok(!html.includes('Выбрано эффектов'));
const sneaky=cardContributionEntry({...item,name:'<img onerror="oops">'},p);
assert.ok(renderRollPreparation([sneaky]).includes('&lt;img'));
assert.ok(!renderRollPreparation([sneaky]).includes('<img onerror'));
const full=await prepareRoll({actor,kind:'attack',sourceItem:item,formula:p.formula,skipDialog:true});
assert.equal(full.expression,all.expression);
assert.equal(full.contributions.length,6);
assert.equal(full.contributions.filter(c=>c.nonStackingGroup==='hindrance' && !c.enabled).length,3);
assert.equal(full.snapshot.length,1);
assert.equal(full.snapshot[0].components.length,2);
await finalizeRollEffects(full,{id:'saved'}); // Card additions do NOT spend or delete items.
assert.equal(visibleRollInfluences(full,{hasPlayerOwner:false},'public')[0].uuid,undefined);
assert.equal(visibleRollInfluences(full,actor,'gm')[0].sourceType,'item');
const nothing=await prepareRoll({actor,kind:'ability',sourceItem:item,formula:p.formula,skipDialog:true});
assert.equal(nothing.expression,p.formula,'unmatched card rules never apply');
assert.equal(nothing.contributions.length,1,'base is still represented even with no additions');
const sheet=readFileSync(new URL('../module/sheets/sheets.mjs',import.meta.url),'utf8');
const attack=readFileSync(new URL('../module/weapon/weapon-attack.mjs',import.meta.url),'utf8');
const intervene=readFileSync(new URL('../module/damage/interventions.mjs',import.meta.url),'utf8');
assert.match(sheet,/kind:cardRollKind\(item\),sourceItem:item/);
assert.match(attack,/sourceItem:item/);
assert.match(intervene,/sourceItem:selected\.item\?\?null/);

const fields=new Map();fields.set('effect_0',{checked:true,dataset:{fnriEffect:'0'}});
for(let i=0;i<card.parts.length;i++) fields.set(`part_0_${i}`,{checked:true,dataset:{fnriPart:'0'}});
fields.set('situational',{value:''});fields.set('situationalName',{value:''});
const form={elements:{namedItem:key=>fields.get(key)}};
const formula={textContent:''},err={textContent:''},button={disabled:false};
const listeners={};
const root={dataset:{},closest:()=>form,
  querySelectorAll:()=>[],
  querySelector:sel=>({'[data-fnri-preview-formula]':formula,'[data-fnri-preview-error]':err}[sel]),
  addEventListener:(k,fn)=>{listeners[k]=fn}};
const dialog={element:{querySelector:sel=>({'[data-fnri-preroll]':root,'button[data-action="roll"]':button}[sel])}};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
globalThis.foundry={applications:{api:{DialogV2:{wait:async cfg=>{
  cfg.render({},dialog);await flush();
  assert.equal(formula.textContent,'1d20 + 1d10 + (2)');
  fields.get('part_0_1').checked=false;listeners.change({target:fields.get('part_0_1')});await flush();
  assert.equal(formula.textContent,'1d20 + 1d8 + (2)');
  assert.equal(button.disabled,false);
  return cfg.buttons[0].callback({}, {form});
}}}}};
const chosen=await prepareRoll({actor,kind:'attack',sourceItem:item,formula:p.formula});
assert.equal(chosen.expression,'1d20 + 1d8 + (2)');
assert.deepEqual(chosen.excludedComponents.filter(c=>c.uuid===card.uuid),[{uuid:card.uuid,partId:'card-1'}]);
assert.equal(chosen.excludedComponents.filter(c=>c.uuid.startsWith('hindrance:fallback:')).length,3);
console.log('PASS stage14 contributions: fixed base, explicit Item rules, per-part toggles, live preview, scope, no duplicate native mods, privacy');
