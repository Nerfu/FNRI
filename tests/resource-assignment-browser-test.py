#!/usr/bin/env python3
"""Actual resource partial and sheet handlers in Chromium; local Foundry shim."""
from pathlib import Path
from ast import parse, literal_eval
from browser_test_helpers import load_real_sheet, renderer
from playwright.sync_api import expect,sync_playwright
root=Path(__file__).resolve().parents[1]
# Reuse the existing restricted Handlebars renderer and document mock, not a live server.
source=parse((root/'tests/skill-allocation-browser-test.py').read_text())
values={node.targets[0].id:literal_eval(node.value) for node in source.body if isinstance(node,__import__('ast').Assign) and len(node.targets)==1 and isinstance(node.targets[0],__import__('ast').Name) and node.targets[0].id in ('shim','html')}
partial=(root/'templates/actor-resource.hbs').read_text()
for actor_type in ('character','npc'):
 assert '{{> fnri-actor-resource}}' in (root/'templates'/f'{actor_type}.hbs').read_text()
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 try:
  page=browser.new_page(viewport={'width':440,'height':730})
  load_real_sheet(page,root,values['html'],values['shim'])
  page.add_script_tag(content=renderer)
  page.add_style_tag(content=(root/'styles/fast-nri.css').read_text())
  page.evaluate('(partial)=>window.partial=partial',partial)
  page.evaluate('''async()=>{
    const {FastNRINPCSheet}=await import('fnri/module/sheets/sheets.mjs');
    const {initialSkillEntries}=await import('fnri/module/data/skills-catalog.mjs');
    const {initialSkillAllocation}=await import('fnri/module/data/skill-allocation.mjs');
    window.raw={className:'Колдун',classTradition:'mysticism',skills:initialSkillEntries(),skillAllocation:initialSkillAllocation(),equipment:{},equipmentSlots:{},resources:{mana:{name:'Mana',current:2,max:4,kind:'',resourceKey:''}}};
    window.reprepare=()=>{actor.system=structuredClone(raw);actor.system.resources.mana.max=6;actor.system.parent=actor;};
    reprepare();
    window.paint=async()=>{const ctx=await sheet._prepareContext({});sheet.element.querySelector('.window-content').innerHTML=renderSkill('{{#each resourceRows}}'+partial+'{{/each}}',ctx);await sheet._onRender({},{});};
    sheet._configurationLocked=true;
    sheet.element.addEventListener('click',event=>{const b=event.target.closest('[data-action]');if(b&&sheetActions[b.dataset.action]){event.preventDefault();void sheetActions[b.dataset.action].call(sheet,event,b);}});
    window.switchNPC=async()=>{actor.type='npc';sheet=new FastNRINPCSheet({actor});sheet._configurationLocked=true;await paint()};
    await paint();
  }''')
  lock=page.locator('[data-action="toggleSheetLock"]')
  assignment=page.locator('[data-row-field="assignment"]')
  current=page.locator('[data-row-field="current"]')
  maximum=page.locator('[data-row-field="max"]')
  expect(assignment).to_be_hidden();expect(maximum).to_be_hidden();expect(current).to_be_enabled()
  expect(page.locator('.fnri-resource-read-only')).to_have_text('6')
  lock.click();expect(assignment).to_be_visible();expect(maximum).to_have_value('4')
  assignment.select_option('class_magic');page.wait_for_function("raw.resources.mana.kind==='class' && raw.resources.mana.resourceKey==='class_magic'")
  expect(assignment).to_have_value('class_magic')
  name=page.locator('[data-row-field="name"]');name.fill('Переименован');name.press('Tab');page.wait_for_function("raw.resources.mana.name==='Переименован'")
  assert page.evaluate("raw.resources.mana.resourceKey==='class_magic' && raw.resources.mana.max===4")
  lock.click();expect(assignment).to_be_hidden();expect(current).to_be_enabled();page.locator('[data-delta="1"]').click();page.wait_for_function('raw.resources.mana.current===3')
  page.evaluate('switchNPC()');expect(assignment).to_be_hidden();expect(current).to_be_enabled();lock.click();expect(assignment).to_be_visible()
  assignment.select_option('intervention');page.wait_for_function("raw.resources.mana.kind==='intervention' && raw.resources.mana.resourceKey==='' ")
  expect(assignment).to_have_value('intervention');assert page.evaluate('raw.resources.mana.max===4 && raw.resources.mana.current===3')
  print('PASS shared PC/NPC resource partial, lock, effective maximum, explicit assignment, rename, manual adjustment')
 finally:browser.close()
