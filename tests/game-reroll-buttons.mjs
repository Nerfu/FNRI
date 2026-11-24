import assert from 'node:assert/strict';
import {rerollParts,rerollOptions,executeGameReroll} from '../module/rolls/game-reroll.mjs';
import {renderButtonChoices,chooseByButtons} from '../module/rolls/button-choice.mjs';
import {resolveAreaResults} from '../module/damage/area-attack.mjs';
const ID='fast-nri-v14';
const item={id:'t',uuid:'Actor.a.Item.t',name:'Talisman',system:{quantity:1,mechanics:{talisman:{rerollAnyDieExceptD20:true},accounting:{frequency:{uses:1}}}}};
const actor={id:'a',uuid:'Actor.a',isOwner:true,hasPlayerOwner:true,items:{contents:[item]},system:{},flags:{},getFlag(s,k){return this.flags[s]?.[k];},async update(patch){for(const [key,value] of Object.entries(patch)){const path=key.split('.');let doc=this;for(const k of path.slice(0,-1))doc=doc[k]??={};doc[path.at(-1)]=structuredClone(value);}}};
const token={actor};
const parts=[{id:'base',kind:'die',faces:6,value:3},{id:'added',kind:'die',faces:8,value:4,added:true},{id:'pending',kind:'die',faces:8,value:null,added:true,pending:true},{id:'fixed',kind:'fixed',value:2,added:true},{id:'d20',kind:'die',faces:20,value:5}];
const msg={id:'m',flags:{[ID]:{weaponDamage:{version:2,sourceActorUuid:actor.uuid,parts}}},rolls:[],getFlag(s,k){return this.flags[s]?.[k];}};
globalThis.game={user:{id:'p',isGM:false},messages:new Map([['m',msg]]),i18n:{localize:k=>k},time:{worldTime:1}};
globalThis.canvas={tokens:{controlled:[token]}};
const warnings=[];globalThis.ui={notifications:{info(){},warn(v){warnings.push(v);}}};
assert.deepEqual(rerollParts(msg,actor).map(r=>r.part.id),['base','added','d20']);
assert.deepEqual(rerollOptions(msg,actor)[0].parts.map(r=>r.part.id),['base','added']);
assert.equal(rerollParts(msg,{...actor,uuid:'Actor.other'}).length,0);
msg.isContentVisible=false;assert.equal(rerollParts(msg,actor).length,0);msg.isContentVisible=true;
const onlyD20={...msg,flags:{[ID]:{weaponDamage:{version:2,sourceActorUuid:actor.uuid,parts:[parts.at(-1)]}}}};
assert.deepEqual(rerollOptions(onlyD20,actor),[],'Talisman never offers d20 as a source');
// Player uses a GM-added evaluated die through the actual gameplay handler,
// not through the editor; original native Roll remains untouched.
const nativeDie={faces:6,results:[{result:3,active:true}]};
const native={id:'native',flags:{[ID]:{checkRoll:{actorUuid:actor.uuid},rollEdit:{version:1,originalTotal:3,currentTotal:7,offset:0,history:[],components:[{id:'die-1',kind:'die',faces:6,original:3,value:3,excluded:false},{id:'added-1',kind:'die',faces:8,original:0,initial:4,value:4,added:true,excluded:false}]}}},rolls:[{total:3,dice:[nativeDie],terms:[nativeDie]}],getFlag:msg.getFlag,canUserModify(){return true;},async update(patch){for(const [k,v] of Object.entries(patch))this.flags[ID][k.split('.').at(-1)]=structuredClone(v);}};
game.messages.set(native.id,native);
globalThis.Roll=class {constructor(formula){this.formula=formula;}async evaluate(){assert.equal(this.formula,'1d8');this.total=7;return this;}toJSON(){return {formula:this.formula,total:this.total};}};
let seq=0;globalThis.ChatMessage={getSpeaker:()=>({actor:actor.id}),async create(data){const result={id:`report${++seq}`,...data};game.messages.set(result.id,result);return result;}};
assert.equal(rerollOptions(native,actor)[0].exhausted,false);
let rerolled=await executeGameReroll(native,{itemId:item.id,view:'0',partId:'added-1'});
assert.equal(rerolled.value,7);assert.equal(rerolled.updated,true);assert.equal(native.flags[ID].rollEdit.currentTotal,10);assert.equal(native.rolls[0].total,3);assert.equal(rerollOptions(native,actor)[0].exhausted,true);
assert.equal(await executeGameReroll(native,{itemId:item.id,view:'0',partId:'added-1'}),null);
assert.equal(Object.keys(actor.flags[ID].accountingEvents).length,1);
globalThis.Roll=class {constructor(formula){assert.equal(formula,'1d6');}async evaluate(){this.total=3;return this;}toJSON(){return {total:this.total};}};
rerolled=await executeGameReroll(native,{itemId:item.id,view:'0',partId:'die-1'});
assert.equal(rerolled.value,3);assert.ok(warnings.length);assert.equal(Object.keys(actor.flags[ID].accountingEvents).length,2);
const input={value:''};const list={ownerDocument:{createElement(tag){return {tag,setAttribute(k,v){this[k]=v;}};}},replaceChildren(...buttons){this.buttons=buttons;}};
const element={querySelector(q){return q==='input[name="choice"]'?input:list;}};
const rows=[{value:'0',label:'First'},{value:'1',label:'Second ⚠'}];
renderButtonChoices(element,rows);assert.equal(input.value,'0');assert.equal(list.buttons[0]['aria-pressed'],'true');list.buttons[1].onclick();assert.equal(input.value,'1');assert.equal(list.buttons[0]['aria-pressed'],'false');assert.equal(list.buttons[1]['aria-pressed'],'true');
renderButtonChoices(element,rows,'1');assert.equal(input.value,'1');renderButtonChoices(element,[],'1');assert.equal(input.value,'');
globalThis.foundry={applications:{api:{DialogV2:{input:async cfg=>{assert.doesNotMatch(cfg.content,/<select/);cfg.render(null,{element});list.buttons[1].onclick();return {choice:input.value};}}}}};
assert.equal((await chooseByButtons({title:'Sources',rows,confirmLabel:'Choose'})).value,'1');
console.log('PASS reroll: editor-added evaluated dice, pending/fixed/d20 exclusion, source privacy, button selection');

