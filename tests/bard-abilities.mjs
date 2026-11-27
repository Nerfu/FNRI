import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {CLASSES,rhythmBonus,prepareRhythmArmor} from '../module/data/classes.mjs';
import {applicableRollContributions,preparedDamageDefinitions,selectedRollParts} from '../module/rolls/roll-context.mjs';
import {ruleComponents} from '../module/rolls/roll-contributions.mjs';
import {accountingRule} from '../module/data/ability-accounting.mjs';
import {damageFormulaForDegree} from '../module/weapon/weapon-attack.mjs';
import {selectAreaDamageParts} from '../module/damage/area-damage-profile.mjs';
const ID='fast-nri-v14',dir=new URL('../packs/_source/abilities/',import.meta.url);
const cards=readdirSync(dir).filter(f=>f.startsWith('bard-')).map(f=>JSON.parse(readFileSync(new URL(f,dir),'utf8')));
assert.equal(cards.length,12);assert.deepEqual(new Set(cards.map(c=>c.flags[ID].contentId)),new Set(CLASSES.bard.abilityIds));
const get=n=>cards.find(c=>c.name===n);
globalThis.game={i18n:{localize:k=>k},user:{isGM:true}};
const rhythm=get('Ритм');rhythm.uuid='Actor.bard.Item.rhythm';
const actor={type:'character',uuid:'Actor.bard',system:{className:'Бард',ac:{partial:9,success:15,great:19},resources:{class_rhythm:{kind:'class',name:'Ритм',current:2,max:3}}},items:{contents:[rhythm]},effects:{contents:[]}};
assert.equal(rhythmBonus(actor),2);prepareRhythmArmor({...actor.system,ac:actor.system.ac,parent:actor});assert.deepEqual(actor.system.ac,{partial:11,success:17,great:21});
assert.equal(applicableRollContributions(actor,{kind:'attack'}).find(e=>e.name==='Ритм').parts[0].value,'2');assert.equal(applicableRollContributions(actor,{kind:'damage'}).some(e=>e.name==='Ритм'),false);
actor.system.resources.class_rhythm.current=-1;assert.equal(rhythmBonus(actor),0);actor.system.resources.class_rhythm.current=3;
const forward=get('Вперёд!').effects[0].flags[ID].rollContributions;
assert.equal(ruleComponents(forward,{kind:'attack'})[0].value,'1d4');assert.equal(ruleComponents(forward,{kind:'damage',attackDamage:true})[0].value,'1d4');assert.equal(ruleComponents(forward,{kind:'damage'}).length,0);assert.equal(ruleComponents(forward,{kind:'heal'}).length,0);
const slow=get('Убавь темп!');assert.deepEqual(accountingRule(slow).resourceCosts.map(c=>c.amount),[1,1]);assert.deepEqual(slow.effects.map(e=>e.flags[ID].conditionId),['slowed','stunned']);
for(const [n,bonus] of [['Получай!','4d6'],['Разойдись!','2d8'],['Всем хватит!','1d6'],['В яблочко!','3d6'],['Каждому своё!','1d6'],['Мой выход!','3d8']]){
 const card=get(n);card.uuid='Actor.bard.Item.'+card._id;
 const m=card.system.mechanics;assert.equal(m.attack.damageType,'магический');assert.equal(m.culmination,true);assert.equal(accountingRule(card).resourceCosts[0].amount,3);
 assert.equal(ruleComponents(m.rollContributions,{kind:'damage'})[0].value,bonus);
 if(m.executions.length===2){assert.equal(accountingRule(card,m.executions[1]),null);assert.equal(accountingRule(card,m.executions[0]).resourceCosts[0].amount,3);}
}
const area=get('Разойдись!'),m=area.system.mechanics;
const base=damageFormulaForDegree(m.attack.damageProfile,'great').parts;
const entry=applicableRollContributions(actor,{kind:'damage',attackDamage:true,sourceItem:area}).find(e=>e.name===area.name);
const defs=preparedDamageDefinitions(base,{selected:[entry],manual:[],expression:'1d10 + 1d4 + 4 + (2d8)'});assert.equal(defs.length,5);assert.equal(defs.filter(d=>d.faces===8).length,2);assert.equal(defs.find(d=>d.kind==='fixed').value,4);
const parts=defs.map((p,i)=>({...p,value:[8,2,4,5,7][i],damageType:'магический'}));
for(const [d,count] of [['great',5],['success',4],['partial',4],['failure',0]])assert.equal(selectAreaDamageParts(parts,d,m.attack.areaDamageProfile).includedPartIds.length,count);
assert.equal(selectAreaDamageParts(parts,'success',m.attack.areaDamageProfile).excludedPartIds[0],parts[1].id);assert.equal(selectAreaDamageParts(parts,'partial',m.attack.areaDamageProfile).excludedPartIds[0],parts[0].id);
console.log('PASS Bard: 12 cards, rhythm armor/attack, scoped inspiration, costs, culmination damage and five-component area');
