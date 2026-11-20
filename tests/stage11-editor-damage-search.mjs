import assert from 'node:assert/strict';
import {rollEditorPage,renderRollEditorContent,editorPartTraits,saveRollEditorInput,ROLL_EDITOR_PAGE_SIZE}
  from '../module/damage/roll-editor.mjs';
const ID='fast-nri-v14';
globalThis.game={user:{id:'gm',isGM:true},i18n:{localize:k=>k.split('.').at(-1)}};
const parts=Array.from({length:603},(_,i)=>({id:`part-${i}`,kind:'die',faces:6,
  original:4,value:4,formula:'1d6',excluded:false,
  damageType:i%3===0?'Огонь':i%3===1?'Холод':'Физический',
  traits:i%5===0?['Святой','Бронебойный']:['Обычный']}));
const card={version:2,parts,adjustments:{penalty:0,resistance:0,vulnerability:0},history:[],naturalD20:12};
const msg={flags:{[ID]:{weaponDamage:card}},getFlag(scope,key){return this.flags[scope][key];},
  canUserModify(){return true;},async update(patch){for(const [k,v] of Object.entries(patch))this.flags[ID][k.split('.').at(-1)]=v;}};
assert.deepEqual(editorPartTraits(parts[0]),['Святой','Бронебойный']);
assert.deepEqual(editorPartTraits({properties:'Режущий, Магический; Особый'}),['Режущий','Магический','Особый']);
assert.deepEqual(editorPartTraits({}),[]);
assert.equal(rollEditorPage(parts,{query:'оГоНь'}).count,201);
assert.equal(rollEditorPage(parts,{query:'холод'}).count,201);
assert.equal(rollEditorPage(parts,{query:'святой'}).count,121);
assert.equal(rollEditorPage(parts,{query:'бронЕбой'}).count,121);
assert.equal(rollEditorPage(parts,{query:'1d6'}).count,603);
assert.equal(rollEditorPage(parts,{query:'#500'}).items[0].index,499);
assert.equal(rollEditorPage(parts,{query:'Огонь',page:99}).page,10);
assert.equal(rollEditorPage(parts,{query:'Святой',page:1}).items.length,ROLL_EDITOR_PAGE_SIZE);
assert.equal(rollEditorPage(parts,{query:'Святой',page:1}).items[0].index,100);
const rendered=renderRollEditorContent(msg,{query:'Святой',page:1,interventionDraft:true,criticalDraft:true});
assert.equal((rendered.match(/fnri-editor-part-row/g)??[]).length,ROLL_EDITOR_PAGE_SIZE);
assert.match(rendered,/#101 · 1d6/);
assert.match(rendered,/Святой · Бронебойный/,'traits visible alongside dice');
assert.match(rendered,/data-fnri-editor-op="set:100"/,'action uses original index');
assert.match(rendered,/name="intervention" value="true" checked/);
assert.match(rendered,/name="critical" value="true" checked/);
assert.doesNotMatch(rendered,/data-fnri-editor-nav="search"/,'no apply-search button');
const physical=renderRollEditorContent(msg,{query:'Физический'});
assert.match(physical,/Физический/);
const dangerous={...parts[0],traits:['<img src=x onerror=alert(1)>']};
const unsafe=renderRollEditorContent({...msg,flags:{[ID]:{weaponDamage:{...card,parts:[dangerous]}}}});
assert.doesNotMatch(unsafe,/<img src=x/);
assert.match(unsafe,/&lt;img src=x onerror=alert\(1\)&gt;/);
const manual=await saveRollEditorInput(msg,{operation:'set:500',partValue_500:2});
assert.ok(manual.outcome);
assert.equal(msg.getFlag(ID,'weaponDamage').parts[500].value,2);
assert.equal(msg.getFlag(ID,'weaponDamage').parts[499].value,4);
assert.equal(msg.getFlag(ID,'weaponDamage').parts[500].original,4);
console.log('PASS: damage-type and trait search, 603 components, 20/page, original indexes, XSS escaping, independent checkboxes');
