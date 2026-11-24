#!/usr/bin/env python3
"""Browser tests for actual tab markup with the real switchTab method.
Runs against a lightweight Foundry shim; not a live v14 integration test.
"""
from pathlib import Path
from browser_test_helpers import expand_actor_template
from playwright.sync_api import sync_playwright
import re,base64

ROOT=Path(__file__).resolve().parents[1]
TABS=['characteristics','actions','skills','abilities','inventory','description']

def html_from_template(path):
    src=expand_actor_template(ROOT,f'{path}.hbs')
    nav=re.findall(r'<button type="button" data-action="([^\"]+)" data-fnri-target="([^\"]+)"',src)
    panels=re.findall(r'<div class="fnri-tab-content" data-fnri-panel="([^\"]+)"',src)
    expected=TABS+(['journal'] if path=='character' else [])
    assert [t[1] for t in nav]==expected and panels==expected
    html='<main id="actor-root"><nav class="fnri-tabs">'
    html+=''.join(f'<button data-action="{action}" data-fnri-target="{tab}">{tab}</button>' for action,tab in nav)
    html+='</nav>'
    html+=''.join(f'<div class="fnri-tab-content" data-fnri-panel="{tab}" '+('hidden' if i else '')+f'><input id="input-{tab}" value="{tab}"></div>' for i,tab in enumerate(panels))
    return html+'</main>'

src=(ROOT/'module/sheets/sheets.mjs').read_text()
# Isolate the tab method (the full module imports the rolling adapter).
start=src.index('  static changeTab(_event, button) {')
end=src.index('\n  static toggleQuickHp',start)
method=src[start:end]
js='''({method}) => {
const fn=new Function('_event','button','const TAB_IDS=new Set(["characteristics","actions","skills","abilities","inventory","description","journal"]);const SYSTEM_ID="fast-nri-v14";'+method.slice(method.indexOf('{')+1,method.lastIndexOf('}')));
const flags={}; window.game={user:{setFlag(_system,key,tab){flags[key]=tab;return Promise.resolve();}, getFlag(_system,key){return flags[key];}}};
const sheet={element:document.querySelector('#actor-root'),actor:{id:'a1'},_selectedTab:'characteristics',_tabFlagQueue:Promise.resolve(),_failedFields:new Set(['system.wealth'])};window.savedFlags=flags;
for (const button of document.querySelectorAll('.fnri-tabs button')) button.addEventListener('click',e=>fn.call(sheet,e,button));
window.sheetUnderTest=sheet;
}'''
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    try:
        for actor in ['character','npc']:
            page=browser.new_page()
            page.set_content(html_from_template(actor))
            page.evaluate(js,{'method':method})
            for tab in (TABS+(['journal'] if actor=='character' else []))[1:]:
                page.locator(f'.fnri-tabs [data-fnri-target="{tab}"]').click()
                assert page.locator(f'[data-fnri-panel="{tab}"]').is_visible()
                assert page.locator('[data-fnri-panel]:visible').count()==1
            page.locator('.fnri-tabs [data-fnri-target="skills"]').click()
            page.locator('#input-skills').fill('unsaved string')
            page.locator('.fnri-tabs [data-fnri-target="inventory"]').click()
            page.locator('.fnri-tabs [data-fnri-target="skills"]').click()
            assert page.locator('#input-skills').input_value()=='unsaved string'
            assert page.evaluate('window.sheetUnderTest._selectedTab')=='skills'
            page.wait_for_function("window.savedFlags['sheetTab_a1']==='skills'")
            page.close()
    finally:browser.close()
print('PASS: Chromium actor and NPC tabs, failed-save independence, DOM/input preservation')
