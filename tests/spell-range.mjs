import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {currentSpellRange,directedSpellRange} from '../module/spatial/spell-range.mjs';
import {spatialAttackContext,directedSpellSpatialContext} from '../module/spatial/spatial-context.mjs';
import {renderRollPreparation} from '../module/rolls/roll-context.mjs';
import {prepareClassBaseStats} from '../module/data/classes.mjs';
globalThis.game={i18n:{localize:k=>k},user:{isGM:true}};
const caster={type:'character',system:{className:'Колдун',hp:{current:10},equipment:{}}};
assert.equal(currentSpellRange(caster),8);assert.equal(currentSpellRange({system:{}}),3);
assert.equal(currentSpellRange({system:{className:'Друид'}}),4);
prepareClassBaseStats(caster.system);assert.equal(caster.system.spellRange,8);
caster.system.spellRange=10;assert.equal(currentSpellRange(caster),10);
assert.equal(directedSpellRange(caster,{spellRange:8}),8);assert.equal(directedSpellRange(caster,{}),null);
caster.system.spellRange=8;
const scene={id:'s'},grid={size:100,isSquare:true,measurePath:([a,b])=>({spaces:Math.abs(a.x-b.x)/100})};
const token=(x,actor=caster)=>({actor,document:{uuid:`Token.${x}`,parent:scene,x:x*100,y:0,width:1,height:1,disposition:1}});
const source=token(0), target=token(8,{type:'npc',system:{hp:{current:10},equipment:{}}});
const args={origin:{tokenUuid:source.document.uuid},targetTokens:[target],tokens:[source,target],scene,grid,attackKind:'ranged'};
const calc=(distance,options={})=>{target.document.x=distance*100;return spatialAttackContext({...args,...options});};
for(const distance of [8,9,13,16,17]){
  const s=calc(distance,{spellRange:8});assert.equal(s.distanceSpaces,distance);assert.equal(s.spellRange,8);
  assert.equal(!!s.spellRangeWarning,distance>8);assert.equal(s.entries.length,0);
  const html=renderRollPreparation([],{spatialInfo:s,formula:'1d20'});
  assert.ok(html.includes(`${distance} / 8 клеток`));assert.equal(html.includes('Цель вне дистанции заклинания'),distance>8);
}
const weapon={type:'weapon',system:{distance:'8',properties:''}};
for(const distance of [8,9,16,17]){const s=calc(distance,{weaponItem:weapon});assert.equal(s.entries.some(e=>e.parts.some(p=>p.value==='-6')),distance>8&&distance<=16);assert.equal(s.warnings.length>0,distance>16);}
assert.equal(calc(9,{weaponItem:{type:'weapon',system:{distance:'8',properties:'Дальнобойное'}}}).entries[0].parts[0].value,'-3');
assert.equal(calc(13,{spellRange:8,properties:'Область действия'}).spellRangeWarning,undefined);
assert.equal(calc(13,{spellRange:8,targetTokens:[]}).spellRangeWarning,undefined);
assert.equal(calc(13,{spellRange:8,targetTokens:[target,source]}).spellRangeWarning,undefined);
target.document.hidden=true;assert.equal(calc(13,{spellRange:8}).spellRangeWarning,undefined);target.document.hidden=false;
const projection=token(10);assert.equal(calc(13,{spellRange:8,origin:{tokenUuid:projection.document.uuid},tokens:[projection,target]}).distanceSpaces,3);
const dir=new URL('../packs/_source/abilities/',import.meta.url);
for(const prefix of ['razrushenie-misticheskii-zariad','razrushenie-pokhishchenie']){
 const file=readdirSync(dir).find(n=>n.startsWith(prefix));const item=JSON.parse(readFileSync(new URL(file,dir),'utf8'));
 for(const e of item.system.mechanics.executions.filter(e=>e.type==='attack'))assert.equal(directedSpellRange(caster,e.attack),8);
}
console.log('PASS directed spell range 8/9/13, override, fixed range, weapon regression, area/hidden/no target and projection origin');

