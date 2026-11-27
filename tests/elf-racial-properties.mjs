import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {attackExpressionForWeapon,sendWeaponAttack,sendWeaponDamage,sendAttackSnapshot} from '../module/weapon/weapon-attack.mjs';
import {attackAugmentEntries,selectedAttackAugments,readAttackAugmentDamageParts} from '../module/rolls/attack-augmentations.mjs';
import {selectRollParts} from '../module/rolls/roll-context.mjs';
import {resolveAreaResults,areaPostDefenseChoices} from '../module/damage/area-attack.mjs';
import {directedPostDefenseChoices,publishPostDefenseDamage} from '../module/damage/post-defense-damage.mjs';
import {calculateDamage,damageDisplay} from '../module/damage/damage-core.mjs';
import {racialState,racialAddWarnings} from '../module/data/racial-properties.mjs';
import {abilityAccountingStatus,restActor} from '../module/data/ability-accounting.mjs';
import {acceptPreroll} from './foundry-test-helpers.js';
const S='fast-nri-v14';
const cards=pack=>readdirSync(new URL(`../packs/_source/${pack}/`,import.meta.url)).map(file=>JSON.parse(readFileSync(new URL(`../packs/_source/${pack}/${file}`,import.meta.url),'utf8')));
const all=cards('abilities'),weapons=cards('weapons');
const actor={id:'elf',uuid:'Actor.elf',documentName:'Actor',type:'character',name:'Elf',isOwner:true,hasPlayerOwner:true,
 system:{race:'Эльф',className:'Воин',combatDie:'d8',resources:{},hp:{current:12,max:12,temp:0}},items:{contents:[]},effects:{contents:[]},flags:{[S]:{}},
 getFlag(s,k){return this.flags[s]?.[k]},getRollData(){return {}},async update(changes){for(const [path,v] of Object.entries(changes)){let t=this;const keys=path.split('.');for(const k of keys.slice(0,-1))t=t[k]??={};t[keys.at(-1)]=v;}}};
