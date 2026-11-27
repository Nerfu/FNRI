import {acceptPreroll} from './foundry-test-helpers.js';
import assert from 'node:assert/strict';
import {rerollOptions} from '../module/rolls/game-reroll.mjs';
import {autoRerollWeaponParts} from '../module/equipment/weapon-traits.mjs';
import {resolveAreaResults,renderAreaChat} from '../module/damage/area-attack.mjs';
import {
  sendWeaponAttack,sendWeaponDamage,sendOtherItemAttack,selectedTargetSnapshot,naturalAttackingD20,
  registerWeaponChatControls
} from '../module/weapon/weapon-attack.mjs';
const item={id:'xyz',name:'Меч',type:'weapon',uuid:'Actor.abc.Item.xyz',system:{attackKind:'melee',damageProfile:{A:'1d10',B:'1d4',C:4},proficiencyMode:'yes',damageType:'физический'}};
const actor={documentName:'Actor',system:{className:'Воин',combatDie:'d10'},getRollData(){return {}}};
globalThis.fromUuid=async uuid=>uuid===item.uuid?item:null;
const messages=[];let nextD20=12;let nextTotal=19;
const queuedRolls=[];
class RollMock {
  static validate(formula){return formula.length>0;}
  constructor(formula){this.formula=formula;this.dice=[...formula.matchAll(/(\d+)d(\d+)/g)].map(([,count,faces])=>({faces:Number(faces),number:Number(count),results:Array.from({length:Number(count)},()=>({result:Number(faces)===20?nextD20:Number(faces)===10?7:3,active:true}))}));this.total=nextTotal;
    if(queuedRolls[0]?.formula===formula){
      const {values}=queuedRolls.shift();let i=0;
      for(const die of this.dice)for(const result of die.results)result.result=values[i++];
      assert.equal(i,values.length);this.total=values.reduce((a,b)=>a+b,0);
    }}
  async evaluate(){return this;}
  toJSON(){return {formula:this.formula,dice:structuredClone(this.dice),total:this.total};}
  async toMessage(data,opts){
    const message={id:'msg'+(messages.length+1),isAuthor:true,speaker:data.speaker,
      flags:data.flags,whisper:data.whisper??[],blind:data.blind??false,opts,formula:this.formula,flavor:data.flavor,rolls:[this.toJSON()],
      getFlag(scope,key){return this.flags?.[scope]?.[key]}};
    if(opts?.create!==false) messages.push(message);return message;
  }
}
globalThis.Roll=RollMock;
globalThis.ChatMessage={async create(data){messages.push(data);return data;},getSpeaker({actor}={}){return actor?{actor:'abc'}:{alias:'World'}}};
globalThis.game={user:{isGM:false,targets:new Set()},settings:{get(){return 'public'}},i18n:{localize(x){return x}}};
const guard={actor:{system:{ac:{partial:10,success:18,great:22}}},name:'Guard'};
game.user.targets=new Set([guard]);
globalThis.foundry={applications:{api:{DialogV2:{wait:acceptPreroll}}}};
let attack=await sendWeaponAttack(item,actor);
let data=attack.getFlag('fast-nri-v14','weaponAttack');
assert.equal(attack.formula,'1d20 + 1d10');
assert.equal(data.attackDegree,'success');
assert.equal(data.suggestedDegree,'success');
assert.equal(data.targetName,'Guard');
assert.equal(data.ac,undefined,'AC is not leaked via chat flags');
assert.equal(data.profile.C,4);
const first=await sendWeaponDamage(attack,'partial');
const second=await sendWeaponDamage(attack,'success');
const third=await sendWeaponDamage(attack,'great');
assert.equal(first.formula,'1d10');
assert.equal(second.formula,'1d10 + 1d4');
assert.equal(third.formula,'1d10 + 1d4 + 4');
assert.equal(third.getFlag('fast-nri-v14','weaponDamage').naturalTwenty,false);
assert.deepEqual(third.getFlag('fast-nri-v14','weaponDamage').parts.map(x=>x.value),[7,3,4]);
assert.equal(messages.length,4);
nextD20=1;nextTotal=99;
attack=await sendWeaponAttack(item,actor);
assert.equal(attack.getFlag('fast-nri-v14','weaponAttack').attackDegree,'failure');
assert.equal(attack.getFlag('fast-nri-v14','weaponAttack').suggestedDegree,null);
// Luck preserves the native attack but the next damage uses its corrected natural d20.
attack.flags['fast-nri-v14'].rollEdit={currentTotal:118,components:[{id:'die-1',kind:'die',faces:20,original:1,value:20}],history:[{id:'die-1',gameReroll:true,rule:'luck'}]};
const luckDamage=await sendWeaponDamage(attack,'great');
assert.equal(luckDamage.getFlag('fast-nri-v14','weaponDamage').naturalD20,20);
assert.equal(luckDamage.getFlag('fast-nri-v14','weaponDamage').criticalTriggered,true);
assert.equal(luckDamage.getFlag('fast-nri-v14','weaponDamage').attackTotal,118);
assert.equal(attack.getFlag('fast-nri-v14','weaponAttack').naturalD20,1);
nextD20=20;nextTotal=25;
attack=await sendWeaponAttack(item,actor);
assert.equal(attack.getFlag('fast-nri-v14','weaponAttack').attackDegree,'great');
assert.equal(attack.getFlag('fast-nri-v14','weaponAttack').naturalTwenty,true);
const gripAttack=await sendWeaponAttack(item,actor,{gripWarning:true});
assert.equal(gripAttack.getFlag('fast-nri-v14','weaponAttack').gripWarning,true,
  'weapon attack keeps an advisory marker without canceling the roll');
