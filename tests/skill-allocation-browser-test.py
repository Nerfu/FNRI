#!/usr/bin/env python3
"""Chromium DOM change events with the real sheet handler and skill allocator.
The Actor and DialogV2 are narrow mocks, not a live Foundry world."""
from pathlib import Path
from browser_test_helpers import load_real_sheet
from playwright.sync_api import expect, sync_playwright
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
  page=browser.new_page(viewport={"width": 390, "height": 730})
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
  page.evaluate('sheet._configurationLocked=false; choose()')
  page.get_by_role('button',name='Мистицизм').click()
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
  # Each basic row has one select for actual pool dice, transfer and manual editing.
  page.evaluate('()=>{window.editorPending=sheetActions.openSkillEditor.call(sheet);}')
  editor=page.locator('[data-skill-editor]')
  editor.wait_for()
  page.add_style_tag(content=(root/'styles/fast-nri.css').read_text())
  body = editor.locator('.fnri-skill-edit-body')
  pool = editor.locator('.fnri-skill-edit-pool')
  medicine = editor.locator('[data-skill-die="medicine"]')
  stealth = editor.locator('[data-skill-die="stealth"]')
  mysticism = editor.locator('[data-skill-die="mysticism"]')
  assert editor.locator('[data-skill-die]').count()==16
  assert editor.locator('.fnri-skill-edit-group').count()==5
  assert editor.locator('[data-skill-custom="specialization"]').locator('[data-row-id="starter_primary"]').count() > 0
  expect(pool).to_contain_text("d6 × 2")
  # Clear the legacy hand-entered override, then take one particular free die.
  medicine.select_option('use-assigned')
  page.wait_for_function("actor.system.skills.core_medicine.dice==='';")
  d6 = medicine.locator('option[value^="assign:free_1"]').get_attribute('value')
  medicine.select_option(d6)
  page.wait_for_function("actor.system.skills.core_medicine.dice==='1d6'")
  expect(pool).to_contain_text("d6 × 1")
  expect(mysticism.locator('option').first).to_have_text("d10")
  assert mysticism.locator('option[value^="assign:"]').count() == 0
  assert mysticism.locator('option[value="release"]').count() == 0

  upgrade = medicine.locator('option[value^="upgrade:"]').first
  assert "d6 → d8" in upgrade.inner_text()
  target = upgrade.get_attribute('value').split(':')[-1]
  medicine.select_option(upgrade.get_attribute('value'))
  page.wait_for_function("actor.system.skills.core_medicine.dice==='1d8'")
  assert "d6 → d8" in medicine.locator('..').inner_text()
  move = stealth.locator('option[value$=":medicine"]').first
  assert "Медицина" in move.inner_text()
  stealth.select_option(move.get_attribute('value'))
  page.wait_for_function("actor.system.skills.core_stealth.dice==='1d8' && actor.system.skills.core_medicine.dice===''")
  assert "d6 → d8" in stealth.locator('..').inner_text()
  assert page.evaluate('result().upgrades.some(u=>u.target==='+repr(target)+')')
  stealth.select_option('release')
  page.wait_for_function("actor.system.skills.core_stealth.dice===''")
  expect(pool).to_contain_text("d8 × 2")

  stealth.select_option(stealth.locator('option[value="assign:free_1:"]').get_attribute('value'))
  page.wait_for_function("actor.system.skills.core_stealth.dice==='1d8'")

  # Manual edits keep the normal allocation, including an inherited class die.
  mysticism.select_option('manual')
  formula = editor.locator('[data-skill-formula="mysticism"]')
  formula.fill('1d12')
  formula.press('Tab')
  page.wait_for_function("actor.system.skills.core_mysticism.dice==='1d12'")
  assert page.evaluate("result().rows.mysticism.die") == 'class_mysticism'
  editor.locator('[data-skill-action="reset"]').click()
  page.wait_for_function("actor.system.skills.core_stealth.dice===''")
  expect(pool).to_contain_text("d8 × 2")
  assert page.evaluate("actor.system.skills.core_mysticism.dice") == '1d12'
  mysticism.select_option('use-assigned')
  page.wait_for_function("actor.system.skills.core_mysticism.dice==='1d10'")
  assert page.evaluate('raw.skills.starter_primary.name')=='Лес'
  pool_y = pool.bounding_box()["y"]
  body.evaluate('(node) => { node.scrollTop = node.scrollHeight; }')
  assert body.evaluate('(node) => node.scrollTop > 0')
  assert pool.bounding_box()["y"] == pool_y
  assert editor.evaluate("(node) => node.scrollWidth <= node.clientWidth + 1")
  page.evaluate('closeDialog()')
  page.evaluate('editorPending')
  print('PASS one die selector, live pool, exact upgraded transfer, release, separate manual edits and specializations')
 finally: browser.close()
