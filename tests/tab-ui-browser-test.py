#!/usr/bin/env python3
"""Browser tests for actual tab markup with the real switchTab method.
Runs against a lightweight Foundry shim; not a live v14 integration test.
"""
from pathlib import Path
from browser_test_helpers import expand_actor_template
from playwright.sync_api import sync_playwright
import re,base64,json

ROOT=Path(__file__).resolve().parents[1]
TABS=['characteristics','actions','skills','abilities','inventory']
def actor_tabs(kind):return TABS+(['role'] if kind=='character' else [])+['effects','description']+(['journal'] if kind=='character' else [])

def html_from_template(path,language):
    src=expand_actor_template(ROOT,f'{path}.hbs')
    nav=re.findall(r'<button type="button" data-action="([^\"]+)" data-fnri-target="([^\"]+)"',src)
    panels=re.findall(r'<div class="fnri-tab-content" data-fnri-panel="([^\"]+)"',src)
    expected=actor_tabs(path)
    assert [t[1] for t in nav]==expected and panels==expected
    labels=json.loads((ROOT/'lang'/f'{language}.json').read_text())['FASTNRI']['Tabs']
    html='<main id="actor-root" class="fast-nri-v14 fast-nri-sheet"><nav class="fnri-tabs">'
    html+=''.join(f'<button data-action="{action}" data-fnri-target="{tab}" class="fnri-tab">{labels[tab]}</button>' for action,tab in nav)
    html+='</nav>'
    html+=''.join(f'<div class="fnri-tab-content" data-fnri-panel="{tab}" '+('hidden' if i else '')+f'><input id="input-{tab}" value="{tab}"></div>' for i,tab in enumerate(panels))
    return html+'</main>'

src=(ROOT/'module/sheets/sheets.mjs').read_text()
# Isolate the tab method (the full module imports the rolling adapter).
start=src.index('  static changeTab(_event, button) {')
end=src.index('\n  static toggleQuickHp',start)
method=src[start:end]
js='''({method}) => {
const fn=new Function('_event','button','const validActorTab=()=>true;const SYSTEM_ID="fast-nri-v14";'+method.slice(method.indexOf('{')+1,method.lastIndexOf('}')));
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
            page.set_content(html_from_template(actor,'ru'))
            page.add_style_tag(content=(ROOT/'styles/fast-nri.css').read_text())
            for language in ('ru','en'):
                labels=json.loads((ROOT/'lang'/f'{language}.json').read_text())['FASTNRI']['Tabs']
                page.evaluate('(labels)=>document.querySelectorAll(".fnri-tab").forEach(b=>b.textContent=labels[b.dataset.fnriTarget])',labels)
                for theme in ('theme-light','theme-dark'):
                    page.evaluate('(theme)=>document.body.className=theme',theme)
                    for width in (280,360,470,760):
                        page.locator('#actor-root').evaluate('(e,w)=>e.style.width=w+"px"',width)
                        assert page.locator('.fnri-tabs').evaluate('e=>e.scrollWidth<=e.clientWidth+1')
                        assert page.locator('.fnri-tabs button').evaluate_all('buttons=>buttons.every(b=>b.clientWidth>0&&b.scrollWidth<=b.clientWidth+1&&b.scrollHeight<=b.clientHeight+1&&getComputedStyle(b).fontSize!=="0px")'),(actor,language,theme,width)
            page.locator('#actor-root').evaluate('e=>e.style.width="760px"')
            page.evaluate(js,{'method':method})
            for tab in actor_tabs(actor)[1:]:
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
