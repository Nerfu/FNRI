#!/usr/bin/env python3
"""Actual preroll DOM with a mocked Actor and DialogV2: frightened check modifier."""
import base64,json,re
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
imports={}
for file in sorted((root/'module').rglob('*.mjs')):
    def specifier(match):
        target=(file.parent/match.group(3)).resolve()
        assert root in target.parents and target.is_file(),target
        return match.group(1)+match.group(2)+'fnri/'+target.relative_to(root).as_posix()+match.group(2)
    source=re.sub(r'(\bfrom\s+|\bimport\s+)([\"\'])(\.[^\"\']+)\2',specifier,file.read_text())
    imports['fnri/'+file.relative_to(root).as_posix()]='data:text/javascript;base64,'+base64.b64encode(source.encode()).decode()
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    try:
        page=browser.new_page()
        page.set_content('<script type="importmap">'+json.dumps({'imports':imports})+'</script><form id="preroll"></form>')
        page.add_style_tag(content=(root/'styles/fast-nri.css').read_text())
        page.evaluate('''async () => {
          globalThis.game={i18n:{localize:k=>k==='FASTNRI.Preroll.frightened'?'Напуган':k}};
          const {prepareRoll}=await import('fnri/module/rolls/roll-context.mjs');
          const actor={type:'npc',items:{contents:[]},system:{},effects:{contents:[{statuses:new Set(['fnri7-frightened'])},{flags:{'fast-nri-v14':{conditionId:'frightened'}}}]},uuid:'Actor.Hero',name:'Hero'};
          window.foundry={applications:{api:{DialogV2:{wait:cfg=>{
            const form=document.querySelector('#preroll');form.innerHTML=cfg.content;
            cfg.render({}, {element:form});
            return new Promise(resolve=>{window.submitPreroll=async()=>resolve(await cfg.buttons[0].callback({}, {form}));});
          }}}}};
          window.openCheck=effectEnding=>{window.resultPromise=prepareRoll({actor,kind:'skill',formula:'1d20 + (1d6)',effectEnding});};
          window.openCheck(false);
        }''')
        field=page.locator('[name="part_0_0"]')
        formula=page.locator('[data-fnri-preview-formula]')
        from playwright.sync_api import expect
        expect(field).to_be_visible();expect(field).to_be_checked()
        assert page.locator('.fnri-preroll-toggle').count()==1
        expect(page.locator('[data-fnri-preroll]')).to_contain_text('Напуган')
        expect(formula).to_have_text('1d20 + (1d6) + (-2)')
        field.uncheck();expect(formula).to_have_text('1d20 + (1d6)')
        field.check();expect(formula).to_have_text('1d20 + (1d6) + (-2)')
        page.evaluate('submitPreroll()')
        assert page.evaluate('async()=> (await window.resultPromise).expression')=='1d20 + (1d6) + (-2)'
        page.evaluate('openCheck(true)')
        expect(page.locator('[data-fnri-preroll]')).not_to_contain_text('Напуган')
        assert field.count()==0
        page.evaluate('submitPreroll()')
        assert page.evaluate('async()=> (await window.resultPromise).expression')=='1d20 + (1d6)'
        print('PASS Frightened preroll DOM: one default -2 for two sources, manual toggle, exemption')
    finally:
        browser.close()