const mk=d=>({...structuredClone(d),id:d._id,uuid:`${actor.uuid}.Item.${d._id}`,documentName:'Item',parent:actor,getFlag(s,k){return this.flags?.[s]?.[k]}});
const property=name=>mk(all.find(c=>c.name===name));
const bowSchool=property('Эльфийская школа лука'),spark=property('Магия эльфов');
const short=mk(weapons.find(c=>c.name==='Короткий лук')),long=mk(weapons.find(c=>c.name==='Длинный лук'));
assert.equal(attackExpressionForWeapon(short,actor).expression,'1d20');
actor.items.contents=[bowSchool,spark];
assert.equal(racialState(actor).used,2);assert.equal(racialState(actor).max,2);
assert.equal(attackExpressionForWeapon(short,actor).expression,'1d20 + 1d8');assert.equal(attackExpressionForWeapon(long,actor).expression,'1d20 + 1d8');
short.system.proficiencyMode='no';assert.equal(attackExpressionForWeapon(short,actor).expression,'1d20');short.system.proficiencyMode='auto';
short.system.rollFormula='1d20+7';assert.equal(attackExpressionForWeapon(short,actor).expression,'1d20+7');short.system.rollFormula='';
const other={...short,flags:{[S]:{contentId:'other'}}};assert.equal(attackExpressionForWeapon(other,actor).expression,'1d20');
const t=(id,name)=>({name,document:{uuid:`Scene.s.Token.${id}`},actor:{system:{ac:{partial:5,success:10,great:15}}}});
const a=t('a','Alpha'),b=t('b','Beta');
const notifications=[];let messages=0;const history=[];
globalThis.game={user:{id:'p',isGM:false,targets:new Set([a])},settings:{get:()=> 'public'},messages:{contents:history,get:id=>history.find(m=>m.id===id)},i18n:{localize:k=>k,lang:'ru'}};
globalThis.ui={notifications:{warn:v=>notifications.push(v)}};
globalThis.foundry={utils:{randomID:()=>`random${messages}`,fromUuidSync:uuid=>[a,b].find(t=>t.document.uuid===uuid)?.document},applications:{api:{DialogV2:{wait:acceptPreroll}}}};
globalThis.fromUuid=async uuid=>uuid===actor.uuid?actor:[short,long,spark].find(i=>i.uuid===uuid)??null;
const message=data=>{const result={...data,id:data._id??`msg${++messages}`,isAuthor:true,getFlag(s,k){return this.flags?.[s]?.[k]}};history.push(result);return result;};
globalThis.ChatMessage={getSpeaker:()=>({actor:actor.id}),applyMode:()=>({whisper:[],blind:false}),create:async data=>message(data)};
globalThis.Roll=class {static validate(){return true} constructor(formula){this.formula=formula;this.dice=[...formula.matchAll(/(\d+)d(\d+)/g)].map(([,n,f])=>({faces:+f,number:+n,results:Array.from({length:+n},()=>({result:+f===20?12:3,active:true}))}));this.total=20;}async evaluate(){return this}toJSON(){return {formula:this.formula,dice:this.dice,total:this.total}}async toMessage(data,opts){const result={...data,formula:this.formula,rolls:[this.toJSON()]};return opts?.create===false?result:message(result);}};
const flags=(m,k)=>m.getFlag(S,k);
let entries=attackAugmentEntries(actor,{declaredTargets:[a,b]});assert.equal(entries.length,1);assert.equal(entries[0].parts.length,2);assert.ok(entries[0].parts.every(p=>!p.defaultEnabled));
const both=selectRollParts(entries,{[entries[0].uuid]:entries[0].parts.map(p=>p.id)});assert.equal(selectedAttackAugments({selected:both}).length,1);assert.equal(selectedAttackAugments({selected:both})[0].targetUuid,a.document.uuid);
const chooseSpark=async cfg=>acceptPreroll({...cfg,content:cfg.content.replace(/<label\b[^>]*>[\s\S]*?<\/label>/g,row=>row.includes('Искра магии')&&row.includes('Alpha')?row.replace(/<input\b/,'<input checked'):row)});
let attack=await sendWeaponAttack(short,actor,{skipPreroll:true});assert.equal(flags(attack,'weaponAttack').damageAdditions,undefined);
foundry.applications.api.DialogV2.wait=chooseSpark;
attack=await sendWeaponAttack(short,actor);let data=flags(attack,'weaponAttack');assert.equal(data.damageAdditions.length,0);assert.equal(data.postDefenseDamage[0].parts.length,2);assert.equal(data.attackAugments[0].name,'Искра магии');assert.equal(data.postDefenseDamage[0].targetUuid,a.document.uuid);assert.equal(abilityAccountingStatus(actor,spark).remaining,0);
let damage=await sendWeaponDamage(attack,'success',{skipPreroll:true});assert.equal(flags(damage,'weaponDamage').parts.length,2);
const damaged=flags(damage,'weaponDamage');
const defense=message({flags:{[S]:{weaponDamage:{...damaged,previousMessageId:damage.id,isIntervention:true,parts:damaged.parts.map((p,i)=>({...p,excluded:i===0})),effectDegree:'partial'}}}});
assert.equal(directedPostDefenseChoices(damage).length,0,'only current defense result');
assert.equal(directedPostDefenseChoices(defense).length,1);
const cancel=message({flags:{[S]:{weaponDamage:{...damaged,previousMessageId:defense.id,cancelled:true}}}});
assert.equal(directedPostDefenseChoices(cancel).length,0);assert.equal(directedPostDefenseChoices(defense).length,0);history.pop();
const choice=directedPostDefenseChoices(defense)[0];const extra=await publishPostDefenseDamage(choice,()=>directedPostDefenseChoices(defense));
const extraCard=flags(extra,'weaponDamage');assert.deepEqual(extraCard.parts.map(p=>[p.formula,p.damageType]),[['1d6','магический'],['1d6','магический']]);
assert.equal(extraCard.postDefenseOrigin.rootMessageId,attack.id);assert.equal(extraCard.postDefenseOrigin.parentMessageId,defense.id);assert.equal(extraCard.originalTargetUuid,a.document.uuid);
assert.equal(extraCard.isIntervention,true);assert.equal(extraCard.noCritical,true);assert.equal(calculateDamage({...extraCard,naturalD20:20,manualCritical:true},{critical:true}).total,6);
assert.equal(damageDisplay({...extraCard,manualCritical:true}).active,false);assert.equal(directedPostDefenseChoices(defense).length,0);
assert.equal(await publishPostDefenseDamage(choice,()=>directedPostDefenseChoices(defense)),null);assert.equal(abilityAccountingStatus(actor,spark).used,1);
entries=attackAugmentEntries(actor,{declaredTargets:[a]});assert.match(entries[0].parts[0].warning,/exhausted/);assert.ok(!entries[0].parts[0].defaultEnabled);
await restActor(actor);assert.equal(abilityAccountingStatus(actor,spark).remaining,1);
const area=await sendAttackSnapshot({actor,name:'Area',profile:{failure:'0',partial:'1d6',success:'2d6',great:'3d6'},profileKind:'magic',damageType:'магический',properties:'Область действия',expression:'1d20 + 1d8',targetTokens:[a,b]});
const areaCard=flags(area,'weaponDamage');assert.equal(areaCard.parts.length,3);assert.equal(areaCard.parts.filter(p=>p.singleTarget).length,0);assert.equal(abilityAccountingStatus(actor,spark).remaining,0);const results=resolveAreaResults(area);assert.deepEqual(results.map(r=>[r.name,r.damage]),[['Alpha',9],['Beta',9]]);
areaCard.parts.forEach((p,i)=>{p.value=2+i;});
const partial=resolveAreaResults(area,[{targetKey:a.document.uuid,success:true,kindKey:'card',degreeReduction:2}]);assert.equal(partial[0].profileComplete,true);assert.equal(partial[1].damage,9);
const avoided=message({flags:{[S]:{areaIntervention:{version:1,rootMessageId:area.id,targetKey:a.document.uuid,success:true,naturalD20:20}}}});assert.equal(areaPostDefenseChoices(area).length,0);history.pop();
const reduced=message({flags:{[S]:{areaIntervention:{version:1,rootMessageId:area.id,targetKey:a.document.uuid,success:true,kindKey:'card',degreeReduction:2}}}});
const areaChoice=areaPostDefenseChoices(area)[0];assert.ok(areaChoice);const areaExtra=await publishPostDefenseDamage(areaChoice,()=>areaPostDefenseChoices(area));assert.equal(flags(areaExtra,'weaponDamage').parts.length,2);assert.equal(flags(areaExtra,'weaponDamage').originalTargetUuid,a.document.uuid);assert.equal(areaPostDefenseChoices(area).length,0);
assert.equal(abilityAccountingStatus(actor,spark).used,1);
console.log('PASS elf cards: bow proficiency, opt-in Spark target, frequency, typed dice, separate post-defense roll, no critical, area isolation, cancellation and deduplication');