assert.equal(gripAttack.formula,'1d20 + 1d10','occupied hand does not change attack formula');
const critical=await sendWeaponDamage(attack,'great');
assert.equal(critical.formula,'1d10 + 1d4 + 4','critical 20 is post-defense, not doubled here');
nextD20=12;nextTotal=19;
game.user.targets=new Set();
attack=await sendWeaponAttack(item,actor);
assert.equal(attack.getFlag('fast-nri-v14','weaponAttack').suggestedDegree,null);
assert.equal(attack.getFlag('fast-nri-v14','weaponAttack').targetStatus,'none');
game.user.targets=new Set([guard,{...guard,name:'Guard2'}]);
attack=await sendWeaponAttack(item,actor);
assert.equal(attack.getFlag('fast-nri-v14','weaponAttack').targetStatus,'multiple');
assert.equal(attack.getFlag('fast-nri-v14','weaponAttack').suggestedDegree,null);
game.user.targets=new Set([{actor:{system:{ac:{partial:10}}},name:'Incomplete'}]);
assert.equal(selectedTargetSnapshot(game.user.targets).status,'missingAC');
assert.equal(naturalAttackingD20({dice:[{faces:20,number:2,results:[{result:20}]}]}),null);
item.system.mechanics={attack:{criticalThreshold:19,criticalMultiplier:3}};
nextD20=19;nextTotal=24;
game.user.targets=new Set([guard]);
const thresholdAttack=await sendWeaponAttack(item,actor);
assert.equal(thresholdAttack.getFlag('fast-nri-v14','weaponAttack').criticalThreshold,19);
const thresholdDamage=await sendWeaponDamage(thresholdAttack,'success');
assert.equal(thresholdDamage.getFlag('fast-nri-v14','weaponDamage').criticalTriggered,true);
assert.equal(thresholdDamage.getFlag('fast-nri-v14','weaponDamage').naturalCritMultiplier,3);
item.system.mechanics={attack:{rerollWeaponLowOnce:true,traitOptions:[{id:'sweeping',label:'Размашистое',defaultEnabled:true,effect:{rerollWeaponLowOnce:true}}]}};
const sweepingAttack=await sendWeaponAttack(item,actor);
assert.equal(sweepingAttack.getFlag('fast-nri-v14','weaponAttack').autoRerollTraits.sweeping,false);
assert.equal(sweepingAttack.getFlag('fast-nri-v14','weaponAttack').gameRerollTraits.sweeping,true);
const sweepingDamage=await sendWeaponDamage(sweepingAttack,'success');
assert.equal(sweepingDamage.formula,'1d10 + 1d4','normal path must not reroll before chat');
assert.equal(sweepingDamage.getFlag('fast-nri-v14','weaponDamage').gameRerollTraits.sweeping,true);
assert.equal(sweepingDamage.getFlag('fast-nri-v14','weaponDamage').weaponLowRerollApplied,false);
delete item.system.mechanics;
nextD20=12;nextTotal=19;

// A tiny DOM shim validates the v14 HTML hook generates three *unblocked* buttons.
const listeners={};
class MiniNode{
  constructor(tag){this.tagName=tag;this.dataset={};this.children=[];this.className='';this.textContent='';this.attrs={};this.list=new Set();this.classList={add:x=>this.list.add(x),contains:x=>this.list.has(x)};}
  append(...nodes){this.children.push(...nodes)}
  querySelector(sel){return sel==='.message-content'?this:null}
  addEventListener(type,fn){this.listeners??={};this.listeners[type]=fn;}
}
globalThis.document={createElement:tag=>new MiniNode(tag)};
globalThis.Hooks={on(name,callback){listeners[name]=callback;}};
globalThis.ui={notifications:{warn(){throw Error('unexpected damage warning')}}};
registerWeaponChatControls();
const root=new MiniNode('div');
const inputMessage=messages[0];
listeners.renderChatMessageHTML(inputMessage,root);
const container=root.children[0],buttons=container.children[1].children;
const gripRoot=new MiniNode('div');
listeners.renderChatMessageHTML(gripAttack,gripRoot);
assert.ok(!gripRoot.children[0].children.some(node=>node.textContent==='FASTNRI.Equipment.secondHandRequired'),
  'grip warning is intentionally sheet-only');

assert.equal(buttons.length,3);
assert.equal(buttons.filter(x=>x.classList.contains('fnri-weapon-suggested')).length,1);
assert.equal(buttons[1].classList.contains('fnri-weapon-suggested'),true);
assert.equal(buttons.every(x=>!('disabled' in x)),true);
await buttons[2].listeners.click();
assert.equal(messages.at(-1).formula,'1d10 + 1d4 + 4');
inputMessage.flags['fast-nri-v14'].rollEdit={currentTotal:31};
const correctedDamage=await sendWeaponDamage(inputMessage,'partial');
assert.equal(correctedDamage.getFlag('fast-nri-v14','weaponDamage').attackTotal,31,
  'new damage card uses corrected attack result without touching original');
console.log('PASS: native weapon attack with/without target, 3 unblocked chat damage buttons, no AC leak');

