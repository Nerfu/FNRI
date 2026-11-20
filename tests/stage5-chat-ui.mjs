import assert from 'node:assert/strict';
import {renderDamageCard,toggleManualCritical} from '../module/damage/damage-chat.mjs';
import {renderHpReport} from '../module/damage/hp-actions.mjs';
const ID='fast-nri-v14';
class N {constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.textContent='';this.className='';
  this.classes=new Set();this.classList={add:x=>this.classes.add(x),contains:x=>this.classes.has(x)};}
  append(...nodes){this.children.push(...nodes);}querySelector(sel){return sel==='.message-content'?this:null;}
  addEventListener(name,callback){this.events??={};this.events[name]=callback;}}
globalThis.document={createElement:tag=>new N(tag)};
globalThis.game={user:{id:'gm',isGM:true},i18n:{localize:k=>k.split('.').at(-1)}};
const data={version:2,parts:[{id:'A',kind:'die',value:5,original:5,formula:'1d6',excluded:false,
  damageType:'physical',traits:[]},{id:'C',kind:'fixed',value:4,original:4,formula:'4',excluded:true,
  damageType:'physical',traits:[]}],attackTotal:18,naturalD20:20,manualCritical:null,
  adjustments:{penalty:0,resistance:0,vulnerability:0},history:[],revision:0};
const msg={flags:{[ID]:{weaponDamage:data}},isAuthor:true,canUserModify(){return true;},
  getFlag(s,k){return this.flags?.[s]?.[k];},async update(obj){for(const [p,v] of Object.entries(obj))this.flags[ID][p.split('.').at(-1)]=v;}};
const root=new N('div');renderDamageCard(msg,root);
const card=root.children[0];assert.equal(card.className,'fnri-damage-card');
const labels=card.children.map(n=>n.className);
assert.deepEqual(labels.slice(0,4),['fnri-damage-attack','fnri-damage-parts','fnri-damage-total','fnri-damage-button']);
assert.equal(card.children[3].classList.contains('fnri-intervene-button'),true);
const bottom=card.children.at(-1);
assert.equal(bottom.className,'fnri-damage-bottom');
assert.equal(bottom.children[0].textContent,'apply');
assert.equal(bottom.children[1].textContent,'critical');
assert.equal(bottom.children[1].classList.contains('fnri-crit-active'),true);
assert.equal(card.children[1].children[1].classList.contains('fnri-damage-excluded'),true);
await toggleManualCritical(msg);
assert.equal(msg.getFlag(ID,'weaponDamage').manualCritical,false,'manual toggle disables automatic natural20 multiplier');
const root2=new N('div');renderDamageCard(msg,root2);
assert.equal(root2.children[0].children[2].textContent,'total: 5');
const report={getFlag(s,k){return k==='hpReport'?{reverted:true}:null;}};
const root3=new N('div');renderHpReport(report,root3);
assert.equal(root3.classList.contains('fnri-hp-reverted'),true);
assert.equal(root3.children[0].children[0].tag,'small');
console.log('PASS stage 5 chat UI: damage parts, bottom apply/critical placement, manual natural20 override, crossed-out undo');
