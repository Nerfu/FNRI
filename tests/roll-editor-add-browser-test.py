#!/usr/bin/env python3
"""Chromium integration: Add dice/fixed dialog, traits, search, and no disabled controls."""
from pathlib import Path
import re
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
source=(root/'module/damage/roll-editor.mjs').read_text(encoding='utf-8')
source=re.sub(r'^import [^\n]+\n','',source,flags=re.MULTILINE)
source=re.sub(r'\bexport (?=(async )?(function|const))','',source)
shim="""
const calculateDamage = card=>({total:card.parts.reduce((n,p)=>n+(p.excluded?0:Number(p.value)),0)});
const criticalDamageRule = card=>({triggered:false});
const messageIntervention = msg=>false;
const copy = v=>JSON.parse(JSON.stringify(v));
const changePart=(card,id,action,value)=>{const next=copy(card);const part=next.parts.find(x=>x.id===id);
 const old=part.value;part.value=value;return {next,old,current:value};};
const appendDamageComponents=(card,{kind,faces,count,values,value,damageType,traits})=>{
 const next=copy(card),pending=kind==='die'&&values.length===0;
 const appended=(kind==='die'?(pending?Array(count).fill(null):values):[value]).map((v,i)=>({
  id:`gm-${next.parts.length+i}`,kind,faces,original:v,value:v,pending,excluded:false,
  formula:kind==='die'?`1d${faces}`:`+${v}`,damageType,traits}));
 next.parts.push(...appended);return {next,appended};};
const refreshDamageMessage=()=>{};
"""
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 try:
  page=browser.new_page(viewport={'width':420,'height':640})
  page.set_content('<main></main>')
  page.add_script_tag(content=shim+source)
  page.evaluate("""async () => {
   window.game={user:{id:'gm',isGM:true},i18n:{localize:k=>k.split('.').at(-1)}};
   window.ui={notifications:{error:e=>console.error('Error',e),info:()=>{}}};
   window.Roll=class {constructor(formula){this.formula=formula;}async evaluate(){
     const [count,faces]=this.formula.split('d').map(Number);
     this.dice=[{faces,results:Array.from({length:count},(_,i)=>({result:i%faces+1}))}];
     this.total=count;return this;
   }};
   const card={version:2,parts:[{id:'p0',kind:'die',faces:4,original:2,value:2,formula:'1d4',excluded:false}],
      history:[],revision:0,adjustments:{},naturalD20:9};
   const msg={flags:{'fast-nri-v14':{weaponDamage:card}},id:'test-damage',
      canUserModify(){return true},getFlag(scope,key){return this.flags[scope][key]},
      async update(patch){for(const [k,v] of Object.entries(patch))this.flags['fast-nri-v14'][k.split('.').at(-1)]=v;}};
   window.__msg=msg;
   window.foundry={applications:{api:{DialogV2:{
     input:async (opts)=>{
       const dialog=document.createElement('section');dialog.className='test-dialog';
       dialog.innerHTML=opts.content;
       const done=document.createElement('button');done.className='test-submit';done.textContent='Submit';
       dialog.append(done);document.body.append(dialog);
       let resolve;const pending=new Promise(r=>{resolve=r});
       const app={element:dialog,close:async()=>{dialog.remove();resolve(null)}};
       opts.render?.(null,app);
       done.onclick=()=>{const data=Object.fromEntries([...dialog.querySelectorAll('input[name], select[name]')].
          filter(x=>x.type!=='checkbox'||x.checked).map(x=>[x.name,x.value]));
          dialog.remove();resolve(data);};
       return pending;
     },
     confirm:async()=>true
   }}}};
   window.__editorPromise=openRollEditor(msg);
  }""")
  page.locator('[data-fnri-editor-op="add"]').wait_for()
  assert page.locator('button[disabled]').count()==0
  page.locator('[data-fnri-editor-op="add"]').click()
  page.locator('select[name="kind"]').select_option('fixed')
  assert page.locator('[data-fnri-add-fixed]').is_visible()
  assert not page.locator('[data-fnri-add-dice]').is_visible()
  page.locator('input[name="value"]').fill('-3')
  page.locator('input[name="damageType"]').fill('Огонь')
  page.locator('input[name="traits"]').fill('Святой, Магический')
  page.locator('.test-dialog:has(select[name="kind"]) .test-submit').click()
  page.locator('.fnri-editor-part-row').filter(has_text='-3').wait_for()
  assert 'Огонь' in page.locator('.fnri-editor-part-row').last.inner_text()
  page.locator('input[name="editorSearch"]').fill('Магический')
  assert page.locator('.fnri-editor-part-row').count()==1
  page.locator('input[name="editorSearch"]').fill('')
  page.locator('[data-fnri-editor-op="add"]').click()
  page.locator('input[name="faces"]').fill('8')
  page.locator('input[name="count"]').fill('3')
  page.locator('input[name="damageType"]').fill('Лёд')
  page.locator('input[name="traits"]').fill('Холодный')
  page.locator('.test-dialog:has(select[name="kind"]) .test-submit').click()
  page.locator('.fnri-editor-part-row').filter(has_text='1d8').first.wait_for()
  page.locator('input[name="editorSearch"]').fill('Лёд')
  assert page.locator('.fnri-editor-part-row').count()==3
  assert page.locator('[data-fnri-editor-op="reroll:2"]').count()==0
  assert page.locator('input[data-fnri-editor-select]:checked').count()==3
  page.locator('[data-fnri-editor-op="rerollMarked"]').click()
  page.locator('[data-fnri-editor-op="reroll:2"]').wait_for()
  assert page.locator('button[disabled]').count()==0
  state=page.evaluate("""() => {
    const msg=window.__msg;
    return {parts:msg.getFlag('fast-nri-v14','weaponDamage').parts,
      history:msg.getFlag('fast-nri-v14','weaponDamage').history};
  }""")
  assert len(state['parts'])==5
  assert state['parts'][0]['value']==2
  assert state['parts'][1]['value']==-3
  assert state['parts'][1]['damageType']=='Огонь'
  assert state['parts'][1]['traits']==['Святой','Магический']
  assert [x['value'] for x in state['parts'][2:]]==[1,2,3]
  assert len(state['history'])==3
  assert [x['action'] for x in state['history']]==['add','add','rerollBatch']
  page.evaluate('window.__app?.close?.()') if page.evaluate('!!window.__app') else None
  print('PASS Chromium: add fixed and 3 dice, typing and traits, live search, no disabled buttons, history and original intact')
 finally:browser.close()