// Check the actual preroll form, not a separately synthesized property flag.
const ID='fast-nri-v14';
const flag=(message,key)=>message.getFlag(ID,key);
const attackFlag=message=>flag(message,'weaponAttack');
const damageFlag=message=>flag(message,'weaponDamage');
actor.id='abc';actor.uuid='Actor.abc';actor.hasPlayerOwner=true;
let autoRows=0;
const chooseAuto=async cfg=>{
  const content=cfg.content.replace(/<label\b[^>]*>[\s\S]*?<\/label>/g, row=>{
    if(!row.includes('FASTNRI.GameReroll.autoReroll'))return row;
    autoRows++;
    assert.doesNotMatch(row,/<input[^>]*\bchecked\b/,'auto reroll is opt-in');
    return row.replace(/<input\b/, '<input checked');
  });
  return acceptPreroll({...cfg,content});
};
foundry.applications.api.DialogV2.wait=chooseAuto;
// Both low weapon dice reroll once, and a second 1 is kept.
item.system.mechanics={attack:{rerollWeaponLowOnce:true,traitOptions:[{id:'sweeping',label:'Размашистое',defaultEnabled:false,effect:{rerollWeaponLowOnce:true}}]}};
const autoAttack=await sendWeaponAttack(item,actor);
assert.equal(attackFlag(autoAttack).autoRerollTraits.sweeping,true);
queuedRolls.push({formula:'1d10 + 1d4',values:[1,2]},{formula:'1d10',values:[1]},{formula:'1d4',values:[4]});
const autoDamage=await sendWeaponDamage(autoAttack,'success');
assert.deepEqual(damageFlag(autoDamage).parts.map(p=>[p.original,p.value]),[[1,1],[2,4]]);
assert.deepEqual(damageFlag(autoDamage).history.map(h=>[h.rule,h.id,h.automatic]),[['sweeping','A',true],['sweeping','B',true]]);
assert.equal(autoDamage.rolls[0].total,3,'original native roll remains intact');
assert.match(autoDamage.flavor,/1 → 1/);
assert.ok(!rerollOptions(autoDamage,actor).some(o=>o.rule==='sweeping'),'automatic and manual routes cannot reroll the same die twice');
assert.equal(autoRows,1);
// A compatible chosen Catalyst grants the existing reroll, not an unrelated held item.
const focus={id:'focus',type:'weapon',uuid:'Actor.abc.Item.focus',name:'Staff',system:{distance:'6',proficiencyMode:'yes',mechanics:{weapon:{isSpellcastingFocus:true,conducts:['wizard']},attack:{traitOptions:[{id:'catalyst',label:'Катализатор'}]}}}};
actor.items={contents:[focus]}; actor.system.equipment={leftHand:'focus'};
const spell={type:'ability',name:'Spell',uuid:'Actor.abc.Item.spell',system:{tags:'Заклинание',mechanics:{attack:{kind:'magic',spellRange:'current',spellEnergy:'wizard',properties:'Заклинание',damageProfile:{failure:'0',partial:'1d6',success:'2d6',great:'3d6'}}}}};
foundry.applications.api.DialogV2.input=async()=>{throw Error('unexpected separate Catalyst dialog');};
foundry.applications.api.DialogV2.wait=acceptPreroll;
const magicAttack=await sendOtherItemAttack(spell,actor,{execution:{attack:{}}});
assert.equal(attackFlag(magicAttack).gameRerollTraits.catalyst,true);
assert.equal(attackFlag(magicAttack).autoRerollTraits.catalyst,false);
queuedRolls.push({formula:'1d6 + 1d6',values:[1,3]});
const magicDamage=await sendWeaponDamage(magicAttack,'success');
assert.equal(damageFlag(magicDamage).gameRerollTraits.catalyst,true);
assert.equal(rerollOptions(magicDamage,actor).find(o=>o.rule==='catalyst').parts[0].part.id,'M1');
// Same inventory: no weapon and incompatible energy cannot inherit Catalyst.
const explicitNone=await sendOtherItemAttack(spell,actor,{execution:{attack:{}},spellWeaponId:null,skipPreroll:true});
assert.equal(attackFlag(explicitNone).gameRerollTraits.catalyst,false);
for(const spellEnergy of [null,'divine']){
 const incompatible=await sendOtherItemAttack(spell,actor,{execution:{attack:{spellEnergy}},skipPreroll:true});
 assert.equal(attackFlag(incompatible).gameRerollTraits.catalyst,false);
}
const oldUnmarked=await sendOtherItemAttack(spell,actor,{execution:{attack:{spellRange:null}},skipPreroll:true});
assert.equal(attackFlag(oldUnmarked).gameRerollTraits.catalyst,false);
// Moving the same focus to the other hand does not change detection.
actor.system.equipment={rightHand:'focus'};
foundry.applications.api.DialogV2.wait=chooseAuto;
const autoMagicAttack=await sendOtherItemAttack(spell,actor,{execution:{attack:{}}});
assert.equal(attackFlag(autoMagicAttack).autoRerollTraits.catalyst,true);
queuedRolls.push({formula:'1d6 + 1d6',values:[1,3]},{formula:'1d6',values:[1]});
const autoMagicDamage=await sendWeaponDamage(autoMagicAttack,'success');
assert.deepEqual(damageFlag(autoMagicDamage).parts.map(p=>[p.original,p.value]),[[1,1],[3,3]]);
assert.equal(damageFlag(autoMagicDamage).history.length,1);
assert.equal(damageFlag(autoMagicDamage).history[0].rule,'catalyst');
assert.ok(!rerollOptions(autoMagicDamage,actor).some(o=>o.rule==='catalyst'));
assert.equal(autoRows,2);
// Shift skips the optional automatic checkbox, but not held-item detection.
const shift=await sendOtherItemAttack(spell,actor,{execution:{attack:{}},skipPreroll:true});
assert.equal(attackFlag(shift).gameRerollTraits.catalyst,true);
assert.equal(attackFlag(shift).autoRerollTraits.catalyst,false);
// No new dialog or refusal when the weapon is merely in inventory.
actor.system.equipment={};
const without=await sendOtherItemAttack(spell,actor,{execution:{attack:{}}});
assert.equal(attackFlag(without).gameRerollTraits.catalyst,false);
assert.equal(autoRows,2);
// Shared area pool: exactly one reroll per base component, never per target.
actor.system.equipment={leftHand:'focus',rightHand:'focus'};
ChatMessage.applyMode=()=>({whisper:[],blind:false});
const areaSpell=structuredClone(spell);
areaSpell.system.mechanics.attack.properties='Заклинание, Область действия';
queuedRolls.push({formula:'1d6 + 1d6 + 1d6',values:[1,3,1]},{formula:'1d6',values:[4]},{formula:'1d6',values:[1]});
const area=await sendOtherItemAttack(areaSpell,actor,{execution:{attack:{}},targetTokens:[]});
assert.equal(attackFlag(area).autoRerollTraits.catalyst,true);
assert.deepEqual(damageFlag(area).parts.map(p=>[p.original,p.value]),[[1,4],[3,3],[1,1]]);
assert.equal(damageFlag(area).history.length,2);
assert.equal(area.rolls.length,2,'original attack + common damage Roll; corrections stay in component history');
assert.equal(autoRows,3,'two hand slots holding one focus do not duplicate the checkbox');
assert.equal(queuedRolls.length,0);
// A replacement is the active die for all degrees, not a second calculation.
queuedRolls.push({formula:'1d6 + 1d6 + 1d6',values:[1,3,5]},{formula:'1d6',values:[6]});
const changedArea=await sendOtherItemAttack(areaSpell,actor,{execution:{attack:{}},targetTokens:[]});
const changedCard=damageFlag(changedArea);
changedCard.areaAttack.targets=['failure','partial','success','great'].map(initialDegree=>({key:initialDegree,name:initialDegree,initialDegree}));
assert.deepEqual(changedCard.parts.map(p=>[p.original,p.value]),[[1,6],[3,3],[5,5]]);
assert.deepEqual(resolveAreaResults(changedArea).map(r=>[r.degree,r.damage]),[['failure',0],['partial',5],['success',11],['great',14]]);
assert.equal(changedArea.rolls[1].total,9,'original damage Roll is retained for audit');
assert.equal(changedCard.history.length,1,'one shared reroll, not one per recipient');
assert.equal(queuedRolls.length,0);
// Render the area card: only its original damage total is visually deprecated.
const nativeAttack=new MiniNode('span'),nativeDamage=new MiniNode('span');
nativeAttack.textContent=String(changedArea.rolls[0].total);nativeDamage.textContent='9';
const areaRoot=new MiniNode('div');areaRoot.querySelectorAll=()=>[nativeAttack,nativeDamage];
assert.equal(renderAreaChat(changedArea,areaRoot),true);
assert.equal(nativeAttack.classList.contains('fnri-original-roll'),false);
assert.equal(nativeDamage.classList.contains('fnri-original-roll'),true);
assert.match(areaRoot.children[0].children[0].textContent,/FASTNRI.GameReroll.currentDice: 6 \+ 3 \+ 5/);
// Added dice and fixed values are never auto-rerolled.
const extras=[{id:'A',kind:'die',faces:6,value:1,original:1},{id:'bonus',kind:'die',faces:6,value:1,original:1},{id:'C',kind:'fixed',value:1,original:1},{id:'B',kind:'die',faces:6,value:2,original:2,added:true}];
queuedRolls.push({formula:'1d6',values:[5]});
const h=await autoRerollWeaponParts(extras,{sweeping:true},'physical');
assert.deepEqual(extras.map(p=>p.value),[5,1,1,2]);assert.equal(h.length,1);assert.equal(queuedRolls.length,0);
console.log('PASS weapon rerolls: actual preroll checkbox, compatible selected Catalyst, no extra dialog, Shift, directed and area dice, history and duplicate prevention');