// New Ferocity uses the same separate hit pipeline, with its own critical dice.
const orc=property('Суровость');actor.items.contents=[orc];
const sword=mk(weapons.find(c=>c.system.attackKind==='melee'));sword.system.proficiencyMode='yes';sword.system.properties='Огонь';
game.user.targets=new Set([a]);
foundry.applications.api.DialogV2.wait=async cfg=>acceptPreroll({...cfg,content:cfg.content.replace(/<label\b[^>]*>[\s\S]*?<\/label>/g,row=>row.includes('Суровость')?row.replace(/<input\b/,'<input checked'):row)});
for(const critical of [false,true]){
 const attack=await sendAttackSnapshot({actor,name:'Melee',expression:'1d20 + 1d8',usesCombatDie:true,attackKind:'melee',profile:{A:'1d6',B:'1d6',C:3},properties:'Огонь',damageType:'физический',targetTokens:[a]});const original=flags(attack,'weaponAttack');
 assert.equal(attack.formula,'1d20 + 1d12');assert.equal(original.postDefenseDamage[0].parts[0].faces,8);
 const damage=await sendWeaponDamage(attack,'success',{skipPreroll:true});const card=flags(damage,'weaponDamage');
 const defense=message({flags:{[S]:{weaponDamage:{...card,previousMessageId:damage.id,effectDegree:'partial'}}}});
 message({flags:{[S]:{hpReport:{kind:'damage',sourceMessageId:defense.id,tokenUuid:a.document.uuid,critical,reverted:false}}}});
 const choices=directedPostDefenseChoices(defense);assert.equal(choices.length,1);
 const hit=await publishPostDefenseDamage(choices[0],()=>directedPostDefenseChoices(defense));
 const result=flags(hit,'weaponDamage');assert.equal(result.parts.length,critical?2:1);
 assert.ok(result.parts.every(p=>p.faces===8&&p.traits.includes('Огонь')&&p.damageType===card.damageType));
 assert.equal(result.noCritical,true);assert.equal(calculateDamage(result,{critical:true}).total,critical?6:3);
 assert.equal(directedPostDefenseChoices(defense).length,0);
}
const ranged=await sendWeaponAttack(short,actor);assert.equal(flags(ranged,'weaponAttack').ferocity,undefined);
const {damageAtReducedDegree,largestDamageDieHealing}=await import('../module/damage/damage-core.mjs');
assert.equal(damageAtReducedDegree({degree:'success',ferocity:true,postDefenseDamage:[{ferocity:true}],parts:[],profile:{A:'1d6',B:'1d6',C:3}},'partial').degree,'failure');
assert.equal(largestDamageDieHealing({healLargestDamageDie:true,parts:[{kind:'die',value:1},{kind:'fixed',value:3},{kind:'die',value:6,excluded:true}]}),3);
console.log('PASS updated Ferocity: 1d8 or 2d8 as separate hit, inherited properties, no multiplier, melee only; Hunger counts fixed damage bonuses');