// Weapon properties use the same menu without charging a Talisman.
const damageParts=[{id:'A',profilePart:'A',kind:'die',faces:6,value:1,original:1},{id:'B',profilePart:'B',kind:'die',faces:8,value:2,original:2},{id:'bonus',kind:'die',faces:6,value:1,original:1},{id:'fixed',kind:'fixed',value:3,original:3}];
const weapon={...msg,id:'weapon',flags:{[ID]:{weaponDamage:{version:2,sourceActorUuid:actor.uuid,gameRerollTraits:{sweeping:true},parts:damageParts,history:[],revision:0}}},canUserModify(){return true;},update:native.update};
game.messages.set(weapon.id,weapon);
const optionsFor=(m,rule)=>rerollOptions(m,actor).find(o=>o.rule===rule);
assert.deepEqual(optionsFor(weapon,'sweeping').parts.map(r=>r.part.id),['A','B']);
const events=Object.keys(actor.flags[ID].accountingEvents).length;
globalThis.Roll=class {constructor(formula){this.formula=formula;}async evaluate(){assert.equal(this.formula,'1d6');this.total=1;return this;}toJSON(){return {formula:this.formula,total:this.total};}};
assert.equal((await executeGameReroll(weapon,{itemId:'trait:sweeping',view:'damage',partId:'A'})).updated,true);
assert.deepEqual(optionsFor(weapon,'sweeping').parts.map(r=>r.part.id),['B'],'even a repeated 1 is the new result');
assert.equal(weapon.flags[ID].weaponDamage.parts[0].original,1);
assert.ok(!optionsFor(weapon,'talisman').parts.some(r=>r.part.id==='A'),'Sweeping consumes Talisman opportunity even when result is unchanged');
assert.equal(Object.keys(actor.flags[ID].accountingEvents).length,events);
weapon.flags[ID].weaponDamage.weaponLowRerollApplied=true;
assert.equal(optionsFor(weapon,'sweeping'),undefined,'legacy automatic reroll cannot double apply');
const magic={...weapon,id:'magic',flags:{[ID]:{weaponDamage:{version:2,sourceActorUuid:actor.uuid,profileKind:'magic',gameRerollTraits:{catalyst:true},parts:[{id:'M1',kind:'die',faces:6,value:1,original:1},{id:'M2',kind:'die',faces:6,value:2,original:2},{id:'extra',kind:'die',faces:6,value:1,original:1,damageType:'magical'},{id:'gm-added',profilePart:'M3',added:true,kind:'die',faces:6,value:1,original:1}],history:[],revision:0,areaAttack:{version:1,targets:[]}}}}};
game.messages.set(magic.id,magic);
assert.deepEqual(optionsFor(magic,'catalyst').parts.map(r=>r.part.id),['M1']);
assert.equal((await executeGameReroll(magic,{itemId:'trait:catalyst',view:'damage',partId:'M1'})).updated,true);
assert.equal(optionsFor(magic,'catalyst'),undefined);
assert.equal(Object.keys(actor.flags[ID].accountingEvents).length,events);
assert.equal(optionsFor({...magic,id:'copy',flags:{[ID]:{weaponDamage:{...magic.flags[ID].weaponDamage,previousMessageId:'magic'}}}},'catalyst'),undefined);
console.log('PASS weapon rerolls: base weapon and spell profile dice, one per rule/die, area root, no Talisman expense, legacy exclusion');

