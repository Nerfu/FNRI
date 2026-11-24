import {installTemplateMock} from './foundry-test-helpers.js';
import assert from 'node:assert/strict';
const {readFileSync}=await import('node:fs');
const locale=JSON.parse(readFileSync(new URL('../lang/ru.json',import.meta.url),'utf8')).FASTNRI;
const localize=k=>k.split('.').slice(1).reduce((o,key)=>o?.[key],locale)??k;
class BaseSheet {constructor(opts={}){this.actor=opts.actor;this.isEditable=true;}async _prepareContext(){return {};} }
globalThis.game={user:{getFlag(){return null;}},i18n:{localize}};
globalThis.foundry={applications:{api:{HandlebarsApplicationMixin(P){return class extends P{};},DialogV2:{}},sheets:{ActorSheetV2:BaseSheet,ItemSheetV2:BaseSheet}}};
installTemplateMock();
const {FastNRICharacterSheet,FastNRINPCSheet}=await import('../module/sheets/sheets.mjs');
const sword={id:'sword',getFlag(){return undefined;},name:'Длинный меч',sort:0,img:'',type:'weapon',system:{damageProfile:{A:'1d10',B:'1d10',C:4},
  attackKind:'melee',distance:'Ближняя',properties:'Рубящее',grip:'1'}};
const fist={id:'claw',getFlag(){return undefined;},name:'Когти',sort:1,img:'',type:'ability',system:{mechanics:{unarmedAttack:{mode:'option',active:true,
  damageProfile:{A:'1d8',B:'1d6',C:5},properties:'Природное оружие'}}}};
for(const [type,Sheet] of [['character',FastNRICharacterSheet],['npc',FastNRINPCSheet]]){
  const base={hp:{current:12,max:15,temp:0},ac:{partial:7,success:12,great:17},
    defenses:{awareness:0,reflex:0,fortitude:0,will:0},skills:{},resources:{},combatDie:'d6',
    equipment:{leftHand:'sword',rightHand:'',armor:''},equipmentSlots:{},equipmentWear:{}};
  const actor={id:'actor',name:'Hero',type,system:base,
    toObject(){return {system:structuredClone(this.system)};},
    items:{contents:[sword,fist],get:id=>[sword,fist].find(it=>it.id===id)},
    effects:{contents:[]},getFlag(scope,key){return key==='selectedUnarmedAttack'?'item:claw':null;}};
  const sheet=new Sheet({actor});const ctx=await sheet._prepareContext({});
  assert.equal(ctx.attackHands[0].damageSummary,'1d10/1d10/+4');
  assert.equal(ctx.attackHands[0].details,'Ближняя · Рубящее');
  assert.equal(ctx.unarmedAction.damageSummary,'1d8/1d6/+5');
  assert.equal(ctx.unarmedAction.details,'Природное оружие');
  assert.equal(ctx.attackHands[1].damageSummary,'');
}
console.log('PASS: both actual Actor sheet contexts populate short profiles for weapons and selected melee cards');
