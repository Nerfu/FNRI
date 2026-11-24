#!/usr/bin/env python3
"""Chromium DOM change events with the real sheet handler and skill allocator.
The Actor and DialogV2 are narrow mocks, not a live Foundry world."""
from pathlib import Path
from browser_test_helpers import load_real_sheet
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
html='''<section id="sheet">
<select data-fnri-dice-picker="skill" data-row-id="core_medicine"><option value="">—</option><option value="1d6">d6</option><option value="1d12">d12</option></select>
<input data-fnri-custom-dice data-row-collection="skills" data-row-id="core_medicine" data-row-field="dice" hidden>
</section><section id="dialog"></section>'''
shim='''
window.game={i18n:{localize:k=>k},user:{}};
window.ui={notifications:{warn:()=>{},error:()=>{}}};
class Sheet{constructor({actor}){this.actor=actor;this.isEditable=true;this.element=document.querySelector('#sheet');}async _onRender(){} async _prepareContext(){return {}}}
window.foundry={applications:{api:{HandlebarsApplicationMixin:p=>p,DialogV2:{wait:cfg=>new Promise(resolve=>{
 const el=document.querySelector('#dialog');el.innerHTML=cfg.content;window.closeDialog=()=>{el.innerHTML='';resolve(null)};cfg.render({}, {element:el,close:window.closeDialog});
})}},sheets:{ActorSheetV2:Sheet,ItemSheetV2:class{}}}};
window.actor={type:'character',system:{skills:{}},items:{contents:[]},effects:{contents:[]},getFlag:()=>null,
 toObject:()=>({system:structuredClone(window.raw)}),async update(changes){
  for(const [k,v] of Object.entries(changes)){const parts=k.split('.').slice(1);let dest=window.raw;while(parts.length>1){const p=parts.shift();dest=dest[p]??={};}dest[parts[0]]=v;}
  window.reprepare();
 }};
'''
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 try:
  page=browser.new_page()
  load_real_sheet(page,root,html,shim)
  page.evaluate('''async()=>{
   const {initialSkillEntries}=await import('fnri/module/data/skills-catalog.mjs');
   const {initialSkillAllocation,prepareSkillAllocation,resolveSkillAllocation}=await import('fnri/module/data/skill-allocation.mjs');
   window.raw={className:'Колдун',classTradition:'',skills:initialSkillEntries(),skillAllocation:initialSkillAllocation()};
   raw.skills.starter_primary.name='Лес';
   window.reprepare=()=>{actor.system=structuredClone(raw);actor.system.parent=actor;prepareSkillAllocation(actor.system);};
   window.result=()=>resolveSkillAllocation(raw,actor.items.contents);reprepare();
   actor.items.contents.push({id:'advanced',name:'Продвинутый',type:'ability',system:{mechanics:{
     racialProperty:{races:['human']},skillDice:{upgrades:[6,8]}}}});

   window.choose=()=>{window.pending=sheetActions.chooseTradition.call(sheet);};
  }''')
  page.evaluate('choose()')
  page.get_by_role('button',name='Мистика').click()
  page.evaluate('pending')
  assert page.evaluate('raw.classTradition')=='mysticism'
  assert page.evaluate('actor.system.skills.core_mysticism.dice')=='1d10'
  select=page.locator('[data-fnri-dice-picker]')
  select.select_option('1d6')
  page.wait_for_function("actor.system.skills.core_medicine.dice==='1d6'")
  assert page.evaluate('result().free.length')==2
  assert page.evaluate('raw.skills.core_medicine.dice')==''
  select.select_option('1d12')
  page.wait_for_function("actor.system.skills.core_medicine.dice==='1d12'")
  assert page.evaluate("result().warnings.some(w=>w.code==='manualOverride')")
  assert page.evaluate('result().free.length')==3
  # The final PC editor is an independent DialogV2 with live dice buttons.
  page.evaluate('()=>{window.editorPending=sheetActions.openSkillEditor.call(sheet);}')
  editor=page.locator('[data-skill-editor]')
  editor.wait_for()
  page.add_style_tag(content=(root/'styles/fast-nri.css').read_text())
  assert editor.locator('.fnri-skill-edit-row').count()==15
  assert editor.locator('.fnri-skill-edit-group').count()==4
  assert not editor.locator('.fnri-skill-edit-formula').first.is_visible()
  editor.locator('[data-skill-manual]').check()
  assert editor.locator('.fnri-skill-edit-formula').first.is_visible()
  editor.locator('[data-skill-manual]').uncheck()
  editor.locator('[data-skill-action="die"][data-id="core_medicine"][data-die="1d6"]').click()
  page.wait_for_function("actor.system.skills.core_medicine.dice==='1d6'")
  upgrade = editor.locator('[data-skill-upgrade]').first
  assert "d6 → d8" in upgrade.locator('..').inner_text()
  target = upgrade.locator('option').filter(has_text='Медицина').get_attribute('value')
  upgrade.select_option(target)
  page.wait_for_function("actor.system.skills.core_medicine.dice==='1d8'")
  assert upgrade.input_value() == target
  upgrade.select_option('')
  page.wait_for_function("actor.system.skills.core_medicine.dice==='1d6'")
  editor.locator('[data-skill-action="die"][data-id="core_medicine"][data-die="1d6"]').click()
  page.wait_for_function("actor.system.skills.core_medicine.dice==='' ")
  editor.locator('[data-skill-action="die"][data-id="core_medicine"][data-die="1d12"]').click()
  page.wait_for_function("actor.system.skills.core_medicine.dice==='1d12'")
  editor.locator('[data-skill-action="reset"]').click()
  page.wait_for_function("actor.system.skills.core_medicine.dice==='' ")
  assert page.evaluate('actor.system.skills.core_medicine.dice')==''
  assert page.evaluate('actor.system.skills.core_mysticism.dice')=='1d10'
  assert page.evaluate('raw.skills.starter_primary.name')=='Лес'
  page.evaluate('closeDialog()')
  page.evaluate('editorPending')
  print('PASS separate skill dialog, actual sheet handler, tradition popup, source-based preset, manual warning, reset preserves mandatory and specialization')
 finally: browser.close()