// Catalyst applies only to the spell profile, not extra damage.
const spellExtras=[{id:'M1',kind:'die',faces:6,value:1,original:1},{id:'extra',kind:'die',faces:6,value:1,original:1,damageType:'magical'},{id:'added',profilePart:'M2',added:true,kind:'die',faces:6,value:1,original:1},{id:'fixed',kind:'fixed',value:1,original:1},{id:'pending',kind:'die',faces:6,value:1,pending:true}];
queuedRolls.push({formula:'1d6',values:[4]});
const spellHistory=await autoRerollWeaponParts(spellExtras,{catalyst:true},'magic');
assert.deepEqual(spellExtras.map(p=>p.value),[4,1,1,1,1]);
assert.equal(spellHistory.length,1);assert.equal(queuedRolls.length,0);
console.log('PASS Catalyst excludes additional damage dice, fixed/pending');

// Blade: selecting its actual card contribution does not inherit an unrelated held Catalyst.
const {readFileSync}=await import('node:fs');
const bladeCard=JSON.parse(readFileSync(new URL('../packs/_source/abilities/razrushenie-lezvie--fci31o4779fdagct.json',import.meta.url),'utf8'));
const blade={...bladeCard,id:'blade',uuid:'Actor.abc.Item.blade'};
delete item.system.mechanics;
item.flags={[ID]:{contentId:'fnri7.rulebook.weapon.004'}};
actor.items={contents:[item,focus,blade]};actor.system.equipment={leftHand:item.id,rightHand:focus.id};
actor.system.resources={magic:{name:'Магическая сила',kind:'class',resourceKey:'class_magic',current:4,max:4}};
foundry.applications.api.DialogV2.wait=async cfg=>chooseAuto({...cfg,content:cfg.content.replace(/<label\b[^>]*>[\s\S]*?<\/label>/g,row=>row.includes('Лезвие — +1d8')?row.replace(/<input\b/,'<input checked'):row)});
const bladeAttack=await sendWeaponAttack(item,actor);
assert.equal(attackFlag(bladeAttack).gameRerollTraits.catalyst,false);
assert.equal(attackFlag(bladeAttack).autoRerollTraits.catalyst,false);
assert.equal(attackFlag(bladeAttack).damageAdditions[0].spellDamage,true);
queuedRolls.push({formula:'1d10 + 1d4 + 1d8',values:[1,1,1]});
const bladeDamage=await sendWeaponDamage(bladeAttack,'success');
assert.deepEqual(damageFlag(bladeDamage).parts.map(p=>p.value),[1,1,1]);
assert.ok(!damageFlag(bladeDamage).history.some(h=>h.rule==='catalyst'));
assert.equal(queuedRolls.length,0);
const physicalSpell=[{id:'M1',kind:'die',faces:6,value:1,damageType:'физический'}];
assert.deepEqual(await autoRerollWeaponParts(physicalSpell,{catalyst:true},'magic'),[]);
console.log('PASS Blade damage unchanged; unrelated Catalyst excluded; physical spell damage excluded');
// A hidden Catalyst checkbox cannot enable reroll when Blade is not selected.
foundry.applications.api.DialogV2.wait=async cfg=>{
  assert.doesNotMatch(cfg.content,/data-fnri-dependent-entry="\d+" style="display:none"/);
  return chooseAuto(cfg);
};
const plainAttack=await sendWeaponAttack(item,actor);
assert.equal(attackFlag(plainAttack).gameRerollTraits.catalyst,false);
assert.equal(attackFlag(plainAttack).autoRerollTraits.catalyst,false);
const physicalMagicSpell=structuredClone(spell);
physicalMagicSpell.system.mechanics.attack.damageType='физический';
foundry.applications.api.DialogV2.wait=async cfg=>{
  assert.doesNotMatch(cfg.content,/FASTNRI.GameReroll.autoReroll/);
  return acceptPreroll(cfg);
};
const physicalAttack=await sendOtherItemAttack(physicalMagicSpell,actor,{execution:{attack:{}}});
assert.equal(attackFlag(physicalAttack).gameRerollTraits.catalyst,false);
assert.equal(attackFlag(physicalAttack).autoRerollTraits.catalyst,false);
console.log('PASS Catalyst conditional visibility and hidden selection cannot enable reroll');

// Repeated automatic invocation cannot reroll a die whose replacement is still 1.
const once=[{id:'A',kind:'die',faces:6,value:1,original:1}];
queuedRolls.push({formula:'1d6',values:[1]});
assert.equal((await autoRerollWeaponParts(once,{sweeping:true},'physical')).length,1);
assert.equal(once[0].gameRerolled,true);
assert.deepEqual(await autoRerollWeaponParts(once,{sweeping:true},'physical'),[]);
assert.equal(queuedRolls.length,0);
console.log('PASS repeated automatic call keeps one reroll per die');

