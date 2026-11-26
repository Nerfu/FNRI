#!/usr/bin/env python3
"""Actual damage card and editor DOM, with mocked Foundry: weakened reduction."""
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
        from playwright.sync_api import expect
        page=browser.new_page(viewport={'width':430,'height':650})
        page.set_content('<script type="importmap">'+json.dumps({'imports':imports})+'</script><div class="chat-message" data-message-id="m"><div class="message-content"></div></div>')
        page.add_style_tag(content=(root/'styles/fast-nri.css').read_text())
        page.evaluate('''async () => {
          const {openRollEditor}=await import('fnri/module/damage/roll-editor.mjs');
          const {renderDamageCard}=await import('fnri/module/damage/damage-chat.mjs');
          const S='fast-nri-v14';
          const part={id:'A',kind:'die',faces:6,original:5,value:5,formula:'1d6',damageType:'физический',excluded:false};
          const state={version:2,parts:[part],history:[],revision:0,naturalD20:20,adjustments:{penalty:0,resistance:1,vulnerability:0,physicalReduction:2}};
          const msg={id:'m',isAuthor:true,rolls:[{total:5}],flags:{[S]:{weaponDamage:state}},getFlag(s,k){return this.flags[s]?.[k];},canUserModify(){return true;},async update(patch){for(const [k,v] of Object.entries(patch))this.flags[S][k.split('.').at(-1)]=v;renderDamageCard(this,document.querySelector('.chat-message'));}};
          window.msg=msg;
          window.game={user:{isGM:true,id:'gm'},messages:{get:id=>id==='m'?msg:null,contents:[msg]},i18n:{localize:k=>k.split('.').at(-1)}};
          window.ui={notifications:{error:message=>{throw Error(message)}}};
          window.foundry={applications:{api:{DialogV2:{input:async cfg=>{
            const node=document.createElement('form');node.className='mock-dialog';node.innerHTML=cfg.content;document.body.append(node);
            return new Promise(resolve=>{const close=value=>{node.remove();resolve(value)};cfg.render?.({}, {element:node,close:async()=>close(null)});node.addEventListener('submit',event=>{event.preventDefault();close(Object.fromEntries(new FormData(node)));});if(node.querySelector('[name="newValue"]')){const button=document.createElement('button');button.type='submit';button.textContent='OK';node.append(button);}});
          }}}}};
          renderDamageCard(msg,document.querySelector('.chat-message'));
          window.editorPromise=openRollEditor(msg);
        }''')
        expect(page.locator('.fnri-damage-total')).to_have_text('total: 5 × 2 − 1 − 2 = 7')
        expect(page.locator('.fnri-roll-editor > strong')).to_have_text('total: 7')
        page.locator('[data-fnri-editor-op="adjustment:physicalReduction"]').click()
        expect(page.locator('[name="newValue"]')).to_have_value('2')
        page.locator('[name="newValue"]').fill('0')
        page.get_by_role('button',name='OK',exact=True).click()
        expect(page.locator('.fnri-damage-total')).to_have_text('total: 5 × 2 − 1 = 9')
        expect(page.locator('.fnri-roll-editor > strong')).to_have_text('total: 9')
        assert page.evaluate('msg.rolls[0].total')==5
        assert page.evaluate('msg.flags["fast-nri-v14"].weaponDamage.history.length')==1
        print('PASS Chromium weakened: critical expression, existing editor adjustment click, recalculation, immutable Roll')
    finally:
        browser.close()
