#!/usr/bin/env python3
"""Browser DOM/action regression for Foundry-style HTML; does not claim live Foundry coverage."""
from pathlib import Path
import base64, re
from playwright.sync_api import sync_playwright

HERE=Path(__file__).resolve().parents[1]
BEFORE=Path('/mnt/data/fnri_releaseprep_016/FNRI_Stage2_Release_Candidate_0.1.6/GitHub')
TABS=['overview','skills','abilities','inventory','description']

def html_from_template(root,actor):
    src=(root/'templates'/f'{actor}.hbs').read_text(encoding='utf-8')
    # Extract attributes literally from actual template, not a hand-written test UI.
    nav=re.findall(r'<button type="button" data-action="([^"]+)" data-(tab|fnri-target)="([^"]+)"',src)
    panels=re.findall(r'<div class="fnri-tab-content"(?: data-fnri-panel="([^"]+)")?',src)
    assert len(nav)==5 and [n[2] for n in nav]==TABS,(actor,nav)
    assert len(panels)==5
    html='<main id="actor-root"><nav class="fnri-tabs">'
    for action,attribute,tab in nav:
        html+=f'<button type="button" data-action="{action}" data-{attribute}="{tab}" class="fnri-tab'+(' active' if tab=='overview' else '')+'">'+tab+'</button>'
    html+='</nav>'
    for i,panel in enumerate(panels):
        if panel:assert panel==TABS[i]
        attrs=f' data-fnri-panel="{panel}"' if panel else ''
        html+=f'<div class="fnri-tab-content"{attrs}'+(' hidden' if i else '')+f'><input id="input-{TABS[i]}" value="original-{i}">{TABS[i]}</div>'
    return html+'</main>'

INIT_JS='''async ({mode,sourceBase64}) => {
 class BaseSheet {
  constructor(){ this.isEditable=true;this.renders=0; }
  async render(){this.renders++;return this;}
  async _prepareContext(){return {};}
  async _onRender(){}
 }
 globalThis.foundry={applications:{api:{HandlebarsApplicationMixin:(C)=>C,DialogV2:{}},sheets:{ActorSheetV2:BaseSheet,ItemSheetV2:BaseSheet}}};
 const { FastNRICharacterSheet } = await import('data:text/javascript;base64,'+sourceBase64);
 const sheet = new FastNRICharacterSheet();
 sheet.element=document.querySelector('#actor-root');
 sheet._failedFields.add('system.wealth');
 const action=mode==='old'?'tab':'fnriSwitchTab';
 for(const button of document.querySelectorAll('.fnri-tabs button')) {
   button.addEventListener('click',e=>{
     const p=FastNRICharacterSheet.DEFAULT_OPTIONS.actions[action].call(sheet,e,button);
     if(p && p.catch)p.catch(err=>window.testError=''+err);
   });
 }
 window._testSheet=sheet;
}'''

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    try:
        for mode,root in [('old',BEFORE),('new',HERE)]:
            for actor in ['character','npc']:
                page=browser.new_page()
                page.set_content(html_from_template(root,actor))
                sourceBase64=base64.b64encode((root/'module/sheets/sheets.mjs').read_bytes()).decode()
                page.evaluate(INIT_JS,{'mode':mode,'sourceBase64':sourceBase64})
                page.locator('.fnri-tabs button').nth(3).click()
                page.wait_for_timeout(50)
                selected=page.evaluate("window._testSheet._selectedTab")
                if mode=='old':
                    assert selected=='overview',(mode,actor,selected)
                else:
                    assert selected=='inventory',(mode,actor,selected)
                    assert page.locator('[data-fnri-panel="inventory"]').is_visible()
                    assert page.locator('[data-fnri-panel="overview"]').is_hidden()
                    assert page.locator('.fnri-tabs button.active').inner_text()=='inventory'
                    assert page.locator('.fnri-tabs button.active').get_attribute('aria-current')=='page'
                    assert page.locator('#input-overview').input_value()=='original-0'
                    assert page.evaluate('window._testSheet.renders')==0
                    # Invalid input on a different panel is not a navigation gate.
                    page.locator('#input-overview').evaluate("el=>{el.setCustomValidity('bad value');}")
                    page.locator('.fnri-tabs button').nth(1).click()
                    assert page.locator('[data-fnri-panel="skills"]').is_visible()
                    assert page.locator('#input-overview').evaluate('el=>el.validationMessage')=='bad value'
                page.close()
    finally:browser.close()
print('PASS: real Chromium DOM button clicks on character/NPC, v0.1.6 reproduced blocked navigation, fixed implementation navigates without loss/re-render')