// Warlock controls load the two actual compendium cards, not synthetic profiles.
foundry.applications.api.DialogV2.wait=acceptPreroll;
game.user.targets=new Set();
const loadSpell=(file)=>{const doc=JSON.parse(readFileSync(new URL('../packs/_source/abilities/'+file,import.meta.url),'utf8'));return {...doc,id:doc._id,uuid:'Actor.abc.Item.'+doc._id};};
const blast=loadSpell('razrushenie-misticheskii-zariad--fci0aec7hz0c5uax.json');
const blastExecution=blast.system.mechanics.executions[0];
assert.equal(blastExecution.accounting.resourceCosts[0].amount,1);
const blastAttack=await sendOtherItemAttack(blast,actor,{execution:blastExecution,targetTokens:[],skipPreroll:true});
assert.equal(attackFlag(blastAttack).targetStatus,'none');
assert.equal(blastAttack.formula,'1d20 + 1d10');
for(const [degree,count] of [['partial',1],['success',2],['great',3]]){
 const damage=await sendWeaponDamage(blastAttack,degree);const parts=damageFlag(damage).parts;
 assert.equal(parts.length,count);assert.ok(parts.every(p=>p.faces===6&&p.damageType==='магический'));
}
// Real directed spell entry point: range warning, no change to formula or roll.
const rangeScene={id:'range-scene'},rangeGrid={size:100,isSquare:true,measurePath:([a,b])=>({spaces:Math.abs(a.x-b.x)/100})};
const rangeOrigin={actor,document:{uuid:'Token.caster',parent:rangeScene,x:0,y:0,width:1,height:1}};
const rangeTarget={...guard,document:{uuid:'Token.target',parent:rangeScene,x:1300,y:0,width:1,height:1}};
const rangeNotes=[];const previousCanvas=globalThis.canvas,previousUi=globalThis.ui;
const previousClass=actor.system.className;actor.system.className='Колдун';
globalThis.canvas={scene:rangeScene,grid:rangeGrid,tokens:{placeables:[rangeOrigin,rangeTarget],controlled:[rangeOrigin]}};
globalThis.ui={notifications:{warn:message=>rangeNotes.push(message)}};
const rangeOptions={execution:blastExecution,targetTokens:[rangeTarget],spatialOrigin:{tokenUuid:rangeOrigin.document.uuid}};
foundry.applications.api.DialogV2.wait=async cfg=>{assert.match(cfg.content,/13 \/ 8 клеток/);assert.match(cfg.content,/Цель вне дистанции заклинания/);return acceptPreroll(cfg);};
const farBlast=await sendOtherItemAttack(blast,actor,rangeOptions);assert.equal(farBlast.formula,'1d20 + 1d10');
assert.ok(!rangeNotes.includes('Цель вне дистанции заклинания'));
const fastBlast=await sendOtherItemAttack(blast,actor,{...rangeOptions,skipPreroll:true});assert.equal(fastBlast.formula,farBlast.formula);
assert.ok(rangeNotes.includes('Цель вне дистанции заклинания'));
foundry.applications.api.DialogV2.wait=acceptPreroll;actor.system.className=previousClass;globalThis.canvas=previousCanvas;globalThis.ui=previousUi;
const needles=loadSpell('sotvorenie-chernye-igly--fci7blackneedles.json');
const needlesExecution=needles.system.mechanics.executions[0];assert.equal(needlesExecution.accounting.resourceCosts[0].amount,3);
queuedRolls.push({formula:'1d6 + 1d6',values:[2,5]});
const needlesAttack=await sendOtherItemAttack(needles,actor,{execution:needlesExecution,targetTokens:[],skipPreroll:true});
assert.equal(attackFlag(needlesAttack).gameRerollTraits.catalyst,false);
assert.equal(needlesAttack.rolls.length,2);
const needlesDamage=damageFlag(needlesAttack);assert.deepEqual(needlesDamage.parts.map(p=>p.value),[2,5]);assert.ok(needlesDamage.parts.every(p=>p.damageType==='физический'));
needlesDamage.areaAttack.targets=['failure','partial','success','great'].map(initialDegree=>({key:initialDegree,name:initialDegree,initialDegree}));
assert.deepEqual(resolveAreaResults(needlesAttack).map(r=>[r.degree,r.damage]),[['failure',0],['partial',2],['success',5],['great',7]]);
assert.equal(queuedRolls.length,0);
assert.ok(needlesExecution.attack.outcomes.some(o=>o.kind==='periodicDamage'&&o.minEffectDegree==='great'&&o.formula==='1d6'));
console.log('PASS Warlock actual spell cards: Eldritch Blast, Black Needles without targets, all area degrees, physical type and bleed contract');

// Damage uses the common gate: no components => no window, explicit
// optional components => window; Shift chooses the declared default.
const oldMechanics=item.system.mechanics;
item.system.mechanics={...oldMechanics,rollContributions:[{kind:'modifier',value:'1d4',kinds:['damage'],defaultEnabled:false,label:'Optional damage'}]};
let damageDialogs=0;
foundry.applications.api.DialogV2.wait=async cfg=>{damageDialogs++;assert.match(cfg.content,/Optional damage/);return acceptPreroll({...cfg,content:cfg.content.replace(/name="part_0_0">/,'name="part_0_0" checked>')});};
const damageEntryAttack=await sendWeaponAttack(item,actor,{skipPreroll:true});
const modifiedDamage=await sendWeaponDamage(damageEntryAttack,'partial');
assert.equal(modifiedDamage.formula,'1d10 + (1d4)');assert.equal(damageDialogs,1);
const shiftDamage=await sendWeaponDamage(damageEntryAttack,'partial',{skipPreroll:true});
assert.equal(shiftDamage.formula,'1d10');assert.equal(damageDialogs,1);
item.system.mechanics=oldMechanics;
const directDamage=await sendWeaponDamage(damageEntryAttack,'partial');
assert.equal(directDamage.formula,'1d10');assert.equal(damageDialogs,1);
console.log('PASS damage preroll gate and Shift defaults');

// A future range-authored Wizard execution uses the actually chosen weapon,
// with a real weapon card and actual common spell attack pipeline.
const savedActorSystem=structuredClone(actor.system),savedActorItems=actor.items,savedCanvas=globalThis.canvas,savedUi=globalThis.ui;
const loadHeld=(folder,file,id)=>{const doc=JSON.parse(readFileSync(new URL(`../packs/_source/${folder}/${file}`,import.meta.url),'utf8'));return {...doc,id,uuid:'Actor.abc.Item.'+id};};
const rangeWand=loadHeld('weapons','volshebnaia-palochka--fci3fy1zmyodahjv.json','rangeWand');
const rangeRod=loadHeld('weapons','zhezl--fci36yfrup4yhkux.json','rangeRod');
const rangeFocus=loadHeld('equipment','fokusirovka--fci372bro0dkzzbs.json','rangeFocus');
actor.system.className='Волшебник';actor.system.spellRange=4;actor.system.equipment={leftHand:rangeWand.id,rightHand:rangeFocus.id};actor.items={contents:[rangeWand,rangeRod,rangeFocus]};
globalThis.canvas={scene:rangeScene,grid:rangeGrid,tokens:{placeables:[rangeOrigin,rangeTarget],controlled:[rangeOrigin]}};
globalThis.ui={notifications:{warn:message=>rangeNotes.push(message)}};
const wizardSpell=structuredClone(blast);wizardSpell.name='Test Wizard spell';
const wizardExecution=structuredClone(blastExecution);wizardExecution.attack.spellEnergy='wizard';wizardSpell.system.mechanics.executions=[wizardExecution];
foundry.applications.api.DialogV2.wait=async cfg=>{assert.match(cfg.content,/13 \/ 10 клеток/);return acceptPreroll(cfg);};
const chosenFocusAttack=await sendOtherItemAttack(wizardSpell,actor,{...rangeOptions,execution:wizardExecution});
assert.equal(chosenFocusAttack.formula,'1d20 + 1d10');assert.ok(attackFlag(chosenFocusAttack).weaponTraitIds.includes('guided'));
actor.system.equipment={leftHand:rangeWand.id,rightHand:rangeRod.id};
foundry.applications.api.DialogV2.input=async()=>({choice:'1'});
foundry.applications.api.DialogV2.wait=async cfg=>{assert.match(cfg.content,/13 \/ 6 клеток/);return acceptPreroll(cfg);};
const chosenRodAttack=await sendOtherItemAttack(wizardSpell,actor,{...rangeOptions,execution:wizardExecution});
assert.ok(attackFlag(chosenRodAttack).weaponTraitIds.includes('spellweapon'));assert.ok(!attackFlag(chosenRodAttack).weaponTraitIds.includes('guided'));
actor.system=savedActorSystem;actor.items=savedActorItems;globalThis.canvas=savedCanvas;globalThis.ui=savedUi;
console.log('PASS actual spell attack integration: chosen weapon range, focus, selected-only traits');

