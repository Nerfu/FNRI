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

// C1 inventory against Part I/VII: real source documents, including the two
// distinct Claws and the shared vision cards. No migration or old snapshots.
const {readFileSync,readdirSync}=await import('node:fs');
const dir=new URL('../packs/_source/abilities/',import.meta.url);
const cards=readdirSync(dir).filter(f=>f.endsWith('.json')).map(f=>JSON.parse(readFileSync(new URL(f,dir),'utf8'))).filter(c=>c.system.mechanics?.racialProperty);
const cid=c=>c.flags[S].contentId;
for(const c of cards)c.getFlag=(scope,key)=>c.flags?.[scope]?.[key];
assert.equal(cards.length,43);
assert.equal(new Set(cards.map(cid)).size,43);
const expectedRaces=[
 ['Человек','human',3,['Умелый'],['Продвинутый','Устойчивый','Мастер боя','Умелый']],
 ['Эльф','elf',2,['Эльфийское проворство','Сумеречное зрение'],['Эльфийская школа лука','Магия эльфов','Эльфийский эрудит','Зрение в темноте','Эльфийское проворство']],
 ['Дварф','dwarf',2,['Зрение в темноте'],['Живая крепость','Упрямство','Таран','Щит дварфа','Зрение в темноте']],
 ['Полурослик','halfling',2,[],['Везучесть','Неуловимый','Работяга']],
 ['Орк','orc',2,['Зрение в темноте'],['Неукротимость','Суровость','Боевые шрамы','Зрение в темноте']],
 ['Нефалем','nephalem',3,['Природа Нефалема'],['Природа Нефалема','Небесный посланник','Нимб','Дар небес','Полёт','Голод','Ловкий хвост','Месть','Нечеловеческая скорость','Почти бессмертие']],
 ['Драконообразный','draconic',3,['Сумеречное зрение','Драконья природа'],['Драконья природа','Дыхание','Крепкий хвост','Когти','Драконьи крылья']],
 ['Котолюд','catfolk',3,['Сумеречное зрение'],['Когти','Мешающийся','Отскок','Тихие шаги']]
];
for(const [race,id,max,innate,names] of expectedRaces){
 const pc={type:'character',system:{race},items:{contents:[]}};
 const state=racialState(pc);
 assert.equal(state.max,max,race);
 assert.deepEqual(cards.filter(c=>state.innate.has(cid(c))).map(c=>c.name).sort(),[...innate].sort(),race);
 assert.deepEqual(cards.filter(c=>c.system.mechanics.racialProperty.races?.includes(id)).map(c=>c.name).sort(),[...names].sort(),race);
 pc.system.role='Наследник';assert.equal(racialState(pc).max,max+1,race);
}
assert.deepEqual(cards.filter(c=>c.system.mechanics.racialProperty.universal).map(c=>c.name).sort(),['Полукровка','Быстроногий','Инициативный','Сумеречное зрение','Самоотверженный'].sort());
console.log('PASS C1: 43 real racial cards, all eight race quotas and innate sets, common vision, two Claws, Heir for all races');

// The existing user filter is the only nature filter. Owned mismatching
// properties remain visible so a user can remove them, and show-all is free.
const {racialPickerIncludes}=await import('../module/sheets/racial-property-picker.mjs');
const natureCard=cards.find(c=>c.name==='Природа Нефалема');
const holy=['Нимб','Дар небес','Полёт'], unholy=['Голод','Ловкий хвост','Месть'];
for(const [selection,allowed,hidden] of [['holy',holy,unholy],['unholy',unholy,holy]]){
 const nature=structuredClone(JSON.parse(JSON.stringify(natureCard)));
 nature.getFlag=(scope,key)=>nature.flags?.[scope]?.[key];
 nature.system.mechanics.racialProperty.selection=selection;
 for(const race of ['Нефалем','Человек']){
  const pc={type:'character',system:{race},items:{contents:[nature]}};
  if(race==='Человек')pc.items.contents.push(make('polukrovka',pc,{universal:true,selection:'nephalem'}));
  const state=racialState(pc);
  for(const name of allowed)assert.equal(racialPickerIncludes(pc,cards.find(c=>c.name===name),state),true,name);
  for(const name of hidden){const card=cards.find(c=>c.name===name);assert.equal(racialPickerIncludes(pc,card,state),false,name);assert.equal(racialPickerIncludes(pc,card,state,{showAll:true}),true);assert.equal(racialPickerIncludes(pc,card,state,{ownedItem:true}),true);}
  for(const name of ['Почти бессмертие','Нечеловеческая скорость'])assert.equal(racialPickerIncludes(pc,cards.find(c=>c.name===name),state),true);
 }
}
assert.equal(cards.filter(c=>c.system.mechanics.racialProperty.nature).length,6);
console.log('PASS nature filter: holy/unholy, Half-Blood, neutral, show-all and owned cards');
