/** Stage-3 isolated tests. Does not pretend to replace live Foundry v14. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {skillFormula,itemFormula,postRoll,resolveMessageMode} from '../module/rolls/checks.mjs';

const sent=[];const rolled=[];
globalThis.Roll=class {
  static validate(expression){return !expression.includes('INVALID');}
  constructor(expression,data){this.expression=expression;this.data=data;rolled.push(this);}
  async evaluate(){this.terms=['d20', 'd6'];this.total=17;return this;}
  async toMessage(data,opts){sent.push({expression:this.expression,data,opts});return {id:'msg'};}
};
globalThis.ChatMessage={getSpeaker(args={}){return args.actor ? {actor:args.actor.id}: {alias:'Standalone'};}};

assert.equal(skillFormula({dice:'2d6 + 1d10',modifier:3}),'1d20 + (2d6 + 1d10) + (3)');
assert.equal(skillFormula({dice:'',modifier:0}),'1d20');
assert.equal(skillFormula({dice:'-1d4',modifier:-2}),'1d20 + (-1d4) + (-2)');
assert.equal(skillFormula({dice:'1d8',value:999}),'1d20 + (1d8)','old numeric values are not reinterpreted');
assert.equal(skillFormula({dice:'1d8',modifier:'5'}),'1d20 + (1d8)','free text is never a numeric modifier');
assert.equal(itemFormula({system:{rollFormula:'3d12 + 7'}}),'3d12 + 7');
assert.equal(itemFormula({system:{rollFormula:''}}),'');
assert.equal(resolveMessageMode('blind','public'),'blind');
assert.equal(resolveMessageMode('','gm'),'gm');
assert.equal(resolveMessageMode('unknown','unknown'),'public');

// AE was applied by Foundry to actor.system.skills[...].modifier BEFORE roll.
// +2 and +3 from distinct enabled sources should be reflected exactly once.
const actor={id:'actorA',getRollData(){return {actor:'prepared'}}};
const effects=[{disabled:false,delta:2},{disabled:false,delta:3},{disabled:true,delta:50}];
const prepared=effects.filter(e=>!e.disabled).reduce((n,e)=>n+e.delta,0);
const entry={name:'Sample skill',dice:'2d6',modifier:prepared};
await postRoll({formula:skillFormula(entry),label:'Skill <secret> & "test"',actor,mode:'gm'});
assert.equal(sent[0].expression,'1d20 + (2d6) + (5)');
assert.equal(sent[0].opts.messageMode,'gm');
assert.equal(sent[0].data.speaker.actor,'actorA');
assert.deepEqual(rolled[0].data,{actor:'prepared'});
assert.ok(sent[0].data.flavor.includes('&lt;secret&gt;'));
assert.ok(!sent[0].data.flavor.includes('<secret>'));
// Disabling the effect restores the prepared value, not by subtracting twice.
effects[0].disabled=true;
entry.modifier=effects.filter(e=>!e.disabled).reduce((n,e)=>n+e.delta,0);
await postRoll({formula:skillFormula(entry),label:'Skill',actor,mode:'blind'});
assert.equal(sent[1].expression,'1d20 + (2d6) + (3)');
assert.equal(sent[1].opts.messageMode,'blind');
assert.ok(sent[1].data.flavor.includes('Skill'));

// Different card versions coexist. A deprecated flag never blocks the roll.
const legacy={system:{rollFormula:'1d6'},flags:{status:'deprecated'}};
const modern={system:{rollFormula:'2d8+1'}};
await postRoll({formula:itemFormula(legacy),label:'Old',mode:'self'});
await postRoll({formula:itemFormula(modern),label:'New',mode:'public'});
assert.equal(sent[2].expression,'1d6');assert.equal(sent[2].opts.messageMode,'self');
assert.equal(sent[3].expression,'2d8+1');assert.equal(sent[3].opts.messageMode,'public');

await assert.rejects(()=>postRoll({formula:'INVALID',label:'x'}),/invalid-formula/);
await assert.rejects(()=>postRoll({formula:'',label:'x'}),/empty-formula/);
assert.equal(sent.length,4,'failed formulas do not create any chat message');

const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const read=path=>readFileSync(join(root,path),'utf8');
for(const file of ['templates/character.hbs','templates/npc.hbs']){
 const src=read(file);
 for(const action of ['rollSkill','createEffect','editEffect','toggleEffect','deleteEffect'])
  assert.ok(src.includes(`data-action="${action}"`),`${file} missing ${action}`);
 assert.ok(src.includes('data-row-field="modifier"'));
 assert.ok(src.includes('data-fnri-message-mode'));
}
const item=read('templates/item.hbs');
for(const action of ['itemRoll','createItemEffect','editItemEffect','toggleItemEffect','deleteItemEffect'])
 assert.ok(item.includes(`data-action="${action}"`));
assert.ok(read('module/sheets/sheets.mjs').includes('system: { changes: [{'),'v14 AE changes must be nested in system');
assert.ok(read('module/sheets/sheets.mjs').includes('transfer: false'));
console.log('PASS stage 3: skill checks, custom dice, modifiers, disabled AE, modes and privacy, item roll compatibility');
