#!/usr/bin/env python3
"""Actual preroll DOM with mocked Actor and DialogV2: lighting and non-stacking hindrance."""
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
          globalThis.game={user:{isGM:true},i18n:{localize:k=>k}};
          const {prepareRoll}=await import('fnri/module/rolls/roll-context.mjs');
          const S='fast-nri-v14';
          const actor={uuid:'Actor.Hero',name:'Hero',system:{},items:{contents:[]},effects:{contents:[]}};
          const effect=id=>({showIcon:2,flags:{[S]:{conditionId:id}}});
          const target={effects:{contents:[effect('darkness'),effect('partial-cover')]}};
          const token={visible:true,document:{hidden:false}};
          const range={uuid:'range',name:'Вторая дистанция',parts:[{id:'range',kind:'modifier',value:'-6',nonStackingGroup:'hindrance'}]};
          window.foundry={applications:{api:{DialogV2:{wait:cfg=>{
            const form=document.querySelector('#preroll');form.innerHTML=cfg.content;
            cfg.render({}, {element:form});
            return new Promise(resolve=>{window.submitPreroll=async()=>resolve(await cfg.buttons[0].callback({}, {form}));});
          }}}}};
          window.openCheck=vision=>{actor.flags={[S]:{visionKind:vision}};window.resultPromise=prepareRoll({actor,kind:'attack',formula:'1d20',targetActor:target,targetToken:token,extraEntries:[range]});};
          window.openCheck('normal');
        }''')
        from playwright.sync_api import expect
        formula=page.locator('[data-fnri-preview-formula]')
        darkness=page.locator('label.fnri-preroll-choice').filter(has_text='Темнота').locator('input')
        expect(formula).to_have_text('1d20 + (-10)')
        expect(darkness).to_be_checked()
        darkness.uncheck();expect(formula).to_have_text('1d20 + (-6)')
        darkness.check();expect(formula).to_have_text('1d20 + (-10)')
        page.evaluate('submitPreroll()')
        assert page.evaluate('async()=> (await window.resultPromise).expression')=='1d20 + (-10)'
        page.evaluate("openCheck('darkvision')")
        expect(darkness).to_have_count(0)
        expect(formula).to_have_text('1d20 + (-6)')
        page.evaluate('submitPreroll()')
        assert page.evaluate('async()=> (await window.resultPromise).expression')=='1d20 + (-6)'
        print('PASS P.3.1 lighting DOM: strongest penalty, manual toggle, darkvision')
    finally:
        browser.close()
