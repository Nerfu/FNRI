import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {CLASSES,classNames,classDefinition,classSelectionUpdate,mandatoryClassSkills} from '../module/data/classes.mjs';
import {permanentRacialStats} from '../module/data/character-contributions.mjs';
import {potionResource} from '../module/data/potion-resource.mjs';
class Field {constructor(...args){this.args=args;}}
class Model {prepareBaseData(){} prepareDerivedData(){}}
globalThis.foundry={data:{fields:{StringField:Field,NumberField:Field,SchemaField:Field,TypedObjectField:Field,ObjectField:Field}},abstract:{TypeDataModel:Model}};
const {CharacterModel,NPCModel}=await import('../module/data/models.mjs');
// Independent expected table from canonical Part II, including all armour totals.
const expected=[['Защитник',21,'d6',6,[14,19,25],[10,8,14,10],['athletics']],['Воин',21,'d10',7,[10,18,22],[10,10,10,10],['athletics']],['Егерь',18,'d8',8,[10,16,20],[14,12,8,10],['survival']],['Разбойник',18,'d6',9,[11,17,21],[12,14,8,10],['stealth']],['Клерик',19,'d6',6,[7,15,19],[12,10,12,14],['religion']],['Волшебник',15,'d6',6,[8,13,19],[12,10,8,12],['arcana']],['Друид',19,'d8',7,[9,15,19],[12,8,12,12],['nature']],['Бард',18,'d8',8,[9,15,19],[10,10,10,12],['mysticism']],['Колдун',19,'d6',6,[8,13,19],[10,10,10,12],[]],['Боец',22,'d8',7,[9,14,20],[12,12,12,12],['athletics','acrobatics']]];
const blank=()=>({className:'',role:'',race:'',level:null,speed:null,combatDie:'',hp:{current:null,max:null,temp:null},ac:{partial:null,success:null,great:null},defenses:{awareness:null,reflex:null,fortitude:null,will:null},resources:{},potionsUsed:0});
const actor={type:'character',items:{contents:[]},effects:{contents:[]}};
const model=new CharacterModel();model.parent=actor;actor.system=model;
const prepare=raw=>{Object.assign(model,structuredClone(raw));model.prepareBaseData();model.prepareDerivedData();};
assert.deepEqual(classNames(),expected.map(r=>r[0]));
for(const [name,hp,die,speed,ac,def,skills] of expected){
 const raw={...blank(),className:name};prepare(raw);
 assert.equal(model.hp.max,hp,name);assert.equal(model.combatDie,die);assert.equal(model.speed,speed);assert.deepEqual(Object.values(model.ac),ac);assert.deepEqual(Object.values(model.defenses),def);assert.deepEqual(mandatoryClassSkills(raw),skills);assert.equal(raw.hp.max,null);assert.equal(raw.speed,null);
}
assert.deepEqual(CLASSES.warlock.traditions,['arcana','mysticism','nature','religion']);
assert.deepEqual(mandatoryClassSkills({className:'Колдун',classTradition:'mysticism'}),['mysticism']);assert.deepEqual(mandatoryClassSkills({className:'Колдун',classTradition:'athletics'}),[]);
assert.equal(classDefinition({className:'unknown'}),null);prepare(blank());assert.equal(model.hp.max,null);
const raw={...blank(),className:'Воин',role:'Наследник',speed:0};
const load=stem=>{const dir=new URL('../packs/_source/abilities/',import.meta.url);const file=readdirSync(dir).find(n=>n.startsWith(stem+'--'));const obj=JSON.parse(readFileSync(new URL(file,dir),'utf8'));obj.id=obj._id;obj.getFlag=(scope,key)=>obj.flags?.[scope]?.[key];return obj;};
const elf=load('elfiiskoe-provorstvo'),wings=load('drakoni-krylia'),heaven=load('nebesnyi-poslannik'),stable=load('ustoichivyi');
actor.items.contents=[elf,elf,wings,heaven];
for(let i=0;i<3;i++){prepare(raw);assert.equal(model.speed,3);assert.deepEqual(Object.values(model.ac),[10,18,24]);assert.deepEqual(Object.values(model.defenses),[10,10,12,12]);}
assert.equal(raw.speed,0);assert.equal(permanentRacialStats(actor).speed,3);
// Phase ordering: temporary initial effect remains on top of class defaults.
Object.assign(model,blank(),{className:'Воин'});model.prepareBaseData();model.ac.partial-=2;model.prepareDerivedData();assert.equal(model.ac.partial,8);
actor.items.contents=[];prepare({...blank(),className:'Егерь'});assert.equal(potionResource(actor).max,4);actor.items.contents=[stable];assert.equal(potionResource(actor).max,5);assert.equal(potionResource({...actor,type:'npc'}).max,4);
actor.system.potionsBaseMax=6;assert.equal(potionResource(actor).max,8);assert.equal(potionResource({...actor,type:'npc'}).max,4);actor.system.potionsBaseMax=null;assert.equal(potionResource(actor).max,5);
const npc=new NPCModel();Object.assign(npc,blank(),{className:'Колдун'});npc.parent={type:'npc',items:{contents:[]},effects:{contents:[]}};npc.prepareBaseData();npc.prepareDerivedData();assert.equal(npc.hp.max,null);assert.equal(npc.speed,null);assert.equal(npc.spellRange,8);
const genericNpc=new NPCModel();genericNpc.prepareBaseData();assert.equal(genericNpc.spellRange,3);
genericNpc.spellRange=0;genericNpc.prepareBaseData();assert.equal(genericNpc.spellRange,0);
const fresh={type:'character',system:blank()};const start=classSelectionUpdate(fresh,'Колдун');assert.deepEqual(start,{'system.className':'Колдун','system.level':1,'system.hp.current':19,'system.resources.class_magic':{name:'Магическая сила',current:4,max:4,kind:'class'}});
const bard=classSelectionUpdate(fresh,'Бард');assert.deepEqual(bard['system.resources.class_rhythm'],{name:'Ритм',current:0,max:3,kind:'class'});
const ready={system:{...blank(),level:1,hp:{current:5,max:null},resources:{class_magic:{name:'Магическая сила',current:1,max:4,kind:'class'}}}};
assert.deepEqual(classSelectionUpdate(ready,'Колдун'),{'system.className':'Колдун'});assert.deepEqual(classSelectionUpdate(ready,'Воин'),{'system.className':'Воин'});assert.deepEqual(classSelectionUpdate(ready,''),{'system.className':''});
assert.equal(classSelectionUpdate(fresh,'Воин',{hpBonus:2})['system.hp.current'],23);
console.log('PASS 10 class defaults, source-safe preparation, role and card contributions, no duplicate bonus, potion limits, new resources and no refill');

