#!/usr/bin/env python3
"""Actual social preroll: the Heir role supplies one optional d10."""
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
          globalThis.game={i18n:{localize:k=>k}};
          const {prepareRoll}=await import('fnri/module/rolls/roll-context.mjs');
          const actor={type:'character',items:{contents:[]},system:{role:'Наследник'},effects:{contents:[]},uuid:'Actor.Hero',name:'Hero'};
          window.foundry={applications:{api:{DialogV2:{wait:cfg=>{
            const form=document.querySelector('#preroll');form.innerHTML=cfg.content;
            cfg.render({}, {element:form});
            return new Promise(resolve=>{window.submitPreroll=async()=>resolve(await cfg.buttons[0].callback({}, {form}));});
          }}}}};
          window.openSocial=skillId=>{window.resultPromise=prepareRoll({actor,kind:'skill',skillId,formula:'1d20 + (1d6)'});};
          window.openSocial('core_persuasion');
        }''')
        field=page.locator('[name="part_0_0"]')
        formula=page.locator('[data-fnri-preview-formula]')
        from playwright.sync_api import expect
        expect(field).to_be_visible();expect(field).not_to_be_checked()
        expect(page.locator('[data-fnri-preroll]')).to_contain_text('Наследник')
        expect(formula).to_have_text('1d20 + (1d6)')
        field.check();expect(formula).to_have_text('1d20 + (1d6) + (1d10)')
        field.uncheck();expect(formula).to_have_text('1d20 + (1d6)')
        field.check();page.evaluate('submitPreroll()')
        assert page.evaluate('async()=> (await window.resultPromise).expression')=='1d20 + (1d6) + (1d10)'
        page.evaluate("openSocial('core_athletics')")
        expect(page.locator('[data-fnri-preroll]')).not_to_contain_text('Наследник')
        assert field.count()==0
        page.evaluate('submitPreroll()')
        assert page.evaluate('async()=> (await window.resultPromise).expression')=='1d20 + (1d6)'
        print('PASS Heir actual preroll DOM: optional 1d10 toggles once, real formula, unrelated skill absent')
    finally:
        browser.close()