// Cleric uses the same optional preroll and separate result path; a fixed
// component is a damage die in rules, not a synthetic native dice result.
const nature=property('Природа клерика'),sear=property('Опаление');
nature.system.mechanics.classNature.selection='holy';actor.items.contents=[nature,sear];
const targetNature=property('Природа Нефалема');targetNature.system.mechanics.racialProperty.selection='unholy';
a.actor.isOwner=true;a.actor.items={contents:[targetNature]};
foundry.applications.api.DialogV2.wait=async cfg=>acceptPreroll({...cfg,content:cfg.content.replace(/<label\b[^>]*>[\s\S]*?<\/label>/g,row=>row.includes('Опаление')?row.replace(/<input\b/,'<input checked'):row)});
for(const targetIsOpposite of [false,true]){
 targetNature.system.mechanics.racialProperty.selection=targetIsOpposite?'unholy':'holy';
 const strike=await sendAttackSnapshot({actor,name:'Melee',expression:'1d20 + 1d8',usesCombatDie:true,attackKind:'melee',profile:{A:'1d6',B:'1d6',C:3},properties:'',damageType:'физический',targetTokens:[a]});
 const offer=flags(strike,'weaponAttack').postDefenseDamage[0];assert.deepEqual(offer.parts.map(p=>p.formula),targetIsOpposite?['2','1d8']:['2']);
 const dmg=await sendWeaponDamage(strike,'success',{skipPreroll:true});const available=directedPostDefenseChoices(dmg);assert.equal(available.length,1);
 const extra=await publishPostDefenseDamage(available[0],()=>directedPostDefenseChoices(dmg));const result=flags(extra,'weaponDamage');
 assert.equal(result.parts[0].kind,'fixed');assert.equal(result.parts[0].value,2);assert.ok(result.parts.every(p=>p.traits.includes('Святой')));assert.equal(result.noCritical,true);assert.equal(calculateDamage(result,{critical:true}).total,targetIsOpposite?5:2);
}
console.log('PASS Cleric Sear: selected preroll, fixed 2, optional opposite nature d8, separate post-defense hit, no critical');