// The same replacement semantics apply to the manual Catalyst path.
const shared={...magic,id:'magic-shared',flags:{[ID]:{weaponDamage:{version:2,sourceActorUuid:actor.uuid,profileKind:'magic',gameRerollTraits:{catalyst:true},parts:[1,3,5].map((value,i)=>({id:`M${i+1}`,kind:'die',faces:6,original:value,value})),history:[],revision:0,areaAttack:{version:1,targets:['partial','success','great'].map(initialDegree=>({key:initialDegree,name:initialDegree,initialDegree}))}}}}};
game.messages.set(shared.id,shared);
globalThis.Roll=class {constructor(formula){this.formula=formula;}async evaluate(){assert.equal(this.formula,'1d6');this.total=6;return this;}toJSON(){return {formula:this.formula,total:this.total};}};
assert.deepEqual(resolveAreaResults(shared).map(r=>r.damage),[3,8,9]);
assert.equal((await executeGameReroll(shared,{itemId:'trait:catalyst',view:'damage',partId:'M1'})).updated,true);
assert.deepEqual(resolveAreaResults(shared).map(r=>r.damage),[5,11,14]);
assert.deepEqual(shared.flags[ID].weaponDamage.parts.map(p=>[p.original,p.value]),[[1,6],[3,3],[5,5]]);
assert.equal(Object.keys(actor.flags[ID].accountingEvents).length,events);
console.log('PASS manual Catalyst: replaced value changes shared area selection');

