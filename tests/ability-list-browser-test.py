#!/usr/bin/env python3
"""Actual shared ability template and sheet handlers; Foundry document APIs mocked."""
from pathlib import Path
from browser_test_helpers import load_real_sheet, renderer
from playwright.sync_api import sync_playwright, expect
root=Path(__file__).resolve().parents[1]
partial=(root/'templates/actor-abilities.hbs').read_text()
for name in ('character','npc'):
    assert '{{> fnri-actor-abilities}}' in (root/'templates'/f'{name}.hbs').read_text()
html='''<div class="application fast-nri-v14 fast-nri-sheet" id="sheet"><button data-action="toggleSheetLock">Lock</button><div class="window-content" style="height:450px;overflow:auto"></div></div>'''
shim='''
window.opened=[];window.created=[];window.deleted=[];window.actor={id:'a',type:'character',system:{skills:{},equipment:{},equipmentSlots:{}},items:{contents:[],get(id){return this.contents.find(i=>i.id===id)},has(id){return !!this.get(id)}},effects:{contents:[]},getFlag:()=>null};
window.game={user:{},i18n:{localize:k=>k},settings:{get:()=> 'public'}};window.ui={notifications:{warn:console.warn,error:console.error}};
class Sheet{constructor({actor}){this.actor=actor;this.element=document.querySelector('#sheet');this.isEditable=true;}async _onRender(){}async _prepareContext(){return {}}}
window.foundry={applications:{api:{HandlebarsApplicationMixin:p=>p,DialogV2:{confirm:async()=>true}},sheets:{ActorSheetV2:Sheet,ItemSheetV2:class{}}}};
window.add=(id,name,type='ability',extra={})=>{const item={id,name,type,img:'',sort:0,system:{},getFlag:()=>null,sheet:{render:async()=>opened.push(id)},...extra};actor.items.contents.push(item);return item;};
add('a1','Very long ability name with several distinct real actions that should wrap without widening the window');add('a2','Manual ability');
actor.createEmbeddedDocuments=async(_type,docs)=>{const result=docs.map(d=>{const id='new'+created.length;created.push(id);return add(id,d.name,d.type)});await paint();return result;};
actor.deleteEmbeddedDocuments=async(_type,ids)=>{deleted.push(...ids);actor.items.contents=actor.items.contents.filter(x=>!ids.includes(x.id));await paint();};
actor.update=async()=>{};
'''
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 try:
  page=browser.new_page(viewport={'width':360,'height':650})
  load_real_sheet(page,root,html,shim)
  page.add_script_tag(content=renderer)
  page.add_style_tag(content=(root/'styles/fast-nri.css').read_text())
  page.evaluate('source=>window.abilityTemplate=source',partial)
  page.evaluate('''async()=>{
    sheet._selectedTab='abilities';
    window.paint=async()=>{const rows=actor.items.contents.filter(i=>i.type==='ability').map(i=>({id:i.id,name:i.name,img:i.img,abilitySource:{label:i.id==='a1'?'Колдун':null},hasRollFormula:i.id==='a1',doubleInvocation:i.id==='a1',grantedAction:i.id==='a1'?'attacks':null}));
      const ctx={editable:sheet.isEditable,abilityItems:rows};
      sheet.element.querySelector('.window-content').innerHTML='<div data-fnri-panel="abilities">'+renderSkill(abilityTemplate,ctx)+'</div>';await sheet._onRender({},{});};
    sheet.element.addEventListener('click',event=>{const b=event.target.closest('[data-action]');if(b&&sheetActions[b.dataset.action]){event.preventDefault();void sheetActions[b.dataset.action].call(sheet,event,b);}});
    await paint();
  }''')
  edit=page.locator('.fnri-ability-edit');panel=page.locator('.fnri-abilities');row=page.locator('[data-item-id="a1"]');remove=page.locator('[data-item-id="a2"] [data-action="deleteItem"]')
  assert row.count()==1 and row.locator('small').inner_text()=='Колдун'
  assert page.locator('[data-item-id="a2"] small').count()==0
  assert row.locator('.fnri-ability-actions button').count()==4
  expect(remove).to_be_hidden();expect(edit).to_be_visible()
  for theme in ('theme-light','theme-dark'):
   page.evaluate('t=>document.body.className=t',theme)
   for width in (360,420,760):
    page.set_viewport_size({'width':width,'height':650})
    assert row.evaluate('e=>e.scrollWidth<=e.clientWidth+1')
    assert row.locator('[data-action="openGrantedAction"]').is_visible()
  row.locator('[data-action="openItem"]').click();page.wait_for_function("opened.join()==='a1'")
  edit.click();expect(remove).to_be_visible();expect(row.locator('.fnri-ability-actions')).to_be_hidden()
  page.locator('[data-action="createItem"][data-type="ability"]').click();page.wait_for_function('created.length===1')
  expect(page.locator('[data-item-id="new0"]')).to_be_visible();assert page.evaluate("opened.join()==='a1'")
  assert page.evaluate('sheet._selectedTab')=='abilities';expect(remove).to_be_visible()
  remove.click();page.wait_for_function("deleted.join()==='a2'");expect(page.locator('[data-item-id="a2"]')).to_have_count(0)
  page.locator('[data-fnri-ability-editor] [data-action="toggleAbilityList"]').click();expect(edit).to_be_visible();expect(row.locator('.fnri-ability-actions')).to_be_visible()
  edit.click();page.locator('[data-action="toggleSheetLock"]').click();expect(edit).to_be_hidden();expect(row.locator('.fnri-ability-actions')).to_be_visible()
  page.evaluate("async()=>{sheet.isEditable=false;await paint()}");expect(page.locator('.fnri-ability-edit')).to_have_count(0);expect(page.locator('[data-action="deleteItem"]')).to_have_count(0);expect(row.locator('[data-action="openItem"]')).to_be_visible()
 finally:browser.close()
print('PASS: shared ability list, source, no duplicate rows, real name open, create without open, remove, lock, read-only, narrow layout')
