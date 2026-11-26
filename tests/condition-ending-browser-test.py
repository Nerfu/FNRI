#!/usr/bin/env python3
"""Existing effect editor DOM and real selector submission with mocked native documents."""
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
        page.set_content('<script type="importmap">'+json.dumps({'imports':imports})+'</script><form id="editor"></form>')
        page.add_style_tag(content=(root/'styles/fast-nri.css').read_text())
        lang=json.loads((root/'lang/ru.json').read_text())
        page.evaluate("data=>window.translations=data",lang)
        page.evaluate('''async () => {
          globalThis.game={i18n:{localize:k=>k.split('.').reduce((v,p)=>v?.[p],window.translations)??k}};
          const {openEffectParametersEditor}=await import('fnri/module/effects/effect-parameters-editor.mjs');
          const {CONDITION_STATUSES}=await import('fnri/module/effects/condition-statuses.generated.mjs');
          const actor={documentName:'Actor',isOwner:true,uuid:'Actor.Hero'};
          window.foundry={applications:{api:{DialogV2:{wait:cfg=>{
            const form=document.querySelector('#editor');form.innerHTML=cfg.content;
            cfg.render({}, {element:form});
            return new Promise(resolve=>{window.save=()=>resolve(cfg.buttons[0].callback({}, {form}));});
          }}}}};
          window.openEditor=kind=>{
            window.patch=null;
            const effect={...structuredClone(CONDITION_STATUSES['fnri7-'+kind]??{name:'Custom',flags:{},system:{changes:[]}}),parent:actor,duration:{},async update(p){window.patch=p}};
            window.editorPromise=openEffectParametersEditor(actor,effect);
          };
          window.openEditor('slowed');
        }''')
        from playwright.sync_api import expect
        field=page.locator('[name="endingMode"]')
        expect(field).to_be_visible();expect(field).to_have_value('general')
        field.select_option('particular');page.evaluate('save()');page.evaluate('async()=>await window.editorPromise')
        assert page.evaluate('window.patch')=={'flags.fast-nri-v14.effectEnding':'particular'}
        page.evaluate("openEditor('custom')");expect(field).to_have_value('')
        field.select_option('general');page.evaluate('save()');page.evaluate('async()=>await window.editorPromise')
        assert page.evaluate('window.patch')=={'flags.fast-nri-v14.effectEnding':'general'}
        page.evaluate("openEditor('prone')");assert field.count()==0
        page.evaluate('save()');page.evaluate('async()=>await window.editorPromise');assert page.evaluate('window.patch') is None
        print('PASS Effect ending editor DOM: general default, particular override, custom opt-in, special condition excluded')
    finally:
        browser.close()
