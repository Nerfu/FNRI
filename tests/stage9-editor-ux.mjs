import assert from 'node:assert/strict';
import {renderDamageCard} from '../module/damage/damage-chat.mjs';
import {renderRollEditorContent,saveRollEditorInput} from '../module/damage/roll-editor.mjs';
import {selfDefenseFormula} from '../module/damage/interventions.mjs';
import {attackExpressionForWeapon} from '../module/weapon/weapon-attack.mjs';
import {unarmedExpression} from '../module/rolls/unarmed.mjs';
const ID='fast-nri-v14';
class Node {
  constructor(tag){this.tag=tag;this.dataset={};this.children=[];this.className='';this.textContent='';this.events={};this.parent=null;
    this.classes=new Set();this.classList={add:x=>this.classes.add(x),contains:x=>this.classes.has(x)};}
  append(...children){for(const child of children){child.parent=this;this.children.push(child);}}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);}
  querySelector(selector){
    if(selector==='.message-content' && this.className==='message-content')return this;
    if(selector==='[data-fnri-damage-card]' && Object.hasOwn(this.dataset,'fnriDamageCard'))return this;
    for(const child of this.children){const found=child.querySelector?.(selector);if(found)return found;}
    return null;
  }
  addEventListener(type,fn){this.events[type]=fn;}
}
const root=new Node('li');root.className='chat-message';root.dataset.messageId='damage1';
const anchor=new Node('div');anchor.className='message-content';root.append(anchor);
globalThis.document={createElement:tag=>new Node(tag),querySelectorAll:sel=>sel==='.chat-message'?[root]:[]};
globalThis.game={user:{id:'gm',isGM:true},i18n:{localize:k=>k.split('.').at(-1)}};
const nextDice=[2];
globalThis.Roll=class {constructor(formula){this.formula=formula;}async evaluate(){this.total=nextDice.shift();return this;}};
const msg={id:'damage1',isAuthor:true,flags:{[ID]:{
  weaponDamage:{version:2,isIntervention:true,parts:[
    {id:'die',kind:'die',faces:4,formula:'1d4',value:4,original:4,excluded:false},
    {id:'fix',kind:'fixed',formula:'2',value:2,original:2,excluded:false}],
    history:[],adjustments:{penalty:0,resistance:0,vulnerability:0},naturalD20:12,revision:0}
  }},canUserModify(){return true;},getFlag(scope,key){return this.flags?.[scope]?.[key];},
  async update(patch){for(const [path,value] of Object.entries(patch))this.flags[ID][path.split('.').at(-1)]=value;}
};
function button(){const card=anchor.querySelector('[data-fnri-damage-card]');
  return card?.children?.find(x=>x.classList.contains('fnri-intervene-button'));}
