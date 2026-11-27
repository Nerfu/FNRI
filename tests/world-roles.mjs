import assert from 'node:assert/strict';
import {roleDefinition,roleOptions,roleLabel,prepareRoleDefenses,roleRacialChoices,worldRoleReference,isWorldRoleCard,registerWorldRoles} from '../module/data/roles.mjs';
const card={id:'a000000000000001',name:'External role A',type:'item',system:{mechanics:{roleDefinition:{version:1,defenses:{awareness:2,reflex:-1,will:2},startingWealth:99,racialChoices:99}}}};
const other={...structuredClone(card),id:'a000000000000002',name:'External role B'};other.system.mechanics.roleDefinition.defenses={fortitude:2};
const items=[card,other,{...card,id:'a000000000000003',parent:{}}];
globalThis.game={items:{contents:items,get:id=>items.find(x=>x.id===id)},actors:{contents:[]}};
assert.equal(roleOptions().length,3);assert.ok(!isWorldRoleCard(items[2]));
const base={awareness:10,reflex:10,fortitude:10,will:10};
const ref=worldRoleReference(card.id);const s={role:ref,defenses:{...base}};
assert.equal(roleLabel(s),card.name);assert.equal(roleRacialChoices({type:'character',system:s}),0);assert.equal(roleDefinition(s)[1].startingWealth,undefined);
for(let i=0;i<4;i++){s.defenses={...base};prepareRoleDefenses(s);assert.deepEqual(s.defenses,{awareness:12,reflex:9,fortitude:10,will:12});}
s.role=worldRoleReference(other.id);s.defenses={...base};prepareRoleDefenses(s);assert.deepEqual(s.defenses,{...base,fortitude:12});
s.role='';s.defenses={...base};prepareRoleDefenses(s);assert.deepEqual(s.defenses,base);
card.name=other.name;assert.equal(new Set(roleOptions().map(r=>r.label)).size,3);s.role=ref;assert.equal(roleLabel(s),card.name);
let resets=0,preps=0;const actor={type:'character',system:s,reset(){resets++;s.defenses={...base};},prepareData(){preps++;prepareRoleDefenses(s);}};game.actors.contents=[actor];const hooks={};globalThis.Hooks={once:(k,f)=>hooks[k]=f,on:(k,f)=>hooks[k]=f};registerWorldRoles();hooks.ready();assert.equal(resets,1);assert.equal(preps,1);card.system.mechanics.roleDefinition.defenses.awareness=3;hooks.updateItem(card);assert.equal(s.defenses.awareness,13);hooks.updateItem(other);assert.equal(resets,2);items.splice(0,1);hooks.deleteItem(card);assert.deepEqual(s.defenses,base);assert.equal(roleDefinition(s),null);
console.log('PASS external role catalog, stable ID, numeric modifiers, rename, no accumulation, role switch, update and deletion');