// Actual card data, not a fictional weapon name lookup.
const {eligibleSpellWeapons,chooseSpellWeapon,focusRangeBonus,spellEnergy,spellWeaponOptions}=await import('../module/spatial/spell-range.mjs');
const load=(folder,prefix,id)=>{const dir=new URL(`../packs/_source/${folder}/`,import.meta.url);const card=JSON.parse(readFileSync(new URL(readdirSync(dir).find(n=>n.startsWith(prefix+'--')),dir),'utf8'));return {...card,id,uuid:`Actor.A.Item.${id}`};};
const wand=load('weapons','volshebnaia-palochka','wand'),rod=load('weapons','zhezl','rod'),symbol=load('weapons','bozhestvennyi-simvol','symbol'),branch=load('weapons','vetv','branch'),staff=load('weapons','dvuruchnyi-volshebnyi-posokh','staff'),orb=load('weapons','sfera','orb'),focus=load('equipment','fokusirovka','focus');
const mage={type:'character',_source:{system:{spellRange:null}},system:{className:'Волшебник',spellRange:4,equipment:{leftHand:'wand',rightHand:'focus'}},items:{contents:[wand,rod,symbol,branch,staff,orb,focus]}};
const spell={spellRange:'current'};
assert.equal(spellEnergy(mage,spell),'wizard');assert.deepEqual(eligibleSpellWeapons(mage,spell),[wand]);
assert.equal(directedSpellRange(mage,spell,wand),10);assert.equal(directedSpellRange(mage,spell),4);
assert.equal(directedSpellRange(mage,{spellRange:8},wand),8);
mage.system.spellRange=5;assert.equal(directedSpellRange(mage,spell,wand),11);
mage._source.system.spellRange=5;assert.equal(directedSpellRange(mage,spell,wand),10);
assert.equal(directedSpellRange(mage,{...spell,spellEnergy:null},wand),5);
assert.deepEqual(eligibleSpellWeapons(mage,{...spell,spellEnergy:'divine'}),[]);
wand.system.proficiencyMode='no';assert.deepEqual(eligibleSpellWeapons(mage,spell),[]);wand.system.proficiencyMode='auto';
mage.system.equipment={leftHand:'rod',rightHand:'wand'};assert.equal(focusRangeBonus(mage),0);
assert.deepEqual(eligibleSpellWeapons(mage,spell),[wand,rod]);
// Selecting the shorter weapon rather than guessing the highest distance.
globalThis.foundry={applications:{api:{DialogV2:{input:async()=>({choice:'1'})}}}};
assert.equal((await chooseSpellWeapon(mage,spell)).weapon,rod);assert.equal(directedSpellRange(mage,spell,rod),6);
foundry.applications.api.DialogV2.input=async()=>({choice:'none'});assert.equal((await chooseSpellWeapon(mage,spell)).weapon,null);
foundry.applications.api.DialogV2.input=async()=>null;assert.equal(await chooseSpellWeapon(mage,spell),null);
mage.system.equipment={leftHand:'staff',rightHand:'staff'};assert.deepEqual(eligibleSpellWeapons(mage,spell),[staff]);assert.equal((await chooseSpellWeapon(mage,spell)).weapon,staff);
assert.equal(directedSpellRange(mage,spell,staff),6);
// Explicit grant allows a multiclass weapon, but cannot bypass conductance.
mage.system.className='Воин';mage.system.equipment={leftHand:'symbol',rightHand:'focus'};
mage.items.contents.push({type:'ability',system:{mechanics:{weaponProficiency:{weaponContentIds:[symbol.flags['fast-nri-v14'].contentId]}}}});
assert.deepEqual(eligibleSpellWeapons(mage,{...spell,spellEnergy:'divine'}),[symbol]);assert.equal(focusRangeBonus(mage),0);
assert.deepEqual(eligibleSpellWeapons(mage,{...spell,spellEnergy:'wizard'}),[]);
assert.equal(directedSpellRange(mage,{spellRange:8,spellEnergy:null},symbol),8);
// Check the six card declarations against the canonical conductance table.
assert.deepEqual([symbol,branch,rod,orb,wand,staff].map(w=>w.system.mechanics.weapon.conducts),[['divine'],['divine','life'],['divine','life','wizard'],['wizard'],['wizard'],['wizard']]);
console.log('PASS spell weapon selection, actual conductance and proficiency, focus conditions, raw/prepared delta, fixed and multiclass range');

