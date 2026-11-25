#!/usr/bin/env python3
"""Actual menu modules and DOM events; Foundry DialogV2 API is mocked."""
from pathlib import Path
from base64 import b64encode
import re,json
from playwright.sync_api import sync_playwright,expect
root=Path(__file__).resolve().parents[1]
imports={}
for file in (root/'module').rglob('*.mjs'):
    def spec(m):
        path=(file.parent/m.group(3)).resolve().relative_to(root).as_posix()
        return m.group(1)+m.group(2)+'fnri/'+path+m.group(2)
    source=re.sub(r'(\bfrom\s+|\bimport\s+)([\"\'])(\.[^\"\']+)\2',spec,file.read_text())
    imports['fnri/'+file.relative_to(root).as_posix()]='data:text/javascript;base64,'+b64encode(source.encode()).decode()
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    try:
        page=browser.new_page(viewport={'width':360,'height':600})
        page.set_content('<script type="importmap">'+json.dumps({'imports':imports})+'</script><main></main>')
        page.add_style_tag(content=(root/'styles/fast-nri.css').read_text())
        page.evaluate('''async()=>{
          const {chooseIntervention,interventionMenuRows}=await import('fnri/module/damage/intervention-menu.mjs');
          const {highlightCheckTotal}=await import('fnri/module/damage/dice-highlights.mjs');
          window.flag=false;window.closes=0;window.result=undefined;
          window.game={user:{getFlag:()=>flag,setFlag:async(s,k,v)=>{window.flag=v;}},i18n:{localize:k=>k,format:(k,v)=>`${k}: ${v.resource}`}};
          window.actor={type:'character',system:{resources:{reaction:{kind:'intervention',name:'Вмешательства',current:0,max:1},magic:{kind:'class',resourceKey:'class_magic',name:'Магическая сила',current:0,max:4}}}};
          const spell={type:'ability',system:{mechanics:{accounting:{resourceCosts:[{kind:'class',resourceKey:'class_magic',amount:1}]}}}};
          const free={type:'ability',system:{mechanics:{accounting:{resourceCosts:[{kind:'intervention',amount:0}]}}}};
          const options=[{id:'self',name:'Самозащита'},{id:'shield',name:'Теневой щит',item:spell},{id:'counter',name:'Противодействие'}];
          window.repeat=true;
          window.foundry={applications:{api:{DialogV2:{wait:cfg=>new Promise(resolve=>{
            const main=document.querySelector('main');main.innerHTML=cfg.content;
            const dialog={element:main,close(){window.closes++;resolve(null);}};
            cfg.render(null,dialog);window.cancel=()=>resolve(null);
          })}}}};
          window.open=()=>{window.result=undefined;void chooseIntervention({actor,title:'Вмешательство',choices:all=>options.slice(0,all?3:2),repeated:()=>repeat}).then(v=>window.result=v);};
          window.groups=()=>interventionMenuRows(actor,[options[0],{id:'free',name:'Free',item:free}],false);
          window.testHighlight=()=>{const host=document.createElement('div');host.innerHTML='<div class="dice-roll"><div class="dice-total">27</div></div><div class="dice-roll"><div class="dice-total">20</div></div>';const flags={weaponAttack:{},weaponDamage:{areaAttack:{}}};const message={getFlag:(_,k)=>flags[k],rolls:[{total:27,dice:[{faces:20,number:1,results:[{result:20}]}]},{total:20,dice:[{faces:20,number:1,results:[{result:20}]}]}]};highlightCheckTotal(message,host);return [...host.querySelectorAll('.dice-total')].map(n=>n.className);};
          open();
        }''')
        expect(page.locator('[data-fnri-intervention-warnings] p')).to_have_count(2)
        expect(page.locator('.fnri-intervention-option-warning')).to_have_count(1)
        expect(page.locator('.fnri-intervention-option-warning')).to_contain_text('Магическая сила')
        expect(page.locator('button')).to_have_count(2)
        page.locator('[data-fnri-intervention-show-all]').check();expect(page.locator('button')).to_have_count(3)
        page.wait_for_function('flag===true');assert page.evaluate('result===undefined')
        page.get_by_role('button',name='Противодействие').evaluate('(b)=>{b.click();b.click()}')
        page.wait_for_function("result?.id==='counter'");assert page.evaluate('closes===1')
        page.evaluate('open()');expect(page.locator('[data-fnri-intervention-show-all]')).to_be_checked();page.evaluate('cancel()');page.wait_for_function('result===null')
        assert page.evaluate('groups().common.length===0 && groups().rows[0].warnings.length===1 && groups().rows[1].warnings.length===0')
        assert page.evaluate('testHighlight()')==['dice-total fnri-check-natural-twenty','dice-total']
        print('PASS one-click, double-click guard, cancel, remembered full list, common/private warnings, explicit exemption and area totals')
    finally:browser.close()