// Stage 1B: canonical permanent cards and held protection, tested through the actual PC model.
const fortress=load('zhivaia-krepost'),inhuman=load('nechelovecheskaia-skorost'),dwarfShield=load('shchit-dvarfa');
const loadEquipment=(folder,stem)=>{
 const dir=new URL(`../packs/_source/${folder}/`,import.meta.url);const file=readdirSync(dir).find(n=>n.startsWith(stem+'--'));
 const obj=JSON.parse(readFileSync(new URL(file,dir),'utf8'));obj.id=obj._id;return obj;
};
const shield=loadEquipment('equipment','shchit'),staff=loadEquipment('weapons','dvuruchnyi-volshebnyi-posokh');
const secondShield={...shield,id:'shield2'};
const withHands=(lh='',rh='')=>({...blank(),className:'Воин',role:'Наследник',equipment:{leftHand:lh,rightHand:rh,armor:'irrelevant'}});
actor.items.contents=[fortress,fortress,inhuman,heaven,wings,dwarfShield,dwarfShield,shield,staff,secondShield];
for(let i=0;i<3;i++){
 prepare(withHands(shield.id,staff.id));assert.equal(model.hp.max,23);assert.equal(model.speed,9);assert.deepEqual(Object.values(model.ac),[15,23,29]);assert.deepEqual(Object.values(model.defenses),[10,10,12,12]);
}
prepare(withHands(shield.id,secondShield.id));assert.deepEqual(Object.values(model.ac),[15,23,29],'two shields never stack');
prepare(withHands(staff.id,staff.id));assert.deepEqual(Object.values(model.ac),[14,22,28],'dwarf shield property does not enhance a staff');
prepare(withHands());assert.deepEqual(Object.values(model.ac),[12,20,26],'inventory alone adds no protection');
actor.items.contents=[shield,staff];prepare(withHands(shield.id,staff.id));assert.deepEqual(Object.values(model.ac),[12,20,24],'ordinary held protection is +2, not +4');assert.equal(model.hp.max,21);assert.equal(model.speed,7);
actor.items.contents=[];prepare(withHands(shield.id));assert.deepEqual(Object.values(model.ac),[10,18,22],'removed items no longer count');
assert.equal(classSelectionUpdate(fresh,'Воин',{hpBonus:permanentRacialStats({items:{contents:[fortress]}}).hpMax})['system.hp.current'],23);
console.log('PASS canonical permanent racial cards, shield/staff strongest protection, no repeated bonus, removing or unequipping sources');

