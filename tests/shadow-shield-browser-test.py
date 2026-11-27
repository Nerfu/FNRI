#!/usr/bin/env python3
"""Local Chromium rendering of actual HP header and effect badge templates."""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from browser_test_helpers import renderer
root=Path(__file__).resolve().parents[1]
headers={name:(root/'templates'/f'{name}.hbs').read_text().split('<div class="fnri-summary-stats">',1)[1].split('</div>',1)[0]+'</div>' for name in ('character','npc')}
headers={name:'<div class="fnri-summary-stats">'+html for name,html in headers.items()}
marker=(root/'templates/effects-panel.hbs').read_text()
# The narrow local renderer lacks Handlebars aliases; use the same markup
# with its equivalent single-entry context to test the actual badge branch.
entry=marker.split('{{#each effects as |effect|}}',1)[1].split('{{/each}}',1)[0]
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    try:
        page=browser.new_page(viewport={'width':1280,'height':800})
        page.set_content('<section class="fast-nri-v14 fast-nri-sheet" style="width:360px" id="sheet"></section><section id="fnri-effects-panel"></section>')
        page.add_script_tag(content=renderer)
        page.add_style_tag(content=(root/'styles/fast-nri.css').read_text())
        for theme in ('theme-light','theme-dark'):
            page.evaluate('(t)=>document.body.className=t',theme)
            for h in headers.values():
                page.evaluate('''h=>document.querySelector('#sheet').innerHTML=renderSkill(h,{summary:{hp:'20 / 20',tempHP:'+5'}})''',h)
                expect(page.locator('.fnri-temp-hp')).to_be_visible()
                expect(page.locator('.fnri-temp-hp')).to_have_text('(+5)')
            for amount in (5,2):
                page.evaluate('''([s,n])=>document.querySelector('#fnri-effects-panel').innerHTML=renderSkill(s,{effect:{name:'Теневой щит',icon:'icons/svg/shield.svg',shieldRemaining:n}})''',[entry,amount])
                expect(page.locator('.fnri-effect-panel-strength')).to_be_visible()
                expect(page.locator('.fnri-effect-panel-strength')).to_have_text(str(amount))
            page.evaluate('''s=>document.querySelector('#fnri-effects-panel').innerHTML=renderSkill(s,{effect:{name:'Other',icon:'icons/svg/shield.svg',hasStrength:true,strength:3}})''',entry)
            expect(page.locator('.fnri-effect-panel-strength')).to_have_text('3')
        print('PASS Shadow Shield: actual PC/NPC header and effect HP badge, 5 -> 2, normal strength preserved, two themes')
    finally:browser.close()
