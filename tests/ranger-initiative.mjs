import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CLASSES} from '../module/data/classes.mjs';
import {potionResource} from '../module/data/potion-resource.mjs';
globalThis.foundry={documents:{Combatant:class{_getInitiativeFormula(){return '1d20';}}}};
const {FastNRICombatant,initiativeContribution}=await import('../module/combat/initiative.mjs');
const scout=JSON.parse(readFileSync(new URL('../packs/_source/abilities/ranger-scout--fnriranger000002.json',import.meta.url),'utf8'));
const combat={combatants:[]};
function add(id,className,side,items=[],hidden=false){
  const actor={uuid:'Actor.'+id,type:'character',system:{className,potionsBaseMax:3,potionsUsed:2},prototypeToken:{disposition:side},items:{contents:items}};
  const c=new FastNRICombatant();Object.assign(c,{actor,token:{actor,disposition:side,hidden},parent:combat});combat.combatants.push(c);return c;
}
const r=add('r','Егерь',1,[scout]),r2=add('r2','Егерь',1,[scout]),a=add('a','Воин',1),e=add('e','Воин',-1),n=add('n','Воин',0);
assert.equal(r._getInitiativeFormula(),'(1d20) + 2');assert.equal(initiativeContribution(r2),2);assert.equal(initiativeContribution(a),1);assert.equal(initiativeContribution(e),0);assert.equal(initiativeContribution(n),0);
r.hidden=true;r2.token.hidden=true;assert.equal(initiativeContribution(a),0);
assert.equal(potionResource(r.actor).max,4);assert.equal(potionResource(r.actor).used,2);
assert.equal(CLASSES.ranger.abilityIds.length,7);
console.log('PASS Ranger initiative: own, allies, multiple scouts, hidden and neutral; potion limit');