// P.2.3: actual attack and directed check entry points calculate formation only
// at confirmation; use a distant witness whose side is read only by formation.
const {sendAttackSnapshot}=await import('../module/weapon/weapon-attack.mjs');
const {postCheckRoll}=await import('../module/rolls/checks.mjs');
const testScene={id:'formation-confirm'},testGrid={size:100,isSquare:true,measurePath:([a,b])=>({spaces:Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y))/100})};
const combatantActor=id=>({uuid:`Actor.${id}`,type:'npc',hasPlayerOwner:true,system:{hp:{current:10},equipment:{},ac:{partial:10,success:15,great:20},defenses:{reflex:10}},effects:{contents:[]},items:{contents:[]}});
const ft=(id,a,x,y,side)=>({name:id,actor:a,document:{uuid:`Scene.formation-confirm.Token.${id}`,parent:testScene,x:x*100,y:y*100,width:1,height:1,disposition:side}});
const victim=ft('victim',combatantActor('victim'),0,0,1),enemy1=ft('enemy1',combatantActor('enemy1'),1,0,-1),enemy2=ft('enemy2',combatantActor('enemy2'),0,1,-1),witness=ft('witness',combatantActor('witness'),15,15,1);
let scans=0;Object.defineProperty(witness.document,'disposition',{get(){scans++;return 1;}});
globalThis.canvas={scene:testScene,grid:testGrid,tokens:{placeables:[victim,enemy1,enemy2,witness],controlled:[]}};
globalThis.ui={notifications:{warn(){}}};
const confirmOpts={actor,name:'Formation confirmation',profile:{A:'1d10',B:'1d4',C:4},expression:'1d20 + 1d10',targetTokens:[victim],spatialOrigin:{tokenUuid:enemy1.document.uuid}};
foundry.applications.api.DialogV2.wait=async cfg=>{assert.equal(scans,0,'no formation scan in preroll');assert.doesNotMatch(cfg.content,/Угрозы:|Строй:|Цель окружена/);enemy2.document.y=100;return acceptPreroll(cfg);};
enemy2.document.y=900;nextD20=12;nextTotal=14;
const confirmedAttack=await sendAttackSnapshot(confirmOpts);
assert.equal(scans,1);assert.equal(attackFlag(confirmedAttack).spatialConditions.surrounded,true);assert.equal(attackFlag(confirmedAttack).attackDegree,'success');
scans=0;const confirmedArea=await sendAttackSnapshot({...confirmOpts,properties:'Область действия',skipPreroll:true});
assert.equal(scans,1,'one target area scans only once');assert.equal(attackFlag(confirmedArea).areaAttack.targets[0].initialDegree,'success');
scans=0;const multiArea=await sendAttackSnapshot({...confirmOpts,targetTokens:[victim,enemy1],properties:'Область действия',skipPreroll:true});assert.equal(scans,2,'one scan per area target');assert.equal(attackFlag(multiArea).areaAttack.targets.length,2);
scans=0;const singleCheck=await postCheckRoll({actor,formula:'1d20',label:'Check',targetDefense:'reflex',targetTokens:[victim],compareEachTarget:true,skipPreroll:true});
assert.equal(scans,1,'single directed comparison reuses snapshot');assert.equal(singleCheck.result.degree,singleCheck.targetResults[0].degree);
scans=0;await postCheckRoll({actor,formula:'1d20',label:'Check',targetDefense:'reflex',targetTokens:[victim,enemy1],compareEachTarget:true,skipPreroll:true});assert.equal(scans,2);
globalThis.canvas=savedCanvas;globalThis.ui=savedUi;
console.log('PASS P.2.3 confirmation: single formation scan per target, no preroll scan, one and multiple area/check recipients');

// The actual attack pipeline must use the invisible source only for its own attack.
globalThis.canvas={scene:testScene,grid:testGrid,tokens:{placeables:[victim,enemy1,enemy2],controlled:[]}};
globalThis.ui={notifications:{warn(){}}};
enemy1.actor.effects.contents=[{statuses:new Set(['fnri7-invisible'])}];
nextD20=12;nextTotal=14;
const invisibleAttack=await sendAttackSnapshot({...confirmOpts,actor:enemy1.actor,skipPreroll:true});
assert.equal(attackFlag(invisibleAttack).spatialConditions.threats,1);
assert.equal(attackFlag(invisibleAttack).spatialConditions.surrounded,false);
assert.equal(attackFlag(invisibleAttack).attackOffGuard,true);
assert.equal(attackFlag(invisibleAttack).attackDegree,'success');
nextD20=12;nextTotal=14;
const visibleAttack=await sendAttackSnapshot({...confirmOpts,actor:enemy2.actor,spatialOrigin:{tokenUuid:enemy2.document.uuid},skipPreroll:true});
assert.equal(attackFlag(visibleAttack).attackOffGuard,undefined);
assert.equal(attackFlag(visibleAttack).attackDegree,'partial');
nextD20=12;nextTotal=14;
const invisibleArea=await sendAttackSnapshot({...confirmOpts,actor:enemy1.actor,properties:'Область действия',skipPreroll:true});
assert.equal(attackFlag(invisibleArea).areaAttack.targets[0].attackOffGuard,true);
assert.equal(victim.actor.effects.contents.length,0);
globalThis.canvas=savedCanvas;globalThis.ui=savedUi;
console.log('R104 actual attack pipeline: invisible source local consequence, visible source unaffected, area snapshot: PASS');

