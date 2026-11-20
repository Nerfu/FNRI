#!/usr/bin/env python3
"""Long damage roll rendering: 603 dice, compact pages, mobile widths, original indexes."""
from pathlib import Path
from subprocess import check_output
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
node='''import {renderRollEditorContent} from './module/damage/roll-editor.mjs';
globalThis.game={user:{id:'gm',isGM:true},i18n:{localize:k=>k.split('.').at(-1)}};
const parts=Array.from({length:603},(_,i)=>({id:'die-'+i,kind:'die',faces:6,value:4,original:4,formula:'1d6'}));
const card={version:2,parts,adjustments:{},history:[],naturalD20:12};
const msg={getFlag:(_scope,key)=>key==='weaponDamage'?card:null};
for(const state of [{page:0},{page:30},{query:'#500',interventionDraft:true,criticalDraft:true}])
 console.log('SPLIT_MARKER'+JSON.stringify(state)+'HTML_BEGIN'+renderRollEditorContent(msg,state)+'HTML_END');'''
output=check_output(['node','--input-type=module','--eval',node],cwd=root,text=True)
htmls={}
for section in output.split('SPLIT_MARKER')[1:]:
 state,rest=section.split('HTML_BEGIN',1)
 htmls[state]=rest.split('HTML_END',1)[0]
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 try:
  for width in (360,420,900):
   page=browser.new_page(viewport={'width':width,'height':650})
   page.set_content('<main style="max-width:440px"><form>'+list(htmls.values())[0]+'</form></main>')
   page.add_style_tag(content=(root/'styles/fast-nri.css').read_text())
   assert page.locator('.fnri-editor-part-row').count()==20
   assert page.locator('[data-fnri-editor-nav="next"]').count()==1
   assert page.locator('[data-fnri-editor-nav="prev"]').count()==0
   assert page.locator('input[type=radio]').count()==0
   assert page.locator('input[type=number]').count()==0
   assert page.locator('button[disabled]').count()==0
   assert page.locator('.fnri-editor-parts-list').evaluate('(e)=>e.scrollHeight > e.clientHeight'), f'rows should scroll at {width}'
   assert page.locator('.fnri-editor-parts-list').evaluate('(e)=>e.clientHeight <= 380'), 'list must be height capped'
   assert page.locator('input[name=intervention]').count()==1
   assert page.locator('input[name=critical]').count()==1
   assert not page.locator('.fnri-roll-editor').evaluate('(e)=>e.scrollWidth > e.clientWidth + 5'), 'no horizontal overflow'
   page.close()
  page=browser.new_page(viewport={'width':360,'height':650})
  page.set_content('<form>'+list(htmls.values())[1]+'</form>')
  assert page.locator('.fnri-editor-part-row').count()==3
  assert page.locator('[data-fnri-editor-op="reroll:602"]').count()==1
  assert page.locator('[data-fnri-editor-nav="prev"]').count()==1
  assert page.locator('[data-fnri-editor-nav="next"]').count()==0
  page.set_content('<form>'+list(htmls.values())[2]+'</form>')
  assert page.locator('.fnri-editor-part-row').count()==1
  assert page.locator('[data-fnri-editor-op="set:499"]').count()==1
  assert page.locator('input[name=intervention]').is_checked()
  assert page.locator('input[name=critical]').is_checked()
  print('PASS Chromium: 603 dice, 20-row pages, narrow viewport, scroll, last page, search, checkboxes')
 finally:browser.close()
