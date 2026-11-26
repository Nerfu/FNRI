#!/usr/bin/env python3
"""Chromium: actual skill panel templates and real sheet handlers.
Foundry document updates and template rendering are narrow local mocks.
"""
from pathlib import Path
import json
from browser_test_helpers import load_real_sheet, renderer
from playwright.sync_api import expect, sync_playwright
root=Path(__file__).resolve().parents[1]
# Render the Handlebars subset used by the actual skill panels (no Foundry runtime).
# Keep template tokens, contexts and partials identical to the shipped sources.
templates={name:(root/'templates'/f'{name}.hbs').read_text() for name in ('actor-core-skill','actor-custom-skill','actor-standard-action')}
for name in ('character','npc'):
    s=(root/'templates'/f'{name}.hbs').read_text()
    templates[name]=s[s.index('<div class="fnri-tab-content" data-fnri-panel="skills"'):s.index('<div class="fnri-tab-content" data-fnri-panel="abilities"')]
    assert 'openSkillEditor' not in templates[name]
html='''<section id="sheet" class="fast-nri-v14 fast-nri-sheet"><button data-action="toggleSheetLock">Lock</button><div class="window-content" style="height:560px;overflow:auto"></div></section><section id="dialog"></section>'''
shim='''
window.mode='strict';window.game={i18n:{localize:k=>k},user:{},settings:{get:(s,k)=>k==='skillAllocationMode'?window.mode:'public'}};
window.ui={notifications:{warn:console.warn,error:console.error}};
class Sheet{constructor({actor}){this.actor=actor;this.isEditable=true;this.element=document.querySelector('#sheet');}async _onRender(){} async _prepareContext(){return {}}}
window.foundry={utils:{randomID:()=> 'newSpec'},applications:{api:{HandlebarsApplicationMixin:p=>p,DialogV2:{wait:cfg=>new Promise(resolve=>{
 const el=document.querySelector('#dialog');el.innerHTML=cfg.content;window.closeDialog=()=>{el.innerHTML='';resolve(null)};cfg.render({}, {element:el,close:window.closeDialog});
})}},sheets:{ActorSheetV2:Sheet,ItemSheetV2:class{}}}};
window._del=Symbol('delete');
window.actor={id:'elf',uuid:'Actor.elf',type:'character',system:{skills:{}},items:{contents:[]},effects:{contents:[]},getFlag:()=>null,
 toObject:()=>({system:structuredClone(window.raw)}),async update(changes){
  for(const [k,v] of Object.entries(changes)){const parts=k.split('.').slice(1);let dest=window.raw;while(parts.length>1){const p=parts.shift();dest=dest[p]??={};}if(v===_del)delete dest[parts[0]];else dest[parts[0]]=v;}
  window.reprepare();await window.paint();
 }};
'''

