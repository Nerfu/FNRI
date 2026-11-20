import assert from 'node:assert/strict';
import { dirname,resolve } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const mod=name=>import(pathToFileURL(resolve(root,name)).href);
const {BASIC_SKILLS,SKILL_GROUPS,initialSkillEntries}=await mod('module/data/skills-catalog.mjs');
assert.equal(BASIC_SKILLS.length,15);
assert.deepEqual(SKILL_GROUPS,['physical','practical','magical','social']);
assert.equal(new Set(BASIC_SKILLS.map(s=>s.id)).size,15);
assert.deepEqual(BASIC_SKILLS.map(x=>x.group).reduce((a,b)=>(a[b]=(a[b]??0)+1,a),{}),{
  physical:4,practical:3,magical:4,social:4
});
assert.deepEqual(BASIC_SKILLS.map(x=>x.name), [
  'Акробатика','Атлетика','Скрытность','Ловкость рук','Выживание','Медицина','Ремесло',
  'Природа','Религия','Мистика','Аркана','Общество','Убеждение','Обман','Запугивание'
]);
const mockID=()=>`testCustom${Math.random().toString(16).slice(2,10)}`;
class Sheet {
  constructor({actor}={}){this.actor=actor;this.isEditable=true;}
  async _prepareContext(){return {};}
  async _onRender(){}
}
globalThis.foundry={utils:{randomID:mockID},applications:{api:{HandlebarsApplicationMixin:Base=>Base,DialogV2:{}},
  sheets:{ActorSheetV2:Sheet,ItemSheetV2:Sheet}}};
globalThis.game={i18n:{localize:k=>k},settings:{get:()=>"public"}};
globalThis.ui={notifications:{error(msg){throw new Error(msg)},warn(msg){throw new Error(msg)}}};
globalThis._del=Symbol('DELETE');
const {FastNRICharacterSheet}=await mod('module/sheets/sheets.mjs');
const clone=x=>structuredClone(x);
function makeActor({name='Тестовый герой',skills=initialSkillEntries()}={}){
  const stored={name,system:{skills:clone(skills),resources:{},equipmentSlots:{},equipment:{leftHand:'',rightHand:'',armor:''},
    hp:{current:null,max:null,temp:null},ac:{partial:null,success:null,great:null},
    defenses:{awareness:null,reflex:null,fortitude:null,will:null},speed:null}};
  let prepared=clone(stored.system);
  const actor={id:'char1',type:'character',name,system:prepared,_source:stored,updates:[],
    toObject(){return clone(this._source)},items:{contents:[]},effects:{contents:[]},
    async update(change){
      for(const [path,value] of Object.entries(change)){
        this.updates.push([path,value]);
        if(path==='name'){this.name=this._source.name=value;continue;}
        assert.ok(path.startsWith('system.'));
        const seg=path.slice(7).split('.');
        for(const data of [this._source.system,this.system]){
          let ptr=data;
          for(const part of seg.slice(0,-1)){ptr[part]??={};ptr=ptr[part]}
          if(value===globalThis._del)delete ptr[seg.at(-1)];
          else ptr[seg.at(-1)]=clone(value);
        }
      }
    }
  };
  return actor;
}
const actor=makeActor();
let sheet=new FastNRICharacterSheet({actor});
let ctx=await sheet._prepareContext({});
assert.deepEqual(ctx.catalogGroups.map(g=>g.rows.length),[4,3,4,4]);
assert.equal(ctx.skillRows.length,2,'two blank starting specialization entries');
assert.deepEqual(ctx.skillRows.map(x=>x.dice),['2d6','2d4']);
assert.equal(Object.keys(actor._source.system.skills).length,17);
assert.ok(ctx.catalogGroups[0].rows.every(x=>x.dice===''));
// Explicit edits only touch their own row. No object-wide skills update.
sheet._saveRowControl({dataset:{rowCollection:'skills',rowId:'core_athletics',rowField:'dice'},value:'1d10',setCustomValidity(){}});
await sheet._writeQueue;
sheet._saveRowControl({dataset:{rowCollection:'skills',rowId:'core_acrobatics',rowField:'modifier'},value:'+2',setCustomValidity(){}});
await sheet._writeQueue;
assert.equal(actor.system.skills.core_athletics.dice,'1d10');
assert.equal(actor.system.skills.core_acrobatics.modifier,2);
await actor.update({name:'Переименованный персонаж'});
await sheet._addRow('skills',{name:'Мореходство',kind:'skill',dice:'2d8',modifier:null,value:null});
await sheet._addRow('skills',{name:'Легенды леса',kind:'specialization',dice:'2d6',modifier:null,value:null});
ctx=await sheet._prepareContext({});
assert.equal(ctx.skillRows.length,4);
assert.equal(ctx.catalogGroups.flatMap(g=>g.rows).length,15);
assert.equal(actor.updates.some(([p])=>p==='system.skills'),false,'never overwrite the whole dictionary');
const saved=clone(actor._source);
const actorRestart=makeActor({name:saved.name,skills:saved.system.skills});
sheet=new FastNRICharacterSheet({actor:actorRestart});
const after=await sheet._prepareContext({});
assert.equal(actorRestart.name,'Переименованный персонаж');
assert.equal(after.catalogGroups.flatMap(g=>g.rows).length,15);
assert.equal(after.catalogGroups[0].rows.find(x=>x.id==='core_athletics').dice,'1d10');
assert.equal(after.catalogGroups[0].rows.find(x=>x.id==='core_acrobatics').modifier,2);
assert.deepEqual(after.skillRows.slice(-2).map(r=>r.name),['Мореходство','Легенды леса']);
assert.deepEqual(after.skillRows.slice(0,2).map(r=>r.dice),['2d6','2d4']);
// Simulate an existing pre-0.1.9 Actor: base skills virtual until first edit.
const prior=makeActor({skills:{old99:{name:'Свой старый навык',kind:'skill',dice:'3d4',modifier:0,value:null}}});
const oldSheet=new FastNRICharacterSheet({actor:prior});
const virtual=await oldSheet._prepareContext({});
assert.equal(virtual.catalogGroups.flatMap(g=>g.rows).length,15);
assert.equal(virtual.skillRows.length,1);
oldSheet._saveRowControl({dataset:{rowCollection:'skills',rowId:'core_arcana',rowField:'dice'},value:'1d8',setCustomValidity(){}});
await oldSheet._writeQueue;
assert.equal(prior.system.skills.core_arcana.name,'Аркана');
assert.equal(prior.system.skills.core_arcana.dice,'1d8');
assert.equal(prior.system.skills.old99.dice,'3d4');
const priorAfter=makeActor({skills:prior._source.system.skills});
assert.equal((await (new FastNRICharacterSheet({actor:priorAfter}))._prepareContext({})).catalogGroups.flatMap(g=>g.rows).length,15);
// A transiently empty prepared skills object must not hide stored skills.
priorAfter.system.skills={};
const mismatch=(await (new FastNRICharacterSheet({actor:priorAfter}))._prepareContext({}));
assert.equal(mismatch.skillRows.length,1);
assert.equal(mismatch.catalogGroups[2].rows.find(x=>x.id==='core_arcana').dice,'1d8');
console.log('PASS catalogue 15/4 groups, independent edit + name, add skills/spec, reload, old Actor virtual defaults, source/prepared reconciliation');
