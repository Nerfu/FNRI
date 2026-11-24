#!/usr/bin/env python3
"""UI smoke for equipped border, weight, context buttons, attacks; shim, not Foundry."""
from pathlib import Path
from browser_test_helpers import expand_actor_template
from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
for actor in ('character','npc'):
    src=expand_actor_template(root,f'{actor}.hbs')
    soup=BeautifulSoup(src,'html.parser')
    assert soup.select_one('[data-action="attackUnarmed"]') is not None
    assert soup.select_one('[data-action="selectUnarmedAttack"]') is not None
    assert soup.select_one('details.fnri-unarmed-picker') is not None
    assert soup.select_one('[data-action="attackEquipped"]') is not None
    assert soup.select_one('[data-action="toggleEquipment"]') is not None
    assert soup.select_one('[data-example]') is None
    assert 'Не экипирован' not in src
    assert 'fnri-item-equipped' in src
    assert not soup.select('select[name^="system.equipment."]')
css=(root/'styles/fast-nri.css').read_text()
html='''<div class="application fast-nri-v14 fast-nri-sheet" style="width:560px;background:#272a30;color:white">
<div class="window-content"><section class="fnri-body"><section class="fnri-panel">
<div class="fnri-attack-slot" data-item-id="sword"><strong class="fnri-slot-name">Рука 1</strong><span class="fnri-slot-occupant">Меч</span><button data-action="attackEquipped">Атака</button></div>
<div class="fnri-attack-slot fnri-unarmed-row"><strong class="fnri-slot-name">Рукопашная атака</strong><span class="fnri-slot-occupant">Безоружная атака</span><button data-action="attackUnarmed">Атака</button></div>
<ul class="fnri-item-list"><li class="fnri-item-row fnri-item-equipped" data-item-id="sword"><span class="fnri-inventory-name">Меч<small class="fnri-equipped-location">Рука 1</small></span><button class="fnri-equip-toggle">Снять</button></li>
<li class="fnri-item-row" data-item-id="ring"><span class="fnri-inventory-name">Кольцо</span><button class="fnri-equip-toggle">Экипировать</button></li></ul>
</section></section></div></div>'''
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    try:
        page=browser.new_page(viewport={'width':580,'height':680})
        page.set_content(html)
        page.add_style_tag(content=css)
        assert page.locator('[data-action="attackUnarmed"]').count()==1
        assert page.locator('[data-action="attackEquipped"]').count()==1
        equipped=page.locator('.fnri-item-equipped')
        standard=page.locator('.fnri-item-row:not(.fnri-item-equipped)')
        assert equipped.evaluate("el => Number.parseFloat(getComputedStyle(el).borderTopWidth)")>=2
        assert equipped.locator('.fnri-inventory-name').evaluate("el => Number(getComputedStyle(el).fontWeight)")>=700
        assert standard.locator('.fnri-inventory-name').evaluate("el => Number(getComputedStyle(el).fontWeight)")<700
        assert equipped.locator('.fnri-equip-toggle').inner_text()=='Снять'
        assert standard.locator('.fnri-equip-toggle').inner_text()=='Экипировать'
        assert page.locator('.fnri-item-row').count()==2
        page.close()
    finally: browser.close()
print('PASS: Chromium inventory equipped border and bold, compact slots, equip/unequip labels, no test item')