// C1 Orc: same attack route, explicit selection; no base Actor mutation.
const orcCard=JSON.parse(readFileSync(new URL('../packs/_source/abilities/surovost--fnriorcferocity1.json',import.meta.url),'utf8'));
const ferocityItem={...orcCard,id:orcCard._id,uuid:'Actor.abc.Item.'+orcCard._id};
actor.items={contents:[ferocityItem]};actor.system.combatDie='d10';
let ferocityChecked=true;
foundry.applications.api.DialogV2.wait=async cfg=>{
  const row=[...cfg.content.matchAll(/<label\b[^>]*>[\s\S]*?<\/label>/g)].find(m=>m[0].includes('Суровость'));
  if(!row)return acceptPreroll(cfg);
  const key=row[0].match(/name="(part_\d+_0)"/)?.[1];assert.ok(key);
  return acceptPreroll({...cfg,content:ferocityChecked?cfg.content.replace(`name="${key}">`,`name="${key}" checked>`):cfg.content});
};
game.user.targets=new Set([guard]);nextTotal=14;nextD20=12;
const orcPartial=await sendWeaponAttack(item,actor);
assert.equal(orcPartial.formula,'1d20 + 1d12');assert.equal(attackFlag(orcPartial).attackDegree,'failure');
assert.equal(attackFlag(orcPartial).suggestedDegree,null);
assert.equal((await sendWeaponDamage(orcPartial,'partial')).formula,'1d10','manual choice remains but no success bonus');
nextTotal=19;const orcSuccess=await sendWeaponAttack(item,actor);
assert.equal(attackFlag(orcSuccess).attackDegree,'success');
const orcDamage=await sendWeaponDamage(orcSuccess,'success');
assert.equal(orcDamage.formula,'1d10 + 1d4');
assert.equal(orcDamage.getFlag('fast-nri-v14','weaponDamage').parts.filter(p=>p.ferocityDamage).length,0);
assert.equal(orcDamage.getFlag('fast-nri-v14','weaponDamage').postDefenseDamage[0].parts[0].faces,8);
assert.equal((await sendWeaponDamage(orcSuccess,'great')).formula,'1d10 + 1d4 + 4');
assert.equal(actor.system.combatDie,'d10');
ferocityChecked=false;const ordinary=await sendWeaponAttack(item,actor);
assert.equal(ordinary.formula,'1d20 + 1d10');assert.equal(attackFlag(ordinary).ferocity,undefined);
ferocityChecked=true;actor.system.combatDie='d12';
const already12=await sendWeaponAttack(item,actor);assert.equal(already12.formula,'1d20 + 1d12');assert.equal(attackFlag(already12).ferocity,true);
console.log('PASS Orc: Ferocity attack replacement, failure on partial, bonus die on both success degrees, opt-in and existing d12');
// One area roll: per-target initial degree, one shared extra die. A four-die
// success has no default profile in the canon and must stay manually resolved.
actor.system.combatDie='d10';nextD20=12;nextTotal=19;
const orcArea=await sendAttackSnapshot({actor,name:'Orc area',profile:{A:'1d10',B:'1d4',C:4},expression:'1d20 + 1d10',usesCombatDie:true,properties:'Область действия',targetTokens:[
  {name:'partial',actor:{system:{ac:{partial:10,success:20,great:25}}}},
  {name:'success',actor:{system:{ac:{partial:10,success:15,great:25}}}},
  {name:'great',actor:{system:{ac:{partial:10,success:15,great:18}}}}]});
const orcAreaCard=orcArea.getFlag('fast-nri-v14','weaponDamage');
assert.deepEqual(orcAreaCard.areaAttack.targets.map(t=>t.initialDegree),['partial','success','great']);
assert.equal(orcAreaCard.parts.filter(p=>p.ferocityDamage).length,0);
const orcRows=resolveAreaResults(orcArea);
assert.equal(orcAreaCard.postDefenseDamage,undefined);
assert.equal(orcRows[1].profileComplete,true);assert.equal(orcRows[2].profileComplete,true);
console.log('PASS Orc area: new Ferocity unavailable, ordinary independent degrees');

// Nephalem Bite uses a native physical profile, independent of held weapons.
{
  const data=JSON.parse(readFileSync(new URL('../packs/_source/abilities/golod--fnrinephhunger01.json',import.meta.url),'utf8'));
  const bite={...data,id:data._id,uuid:'Actor.abc.Item.'+data._id};
  actor.items={contents:[bite,item],get:id=>id===item.id?item:null};
  actor.system.equipment={leftHand:item.id,rightHand:item.id};actor.system.combatDie='d8';
  game.user.targets=new Set([guard]);nextTotal=19;nextD20=12;
  const attack=await sendOtherItemAttack(bite,actor,{execution:data.system.mechanics.executions[0],skipPreroll:true});
  const snap=attackFlag(attack);assert.equal(snap.name,'Укус');assert.equal(snap.sourceKind,'unarmed');assert.equal(snap.profileKind??'physical','physical');assert.equal(attack.formula,'1d20 + 1d8');
  assert.equal((await sendWeaponDamage(attack,'partial')).formula,'1d6');
  const biteDamage=await sendWeaponDamage(attack,'success');assert.equal(biteDamage.formula,'1d6 + 1d8');
  const {largestDamageDieHealing}=await import('../module/damage/damage-core.mjs');
  assert.equal(largestDamageDieHealing(biteDamage.getFlag('fast-nri-v14','weaponDamage')),3);
  assert.equal((await sendWeaponDamage(attack,'great')).formula,'1d6 + 1d8 + 3');
  assert.equal(actor.system.combatDie,'d8');
  console.log('PASS Nephalem Bite: explicit unarmed execution, independent held weapon, standard damage parts');
}