// C2: Part II fixed weapon proficiencies, exercised through the actual resolver.
// Cleric's additional selected one-handed weapon and Defender's special rule are
// separate open tasks, not part of the fixed list below.
const {weaponProficiency}=await import('../module/equipment/equipment.mjs');
const {shortRestActions}=await import('../module/sheets/action-catalog.mjs');
const fixedWeapons={
 'Защитник':['Цеп','Короткий меч','Длинный меч','Пистолет','Кистень'],
 'Воин':['Цеп','Дубина','Короткий меч','Длинный меч','Рапира','Одноручный топор','Двуручный топор','Двуручный молот','Длинное копьё','Двуручный меч','Пистолет','Кинжал','Серп','Арбалет','Жестокий топор','Тяжёлый молот'],
 'Егерь':['Арбалет','Длинный лук','Короткий лук','Длинный меч','Короткий меч','Длинное копьё','Одноручный топор'],
 'Разбойник':['Арбалет','Короткий меч','Кинжал','Праща'],
 'Клерик':['Божественный символ','Ветвь','Жезл'],
 'Волшебник':['Волшебная палочка','Сфера','Жезл','Двуручный волшебный посох'],
 'Друид':['Праща','Дубина','Серп','Ветвь','Жезл'],
 'Бард':['Рапира','Длинный меч','Короткий лук'],
 'Колдун':['Кинжал','Короткий меч','Длинный меч','Серп'],
 'Боец':[]
};
const weaponDir=new URL('../packs/_source/weapons/',import.meta.url);
const weapons=readdirSync(weaponDir).filter(f=>f.endsWith('.json')).map(f=>JSON.parse(readFileSync(new URL(f,weaponDir),'utf8')));
assert.equal(weapons.length,28);
assert.equal(new Set(weapons.map(w=>w.name)).size,weapons.length);
globalThis.game={i18n:{localize:k=>k}};
for(const [className,names] of Object.entries(fixedWeapons)){
 const pc={type:'character',system:{className},items:{contents:[]}};
 assert.deepEqual(weapons.filter(w=>weaponProficiency(w,pc).proficient).map(w=>w.name).sort(),[...names].sort(),className);
 for(const w of weapons){
  assert.equal(weaponProficiency({...w,system:{...w.system,proficiencyMode:'yes'}},pc).proficient,true);
  assert.equal(weaponProficiency({...w,system:{...w.system,proficiencyMode:'no'}},pc).proficient,false);
 }
 assert.equal(shortRestActions(pc).some(a=>a.id==='fieldRecovery'),['Егерь','Клерик','Друид','Колдун'].includes(className));
}
for(const [name,level] of [['Кистень',2],['Жестокий топор',2],['Тяжёлый молот',2]])assert.equal(weapons.find(w=>w.name===name).system.level,level);
assert.equal(weapons.find(w=>w.name==='Пистолет').system.grip,'1');
console.log('PASS C2: 280 fixed weapon proficiency combinations, explicit overrides, level-2 weapons and field recovery access');
