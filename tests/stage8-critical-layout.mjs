import assert from 'node:assert/strict';
import {damageDisplay,calculateDamage} from '../module/damage/damage-core.mjs';
import {renderDamageCard} from '../module/damage/damage-chat.mjs';
import {setMessageCritical} from '../module/damage/roll-editor.mjs';
const ID='fast-nri-v14';
const parts=[{id:'A',kind:'die',faces:12,formula:'1d12',value:10,original:10,excluded:false},
  {id:'C',kind:'fixed',formula:'+12',value:12,original:12,excluded:false}];
const source={version:2,parts,naturalD20:12,naturalCritMultiplier:3,criticalThreshold:20,
  adjustments:{penalty:0,resistance:0,vulnerability:0},manualCritical:null,history:[],revision:0};
assert.equal(damageDisplay(source).active,false);
assert.equal(damageDisplay(source).expression,'22');
const crit={...source,naturalD20:20};
assert.equal(damageDisplay(crit).active,true);
assert.equal(damageDisplay(crit).expression,'22 × 3 = 66');
assert.equal(damageDisplay({...source,naturalD20:19,criticalThreshold:19}).active,true);
assert.equal(damageDisplay({...crit,manualCritical:false}).expression,'22');
const defended={...crit,adjustments:{penalty:0,resistance:5,vulnerability:2}};
assert.equal(damageDisplay(defended).expression,'22 × 3 − 5 + 2 = 63');
assert.equal(calculateDamage(defended,{critical:true}).total,63);
const floored={...crit,adjustments:{penalty:0,resistance:80,vulnerability:2}};
assert.equal(damageDisplay(floored).expression,'max(0, 22 × 3 − 80) + 2 = 2');
assert.equal(damageDisplay({...crit,cancelled:true}).expression,'0');
class N {constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.textContent='';
  this.classes=new Set();this.className='';this.classList={add:x=>this.classes.add(x),contains:x=>this.classes.has(x)};}
  append(...args){this.children.push(...args);}querySelector(s){return s==='.message-content'?this:null;}
  addEventListener(name,fn){this.events??={};this.events[name]=fn;}}
globalThis.document={createElement:tag=>new N(tag)};
const messages=new Map();let messageCounter=0;
globalThis.game={user:{id:'gm',isGM:true},messages:{get:id=>messages.get(id),get contents(){return [...messages.values()]}},i18n:{localize:key=>key.split('.').at(-1)}};
function msgFor(card){const msg={id:`source${++messageCounter}`,flags:{[ID]:{weaponDamage:structuredClone(card)}},isAuthor:true,
  getFlag(system,key){return this.flags[system]?.[key];},canUserModify(){return true;},
  async update(obj){for(const [key,val] of Object.entries(obj))this.flags[ID][key.split('.').at(-1)]=val;}};messages.set(msg.id,msg);return msg;}
function layout(message){const root=new N('div');renderDamageCard(message,root);return root.children[0];}
const ordinary=layout(msgFor(source));
assert.equal(ordinary.children[2].children[0].textContent,'total: 22');
assert.equal(ordinary.children[3].textContent,'intervention','intervention stays on its own row');
assert.equal(ordinary.children.at(-1).children.length,2,'manual critical action remains on ordinary damage');
assert.deepEqual(ordinary.children.at(-1).children.map(x=>x.textContent),['apply','critical']);
assert.equal(ordinary.children.at(-1).children[1].classes.has('fnri-secondary-damage-button'),true);
assert.equal(ordinary.children.at(-1).children[0].classes.has('fnri-apply-button'),true);
assert.equal(ordinary.children.at(-1).children[0].events.click instanceof Function,true);
assert.equal(ordinary.children.at(-1).children[1].events.click instanceof Function,true);

