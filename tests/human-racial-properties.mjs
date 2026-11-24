import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {racialState,racialAddWarnings,registerRacialSettings} from '../module/data/racial-properties.mjs';
import {syncInnateProperties,registerRacialPropertyLifecycle} from '../module/sheets/racial-property-lifecycle.mjs';
import {addRacialProperty} from '../module/sheets/racial-property-picker.mjs';
import {applicableRollContributions,prepareRoll,finalizeRollEffects} from '../module/rolls/roll-context.mjs';
import {abilityAccountingStatus,restActor} from '../module/data/ability-accounting.mjs';
import {sendWeaponAttack,sendOtherItemAttack} from '../module/weapon/weapon-attack.mjs';
import {sendUnarmedAttack} from '../module/rolls/unarmed.mjs';
import {acceptPreroll} from './foundry-test-helpers.js';
const S='fast-nri-v14', dir=new URL('../packs/_source/abilities/',import.meta.url);
const cards=readdirSync(dir).map(file=>JSON.parse(readFileSync(new URL(file,dir),'utf8')));
function itemOf(data,actor=null){const doc=structuredClone(data);doc.id=doc._id;doc.parent=actor;doc.uuid=(actor?.uuid??'Compendium.abilities')+'.Item.'+doc.id;doc.getFlag=(scope,key)=>doc.flags?.[scope]?.[key];doc.toObject=()=>structuredClone(data);return doc;}
const card=(suffix)=>itemOf(cards.find(d=>d.flags?.[S]?.contentId?.endsWith(suffix)));
let counter=0;const notifications=[],hooks={},settings=[],world={};
globalThis.game={user:{id:'p',targets:new Set()},i18n:{localize:k=>k,lang:'ru'},settings:{get:(_s,key)=>world[key]??'public',register:(_s,key,cfg)=>settings.push([key,cfg])},packs:{get:()=>({getDocuments:async()=>cards.map(c=>itemOf(c))})}};
globalThis.ui={notifications:{warn:v=>notifications.push(v)}};
globalThis.Hooks={on:(key,fn)=>hooks[key]=fn};
globalThis.foundry={utils:{randomID:()=>`id${++counter}`,deepClone:structuredClone},applications:{api:{DialogV2:{wait:acceptPreroll}}}};
const actor={id:'hero',uuid:'Actor.hero',documentName:'Actor',type:'character',isOwner:true,hasPlayerOwner:true,name:'Hero',system:{race:'Человек',combatDie:'d10',resources:{},hp:{current:10,max:10,temp:0}},flags:{[S]:{}},effects:{contents:[]},items:{contents:[],get(id){return this.contents.find(i=>i.id===id)},has(id){return !!this.get(id)}},getFlag(scope,key){return this.flags[scope]?.[key]},async update(changes){for(const [path,v] of Object.entries(changes)){let target=this;const parts=path.split('.');for(const part of parts.slice(0,-1))target=target[part]??={};target[parts.at(-1)]=v;}},async createEmbeddedDocuments(type,docs,options={}){assert.equal(type,'Item');return docs.flatMap(data=>{const doc=itemOf(data,this);if(hooks.preCreateItem?.(doc,data,options)===false)return [];this.items.contents.push(doc);return [doc];});},async deleteEmbeddedDocuments(type,ids,options={}){assert.equal(type,'Item');this.items.contents=this.items.contents.filter(i=>!ids.includes(i.id)||hooks.preDeleteItem?.(i,options)===false);},getRollData:()=>({})};
registerRacialSettings();assert.deepEqual(settings.filter(([,cfg])=>cfg.config).map(([key,cfg])=>[key,cfg.scope,cfg.default]),[['racialAllowInnateRemoval','world',false],['racialAllowExcess','world',false]]);registerRacialPropertyLifecycle();assert.equal(typeof hooks.preDeleteItem,'function');
await syncInnateProperties(actor);await syncInnateProperties(actor);assert.equal(actor.items.contents.length,1);assert.equal(actor.items.contents[0].name,'Умелый');assert.equal(racialState(actor).used,0);
const half=await addRacialProperty(actor,card('racial.polukrovka'),'elf');
await syncInnateProperties(actor);await syncInnateProperties(actor);
let state=racialState(actor);assert.deepEqual(state.races,['human','elf']);assert.equal(state.max,3);assert.equal(state.used,1);assert.equal(actor.items.contents.length,4);assert.equal(new Set(actor.items.contents.map(i=>i.getFlag(S,'contentId'))).size,4);
actor.system.role='Наследник';assert.equal(racialState(actor).max,4);
const master=await addRacialProperty(actor,card('racial.master-boia'),null);assert.equal(master.system.mechanics.accounting.frequency.uses,1);
await addRacialProperty(actor,card('racial.prodvinutyi'),null);await addRacialProperty(actor,card('racial.ustoichivyi'),null);assert.equal(racialState(actor).used,4);
const wrong=card('racial.krepkij-khvost');assert.deepEqual(racialAddWarnings(actor,wrong),['wrongRace','limitReached']);
assert.equal(await addRacialProperty(actor,wrong,null),null);
world.racialAllowExcess=true;
const wrongOwned=await addRacialProperty(actor,wrong,null);assert.ok(actor.items.has(wrongOwned.id));assert.equal(racialState(actor).used,5);
const innate=actor.items.contents.find(i=>i.name==='Умелый');await actor.deleteEmbeddedDocuments('Item',[innate.id]);assert.ok(actor.items.has(innate.id));
world.racialAllowInnateRemoval=true;await actor.deleteEmbeddedDocuments('Item',[innate.id]);assert.ok(!actor.items.has(innate.id));
await actor.deleteEmbeddedDocuments('Item',[half.id]);await syncInnateProperties(actor,false);assert.deepEqual(racialState(actor).races,['human']);assert.ok(!actor.items.contents.some(i=>i.name==='Эльфийское проворство'));assert.ok(actor.items.has(wrongOwned.id));
// An out-of-race or over-limit direct creation receives a warning, never a veto.
assert.notEqual(hooks.preCreateItem({...wrong,parent:actor}),false);
const attackParams=()=>({actor,kind:'attack',usesCombatDie:true,formula:`1d20 + 1${actor.system.combatDie}`});
const entry=()=>applicableRollContributions(actor,attackParams()).find(e=>e.combatMasterItem);
let acceptMaster=false,cancel=false,dialogCount=0;
foundry.applications.api.DialogV2.wait=async cfg=>{dialogCount++;if(cancel)return null;const html=cfg.content;assert.match(html,/Мастер боя/);const row=[...html.matchAll(/<label\b[^>]*>[\s\S]*?<\/label>/g)].find(m=>m[0].includes('Мастер боя'));const index=row?.[0].match(/name="(part_\d+_0)"/)?.[1];assert.ok(index);
return acceptPreroll({...cfg,content:acceptMaster?html.replace(`name="${index}">`,`name="${index}" checked>`):html});};
for(const [from,to] of [[4,6],[6,8],[8,10],[10,12]]){actor.system.combatDie=`d${from}`;assert.equal(entry().parts[0].to,`1d${to}`);assert.equal(entry().parts[0].defaultEnabled,false);acceptMaster=true;const context=await prepareRoll(attackParams());assert.equal(context.expression,`1d20 + 1d${to}`);assert.equal(actor.system.combatDie,`d${from}`);await finalizeRollEffects(context,null);assert.equal(abilityAccountingStatus(actor,master).remaining,1);}
actor.system.combatDie='d12';assert.equal(entry(),undefined);actor.system.combatDie='d10';assert.ok(!applicableRollContributions(actor,{...attackParams(),kind:'skill'}).some(e=>e.combatMasterItem));assert.ok(!applicableRollContributions(actor,{...attackParams(),usesCombatDie:false}).some(e=>e.combatMasterItem));assert.ok(!applicableRollContributions(actor,{...attackParams(),formula:'1d20'}).some(e=>e.combatMasterItem));
const before=dialogCount;assert.equal((await prepareRoll({...attackParams(),skipDialog:true})).expression,'1d20 + 1d10');assert.equal(dialogCount,before);
acceptMaster=false;assert.equal((await prepareRoll(attackParams())).expression,'1d20 + 1d10');cancel=true;assert.equal(await prepareRoll(attackParams()),null);cancel=false;
acceptMaster=true;let prepared=await prepareRoll(attackParams());await finalizeRollEffects(prepared,{id:'msg1'});await finalizeRollEffects(prepared,{id:'msg1'});assert.equal(abilityAccountingStatus(actor,master).used,1);assert.equal(abilityAccountingStatus(actor,master).remaining,0);assert.match(entry().parts[0].warning,/exhausted/);prepared=await prepareRoll(attackParams());assert.equal(prepared.expression,'1d20 + 1d12');await finalizeRollEffects(prepared,{id:'msg2'});assert.equal(abilityAccountingStatus(actor,master).used,2);await restActor(actor);assert.equal(abilityAccountingStatus(actor,master).remaining,1);
// Previously embedded copies still work, with no migration or UUID change.
delete master.system.mechanics.combatDieUpgrade;delete master.system.mechanics.accounting;assert.equal(abilityAccountingStatus(actor,master).remaining,1);assert.ok(entry());
// Actual publication path: weapon, unarmed, and spell; no target needed.
globalThis.Roll=class{constructor(formula){this.formula=formula;this.dice=[{faces:20,number:1,results:[{result:12,active:true}]}];this.total=18;}static validate(){return true}async evaluate(){return this}async toMessage(data){return {...data,id:`pub${++counter}`,formula:this.formula}}};
globalThis.ChatMessage={getSpeaker:()=>({actor:actor.id})};
const weapon={id:'weapon',type:'weapon',name:'Sword',uuid:'Actor.hero.Item.weapon',system:{attackKind:'melee',proficiencyMode:'yes',damageProfile:{A:'1d6',B:'1d6',C:2}}};
assert.equal((await sendWeaponAttack(weapon,actor)).formula,'1d20 + 1d12');assert.equal(abilityAccountingStatus(actor,master).remaining,0);
assert.equal((await sendUnarmedAttack(actor)).formula,'1d20 + 1d12');
const spell=card('ability.warlock.eldritch-blast');assert.ok(spell);assert.equal((await sendOtherItemAttack(spell,actor,{execution:spell.system.mechanics.executions[0]})).formula,'1d20 + 1d12');
console.log('PASS racial warnings, actual innate synchronization, Half-Blood, Heir, Combat Master step, frequency, rest and publication');
