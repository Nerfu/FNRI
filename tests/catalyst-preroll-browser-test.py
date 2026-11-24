#!/usr/bin/env python3
"""Actual preroll render callback: a dependent option appears and resets with Blade."""
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
          const {chooseRollEffects}=await import('fnri/module/rolls/roll-context.mjs');
          const {attackAugmentEntries}=await import('fnri/module/rolls/attack-augmentations.mjs');
          const item={type:'ability',id:'blade',uuid:'Actor.A.Item.blade',name:'Лезвие',system:{mechanics:{attackAugment:{id:'blade',spellDamage:true,damageParts:[{formula:'1d8',damageType:'магический'}]}}}};
          const actor={items:{contents:[item]},system:{}};
          const [blade]=attackAugmentEntries(actor,{kind:'attack'});
          const catalyst={uuid:'weapon-auto-reroll:catalyst',name:'Катализатор',requiresAny:[{entryUuid:blade.uuid,partId:blade.parts[0].id}],native:false,parts:[{id:'auto',kind:'weaponTrait',label:'Автопереброс',defaultEnabled:false}]};
          const sweeping={uuid:'weapon-auto-reroll:sweeping',name:'Размашистое',native:false,parts:[{id:'auto',kind:'weaponTrait',label:'Автопереброс',defaultEnabled:false}]};
          window.foundry={applications:{api:{DialogV2:{wait:cfg=>{
            const form=document.querySelector('#preroll');form.innerHTML=cfg.content;
            cfg.render({}, {element:form});
            return new Promise(resolve=>{window.submitPreroll=async()=>{const result=await cfg.buttons[0].callback({}, {form});window.chosen=result.selected.map(e=>e.uuid);resolve(result);};});
          }}}}};
          window.resultPromise=chooseRollEffects([blade,catalyst,sweeping],{actor,formula:'1d20'});
        }''')
        blade=page.locator('[name="part_0_0"]')
        catalyst=page.locator('[name="part_1_0"]')
        sweeping=page.locator('[name="part_2_0"]')
        group=page.locator('[data-fnri-dependent-entry="1"]')
        assert not group.is_visible()
        assert sweeping.is_visible()
        blade.check()
        assert group.is_visible() and not catalyst.is_checked()
        catalyst.check();sweeping.check();blade.uncheck()
        assert not group.is_visible() and not catalyst.is_checked()
        assert sweeping.is_checked()
        blade.check()
        assert group.is_visible() and not catalyst.is_checked()
        catalyst.check()
        page.evaluate('submitPreroll()')
        assert page.evaluate('chosen')==['attack-augment:Actor.A.Item.blade:blade','weapon-auto-reroll:catalyst','weapon-auto-reroll:sweeping']
        print('PASS Catalyst actual preroll DOM: hidden initially, toggles with Blade, clears on hide, independent Sweeping, confirmed selections')
    finally:
        browser.close()
