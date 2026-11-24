import assert from 'node:assert/strict';
import {racialAddBlock,racialRemoveBlock,racialCreationPlan,racialState,racialPermissions,registerRacialSettings} from '../module/data/racial-properties.mjs';
import {racialChoiceStatus} from '../module/sheets/racial-property-picker.mjs';
const S='fast-nri-v14', prefix='fnri7.rulebook.racial.';
const settings=new Map(),values={};
globalThis.game={settings:{register:(_s,k,c)=>settings.set(k,c),get:(_s,k)=>values[k]??settings.get(k)?.default},i18n:{lang:'ru',localize:k=>({'FASTNRI.RacialProperties.limitMissingOne':'Осталось выбрать {remaining} свойство','FASTNRI.RacialProperties.limitMissingFew':'Осталось выбрать {remaining} свойства','FASTNRI.RacialProperties.limitMissingMany':'Осталось выбрать {remaining} свойств'}[k]??k)}};
registerRacialSettings();
const actor={type:'character',system:{race:'Человек'},items:{contents:[]}};
const make=(id,parent=actor,rule={universal:true})=>({id,type:'ability',parent,system:{mechanics:{racialProperty:rule}},getFlag:()=>prefix+id});
const innate=make('umelyi'),a=make('a'),b=make('b'),c=make('c'),d=make('d'),e=make('e');
actor.items.contents=[innate,a,b,c];
assert.equal(racialState(actor).used,3);
assert.equal(racialChoiceStatus(racialState(actor)),'');
for(const allowInnateRemoval of [false,true])for(const allowExcess of [false,true]){
  values.racialAllowInnateRemoval=allowInnateRemoval;values.racialAllowExcess=allowExcess;
  assert.deepEqual(racialPermissions(),{allowInnateRemoval,allowExcess});
  assert.equal(racialRemoveBlock(actor,innate),allowInnateRemoval?null:'innateLocked');
  assert.equal(racialRemoveBlock(actor,a),null);
  assert.equal(racialAddBlock(actor,d),allowExcess?null:'limitReached');
  assert.equal(racialAddBlock(actor,innate),null);
}
values.racialAllowExcess=false;values.racialAllowInnateRemoval=false;
actor.items.contents.pop();
const gear={id:'gear',parent:actor,type:'gear'};
const batch=racialCreationPlan([d,e,gear]);
assert.deepEqual(batch.allowed,[d,gear]);assert.deepEqual(batch.blocked.map(x=>x.item.id),['e']);
assert.equal(racialChoiceStatus(racialState(actor)),'Осталось выбрать 1 свойство');
actor.items.contents.push(c,d);
assert.equal(racialChoiceStatus(racialState(actor)),'');
assert.equal(racialRemoveBlock(actor,c),null);
actor.system.race='Эльф';
assert.equal(racialRemoveBlock(actor,innate),null,'old innate is no longer protected after ancestry change');
const npc={type:'npc',system:{race:'Человек'},items:{contents:[innate,a,b,c]}};
assert.equal(racialAddBlock(npc,d),null);assert.equal(racialRemoveBlock(npc,innate),null);
// Already excessive actors are not auto-corrected; removal is still available.
actor.system.race='Человек';
assert.equal(racialAddBlock(actor,e),'limitReached');
assert.equal(racialState(actor).used,4);
console.log('PASS racial configuration: four settings combinations, batch preflight, shortage only, ancestry change, NPC');
