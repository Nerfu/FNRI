#!/usr/bin/env python3
"""Disclosure UI smoke with actual CSS and source templates, not live Foundry."""
from pathlib import Path
from browser_test_helpers import expand_actor_template
from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
for template in ('character.hbs','npc.hbs'):
    soup=BeautifulSoup(expand_actor_template(root,template),'html.parser')
    picker=soup.select_one('details.fnri-unarmed-picker')
    assert picker,template
    assert picker.select_one('summary.fnri-slot-occupant')
    option=picker.select_one('[data-action="selectUnarmedAttack"]')
    assert option and option.get('data-unarmed-choice')=='{{this.key}}'
    assert picker.find_parent(class_='fnri-unarmed-row')
    assert soup.select_one('.fnri-unarmed-row [data-action="attackUnarmed"]')
css=(root/'styles/fast-nri.css').read_text()
markup='''<div class="application fast-nri-v14 fast-nri-sheet" style="width:470px">
<section class="fnri-panel">
 <div class="fnri-attack-slot fnri-unarmed-row">
  <strong class="fnri-slot-name">Рукопашная атака</strong>
  <details class="fnri-unarmed-picker"><summary class="fnri-slot-occupant">Когти</summary>
   <div class="fnri-unarmed-options" role="group">
    <button type="button" class="fnri-unarmed-option" data-unarmed-choice="base">Безоружная атака</button>
    <button type="button" class="fnri-unarmed-option fnri-unarmed-selected" data-unarmed-choice="item:claws">Когти <i class="fa-solid fa-check"></i></button>
    <button type="button" class="fnri-unarmed-option" data-unarmed-choice="item:tail">Удар хвостом</button>
   </div>
  </details>
  <button data-action="attackUnarmed">⚄</button>
 </div>
</section></div>'''
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    try:
        page=browser.new_page(viewport={'width':485,'height':400})
        page.set_content(markup)
        page.add_style_tag(content=css)
        assert page.locator('.fnri-unarmed-options').is_hidden()
        assert page.locator('.fnri-unarmed-row').evaluate('el=>getComputedStyle(el).display')=='grid'
        assert page.locator('.fnri-unarmed-picker summary').evaluate('el=>Number.parseInt(getComputedStyle(el).fontWeight)')>=700
        assert page.locator('.fnri-unarmed-row').evaluate('el=>getComputedStyle(el).borderTopWidth')=='2px'
        assert page.locator('[data-action="attackUnarmed"]').is_visible()
        before=page.locator('[data-action="attackUnarmed"]').bounding_box()
        page.locator('.fnri-unarmed-picker summary').click()
        assert page.locator('.fnri-unarmed-options').is_visible()
        after=page.locator('[data-action="attackUnarmed"]').bounding_box()
        assert abs(before['y']-after['y']) < 2, (before,after)
        assert page.locator('.fnri-unarmed-option[data-unarmed-choice="base"]').is_visible()
        assert page.locator('.fnri-unarmed-option[data-unarmed-choice="base"]').is_enabled()
        assert page.locator('.fnri-unarmed-option:visible').count()==3
        assert page.locator('.fnri-unarmed-selected').evaluate('el => Number.parseInt(getComputedStyle(el).fontWeight)')>=700
        assert page.locator('.fnri-unarmed-selected').evaluate('el=>getComputedStyle(el).borderTopWidth')=='2px'
        bounds=page.locator('.fnri-unarmed-row').evaluate('el=>({left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right})')
        for selector in ('.fnri-unarmed-option','[data-action="attackUnarmed"]'):
            rect=page.locator(selector).first.evaluate('el=>({left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right})')
            assert rect['left']>=bounds['left']-2 and rect['right']<=bounds['right']+2,(selector,rect,bounds)
        page.locator('.fnri-unarmed-picker summary').click()
        assert page.locator('.fnri-unarmed-options').is_hidden()
        page.close()
    finally:browser.close()
print('PASS: Chromium unarmed attack disclosure, 3 alternatives, selected emphasis, dice accessible, compact width')
