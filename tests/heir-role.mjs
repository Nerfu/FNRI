import assert from 'node:assert/strict';
import {racialState,racialAddProblem} from '../module/data/racial-properties.mjs';
import {applicableRollContributions,prepareRoll,needsPreroll} from '../module/rolls/roll-context.mjs';
import {acceptPreroll} from './foundry-test-helpers.js';
class Field {constructor(...args){this.args=args;}}
class TypeModel {prepareDerivedData(){}}
globalThis.foundry={data:{fields:{StringField:Field,NumberField:Field,SchemaField:Field,TypedObjectField:Field,ObjectField:Field}},abstract:{TypeDataModel:TypeModel},applications:{api:{DialogV2:{}}}};
globalThis.game={i18n:{localize:k=>k},settings:{get:()=>true}};
const {CharacterModel}=await import('../module/data/models.mjs');
assert.ok(CharacterModel.defineSchema().role);
const base={race:'Человек',role:'',wealth:'10',defenses:{awareness:12,reflex:13,fortitude:15,will:14},ac:{partial:10,success:15,great:20}};
const actor={id:'hero',uuid:'Actor.hero',type:'character',name:'Hero',items:{contents:[]},effects:{contents:[]}};
const model=new CharacterModel();model.parent=actor;actor.system=model;
const prep=(role)=>{Object.assign(model,structuredClone({...base,role}));model.prepareDerivedData();};
prep('');assert.equal(model.defenses.fortitude,15);assert.equal(model.defenses.will,14);assert.equal(racialState(actor).max,3);
for(let i=0;i<3;i++){prep('Наследник');assert.deepEqual(model.defenses,{awareness:12,reflex:13,fortitude:17,will:16});assert.equal(model.wealth,'10');assert.equal(racialState(actor).max,4);}
assert.equal(base.defenses.fortitude,15);assert.equal(actor.effects.contents.length,0);
const raceProp=id=>({id,type:'ability',system:{mechanics:{racialProperty:{universal:true}}},getFlag:()=>id});
actor.items.contents=[raceProp('a'),raceProp('b'),raceProp('c')];assert.equal(racialAddProblem(actor,raceProp('d')),null);
actor.items.contents.push(raceProp('d'));assert.equal(racialAddProblem(actor,raceProp('e')),'limitReached');
model.race='Эльф';assert.equal(racialState(actor).max,3);model.race='Человек';
let dialogs=0;const formula='1d20 + (1d6)';
for(const skill of ['society','persuasion','deception','intimidation']){
 const params={actor,kind:'skill',skillId:'core_'+skill,formula};
 const entries=applicableRollContributions(actor,params);assert.equal(entries.length,1);assert.equal(entries[0].sourceType,'role');assert.equal(entries[0].parts[0].defaultEnabled,false);
 foundry.applications.api.DialogV2.wait=async cfg=>{dialogs++;assert.match(cfg.content,/Наследник/);assert.match(cfg.content,/name="part_0_0">/);return acceptPreroll(cfg);};
 assert.equal((await prepareRoll(params)).expression,formula);
 foundry.applications.api.DialogV2.wait=async cfg=>{dialogs++;return acceptPreroll({...cfg,content:cfg.content.replace('name="part_0_0">','name="part_0_0" checked>')});};
 assert.equal((await prepareRoll(params)).expression,formula+' + (1d10)');
 assert.equal((await prepareRoll({...params,skipDialog:true})).expression,formula);
}
assert.equal(dialogs,8);
assert.equal(applicableRollContributions(actor,{kind:'skill',skillId:'core_athletics',formula}).length,0);
prep('Другая роль');assert.equal(model.defenses.fortitude,15);assert.equal(model.defenses.will,14);assert.equal(racialState(actor).max,3);assert.equal(actor.items.contents.length,4,'removing role does not delete racial items');
assert.equal(applicableRollContributions(actor,{kind:'skill',skillId:'core_society',formula}).length,0);
assert.ok(needsPreroll('1d20'));assert.ok(needsPreroll('d20+1'));assert.ok(!needsPreroll('1d200'));assert.ok(!needsPreroll('2d20'));assert.ok(!needsPreroll('1d20',[],{skipDialog:true}));
console.log('PASS Role model, permanent defenses, optional social contributions, race quota, role removal');