// New energy identifiers work without modifying the resolver; missing energy is not a wildcard.
const newFocus={...wand,id:'newFocus',system:structuredClone(wand.system)};
newFocus.system.mechanics.weapon.conducts=['future_energy'];newFocus.system.proficiencyMode='yes';
mage.items.contents.push(newFocus);mage.system.equipment={leftHand:'newFocus'};
assert.equal(spellEnergy(mage,{spellEnergy:'future_energy'}),'future_energy');
assert.deepEqual(eligibleSpellWeapons(mage,{...spell,spellEnergy:'future_energy'}),[newFocus]);
assert.deepEqual(eligibleSpellWeapons(mage,{...spell,spellEnergy:''}),[]);
assert.deepEqual(eligibleSpellWeapons(mage,{...spell,spellEnergy:'other_energy'}),[]);
assert.equal(spellEnergy(mage,{spellEnergy:null}),null);
for(const prefix of ['razrushenie-misticheskii-zariad','razrushenie-pokhishchenie']){
 const card=load('abilities',prefix,prefix);
 for(const e of card.system.mechanics.executions.filter(e=>e.type==='attack')){
  assert.equal(spellEnergy({...mage,system:{...mage.system,className:'Волшебник'}},e.attack),null);
 }
}
console.log('PASS open energy compatibility and explicit absence on real invocation cards');

// Future chat planner consumes the complete compatible inventory, not the
// strictly eligible held subset; a warning does not erase an option.
mage.system.className='Волшебник';mage.system.equipment={leftHand:'rod',rightHand:'staff'};
rod.system.proficiencyMode='no';
const options=spellWeaponOptions(mage,spell);
assert.deepEqual(options.map(r=>r.weapon.id),['staff','rod','wand','orb']);
assert.deepEqual(options[0].warnings,[]);assert.deepEqual(options[1].warnings,['notProficient']);
assert.deepEqual(options[2].warnings,['notHeld']);
assert.deepEqual(eligibleSpellWeapons(mage,spell),[staff]);
assert.deepEqual(spellWeaponOptions(mage,{spellEnergy:null}),[]);
assert.deepEqual(mage.system.equipment,{leftHand:'rod',rightHand:'staff'});
console.log('PASS compatible inventory, held-first readiness, nonblocking warning data, no equipment writes');

// Native additive effects are read once from prepared values, on top of the
// class or explicit raw base. Fixed private ranges never inherit this delta.
mage._source.system.spellRange=null;mage.system.className='Волшебник';
mage.system.equipment={leftHand:'wand',rightHand:'focus'};
for(const [prepared,unarmed,withWeapon] of [[6,6,12],[2,2,8],[-1,0,5],[-20,0,0]]){
 mage.system.spellRange=prepared;
 assert.equal(currentSpellRange(mage),unarmed);
 assert.equal(directedSpellRange(mage,spell,wand),withWeapon);
 assert.equal(directedSpellRange(mage,{spellRange:8},wand),8);
}
console.log('PASS signed prepared range modifiers, final zero clamp, fixed range');

const nonAttackDistance=options=>directedSpellSpatialContext({...args,spellRange:8,...options});
target.document.x=1300;
assert.deepEqual(nonAttackDistance(),{distanceSpaces:13,spellRange:8,spellRangeWarning:'Цель вне дистанции заклинания'});
assert.equal(nonAttackDistance({properties:'Область действия'}),null);
assert.equal(nonAttackDistance({targetTokens:[]}),null);
assert.equal(nonAttackDistance({targetTokens:[source,target]}),null);
target.document.hidden=true;assert.equal(nonAttackDistance(),null);target.document.hidden=false;
const nonAttackHtml=renderRollPreparation([],{spatialInfo:nonAttackDistance(),formula:'1d20'});
assert.match(nonAttackHtml,/13 \/ 8 клеток/);assert.doesNotMatch(nonAttackHtml,/Угрозы:|Строй:/);
console.log('PASS non-attack directed range, no formation, no hidden/area/no-target advisory');
