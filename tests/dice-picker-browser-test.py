#!/usr/bin/env python3
"""Real Chromium DOM events against the actual sheet handler code and UI contract.

A narrow Foundry API shim is used; this is not a live-world integration test.
"""
from pathlib import Path
from browser_test_helpers import load_real_sheet
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
for name in ('npc',):
    template = (root / 'templates' / f'{name}.hbs').read_text()
    for required in (
        'data-fnri-dice-picker="skill"',
        'data-fnri-dice-picker="specialization"',
        'this.skillDiceOptions',
        'this.specializationDiceOptions',
        'data-fnri-custom-dice',
        'data-row-field="kind"',
        'data-row-field="dice"',
    ):
        assert required in template, (name, required)

html = '''<section id="sheet">
  <select data-row-collection="skills" data-row-id="s1" data-row-field="kind">
    <option value="skill" selected>Навык</option>
    <option value="specialization">Специализация</option>
  </select>
  <select data-fnri-dice-picker="skill" data-row-id="s1">
    <option value="">—</option><option value="1d4">d4</option>
    <option value="1d6">d6</option><option value="1d8" selected>d8</option>
    <option value="1d10">d10</option><option value="1d12">d12</option>
    <option value="__custom__">Своя формула</option>
  </select>
  <select data-fnri-dice-picker="specialization" data-row-id="s1" hidden>
    <option value="">—</option><option value="2d6">Основная — 2d6</option>
    <option value="2d4">Дополнительная — 2d4</option>
    <option value="__custom__">Своя формула</option>
  </select>
  <input data-fnri-custom-dice data-row-collection="skills" data-row-id="s1"
         data-row-field="dice" value="1d8" hidden>
</section>'''
shim = '''
window.game={i18n:{localize:key=>key}};
window.ui={notifications:{warn:()=>{},error:()=>{}}};
class FakeActorSheetV2 {
  constructor({actor}={}) {this.actor=actor;this.isEditable=true;this.element=document.getElementById('sheet');}
  async _onRender() {}
  async _prepareContext() {return {};}
}
window.foundry={applications:{api:{HandlebarsApplicationMixin:Parent=>Parent,DialogV2:{}},
  sheets:{ActorSheetV2:FakeActorSheetV2,ItemSheetV2:class{}}}};
window.actor={type:"character",items:{contents:[]},system:{skills:{s1:{name:'Навык',kind:'skill',dice:'1d8',modifier:null,value:null}}},
  async update(change){
    for (const [key,value] of Object.entries(change)) {
      const bits=key.split('.');let obj=this;
      while (bits.length>1) obj=obj[bits.shift()];
      obj[bits.shift()]=value;
    }
  }};
'''
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    try:
        page = browser.new_page()
        load_real_sheet(page,root,html,shim)
        skill = '[data-fnri-dice-picker="skill"]'
        special = '[data-fnri-dice-picker="specialization"]'
        custom = '[data-fnri-custom-dice]'
        kind = '[data-row-field="kind"]'
        assert page.locator(skill).is_visible()
        assert not page.locator(special).is_visible()
        assert not page.locator(custom).is_visible()
        page.locator(skill).select_option('1d12')
        page.wait_for_function("window.actor.system.skills.s1.dice === '1d12'")
        # Switching classification must not silently replace dice.
        page.locator(kind).select_option('specialization')
        page.wait_for_function("window.actor.system.skills.s1.kind === 'specialization'")
        assert page.locator(special).is_visible()
        assert not page.locator(skill).is_visible()
        assert page.locator(custom).is_visible()
        assert page.locator(custom).input_value() == '1d12'
        assert page.evaluate('window.actor.system.skills.s1.dice') == '1d12'
        page.locator(special).select_option('2d4')
        page.wait_for_function("window.actor.system.skills.s1.dice === '2d4'")
        assert not page.locator(custom).is_visible()
        page.locator(special).select_option('__custom__')
        page.wait_for_function("window.actor.system.skills.s1.dice === ''")
        assert page.locator(custom).is_visible()
        assert page.locator(custom).input_value() == ''
        # The empty formula already means a 1d20 check, with no old 2d4.
        assert page.evaluate("window.sheet._customDiceEditors.has('s1')")
        # Document re-render must not hide the blank custom editor.
        result = page.evaluate('''async () => {
          const ctx = await window.sheet._prepareContext({});
          const row = ctx.skillRows.find(row => row.id === 's1');
          return {visible: row.hasCustomDice,
            selected: row.specializationDiceOptions.find(option => option.selected)?.value};
        }''')
        assert result == {'visible': True, 'selected': '__custom__'}
        page.evaluate("window.sheet._syncDicePickers('s1', 'specialization')")
        assert page.locator(custom).is_visible()
        assert page.locator(special).input_value() == '__custom__'
        page.locator(custom).fill('3d8 + 1d6')
        page.locator(custom).press('Tab')
        page.wait_for_function("window.actor.system.skills.s1.dice === '3d8 + 1d6'")
        page.locator(kind).select_option('skill')
        assert page.locator(custom).is_visible()
        assert page.locator(custom).input_value() == '3d8 + 1d6'
        page.locator(skill).select_option('1d6')
        page.wait_for_function("window.actor.system.skills.s1.dice === '1d6'")
        assert not page.locator(custom).is_visible()
        # The same clearing rule works for ordinary skills.
        page.locator(skill).select_option('__custom__')
        page.wait_for_function("window.actor.system.skills.s1.dice === ''")
        assert page.locator(custom).is_visible()
        assert page.locator(custom).input_value() == ''
        page.locator(skill).select_option('1d8')
        page.wait_for_function("window.actor.system.skills.s1.dice === '1d8'")
        assert not page.locator(custom).is_visible()
        # Empty means intentional no-die; a UI sentinel must never reach data.
        page.locator(skill).select_option('')
        page.wait_for_function("window.actor.system.skills.s1.dice === ''")
        assert page.evaluate('window.actor.system.skills.s1.dice') != '__custom__'
        page.close()
    finally:
        browser.close()
print('PASS: Chromium presets, custom selection clears old dice immediately, editor survives rerender, no sentinel persistence')
