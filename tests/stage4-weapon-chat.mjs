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