const critical=layout(msgFor(crit));
assert.equal(critical.children[2].children.length,1,'only one total at critical');
assert.equal(critical.children[2].children[0].textContent,'total: 22 × 3 = 66');
assert.equal(critical.children[3].textContent,'intervention','intervention stays above');
assert.deepEqual(critical.children.at(-1).children.map(x=>x.textContent),['applyCritical','applyNormal']);
assert.ok(critical.children.at(-1).children[0].classes.has('fnri-crit-active'));
assert.ok(critical.children.at(-1).children[1].classes.has('fnri-secondary-damage-button'));
assert.equal(ordinary.children[3].textContent,'intervention','ordinary intervention stays above buttons');
const manual=msgFor(source);
assert.equal(await setMessageCritical(manual,'true',4),true);
assert.equal(manual.getFlag(ID,'weaponDamage').history.at(-1).action,'critical');
assert.equal(manual.getFlag(ID,'weaponDamage').revision,1);
assert.equal(damageDisplay(manual.getFlag(ID,'weaponDamage')).expression,'22 × 4 = 88');
assert.equal(calculateDamage(manual.getFlag(ID,'weaponDamage'),{critical:true}).total,88,
  'applying critical uses manual multiplier instead of the item default');
assert.deepEqual(layout(manual).children.at(-1).children.map(x=>x.textContent),['applyCritical','applyNormal']);
assert.equal(await setMessageCritical(manual,'false'),true);
assert.equal(damageDisplay(manual.getFlag(ID,'weaponDamage')).active,false);
assert.equal(await setMessageCritical(manual,'auto'),true);
assert.equal(damageDisplay(manual.getFlag(ID,'weaponDamage')).active,false);
const message20=msgFor(crit);
await setMessageCritical(message20,'false');
assert.equal(damageDisplay(message20.getFlag(ID,'weaponDamage')).active,false,'GM can disable nat20 crit');
await setMessageCritical(message20,'auto');
assert.equal(damageDisplay(message20.getFlag(ID,'weaponDamage')).active,true,'auto restores natural crit');
// Run actual button handlers, not only rendering assertions. Manual Crit must
// apply the source multiplier even when the hit was not a natural critical.
const hpActor={uuid:'Actor.defender',name:'Defender',
  system:{hp:{current:500,temp:0,max:500}},
  async update(values) {
    for(const [key,value] of Object.entries(values)) {
      if(key==='system.hp.current')this.system.hp.current=value;
      if(key==='system.hp.temp')this.system.hp.temp=value;
    }
  }};
const token={name:'Defender',actor:hpActor,document:{uuid:'Scene.test.Token.defender',actor:hpActor}};
globalThis.canvas={tokens:{controlled:[token]}};
const hpReports=[];
globalThis.ChatMessage={getSpeaker:()=>({}),create:async data=>{hpReports.push(data);return data;}};
await ordinary.children.at(-1).children[0].events.click();
assert.equal(hpActor.system.hp.current,478,'normal button on normal hit causes 22 HP loss');
assert.equal(hpReports.at(-1).flags[ID].hpReport.critical,false);
await ordinary.children.at(-1).children[1].events.click();
assert.equal(hpActor.system.hp.current,412,'manual Crit on normal hit applies 66 additional HP loss');
assert.equal(hpReports.at(-1).flags[ID].hpReport.critical,true);
assert.equal(hpReports.at(-1).flags[ID].hpReport.multiplier,3);
assert.equal(ordinary.children[2].children[0].textContent,'total: 22',
  'pressing manual Crit never toggles the displayed normal card');
await critical.children.at(-1).children[0].events.click();
assert.equal(hpActor.system.hp.current,346,'confirmed Crit primary applies 66');
await critical.children.at(-1).children[1].events.click();
assert.equal(hpActor.system.hp.current,324,'confirmed Crit fallback applies ordinary 22');
assert.equal(hpReports.length,4,'each application generates a separate HP report');
assert.equal(hpReports.map(x=>x.flags[ID].hpReport.critical).join(','),
  'false,true,true,false');
game.user.isGM=false;
await assert.rejects(()=>setMessageCritical(message20,'true',3));
console.log('PASS stage 8: always two damage actions, critical/normal primary order, x3 display, GM override and audit');

game.user.isGM=true;
const post=msgFor({...crit,isIntervention:true,noCritical:true,postDefenseOrigin:{rootMessageId:'attack',parentMessageId:'defense'}});
const postLayout=layout(post);assert.equal(postLayout.children[2].children[0].textContent,'total: 22');
assert.ok(!postLayout.children.some(c=>c.textContent==='intervention'));assert.deepEqual(postLayout.children.at(-1).children.map(c=>c.textContent),['apply']);
assert.equal(await setMessageCritical(post,'true',3),false);assert.equal(calculateDamage(post.getFlag(ID,'weaponDamage'),{critical:true}).total,22);
console.log('PASS post-defense card exposes normal damage only');
