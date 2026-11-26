#!/usr/bin/env python3
"""Local Chromium regression: actual Item weapon field markup, real CSS,
wide desktop viewport with independently resized system sheet; no Foundry runtime."""
from pathlib import Path
import json,re
from playwright.sync_api import sync_playwright
from browser_test_helpers import renderer
root=Path(__file__).resolve().parents[1]
source=(root/'templates/item.hbs').read_text()
weapon=source.split('{{#if isWeapon}}',1)[1].split('<details class="fnri-defense-settings">',1)[0]
css=(root/'styles/fast-nri.css').read_text()
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    try:
        page=browser.new_page(viewport={'width':1440,'height':900})
        for lang in ('ru','en'):
            translations=json.loads((root/'lang'/f'{lang}.json').read_text())
            def localize(m):
                v=translations
                for k in m.group(1).split('.'):v=v[k]
                return v
            text=re.sub(r'\{\{localize ["\']([^"\']+)["\']\}\}',localize,weapon)
            page.set_content('<section class="application fast-nri-v14 fast-nri-sheet" style="width:570px;height:620px"><div class="window-content" style="height:100%"><section class="fnri-body fnri-item-body"><section class="fnri-panel" id="fields"></section></section></div></section>')
            page.add_script_tag(content=renderer)
            page.add_style_tag(content=css)
            page.add_style_tag(content='input,select{height:28px} body{font:16px Arial,sans-serif}')
            page.evaluate('(s)=>document.querySelector("#fields").innerHTML=renderSkill(s,{editable:true,weaponMelee:true,weaponAutoProficiency:true})',text)
            for theme in ('theme-light','theme-dark'):
                page.evaluate('(theme)=>document.body.className=theme',theme)
                for width in (760,570,420,360):
                    page.locator('.application').evaluate('(e,w)=>e.style.width=w+"px"',width)
                    fields=page.locator('.fnri-weapon-fields')
                    columns=fields.evaluate('e=>getComputedStyle(e).gridTemplateColumns.split(" ").length')
                    assert columns==(3 if width==760 else 2),(width,columns)
                    critical=page.locator('.fnri-critical-rules')
                    assert critical.evaluate('e=>getComputedStyle(e).gridTemplateColumns.split(" ").length')==2
                    # Same row of critical controls aligns even with differently wrapped labels.
                    assert critical.locator('input').evaluate_all('es=>Math.abs(es[0].getBoundingClientRect().top-es[1].getBoundingClientRect().top)<1')
                    page.locator('.fnri-weapon-legacy').evaluate('e=>e.open=true')
                    assert page.locator('.window-content').evaluate('e=>e.scrollWidth<=e.clientWidth+1'),(lang,theme,width)
                    assert page.locator('.application').evaluate('e=>e.getBoundingClientRect().width')==width
                    page.locator('.fnri-weapon-legacy').evaluate('e=>e.open=false')
    finally:browser.close()
print('PASS: actual weapon fields, independent sheet width 360/420/570/760, critical alignment, RU/EN and two theme classes')