renderDamageCard(msg,root);
assert.equal(button(),undefined,'intervention result hides action instead of disabling it');
let form=renderRollEditorContent(msg);
assert.doesNotMatch(form,/type="radio"/,'component operations are buttons, never radio controls');
assert.match(form,/data-fnri-editor-op="reroll:0"/,'real reroll button');
assert.doesNotMatch(form,/name="partValue_0"/,'numeric input appears only after pressing Set');
assert.match(form,/name="criticalPresent" value="1"/);
assert.match(form,/type="checkbox" name="critical" value="true"/);
assert.match(form,/type="checkbox" name="intervention" value="true" checked/);
assert.match(form,/name="interventionPresent" value="1"/);
assert.doesNotMatch(form,/<select name="intervention">/);
assert.doesNotMatch(form,/name="value"[^>]*value="0"/,'no misleading global zero input');
let result=await saveRollEditorInput(msg,{operation:'none',interventionPresent:'1',criticalMode:'auto',criticalMultiplier:'2'});
assert.equal(result.interventionChanged,true);
assert.ok(button(),'switching to No immediately adds a clickable button');
assert.notEqual(button().disabled,true,'button is not disabled');
assert.equal(msg.flags[ID].weaponDamage.parts[0].value,4,'flag save does not modify die');
assert.equal(msg.flags[ID].weaponDamage.history.length,0,'flag save does not create a die correction');
result=await saveRollEditorInput(msg,{operation:'exclude:0',intervention:'false',criticalMode:'auto',criticalMultiplier:'2'});
assert.equal(msg.flags[ID].weaponDamage.parts[0].excluded,true);
form=renderRollEditorContent(msg);
assert.match(form,/data-fnri-editor-op="restore:0"/,'excluded die offers a restore action');
assert.ok(button(),'editing dice must not hide an allowed intervention');
await saveRollEditorInput(msg,{operation:'restore:0',intervention:'false',criticalMode:'auto',criticalMultiplier:'2'});
assert.equal(msg.flags[ID].weaponDamage.parts[0].excluded,false);
await saveRollEditorInput(msg,{operation:'reroll:0',intervention:'false',criticalMode:'auto',criticalMultiplier:'2'});
assert.equal(msg.flags[ID].weaponDamage.parts[0].value,2);
assert.equal(msg.flags[ID].weaponDamage.parts[0].original,4);
assert.equal(nextDice.length,0);
assert.match(renderRollEditorContent(msg),/data-fnri-editor-op="reset:0"/);
await saveRollEditorInput(msg,{operation:'reset:0',intervention:'false',criticalMode:'auto',criticalMultiplier:'2'});
assert.equal(msg.flags[ID].weaponDamage.parts[0].value,4,'return to original dice result');
assert.equal(msg.flags[ID].weaponDamage.parts[0].excluded,false);
result=await saveRollEditorInput(msg,{operation:'none',interventionPresent:'1',intervention:'true',criticalMode:'auto',criticalMultiplier:'2'});
assert.equal(result.interventionChanged,true);
assert.equal(button(),undefined,'switching to checked removes the button, never disables it');
// Omitted checkbox is not a change when a caller did not send the form marker.
result=await saveRollEditorInput(msg,{operation:'none',criticalMode:'auto',criticalMultiplier:'2'});
assert.equal(result.interventionChanged,false);
assert.equal(button(),undefined,'omitted legacy field leaves state unchanged');
// Checkbox works independently from the die action on subsequent saves.
result=await saveRollEditorInput(msg,{operation:'none',interventionPresent:'1',criticalMode:'auto',criticalMultiplier:'2'});
assert.equal(result.interventionChanged,true);
assert.ok(button(),'unchecked checkbox restores the action');
assert.equal(anchor.children.filter(x=>x.dataset?.fnriDamageCard!==undefined).length,1,'no duplicated cards on refresh');
// Separate Critical checkbox edits only the concrete damage result and honors attack-card multiplier.
result=await saveRollEditorInput(msg,{operation:'none',criticalPresent:'1',critical:'true'});
assert.equal(result.criticalChanged,true);
assert.equal(msg.getFlag(ID,'weaponDamage').manualCritical,true);
assert.match(renderRollEditorContent(msg),/name="critical" value="true" checked/);
result=await saveRollEditorInput(msg,{operation:'none',criticalPresent:'1'});
assert.equal(result.criticalChanged,true);
assert.equal(msg.getFlag(ID,'weaponDamage').manualCritical,null,'unchecked returns to auto if naturally not critical');
assert.equal(msg.getFlag(ID,'weaponDamage').parts[0].value,4,'critical checkbox never changes dice');
const criticalCard=msg.getFlag(ID,'weaponDamage');
criticalCard.naturalD20=20; criticalCard.naturalCritMultiplier=3;
assert.match(renderRollEditorContent(msg),/name="critical" value="true" checked/,'natural critical starts checked');
await saveRollEditorInput(msg,{operation:'none',criticalPresent:'1'});
assert.equal(msg.getFlag(ID,'weaponDamage').manualCritical,false,'GM can turn off natural critical');
assert.doesNotMatch(renderRollEditorContent(msg),/name="critical" value="true" checked/);
await saveRollEditorInput(msg,{operation:'none',criticalPresent:'1',critical:'true'});
assert.equal(msg.getFlag(ID,'weaponDamage').manualCritical,null,'GM may return to natural critical');
const defender={type:'character',system:{combatDie:'',defenses:{reflex:4}}};
assert.deepEqual(selfDefenseFormula(defender,'ranged').warnings,[],'no distracting missing combat die warning');
const weapon={system:{proficiencyMode:'yes',proficiencyClasses:'',rollFormula:''}};
assert.equal(attackExpressionForWeapon(weapon,defender).warning,null);
assert.equal(unarmedExpression(defender).warning,null);
console.log('PASS stage 9: intervention button hide/restore, independent flag edit, safe die actions, no missing combat die warning');