// Actual Warrior cards: separate fixed damage and natural-20-only multiplier.
{
  const load=filename=>JSON.parse(readFileSync(new URL('../packs/_source/abilities/'+filename,import.meta.url),'utf8'));
  const one=load('warrior-one-handed--fnriwaronehand01.json');
  const crit=load('warrior-crushing-blow--fnriwarcrush0001.json');
  actor.items={contents:[one,crit,item],get:id=>id===item.id?item:null};
  actor.system.combatDie='d10';item.system={attackKind:'melee',grip:'1',damageProfile:{A:'1d10',B:'1d4',C:4},proficiencyMode:'yes',damageType:'физический'};
  game.user.targets=new Set([guard]);nextTotal=25;nextD20=20;
  const {calculateDamage,criticalDamageRule}=await import('../module/damage/damage-core.mjs');
  const a=await sendWeaponAttack(item,actor,{skipPreroll:true});
  const d=await sendWeaponDamage(a,'great',{skipPreroll:true});
  const card=d.getFlag('fast-nri-v14','weaponDamage');
  assert.equal(d.formula,'1d10 + 1d4 + 4 + 2');
  assert.equal(card.parts.at(-1).kind,'fixed');assert.equal(card.parts.at(-1).value,2);
  assert.equal(calculateDamage(card).total,48);
  card.parts[0].excluded=true;assert.equal(calculateDamage(card).total,27);
  assert.equal(criticalDamageRule({...card,naturalD20:19,criticalThreshold:19}).multiplier,2);
  item.system.grip='2';const two=attackFlag(await sendWeaponAttack(item,actor,{skipPreroll:true}));
  assert.equal(two.weaponDamageBonus,undefined);assert.equal(two.naturalTwentyMultiplier,3);
  item.system.attackKind='ranged';item.system.grip='1';const ranged=attackFlag(await sendWeaponAttack(item,actor,{skipPreroll:true}));
  assert.equal(ranged.weaponDamageBonus,2);assert.equal(ranged.naturalTwentyMultiplier,undefined);
  item.system.proficiencyMode='no';const unknown=attackFlag(await sendWeaponAttack(item,actor,{skipPreroll:true}));
  assert.equal(unknown.weaponDamageBonus,undefined);assert.equal(unknown.naturalTwentyMultiplier,undefined);
  console.log('PASS Warrior: owned passives, separate fixed damage, critical order, natural 19/20, grips and proficiency');
}
{
  const {inspectDamageDefenseSources}=await import('../module/damage/periodic-damage.mjs');
  const card=JSON.parse(readFileSync(new URL('../packs/_source/abilities/warrior-defensive-stance--fnriwarstance001.json',import.meta.url),'utf8'));
  const effect={...card.effects[0],id:'stance',active:true};
  const shield={id:'shield',type:'gear',system:{mechanics:{protection:{kind:'shield'}}}};
  const owner={system:{equipment:{}},items:{contents:[shield]},effects:{contents:[effect]}};
  const value=()=>inspectDamageDefenseSources(owner)[0]?.rule.resistances[0].value;
  assert.equal(value(),2);owner.system.equipment.leftHand='shield';assert.equal(value(),4);
  delete owner.system.equipment.leftHand;assert.equal(value(),2);effect.disabled=true;assert.equal(value(),undefined);
  assert.equal(effect.duration.expiry,'turnStart');assert.equal(effect.img,card.img);
  console.log('PASS Warrior stance: live held shield, removal, disabled effect, native duration template');
}
// Ranger: actual card + actual bow, independent damage component, excludes interventions.
{
  const load=f=>JSON.parse(readFileSync(new URL('../packs/_source/'+f,import.meta.url),'utf8'));
  const passive=load('abilities/ranger-hunter-shot--fnriranger000004.json');
  const bow=load('weapons/korotkii-luk--fci07ja014xqgmsg.json');
  Object.assign(item,{system:bow.system,flags:bow.flags,name:bow.name});
  actor.system.className='Егерь';actor.system.combatDie='d8';
  actor.items={contents:[passive,passive,item],get:id=>id===item.id?item:null};
  game.user.targets=new Set([guard]);nextTotal=19;nextD20=12;
  const a=await sendWeaponAttack(item,actor,{skipPreroll:true});
  assert.equal((await sendWeaponDamage(a,'partial',{skipPreroll:true})).formula,'1d4');
  assert.equal((await sendWeaponDamage(a,'success',{skipPreroll:true})).formula,'1d4 + 1d4 + (1d8)');
  const d=await sendWeaponDamage(a,'great',{skipPreroll:true});
  assert.equal(d.formula,'1d4 + 1d4 + 5 + (1d8)');
  assert.equal(d.getFlag('fast-nri-v14','weaponDamage').parts.at(-1).damageType,'физический');
  const originalWait=foundry.applications.api.DialogV2.wait;
  foundry.applications.api.DialogV2.wait=async config=>{
    assert.ok(config.content.includes('Выстрел охотника'));
    return config.buttons.find(b=>b.action==='roll').callback({}, {form:{elements:{namedItem:()=>({checked:false})},querySelectorAll:()=>[]}});
  };
  try{assert.equal((await sendWeaponDamage(a,'success')).formula,'1d4 + 1d4');}finally{foundry.applications.api.DialogV2.wait=originalWait;}
  const inter=await sendWeaponAttack(item,actor,{skipPreroll:true,isIntervention:true});
  assert.equal((await sendWeaponDamage(inter,'success',{skipPreroll:true})).formula,'1d4 + 1d4');
  console.log('PASS Ranger ordinary bow damage: degrees, duplicate passive, typed separate die, intervention exclusion');
}
// Bard: native card -> attack preroll -> damage preroll, ordinary and area.
{
  const load=async prefix=>{const {readdirSync}=await import('node:fs');const dir=new URL('../packs/_source/abilities/',import.meta.url);const f=readdirSync(dir).find(f=>f.startsWith(prefix+'--'));const data=JSON.parse(readFileSync(new URL(f,dir),'utf8'));return {...data,id:data._id,uuid:'Actor.abc.Item.'+data._id,documentName:'Item'};};
  const rhythm=await load('bard-rhythm'),rapier=await load('bard-rapier-finale'),area=await load('bard-sword-area');
  const loadWeapon=f=>JSON.parse(readFileSync(new URL('../packs/_source/weapons/'+f,import.meta.url),'utf8'));
  const rap=loadWeapon('rapira--fci2qd7ik405qky2.json');Object.assign(item,{name:rap.name,system:rap.system,flags:rap.flags});
  actor.type='character';actor.uuid='Actor.abc';actor.system.className='Бард';actor.system.combatDie='d8';actor.system.resources={class_rhythm:{kind:'class',name:'Ритм',current:3,max:3}};actor.system.equipment={leftHand:item.id,rightHand:''};
  actor.items={contents:[rhythm,rapier,area,item],get:id=>[rhythm,rapier,area,item].find(i=>i.id===id)};
  globalThis.fromUuid=async uuid=>[actor,rhythm,rapier,area,item].find(o=>o.uuid===uuid)??null;
  game.user.targets=new Set([guard]);nextD20=12;nextTotal=19;
  const a=await sendOtherItemAttack(rapier,actor,{execution:rapier.system.mechanics.executions[0],skipPreroll:true});
  assert.match(a.formula,/\+ \(3\)$/);const d=await sendWeaponDamage(a,'success',{skipPreroll:true});
  const parts=d.getFlag('fast-nri-v14','weaponDamage').parts;assert.equal(parts.length,6);assert.ok(parts.every(p=>p.damageType==='магический'));assert.equal(d.formula,'1d6 + 1d6 + (4d6)');
  const sword=loadWeapon('dlinnyi-mech--fci2un4v92kc3x8z.json');Object.assign(item,{name:sword.name,system:sword.system,flags:sword.flags});
  const b=await sendOtherItemAttack(area,actor,{execution:area.system.mechanics.executions[0],skipPreroll:true,targetTokens:[guard]});
  const snap=b.getFlag('fast-nri-v14','weaponDamage');assert.equal(snap.parts.length,5);assert.ok(snap.parts.every(p=>p.damageType==='магический'));assert.deepEqual(snap.areaAttack.damageProfile.partial.remove,['highest']);
  console.log('PASS Bard chat: rhythm in attack, rapier 4d6, all magical, area five independent components');
}
