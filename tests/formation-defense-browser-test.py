#!/usr/bin/env python3
"""Actual preroll DOM with a mocked Actor and DialogV2: surrounding changes only the confirmed defense characteristic."""
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
          globalThis.game={i18n:{localize:k=>k==='FASTNRI.Preroll.surroundedDefense'?'Окружение':k}};
          const {prepareRoll}=await import('fnri/module/rolls/roll-context.mjs');
          const actor={type:'npc',items:{contents:[]},system:{hp:{current:10},equipment:{}},effects:{contents:[]},uuid:'Actor.Hero',name:'Hero'};
          const scene={id:'scene'},grid={size:100,isSquare:true};
          const tok=(a,id,x,y,disposition)=>({actor:a,name:id,document:{uuid:'Scene.scene.Token.'+id,parent:scene,x:x*100,y:y*100,width:1,height:1,disposition}});
          const enemy={type:'npc',system:{hp:{current:10},equipment:{}},effects:{contents:[]},uuid:'Actor.Enemy'};
          const target=tok(actor,'A',0,0,1),other=tok(actor,'B',9,9,1),e1=tok(enemy,'C',1,0,-1),e2=tok(enemy,'D',0,1,-1);
          globalThis.canvas={scene,grid,tokens:{controlled:[target,other],placeables:[target,other,e1,e2]}};
          window.foundry={applications:{api:{DialogV2:{wait:cfg=>{
            const form=document.querySelector('#preroll');form.innerHTML=cfg.content;
            cfg.render({}, {element:form});
            return new Promise(resolve=>{window.submitPreroll=async()=>resolve(await cfg.buttons[0].callback({}, {form}));});
          }}}}};
          window.openCheck=otherToken=>{window.resultPromise=prepareRoll({actor,kind:'intervention',defenseStat:'reflex',usesDefenseStat:true,defenseToken:otherToken?other:target,formula:'1d20 + (1d6)'});};
          window.openCheck(false);
        }''')
        field=page.locator('[name="part_0_0"]')
        formula=page.locator('[data-fnri-preview-formula]')
        from playwright.sync_api import expect
        assert field.count()==0
        assert page.locator('.fnri-preroll-toggle').count()==0
        expect(page.locator('[data-fnri-preroll]')).not_to_contain_text('Окружение')
        expect(formula).to_have_text('1d20 + (1d6)')
        page.evaluate('submitPreroll()')
        assert page.evaluate('async()=> (await window.resultPromise).expression')=='1d20 + (1d6) + (-2)'
        page.evaluate('openCheck(true)')
        expect(page.locator('[data-fnri-preroll]')).not_to_contain_text('Окружение')
        assert field.count()==0
        page.evaluate('submitPreroll()')
        assert page.evaluate('async()=> (await window.resultPromise).expression')=='1d20 + (1d6)'
        print('PASS Surrounded defense preroll DOM: no toggle, confirmed -2, same Actor other token unaffected')
    finally:
        browser.close()
