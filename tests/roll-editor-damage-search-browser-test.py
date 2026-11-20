#!/usr/bin/env python3
"""Chromium functional typing: live filter, material type and traits; 603 dice."""
from pathlib import Path
import re
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
source=(root/'module/damage/roll-editor.mjs').read_text()
source=re.sub(r'^import [^\n]+\n','',source,flags=re.MULTILINE)
source=re.sub(r'\bexport (?=(async )?(function|const))','',source)
shims="""
const calculateDamage=card=>({total:card.parts.reduce((a,p)=>a+(p.excluded?0:p.value),0)});
const criticalDamageRule=card=>({triggered:false});
const messageIntervention=msg=>false;
const copy=value=>JSON.parse(JSON.stringify(value));
const changePart=()=>null;
const refreshDamageMessage=()=>{};
"""
with sync_playwright() as p:
  browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  try:
   page=browser.new_page(viewport={'width':390,'height':650})
   page.set_content('<main></main>')
   page.add_script_tag(content=shims+source)
   page.evaluate("""async () => {
     const parts=Array.from({length:603},(_,i)=>({id:`die-${i}`,kind:'die',faces:6,
       value:4,original:4,formula:'1d6',excluded:false,
       damageType:i%2?'Лёд':'Огонь',traits:i%3===0?['Святой']:['Обычный']}));
     const state={version:2,parts,history:[],adjustments:{},naturalD20:12};
     window.game={user:{id:'gm',isGM:true},i18n:{localize:k=>k.split('.').at(-1)}};
     window.ui={notifications:{error:console.error,info:console.info}};
     const msg={flags:{'fast-nri-v14':{weaponDamage:state}},getFlag(s,k){return this.flags[s][k];},
       canUserModify(){return true;},async update(patch){for(const [k,v] of Object.entries(patch))this.flags['fast-nri-v14'][k.split('.').at(-1)]=v;}};
     window.__msg=msg;
     window.foundry={applications:{api:{DialogV2:{
       input:async ({content,render})=>{
         const container=document.createElement('div');container.className='dialog-container';
         container.innerHTML=content;document.body.append(container);
         let resolve;
         const pending=new Promise(r=>resolve=r);
         const app={element:container,close:async()=>{container.remove();resolve(null)}};
         window.__app=app;
         render?.(null,app);
         return pending;
       }
     }}}};
     window.__editorPromise=openRollEditor(msg);
   }""")
   page.locator('input[name="editorSearch"]').wait_for()
   page.locator('input[name="intervention"]').check()
   page.locator('input[name="critical"]').check()
   field=page.locator('input[name="editorSearch"]')
   field.fill('огонь')
   assert page.locator('.fnri-editor-part-row').count()==20
   assert '302' in page.locator('.fnri-editor-page-info').inner_text()
   assert page.locator('input[name="editorSearch"]').evaluate('(el)=>el===document.activeElement'),'focus preserved'
   assert page.locator('input[name=intervention]').is_checked()
   assert page.locator('input[name=critical]').is_checked()
   field.fill('святой')
   assert page.locator('.fnri-editor-part-row').count()==20
   assert '201' in page.locator('.fnri-editor-page-info').inner_text()
   assert page.locator('input[name="editorSearch"]').evaluate('(el)=>el===document.activeElement')
   assert page.locator('.fnri-editor-part-heading').first.inner_text().find('Святой')!=-1
   field.fill('#500')
   assert page.locator('.fnri-editor-part-row').count()==1
   assert page.locator('[data-fnri-editor-op="set:499"]').count()==1
   assert page.locator('[data-fnri-editor-nav="next"]').count()==0
   field.fill('лёд')
   assert '301' in page.locator('.fnri-editor-page-info').inner_text()
   page.locator('[data-fnri-editor-nav="next"]').click()
   assert '2/16' in page.locator('.fnri-editor-page-info').inner_text()
   assert page.locator('input[name=intervention]').is_checked()
   assert page.locator('input[name=critical]').is_checked()
   page.locator('[data-fnri-editor-nav="clear"]').click()
   assert page.locator('input[name=editorSearch]').input_value()==''
   assert '603' in page.locator('.fnri-editor-page-info').inner_text()
   assert page.locator('[data-fnri-editor-nav="search"]').count()==0
   page.evaluate('window.__app.close()')
   print('PASS Chromium: live search 603 dice, type/trait/#500, page navigation, focus, checked flags, clear without mutation')
  finally:browser.close()