with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 try:
  page=browser.new_page(viewport={'width':420,'height':730})
  load_real_sheet(page,root,html,shim)
  page.evaluate('(templates)=>window.templates=templates',templates)
  page.add_script_tag(content=renderer)
  page.add_style_tag(content=(root/'styles/fast-nri.css').read_text())
  page.evaluate('''async()=>{
   const {initialSkillEntries}=await import('fnri/module/data/skills-catalog.mjs');
   const {initialSkillAllocation,prepareSkillAllocation,resolveSkillAllocation}=await import('fnri/module/data/skill-allocation.mjs');
   window.raw={className:'Колдун',classTradition:'mysticism',skills:initialSkillEntries(),skillAllocation:initialSkillAllocation(),equipment:{},equipmentSlots:{},resources:{}};
   raw.skills.starter_primary={name:'Лес',kind:'specialization',dice:'1d6'};
   window.reprepare=()=>{actor.system=structuredClone(raw);actor.system.parent=actor;if(actor.type==='character')prepareSkillAllocation(actor.system);};
   window.result=()=>resolveSkillAllocation(raw,actor.items.contents);reprepare();
   actor.items.contents.push({id:'advanced',name:'Продвинутый',type:'ability',getFlag:()=>null,system:{mechanics:{racialProperty:{races:['human']},skillDice:{upgrades:[6,8]}}}});
   sheet._selectedTab='skills';sheet._configurationLocked=true;
   window.paint=async()=>{const ctx=await sheet._prepareContext({});sheet.element.querySelector('.window-content').innerHTML=renderSkill(templates.character,ctx);await sheet._onRender({},{});};
   sheet.element.addEventListener('click',event=>{const b=event.target.closest('[data-action]');if(b&&sheetActions[b.dataset.action]){event.preventDefault();void sheetActions[b.dataset.action].call(sheet,event,b);}});
   await paint();
  }''')
  panel=page.locator('[data-fnri-panel="skills"]');lock=page.locator('[data-action="toggleSheetLock"]')
  pool=panel.locator('.fnri-skill-edit-pool');medicine=panel.locator('[data-skill-die="medicine"]');stealth=panel.locator('[data-skill-die="stealth"]');mysticism=panel.locator('[data-skill-die="mysticism"]');summary=panel.locator('[data-allocation-complete]')
  assert panel.locator('[data-skill-die]').count()==16 and panel.locator('.fnri-core-skills .fnri-skill-group').count()==5
  expect(pool).to_be_hidden();expect(summary).to_be_hidden();expect(medicine).to_be_hidden();expect(panel.locator('[data-action="rollSkill"][data-id="core_medicine"]')).to_be_enabled()
  expect(panel.locator('[data-fnri-skill-filter]')).to_have_count(0);expect(panel.locator('[data-skill-row="core_medicine"]')).to_be_visible()
  lock.click();expect(medicine).to_be_visible();expect(pool).to_contain_text('d6 × 2');expect(summary).to_be_visible()
  medicine.select_option('nominal:6')
  page.wait_for_function("actor.system.skills.core_medicine.dice==='1d6'");expect(pool).to_contain_text('d6 × 1')
  expect(mysticism.locator('option').first).to_have_text('d10');assert mysticism.locator('option[value^="nominal:"]').count()==0
  target=page.evaluate('result().rows.medicine.die')
  upgrade=panel.locator('[data-skill-upgrade]').filter(has=page.locator(f'option[value="{target}"]')).first
  upgrade.select_option(target)
  page.wait_for_function("actor.system.skills.core_medicine.dice==='1d8'")
  assert stealth.locator('option[value*=":medicine"]').count()==0
  panel.locator('[data-skill-row="core_medicine"] [data-skill-release]').click();page.wait_for_function("actor.system.skills.core_medicine.dice===''")
  stealth.select_option('nominal:8')
  page.wait_for_function("actor.system.skills.core_stealth.dice==='1d8' && actor.system.skills.core_medicine.dice==='' ")
  assert page.evaluate('result().upgrades.some(u=>u.target==='+repr(target)+')')
  assert page.evaluate("result().free.some(d=>d.id==="+repr(target)+")")
  stealth.select_option('release');page.wait_for_function("actor.system.skills.core_stealth.dice==='' ");expect(pool).to_contain_text('d8 × 2')
  page.evaluate("async()=>{mode='free';await paint()}")
  mysticism.select_option('manual');formula=panel.locator('[data-skill-formula="mysticism"]');expect(formula).to_be_visible();formula.fill('1d12');formula.press('Tab');page.wait_for_function("actor.system.skills.core_mysticism.dice==='1d12'")
  assert page.evaluate("result().rows.mysticism.die")=='class_mysticism';expect(summary.locator('.fnri-skill-distribution-warnings')).to_have_count(0)
  page.evaluate("async()=>{mode='warning';await paint()}");expect(summary.locator('.fnri-skill-distribution-warnings')).to_be_visible();assert mysticism.locator('option[value=manual]').count()==0
  page.evaluate("async()=>{mode='free';await paint()}")
  panel.locator('[data-skill-use-assigned="mysticism"]').click();page.wait_for_function("actor.system.skills.core_mysticism.dice==='1d10'")
  panel.locator('[data-action="addSpecialization"][data-group="physical"]').click();page.wait_for_function("raw.skills.newSpec?.group==='physical'")
  row=panel.locator('[data-skill-row="newSpec"]');expect(row).to_be_visible();name=row.locator('[data-row-field="name"]');name.fill('Акробат');name.press('Tab');page.wait_for_function("raw.skills.newSpec.name==='Акробат'")
  row.locator('[data-fnri-single-dice]').select_option('1d4');page.wait_for_function("raw.skills.newSpec.dice==='1d4'")
  expect(row.locator('[data-row-field="group"]')).to_have_count(0)
  expect(panel.locator('[data-fnri-skill-group-content="physical"] [data-skill-row="newSpec"]')).to_be_visible()
  lock.click();expect(pool).to_be_hidden();expect(summary).to_be_hidden();expect(row.locator('[data-fnri-single-dice]')).to_be_hidden();expect(row.locator('[data-action="rollSkill"]')).to_be_enabled();expect(panel.locator('[data-skill-row="core_medicine"]')).to_be_visible()
  lock.click();expect(medicine).to_be_visible();row.locator('[data-action="removeSkill"]').click();page.wait_for_function("!raw.skills.newSpec")
  # S.2: existing ungrouped specialization keeps ID/formula; group assignment is explicit.
  page.evaluate("async()=>{mode='strict';await paint()}")
  legacy=panel.locator('[data-skill-row="starter_primary"]')
  expect(legacy.locator('[data-row-field="group"]')).to_be_visible()
  legacy.locator('[data-row-field="group"]').select_option('field')
  page.wait_for_function("raw.skills.starter_primary.group==='field'")
  expect(panel.locator('[data-fnri-skill-group-content="field"] [data-skill-row="starter_primary"]')).to_be_visible()
  expect(legacy.locator('[data-row-field="group"]')).to_have_count(0)
  assert page.evaluate("raw.skills.starter_primary.dice==='1d6'")
  # 0 -> 1 -> 2 actual clicks using unique IDs, no automatic starter rows.
  page.evaluate("async()=>{delete raw.skills.starter_primary;window.specSeq=0;foundry.utils.randomID=()=>`spec${++specSeq}`;reprepare();await paint()}")
  buttons=panel.locator('[data-action="addSpecialization"]');expect(buttons).to_have_count(5)
  panel.locator('[data-action="addSpecialization"][data-group="physical"]').click()
  page.wait_for_function("raw.skills.spec1?.group==='physical'");expect(buttons).to_have_count(5)
  panel.locator('[data-action="addSpecialization"][data-group="magical"]').click()
  page.wait_for_function("raw.skills.spec2?.group==='magical'");expect(buttons).to_have_count(0)
  expect(panel.locator('[data-spec-warning="specUnnamed"]')).to_be_visible()
  for id,name,die in [('spec1','Лес','1d6'),('spec2','Руны','1d4')]:
   item=panel.locator(f'[data-skill-row="{id}"]');expect(item.locator('[data-row-field="group"]')).to_have_count(0)
   assert item.locator('[data-fnri-single-dice] option').count()==3
   item.locator('[data-row-field="name"]').fill(name);item.locator('[data-row-field="name"]').press('Tab')
   page.wait_for_function(f"raw.skills.{id}.name==='{name}'")
   item.locator('[data-fnri-single-dice]').select_option(die);page.wait_for_function(f"raw.skills.{id}.dice==='{die}'")
  expect(panel.locator('[data-spec-warning]')).to_have_count(0)
  for width in (360,420,760):
   page.set_viewport_size({'width':width,'height':730})
   for theme in ('theme-light','theme-dark'):
    page.evaluate('(theme)=>document.documentElement.className=theme',theme)
    for id in ('spec1','spec2'):
     item=panel.locator(f'[data-skill-row="{id}"]')
     assert item.evaluate("n=>{const [a,b,c]=n.children;return a.getBoundingClientRect().right<=b.getBoundingClientRect().left && b.getBoundingClientRect().right<=c.getBoundingClientRect().left && n.scrollWidth<=n.clientWidth+1}")
  page.set_viewport_size({'width':420,'height':730})
  # Effective die differs without changing the base validation.
  page.evaluate("async()=>{actor.system.skills.spec1.dice='1d8';await paint()}")
  expect(panel.locator('[data-spec-warning]')).to_have_count(0)
  page.evaluate("async()=>{raw.skills.saved={name:'Мореходство',kind:'skill',dice:'2d6'};reprepare();await paint()}")
  expect(panel.locator('.fnri-custom-group')).to_have_count(0);expect(panel.locator('.fnri-saved-skills [data-action="rollSkill"][data-id="saved"]')).to_be_visible()
  for m in ('warning','free','strict'):
   page.evaluate("async m=>{mode=m;await paint()}",m)
   expect(buttons).to_have_count(0 if m=='strict' else 5)
   expect(panel.locator('.fnri-custom-group')).to_have_count(1 if m=='free' else 0)
   assert page.evaluate("raw.skills.saved.dice==='2d6'&&raw.skills.spec1.dice==='1d6'&&raw.skills.spec2.dice==='1d4'")
  panel.locator('[data-skill-row="spec2"] [data-action="removeSkill"]').click();page.wait_for_function("!raw.skills.spec2");expect(buttons).to_have_count(5)
  # Restore legacy fixture for subsequent existing regression cases.
  page.evaluate("async()=>{delete raw.skills.spec1;delete raw.skills.saved;raw.skills.starter_primary={name:'Лес',kind:'specialization',dice:'1d6',group:'field'};foundry.utils.randomID=()=> 'newSpec';mode='free';reprepare();await paint()}")
  # Preserve a draft through a document update on another field, then commit it on blur.
  page.evaluate("sheet._flushWrites()")
  medicine.select_option('manual')
  mod=panel.locator('[data-skill-row="core_medicine"] [data-row-field="modifier"]');mod.fill('3')
  page.evaluate("async()=>{raw.skills.core_stealth.modifier=2;reprepare();await paint()}")
  expect(mod).to_be_focused();expect(mod).to_have_value('3');mod.press('Tab');page.wait_for_function("raw.skills.core_medicine.modifier===3")
  # Complete assignment and both available upgrades. Summary should collapse.
  page.evaluate("async()=>{mode='strict';await paint()}")
  medicine.select_option('nominal:8')
  page.wait_for_function("actor.system.skills.core_medicine.dice==='1d8'")
  stealth.select_option(stealth.locator('option[value^="nominal:"]').first.get_attribute('value'))
  page.wait_for_function("actor.system.skills.core_stealth.dice!==''")
  arcana=panel.locator('[data-skill-die="arcana"]');arcana.select_option(arcana.locator('option[value^="nominal:"]').first.get_attribute('value'))
  page.wait_for_function("result().free.length===0");expect(pool).to_have_count(0)
  # Use the outstanding d8 upgrade on whichever row currently has its original die.
  page.evaluate("""async()=>{const r=result();const u=r.upgrades.find(u=>!u.target);const d=r.dice.find(d=>d.size===u?.size&&d.skill&&!r.upgrades.some(x=>x.target===d.id));if(u&&d){await sheet._applySkillUpgrade(u.id,d.id,d.skill,d.id)}}""")
  if page.evaluate("result().upgrades.every(u=>u.target)&&result().warnings.length===0"):
   expect(summary).not_to_have_attribute('open','')
  # Create deviation in free mode; only warning mode exposes the warning.
  page.evaluate("async()=>{mode='free';await paint()}")
  mysticism.select_option('manual');formula=panel.locator('[data-skill-formula="mysticism"]');formula.fill('1d12');formula.press('Tab');page.wait_for_function("actor.system.skills.core_mysticism.dice==='1d12'")
  page.evaluate("async()=>{mode='warning';await paint()}");expect(summary).to_have_attribute('open','');expect(summary.locator('.fnri-skill-distribution-warnings')).to_be_visible()
  page.evaluate("async()=>{mode='free';await paint()}")
  panel.locator('[data-skill-use-assigned="mysticism"]').click();page.wait_for_function("actor.system.skills.core_mysticism.dice==='1d10'")
  panel.locator('[data-action="resetSkillDice"]').click();page.wait_for_function("result().free.length===3")
  expect(pool).to_be_visible();expect(summary).to_have_attribute('open','')
  assert page.evaluate("raw.skills.starter_primary.name==='Лес'")
  assert panel.evaluate('(node)=>node.scrollWidth<=node.clientWidth+1')
  # Compact display is common to locked and unlocked views. Prepare a real
  # resolved skill with native-prepared values, without modifying its source.
  page.evaluate("async()=>{mode='strict';await paint()}")
  medicine.select_option('nominal:6');page.wait_for_function("actor.system.skills.core_medicine.dice==='1d6'")
  page.evaluate("async()=>{actor.system.skills.core_medicine.dice='1d8+1d6+1d6';actor.system.skills.core_medicine.modifier=2;await paint()}")
  medrow=panel.locator('[data-skill-row="core_medicine"]')
  assert medrow.locator('[data-row-field="modifier"]').count()==0
  assert medrow.locator('option[value^="upgrade:"]').count()==0
  for theme in ('theme-light','theme-dark'):
   page.evaluate('(theme)=>document.documentElement.className=theme',theme)
   for width in (360,420,760):
    page.set_viewport_size({'width':width,'height':730})
    for locked in (False,True):
     page.evaluate('(locked)=>{sheet._configurationLocked=locked;sheet._applyConfigurationLock()}',locked)
     formula=medrow.locator('.fnri-formula-face:visible');expect(formula).to_have_count(1)
     assert ''.join(formula.inner_text().split())=='↑d8+2d6+2'
     assert 'd8+2d6+2' in formula.get_attribute('title')
     assert formula.evaluate("n=>{const a=n.querySelector('.fnri-formula-base'),b=n.querySelector('.fnri-formula-suffix');return Math.abs(a.getBoundingClientRect().top-b.getBoundingClientRect().top)<1 && getComputedStyle(a).fontSize===getComputedStyle(b).fontSize && getComputedStyle(n).whiteSpace==='nowrap'}")
     assert medrow.evaluate('(n)=>n.scrollWidth<=n.clientWidth+1')
     expect(medrow.locator('[data-action="rollSkill"]')).to_be_enabled()
  page.evaluate("async()=>{mode='free';sheet._configurationLocked=false;reprepare();await paint()}")
  # Actual NPC context and same row partials, without the class pool.
  page.evaluate('''async()=>{const {FastNRINPCSheet}=await import('fnri/module/sheets/sheets.mjs');mode='strict';actor.type='npc';sheet=new FastNRINPCSheet({actor});sheet._selectedTab='skills';const ctx=await sheet._prepareContext({});sheet.element.querySelector('.window-content').innerHTML=renderSkill(templates.npc,ctx);await sheet._onRender({},{});}''')
  expect(panel.locator('[data-skill-die]')).to_have_count(0);expect(panel.locator('[data-fnri-dice-picker="skill"]').first).to_be_hidden();expect(panel.locator('[data-action="rollSkill"]').first).to_be_enabled()
  lock.click();expect(panel.locator('[data-fnri-dice-picker="skill"]').first).to_be_visible();expect(panel.locator('.fnri-skill-edit-pool')).to_have_count(0)
  # Saved arbitrary NPC formula can be reopened without destructive clearing.
  page.evaluate("async()=>{raw.skills.core_acrobatics.dice='2d6+1';reprepare();const ctx=await sheet._prepareContext({});sheet.element.querySelector('.window-content').innerHTML=renderSkill(templates.npc,ctx);await sheet._onRender({},{});}")
  npcrow=panel.locator('[data-skill-row="core_acrobatics"]');picker=npcrow.locator('[data-fnri-dice-picker]')
  expect(picker).to_have_value('__stored__');picker.select_option('__custom__')
  expect(npcrow.locator('[data-fnri-custom-dice]')).to_have_value('2d6+1');expect(npcrow.locator('[data-fnri-custom-dice]')).to_be_visible()
  assert page.evaluate("raw.skills.core_acrobatics.dice==='2d6+1'")
  # NPC manual editor is not affected by either restrictive world mode.
  for worldmode in ('warning','strict'):
   page.evaluate("async m=>{mode=m;const ctx=await sheet._prepareContext({});sheet.element.querySelector('.window-content').innerHTML=renderSkill(templates.npc,ctx);await sheet._onRender({},{});}",worldmode)
   expect(picker.locator('option[value=__custom__]')).to_have_count(1)
   picker.select_option('__custom__');expect(npcrow.locator('[data-fnri-custom-dice]')).to_be_visible()
   assert page.evaluate("raw.skills.core_acrobatics.dice==='2d6+1'")
  # Restore the NPC-specific render path for the mocked document update.
  page.evaluate("window.paint=async()=>{const ctx=await sheet._prepareContext({});sheet.element.querySelector('.window-content').innerHTML=renderSkill(templates.npc,ctx);await sheet._onRender({},{});}")
  # Saving uses the same NPC-effective mode as the visible editor.
  modifier=npcrow.locator('[data-row-field="modifier"]');modifier.fill('3');modifier.dispatch_event('change');page.wait_for_function('raw.skills.core_acrobatics.modifier===3')
  picker.select_option('__custom__');field=npcrow.locator('[data-fnri-custom-dice]');field.fill('3d6');field.dispatch_event('change');page.wait_for_function("raw.skills.core_acrobatics.dice==='3d6'")
  npcrow.locator('[data-skill-release]').click();page.wait_for_function("raw.skills.core_acrobatics.dice==='' ")
  assert page.evaluate('raw.skills.core_acrobatics.modifier===3')
  print('PASS inline PC/NPC skill panels: real templates, real lock, allocation nominal/return/upgrade/manual, grouped specialization create/edit/remove, no window')
 finally: browser.close()
