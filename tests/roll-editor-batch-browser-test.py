#!/usr/bin/env python3
"""GM batch selection UI for 603 pending dice, filtered navigation and mobile."""
from pathlib import Path
from subprocess import check_output
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
js=r'''import {renderRollEditorContent} from './module/damage/roll-editor.mjs';
globalThis.game={user:{id:'gm',isGM:true},i18n:{localize:k=>k.split('.').at(-1)}};
const parts=[{id:'initial',kind:'die',faces:4,value:2,original:2,excluded:false,formula:'1d4'},
 ...Array.from({length:603},(_,i)=>({id:'gm-'+(i+1),kind:'die',faces:6,value:null,original:null,pending:true,excluded:false,formula:'1d6',damageType:'огонь',traits:['святой']}))];
const card={version:2,parts,adjustments:{},history:[],naturalD20:12};
const msg={getFlag:(_s,k)=>k==='weaponDamage'?card:null};
for(const c of [{page:0},{query:'#500',selectedIds:new Set(['gm-499'])},{page:30,selectedIds:new Set(['gm-600'])}])
 console.log('PART_SPLIT'+renderRollEditorContent(msg,c)+'PART_END');'''
out=check_output(['node','--input-type=module','--eval',js],cwd=root,text=True)
htmls=[v.split('PART_END')[0] for v in out.split('PART_SPLIT')[1:]]
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 try:
  for width in (360,420,900):
   pg=b.new_page(viewport={'width':width,'height':700})
   pg.set_content('<main style="max-width:440px"><form>'+htmls[0]+'</form></main>')
   pg.add_style_tag(content=(root/'styles/fast-nri.css').read_text())
   assert pg.locator('.fnri-editor-part-row').count()==20
   assert pg.locator('.fnri-editor-part-pick input:checked').count()==19  # 19 newly-added dice on page 1
   assert pg.locator('.fnri-editor-bulk-buttons button').count()==3
   assert pg.locator('button[disabled]').count()==0
   assert 'rerollMarked' in pg.locator('.fnri-editor-bulk').inner_html()
   assert pg.locator('.fnri-roll-editor').evaluate('(e)=>e.scrollWidth<=e.clientWidth+5')
   pg.close()
  pg=b.new_page(viewport={'width':360,'height':700})
  pg.set_content('<form>'+htmls[1]+'</form>')
  assert pg.locator('.fnri-editor-part-row').count()==1
  assert pg.locator('.fnri-editor-part-pick input:checked').count()==1
  assert pg.locator('.fnri-editor-bulk').inner_text().find('1')>=0
  pg.set_content('<form>'+htmls[2]+'</form>')
  assert pg.locator('.fnri-editor-part-row').count()==4
  assert pg.locator('.fnri-editor-part-pick input:checked').count()==1
  assert pg.locator('[data-fnri-editor-nav="next"]').count()==0
  assert pg.locator('[data-fnri-editor-nav="prev"]').count()==1
  assert pg.locator('button[disabled]').count()==0
  pg.close()
  print('PASS Chromium: 603 pending dice, auto-selected, 20 rows, bulk controls, filtered IDs and mobile width')
 finally:b.close()