// Mixed physical attack: only the spell's magical contribution is eligible.
const mixed={...weapon,id:'mixed-blade',flags:{[ID]:{weaponDamage:{version:2,sourceActorUuid:actor.uuid,profileKind:'physical',gameRerollTraits:{catalyst:true},parts:[{id:'A',kind:'die',faces:6,value:1,damageType:'физический'},{id:'blade',kind:'die',faces:8,value:1,spellDamage:true,damageType:'магический'},{id:'other',kind:'die',faces:8,value:1,damageType:'магический'},{id:'physical-spell',kind:'die',faces:6,value:1,spellDamage:true,damageType:'физический'}],history:[],revision:0}}}};
game.messages.set(mixed.id,mixed);
assert.deepEqual(optionsFor(mixed,'catalyst').parts.map(r=>r.part.id),['blade']);
globalThis.Roll=class {constructor(formula){this.formula=formula;}async evaluate(){assert.equal(this.formula,'1d8');this.total=7;return this;}toJSON(){return {formula:this.formula,total:this.total};}};
assert.equal((await executeGameReroll(mixed,{itemId:'trait:catalyst',view:'damage',partId:'blade'})).updated,true);
assert.deepEqual(mixed.flags[ID].weaponDamage.parts.map(p=>p.value),[1,7,1,1]);
console.log('PASS manual Blade Catalyst: magical spell contribution only');

// A report remains the same roll, even if the source is read-only.
const readOnly={...weapon,id:'read-only',flags:{[ID]:{weaponDamage:{version:2,sourceActorUuid:actor.uuid,gameRerollTraits:{sweeping:true},parts:[{id:'A',kind:'die',faces:6,value:1}],history:[]}}},canUserModify(){return false;}};
game.messages.set(readOnly.id,readOnly);
globalThis.Roll=class {constructor(formula){assert.equal(formula,'1d6');}async evaluate(){this.total=1;return this;}toJSON(){return {total:this.total};}};
const readOnlyResult=await executeGameReroll(readOnly,{itemId:item.id,view:'damage',partId:'A'});
assert.equal(readOnlyResult.updated,false);
assert.deepEqual(rerollOptions(readOnly,actor),[],'report prevents another source reroll');
assert.deepEqual(rerollOptions(readOnlyResult.report,actor),[],'report itself is not a fresh die');
const auto={...readOnly,id:'auto-history',flags:{[ID]:{weaponDamage:{...readOnly.flags[ID].weaponDamage,history:[{id:'A',gameReroll:true,automatic:true,rule:'sweeping'}]}}}};
assert.deepEqual(rerollOptions(auto,actor),[],'automatic reroll consumes all sources');
console.log('PASS one gameplay reroll per die across all sources, including read-only reports');

// Distinct items and distinct rolls must not reset the same die's eligibility.
const another={...item,id:'t2',uuid:'Actor.a.Item.t2',name:'Second Talisman'};
actor.items.contents.push(another);
const cross={...readOnly,id:'cross',canUserModify(){return true;},flags:{[ID]:{weaponDamage:{...readOnly.flags[ID].weaponDamage,parts:[{id:'A',kind:'die',faces:6,value:1},{id:'B',kind:'die',faces:6,value:2}],history:[]}}}};
game.messages.set(cross.id,cross);
assert.equal((await executeGameReroll(cross,{itemId:item.id,view:'damage',partId:'A'})).updated,true);
for(const option of rerollOptions(cross,actor))assert.deepEqual(option.parts.map(r=>r.part.id),['B']);
assert.equal(await executeGameReroll(cross,{itemId:another.id,view:'damage',partId:'A'}),null);
assert.equal(await executeGameReroll(cross,{itemId:'trait:sweeping',view:'damage',partId:'A'}),null);
// Two native Rolls use independent component IDs even when both contain die-1.
const multi={...native,id:'multi-once',flags:{[ID]:{checkRoll:{actorUuid:actor.uuid}}},rolls:[{total:3,dice:[nativeDie],terms:[nativeDie]},{total:3,dice:[nativeDie],terms:[nativeDie]}]};
game.messages.set(multi.id,multi);
assert.equal((await executeGameReroll(multi,{itemId:item.id,view:'0',partId:'die-1'})).updated,true);
assert.deepEqual(rerollParts(multi,actor).map(r=>[r.view,r.part.id]),[['1','die-1']]);
console.log('PASS two Talismans, Talisman before weapon property, and independent Roll indices');
