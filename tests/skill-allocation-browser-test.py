#!/usr/bin/env python3
"""Chromium: actual skill panel templates and real sheet handlers.
Foundry document updates and template rendering are narrow local mocks.
"""
from pathlib import Path
import json
from browser_test_helpers import load_real_sheet
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
window.game={i18n:{localize:k=>k},user:{},settings:{get:()=> 'public'}};
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
renderer=r'''
window.renderSkill=(source,context,rootContext=context)=>{
 const tokens=source.split(/(\{\{\{[\s\S]*?\}\}\}|\{\{[\s\S]*?\}\})/g).filter(Boolean);
 const tag=t=>t.startsWith('{{')?t.replace(/^\{\{\{?|\}\}\}?$/g,'').trim():null;
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function get(path,ctx){if(path==='this')return ctx;if(path.startsWith('@root.'))return path.slice(6).split('.').reduce((o,k)=>o?.[k],rootContext);return path.replace(/^this\./,'').split('.').reduce((o,k)=>o?.[k],ctx);}
 const truth=v=>Array.isArray(v)?v.length>0:!!v;
 function render(start,end,ctx){let out='';for(let i=start;i<end;i++){
  const t=tokens[i],key=tag(t);if(key===null){out+=t;continue;}
  if(key.startsWith('#')){const [kind,path]=key.slice(1).split(/\s+/);let depth=1,j=i+1,branches=[{start:j,condition:path}];
   for(;j<end;j++){const k=tag(tokens[j]);if(!k)continue;if(k.startsWith('#'))depth++;else if(k.startsWith('/')){if(--depth===0)break;}
    else if(depth===1&&k.startsWith('else')){branches.at(-1).end=j;branches.push({start:j+1,condition:k.startsWith('else if ')?k.slice(8):null});}}
   if(j===end)throw Error('Unclosed '+key);branches.at(-1).end=j;
   const val=get(path,ctx);
   if(kind==='each'){for(const item of val??[])out+=render(branches[0].start,branches[0].end,item);}
   else if(kind==='if'||kind==='unless'){const first=kind==='unless'?!truth(val):truth(val);const branch=first?branches[0]:branches.slice(1).find(b=>b.condition===null||truth(get(b.condition,ctx)));if(branch)out+=render(branch.start,branch.end,ctx);}
   else throw Error('Unsupported '+kind);i=j;continue;}
  if(key.startsWith('> fnri-')){out+=window.renderSkill(window.templates[key.slice(7)],ctx,rootContext);continue;}
  if(key.startsWith('localize ')){out+=esc(key.slice(9).replace(/^['"]|['"]$/g,''));continue;}
  const val=get(key,ctx);out+=t.startsWith('{{{')?String(val??''):esc(val);
 }return out;}
 return render(0,tokens.length,context);
};
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
   raw.skills.starter_primary.name='Лес';
   window.reprepare=()=>{actor.system=structuredClone(raw);actor.system.parent=actor;prepareSkillAllocation(actor.system);};
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
  page.locator('[data-fnri-skill-filter]').select_option('assigned');expect(panel.locator('[data-skill-row="core_medicine"]')).to_be_hidden()
  lock.click();expect(medicine).to_be_visible();expect(pool).to_contain_text('d6 × 2');expect(summary).to_be_visible()
  medicine.select_option(medicine.locator('option[value^="assign:free_1"]').get_attribute('value'))
  page.wait_for_function("actor.system.skills.core_medicine.dice==='1d6'");expect(pool).to_contain_text('d6 × 1')
  expect(mysticism.locator('option').first).to_have_text('d10');assert mysticism.locator('option[value^="assign:"]').count()==0
  upgrade=medicine.locator('option[value^="upgrade:"]').first;target=upgrade.get_attribute('value').split(':')[-1];medicine.select_option(upgrade.get_attribute('value'))
  page.wait_for_function("actor.system.skills.core_medicine.dice==='1d8'")
  stealth.select_option(stealth.locator('option[value$=":medicine"]').first.get_attribute('value'))
  page.wait_for_function("actor.system.skills.core_stealth.dice==='1d8' && actor.system.skills.core_medicine.dice==='' ")
  assert page.evaluate('result().upgrades.some(u=>u.target==='+repr(target)+')')
  stealth.select_option('release');page.wait_for_function("actor.system.skills.core_stealth.dice==='' ");expect(pool).to_contain_text('d8 × 2')
  mysticism.select_option('manual');formula=panel.locator('[data-skill-formula="mysticism"]');expect(formula).to_be_visible();formula.fill('1d12');formula.press('Tab');page.wait_for_function("actor.system.skills.core_mysticism.dice==='1d12'")
  assert page.evaluate("result().rows.mysticism.die")=='class_mysticism';expect(summary.locator('.fnri-skill-distribution-warnings')).to_be_visible()
  mysticism.select_option('use-assigned');page.wait_for_function("actor.system.skills.core_mysticism.dice==='1d10'")
  panel.locator('[data-action="addSpecialization"][data-group="physical"]').click();page.wait_for_function("raw.skills.newSpec?.group==='physical'")
  row=panel.locator('[data-skill-row="newSpec"]');expect(row).to_be_visible();name=row.locator('[data-row-field="name"]');name.fill('Акробат');name.press('Tab');page.wait_for_function("raw.skills.newSpec.name==='Акробат'")
  row.locator('[data-fnri-single-dice]').select_option('1d4');page.wait_for_function("raw.skills.newSpec.dice==='1d4'")
  row.locator('[data-row-field="group"]').select_option('magical');page.wait_for_function("raw.skills.newSpec.group==='magical'")
  expect(panel.locator('[data-fnri-skill-group-content="magical"] [data-skill-row="newSpec"]')).to_be_visible()
  lock.click();expect(pool).to_be_hidden();expect(summary).to_be_hidden();expect(row.locator('[data-fnri-single-dice]')).to_be_hidden();expect(row.locator('[data-action="rollSkill"]')).to_be_enabled();expect(panel.locator('[data-skill-row="core_medicine"]')).to_be_hidden()
  lock.click();expect(medicine).to_be_visible();row.locator('[data-action="removeSkill"]').click();page.wait_for_function("!raw.skills.newSpec")
  # Preserve a draft through a document update on another field, then commit it on blur.
  page.evaluate("sheet._flushWrites()")
  mod=panel.locator('[data-skill-row="core_medicine"] [data-row-field="modifier"]');mod.fill('3')
  page.evaluate("async()=>{raw.skills.core_stealth.modifier=2;reprepare();await paint()}")
  expect(mod).to_be_focused();expect(mod).to_have_value('3');mod.press('Tab');page.wait_for_function("raw.skills.core_medicine.modifier===3")
  # Complete assignment and both available upgrades. Summary should collapse.
  medicine.select_option(medicine.locator('option[value^="assign:free_1"]').first.get_attribute('value'))
  page.wait_for_function("actor.system.skills.core_medicine.dice==='1d8'")
  stealth.select_option(stealth.locator('option[value^="assign:"]').first.get_attribute('value'))
  page.wait_for_function("actor.system.skills.core_stealth.dice!==''")
  arcana=panel.locator('[data-skill-die="arcana"]');arcana.select_option(arcana.locator('option[value^="assign:"]').first.get_attribute('value'))
  page.wait_for_function("result().free.length===0");expect(pool).to_have_count(0)
  # Use the outstanding d8 upgrade on whichever row currently has its original die.
  page.evaluate("""async()=>{const r=result();const u=r.upgrades.find(u=>!u.target);const d=r.dice.find(d=>d.size===u?.size&&d.skill&&!r.upgrades.some(x=>x.target===d.id));if(u&&d){await sheet._applySkillUpgrade(u.id,d.id,d.skill,d.id)}}""")
  if page.evaluate("result().upgrades.every(u=>u.target)&&result().warnings.length===0"):
   expect(summary).not_to_have_attribute('open','')
  # Create deviation: summary opens and remains informative, never disables roll.
  mysticism.select_option('manual');formula=panel.locator('[data-skill-formula="mysticism"]');formula.fill('1d12');formula.press('Tab');page.wait_for_function("actor.system.skills.core_mysticism.dice==='1d12'")
  expect(summary).to_have_attribute('open','');expect(summary.locator('.fnri-skill-distribution-warnings')).to_be_visible()
  mysticism.select_option('use-assigned');page.wait_for_function("actor.system.skills.core_mysticism.dice==='1d10'")
  panel.locator('[data-action="resetSkillDice"]').click();page.wait_for_function("result().free.length===3")
  expect(pool).to_be_visible();expect(summary).to_have_attribute('open','')
  assert page.evaluate("raw.skills.starter_primary.name==='Лес'")
  assert panel.evaluate('(node)=>node.scrollWidth<=node.clientWidth+1')
  # Actual NPC context and same row partials, without the class pool.
  page.evaluate('''async()=>{const {FastNRINPCSheet}=await import('fnri/module/sheets/sheets.mjs');actor.type='npc';sheet=new FastNRINPCSheet({actor});sheet._selectedTab='skills';const ctx=await sheet._prepareContext({});sheet.element.querySelector('.window-content').innerHTML=renderSkill(templates.npc,ctx);await sheet._onRender({},{});}''')
  expect(panel.locator('[data-skill-die]')).to_have_count(0);expect(panel.locator('[data-fnri-dice-picker="skill"]').first).to_be_hidden();expect(panel.locator('[data-action="rollSkill"]').first).to_be_enabled()
  lock.click();expect(panel.locator('[data-fnri-dice-picker="skill"]').first).to_be_visible();expect(panel.locator('.fnri-skill-edit-pool')).to_have_count(0)
  print('PASS inline PC/NPC skill panels: real templates, real lock, assigned filter, allocation transfer/upgrade/manual, grouped specialization create/edit/remove, no window')
 finally: browser.close()
