/** Combined control-content regression, actual card JSON and production modules.
 * Foundry document persistence, data preparation and dialogs are simulated. */
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {classInitializationUpdate} from '../module/data/classes.mjs';
import {initialSkillEntries} from '../module/data/skills-catalog.mjs';
import {initialSkillAllocation,resolveSkillAllocation,planSkillDie,planSkillUpgrade,resetSkillDicePatch} from '../module/data/skill-allocation.mjs';
import {racialState,inheritedAttackTraits,racialAddWarnings} from '../module/data/racial-properties.mjs';
import {syncInnateProperties} from '../module/sheets/racial-property-lifecycle.mjs';
import {addRacialProperty} from '../module/sheets/racial-property-picker.mjs';
import {potionResource} from '../module/data/potion-resource.mjs';
import {availableUnarmedActions,sendUnarmedAttack} from '../module/rolls/unarmed.mjs';
import {applicableRollContributions,prepareRoll} from '../module/rolls/roll-context.mjs';
import {skillFormula} from '../module/rolls/checks.mjs';
import {sendOtherItemAttack} from '../module/weapon/weapon-attack.mjs';
import {selectAreaDamageParts} from '../module/damage/area-damage-profile.mjs';
import {abilityAccountingStatus,restActor} from '../module/data/ability-accounting.mjs';
import {acceptPreroll} from './foundry-test-helpers.js';
const NS='fast-nri-v14',dir=new URL('../packs/_source/abilities/',import.meta.url);
const cards=readdirSync(dir).map(file=>JSON.parse(readFileSync(new URL(file,dir),'utf8')));
const find=stem=>{const c=cards.find(c=>c.flags?.[NS]?.contentId?.endsWith(stem));assert.ok(c,stem);return c;};
const patch=(doc,updates)=>{for(const [path,value] of Object.entries(updates)){let dst=doc;const keys=path.split('.');for(const k of keys.slice(0,-1))dst=dst[k]??={};const k=keys.at(-1);if(k.startsWith('-='))delete dst[k.slice(2)];else dst[k]=structuredClone(value);}};
let seq=0;const warnings=[];
class Field {constructor(...args){this.args=args;}}
class Model {prepareBaseData(){} prepareDerivedData(){}}
const makeItem=(data,parent)=>{const item=structuredClone(data);item.id=item._id??`item${++seq}`;item.parent=parent;item.uuid=`${parent?.uuid??'Compendium.abilities'}.Item.${item.id}`;item.getFlag=(scope,key)=>item.flags?.[scope]?.[key];item.toObject=()=>structuredClone(data);item.update=async changes=>patch(item,changes);return item;};
const card=stem=>makeItem(find(stem));
const natureChoice=async cfg=>{assert.match(cfg.content,/data-racial-subproperties/);const list={dataset:{},addEventListener(_type,fn){fn({target:{closest:()=>({dataset:{racialId:'fire'}})}});}};cfg.render({}, {element:{querySelector:()=>list},close:()=>{}});return null;};
globalThis.foundry={data:{fields:{StringField:Field,NumberField:Field,SchemaField:Field,TypedObjectField:Field,ObjectField:Field}},abstract:{TypeDataModel:Model},utils:{randomID:()=>`id${++seq}`,deepClone:structuredClone},documents:{Combat:class {constructor(combatants){this.combatants=combatants;this.started=false;} async startCombat(){this.started=true;return this;}}},applications:{api:{DialogV2:{wait:natureChoice}}}};
globalThis.game={user:{id:'p',isGM:true,targets:new Set()},i18n:{localize:k=>k,lang:'ru'},settings:{get:()=> 'public'},time:{worldTime:100},packs:{get:()=>({getDocuments:async()=>cards.map(c=>makeItem(c))})}};
globalThis.ui={notifications:{warn:s=>warnings.push(s)}};
const {CharacterModel}=await import('../module/data/models.mjs');
const {FastNRICombat}=await import('../module/combat/fnri-combat.mjs');
function hero(id,race){
 const raw={className:'Колдун',race,role:'Наследник',wealth:'5',level:null,speed:null,combatDie:'',classTradition:'mysticism',hp:{current:null,max:null,temp:0},ac:{partial:null,success:null,great:null},defenses:{awareness:null,reflex:null,fortitude:null,will:null},resources:{},potionsUsed:0,equipment:{leftHand:'',rightHand:'',armor:''},skills:initialSkillEntries(),skillAllocation:initialSkillAllocation()};
 const actor={id,uuid:`Actor.${id}`,documentName:'Actor',type:'character',isOwner:true,hasPlayerOwner:true,name:id,raw,flags:{},effects:{contents:[]},items:{contents:[],get(id){return this.contents.find(i=>i.id===id)},has(id){return !!this.get(id)}},getFlag(s,k){return this.flags[s]?.[k];},toObject(){return {system:structuredClone(raw)}},getRollData(){return {}},prepare(){const model=new CharacterModel();Object.assign(model,structuredClone(raw));model.parent=this;this.system=model;model.prepareBaseData();model.prepareDerivedData();},async update(changes){const dest={system:raw,flags:this.flags};patch(dest,changes);this.flags=dest.flags;this.prepare();return this;},async createEmbeddedDocuments(type,docs){assert.equal(type,'Item');const result=docs.map(d=>makeItem(d,this));this.items.contents.push(...result);this.prepare();return result;},async deleteEmbeddedDocuments(type,ids){assert.equal(type,'Item');this.items.contents=this.items.contents.filter(i=>!ids.includes(i.id));this.prepare();}};
 patch({system:raw},classInitializationUpdate(raw));actor.prepare();return actor;
}
const human=hero('human','Человек'),dragon=hero('dragon','Драконообразный');
for(const a of [human,dragon]){await syncInnateProperties(a);a.prepare();assert.equal(a.system.hp.max,19);assert.equal(a.system.hp.current,19);assert.equal(a.system.speed,6);assert.equal(a.system.combatDie,'d6');assert.deepEqual(a.system.defenses,{awareness:10,reflex:10,fortitude:12,will:14});assert.equal(a.system.resources.class_magic.current,4);assert.equal(a.system.skills.core_mysticism.dice,'1d10');assert.equal(racialState(a).max,4);assert.equal(a.raw.hp.max,null);}
assert.equal(human.items.contents.length,1);assert.equal(dragon.items.contents.length,2);
const half=await addRacialProperty(human,card('racial.polukrovka'),'draconic');await syncInnateProperties(human);await syncInnateProperties(human);human.prepare();assert.equal(human.items.contents.length,4);assert.deepEqual(racialState(human).races,['human','draconic']);assert.equal(racialState(human).used,1);
for(const suffix of ['racial.prodvinutyi','racial.ustoichivyi','racial.drakoni-krylia'])await addRacialProperty(human,card(suffix),null);
for(const suffix of ['ability.draconic.breath','racial.krepkij-khvost','racial.drakoni-krylia'])await addRacialProperty(dragon,card(suffix),null);
const clawData=cards.find(c=>c.system.mechanics?.unarmedAttack?.name==='Когти'&&c.system.mechanics.racialProperty?.races?.includes('draconic'));assert.ok(clawData);await addRacialProperty(dragon,makeItem(clawData),null);
for(const a of [human,dragon]){a.prepare();assert.equal(racialState(a).used,4);assert.deepEqual(Object.values(a.system.ac),[8,13,21]);assert.equal(a.system.speed,6);assert.equal(a.system.hp.max,19);assert.equal(a.effects.contents.length,0);}
assert.equal(potionResource(human).max,4);assert.equal(potionResource(dragon).max,3);
const free=a=>resolveSkillAllocation(a.raw,a.items.contents).free.map(d=>d.face).sort((a,b)=>a-b);
assert.deepEqual(free(human),[6,6,6,6,8]);assert.deepEqual(free(dragon),[6,6,8]);
human.raw.skillAllocation=planSkillDie(human.raw,human.items.contents,'society','1d6');let allocation=resolveSkillAllocation(human.raw,human.items.contents);human.raw.skillAllocation=planSkillUpgrade(human.raw,allocation.upgrades.find(u=>u.size===6).id,allocation.rows.society.die);human.prepare();assert.equal(skillFormula(human.system.skills.core_society),'1d20 + (1d8)');
let formula=skillFormula(human.system.skills.core_society);let entries=applicableRollContributions(human,{kind:'skill',skillId:'core_society',formula});assert.equal(entries.filter(e=>e.sourceType==='role').length,1);
foundry.applications.api.DialogV2.wait=async cfg=>acceptPreroll({...cfg,content:cfg.content.replace('name="part_0_0">','name="part_0_0" checked>')});
assert.equal((await prepareRoll({actor:human,kind:'skill',skillId:'core_society',formula})).expression,formula+' + (1d10)');assert.equal((await prepareRoll({actor:human,kind:'skill',skillId:'core_society',formula,skipDialog:true})).expression,formula);
const spec=structuredClone(human.raw.skills.starter_primary);await human.update(resetSkillDicePatch(human.raw));assert.equal(human.system.skills.core_society.dice,'');assert.equal(human.system.skills.core_mysticism.dice,'1d10');assert.deepEqual(human.raw.skills.starter_primary,spec);assert.deepEqual(free(human),[6,6,6,6,8]);
const breath=dragon.items.contents.find(i=>i.name==='Дыхание');assert.ok(breath);assert.deepEqual(inheritedAttackTraits(dragon,breath,breath.system.mechanics.executions[0].attack.properties),['Огонь']);assert.equal(abilityAccountingStatus(dragon,breath).remaining,1);
const pool=[2,4,6].map((value,i)=>({id:`d${i}`,value,damageType:'магический',faces:6}));
for(const [degree,expected] of [['failure',0],['partial',4],['success',10],['great',12]]){const result=selectAreaDamageParts(pool,degree,breath.system.mechanics.executions[0].attack.areaDamageProfile);assert.equal(result.ok,true);assert.equal(pool.filter(p=>result.includedPartIds.includes(p.id)).reduce((n,p)=>n+p.value,0),expected);}
const claws=()=>availableUnarmedActions(dragon).find(x=>x.name==='Когти');assert.equal(claws().freeHandWarning,false);await dragon.update({'system.equipment.leftHand':'occupied','system.equipment.rightHand':'occupied'});assert.equal(claws().freeHandWarning,true);assert.equal(availableUnarmedActions(dragon).find(x=>x.name==='Удар хвостом').freeHandWarning,false);
globalThis.Roll=class{constructor(formula){this.formula=formula;this.dice=[{faces:20,number:1,results:[{result:12,active:true}]}];this.total=18;}static validate(){return true}async evaluate(){return this}async toMessage(data){return {...data,id:`pub${++seq}`,formula:this.formula}}};globalThis.ChatMessage={getSpeaker:()=>({actor:dragon.id})};
assert.equal((await sendUnarmedAttack(dragon,{choice:claws().key,skipPreroll:true})).formula,'1d20 + 1d6');assert.ok(warnings.some(w=>w.endsWith('freeHandRequired')));
const [blast]=await human.createEmbeddedDocuments('Item',[find('ability.warlock.eldritch-blast')]);
const spell=await sendOtherItemAttack(blast,human,{execution:blast.system.mechanics.executions[0],targetTokens:[],skipPreroll:true});assert.equal(spell.formula,'1d20 + 1d6');assert.equal(human.system.resources.class_magic.current,3,'actual spell spends the automatically created resource');
await human.update({'system.hp.max':23,'system.defenses.fortitude':17,'system.hp.current':7,'system.hp.temp':3,'system.resources.class_magic.current':1,'system.potionsUsed':4});assert.equal(human.system.hp.max,23);assert.equal(human.system.defenses.fortitude,19);for(let i=0;i<3;i++){human.prepare();assert.equal(human.system.defenses.fortitude,19);assert.equal(human.system.ac.great,21);assert.equal(human.system.resources.class_magic.current,1);}
await dragon.update({'system.resources.class_magic.current':2});const combat=new FastNRICombat([{actor:human},{actor:human}]);await combat.startCombat();assert.equal(human.system.resources.class_magic.current,4);assert.equal(dragon.system.resources.class_magic.current,2);assert.equal(human.system.hp.current,7);assert.equal(human.system.potionsUsed,4);await human.update({'system.resources.class_magic.current':1});await combat.startCombat();assert.equal(human.system.resources.class_magic.current,1);
await restActor(human);assert.equal(human.system.hp.current,23);assert.equal(human.system.hp.temp,0);assert.equal(human.system.potionsUsed,0);assert.equal(human.system.resources.class_magic.current,4);assert.equal(dragon.system.resources.class_magic.current,2);
await human.update({'system.role':''});assert.equal(human.system.defenses.fortitude,17);assert.equal(racialState(human).max,3);assert.equal(racialState(human).used,4);assert.ok(racialAddWarnings(human,card('racial.master-boia')).includes('limitReached'));await human.deleteEmbeddedDocuments('Item',[half.id]);await syncInnateProperties(human,false);human.prepare();assert.deepEqual(racialState(human).races,['human']);assert.equal(human.items.contents.length,5);assert.equal(human.system.ac.great,21,'manually owned wings are retained and remain functional');assert.equal(human.system.resources.class_magic.current,4);
console.log('PASS combined Human-Halfblood/Dragonborn Warlock Heir: real innate grants and choice, race limits, class/role/wing stats, skills and reset, social preroll, claw warning and attack, combat/repeated start/rest, manual base and free correction');
