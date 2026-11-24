#!/usr/bin/env python3
"""CSS and template smoke for the short attack profile (not a live Foundry test)."""
from pathlib import Path
from browser_test_helpers import expand_actor_template
from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
for name in ('character.hbs','npc.hbs'):
    s=BeautifulSoup(expand_actor_template(root,name),'html.parser')
    attack=s.select_one('.fnri-attack-slots')
    assert attack, name
    assert attack.select_one('.fnri-attack-slot [data-action="attackEquipped"]')
    assert attack.select_one('.fnri-unarmed-row .fnri-attack-profile')
    assert attack.select_one('.fnri-unarmed-row .fnri-attack-details')
    assert attack.select_one('.fnri-other-attacks .fnri-attack-profile')
    assert attack.select_one('.fnri-unarmed-picker summary.fnri-slot-occupant')
    assert attack.select_one('.fnri-unarmed-row [data-action="attackUnarmed"]')
    assert s.select_one('.fnri-attack-slot .fnri-attack-profile').text.strip()=='{{this.damageSummary}}'
css=(root/'styles/fast-nri.css').read_text()
html="""<div class="application fast-nri-v14 fast-nri-sheet" style="width:100%;padding:8px;box-sizing:border-box">
<section class="fnri-panel" style="padding:6px">
<div class="fnri-attack-slots">
<div class="fnri-attack-slot" data-item-id="sword"><strong class="fnri-slot-name">Рука 1</strong>
<span class="fnri-attack-information"><span class="fnri-slot-occupant">Длинный меч</span><small class="fnri-attack-details">Ближняя · Рубящее</small></span>
<span class="fnri-attack-profile">1d10/1d10/+4</span><button data-action="attackEquipped">⚄</button></div>
<div class="fnri-attack-slot fnri-unarmed-row"><strong class="fnri-slot-name">Рукопашная атака</strong>
<span class="fnri-attack-information"><details class="fnri-unarmed-picker">
<summary class="fnri-slot-occupant">Когти</summary><div class="fnri-unarmed-options">
<button class="fnri-unarmed-option">Безоружная атака</button><button class="fnri-unarmed-option">Когти</button></div></details>
<small class="fnri-attack-details">Воздействие, Ближняя атака</small></span>
<span class="fnri-attack-profile">1d8/1d6/+5</span><button data-action="attackUnarmed">⚄</button></div>
</div></section></div>"""
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    try:
        for width in (370,490,760):
            page=browser.new_page(viewport={'width':width,'height':550})
            page.set_content(html)
            page.add_style_tag(content=css)
            assert page.locator('.fnri-attack-profile').count()==2
            assert page.locator('.fnri-attack-profile').first.is_visible()
            for row in page.locator('.fnri-attack-slot').all():
                assert row.evaluate('el=>el.scrollWidth <= el.clientWidth+1'),width
                profile=row.locator('.fnri-attack-profile').bounding_box()
                button=row.locator('button[data-action^="attack"]').bounding_box()
                assert profile['x']+profile['width']<=button['x']+1,(width,profile,button)
            before=page.locator('[data-action="attackUnarmed"]').bounding_box()
            page.locator('.fnri-unarmed-picker summary').click()
            assert page.locator('.fnri-unarmed-options').is_visible()
            after=page.locator('[data-action="attackUnarmed"]').bounding_box()
            assert abs(before['y']-after['y'])<2,(before,after)
            page.close()
    finally:
        browser.close()
print('PASS: compact physical attack previews and selected unarmed placement at 370/490/760 px')
