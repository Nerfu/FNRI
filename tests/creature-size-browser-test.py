#!/usr/bin/env python3
"""Real PC/NPC size selector and sheet change handler; Foundry documents mocked."""
from pathlib import Path
from browser_test_helpers import load_real_sheet, renderer
from playwright.sync_api import expect, sync_playwright
root=Path(__file__).resolve().parents[1]
markup={}
for name in ('character','npc'):
    source=(root/'templates'/f'{name}.hbs').read_text()
    start=source.index('<label>{{localize "FASTNRI.CreatureSize.label"}}')
    markup[name]=source[start:source.index('</label>',start)+8]
shim='''
window.game={i18n:{localize:k=>k},user:{id:'me'},settings:{get:(s,k)=>k==='skillAllocationMode'?'free':'public'}};
window.ui={notifications:{warn:console.warn,error:console.error}};
class Sheet{constructor({actor}){this.actor=actor;this.isEditable=true;this.element=document.querySelector('#sheet');}async _onRender(){} async _prepareContext(){return {}}}
window.foundry={utils:{randomID:()=> 'id'},applications:{api:{HandlebarsApplicationMixin:p=>p},sheets:{ActorSheetV2:Sheet,ItemSheetV2:class{}}}};
window.raw={skills:{},equipment:{},equipmentSlots:{},resources:{},hp:{current:5,max:5},size:'medium'};
window.actor={id:'a',uuid:'Actor.a',type:'character',system:structuredClone(raw),items:{contents:[]},effects:{contents:[]},getFlag:()=>null,
 prototypeToken:{width:1,height:1},canUserModify:()=>true,toObject:()=>({system:structuredClone(raw)}),
 getDependentTokens:()=>[token],async update(changes){if(changes['system.size'])raw.size=changes['system.size'];if(changes['system.sizeState'])raw.sizeState=structuredClone(changes['system.sizeState']);if(changes['prototypeToken.width'])Object.assign(this.prototypeToken,{width:changes['prototypeToken.width'],height:changes['prototypeToken.height']});this.system=structuredClone(raw);}};
window.token={actor,actorLink:true,width:1,height:1,canUserModify:()=>true,async update(changes){Object.assign(this,changes);}};
'''
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    try:
        page=browser.new_page(viewport={'width':360,'height':600})
        load_real_sheet(page,root,'<section id="sheet" class="fast-nri-v14 fast-nri-sheet"><div class="window-content"></div></section>',shim)
        page.evaluate('(markup)=>window.markup=markup',markup)
        page.add_script_tag(content=renderer)
        page.add_style_tag(content=(root/'styles/fast-nri.css').read_text())
        page.evaluate('''async()=>{
          window.paint=async()=>{const ctx=await sheet._prepareContext({});sheet.element.querySelector('.window-content').innerHTML=renderSkill(markup[actor.type],ctx);await sheet._onRender({},{});};
          await paint();
        }''')
        select=page.locator('select[name="system.size"]')
        expect(select).to_have_value('medium');expect(select.locator('option')).to_have_count(5);expect(select.locator('option[value="gigantic"]')).to_have_count(0)
        select.select_option('large');page.wait_for_function('actor.system.size==="large" && token.width===2 && actor.prototypeToken.height===2')
        select.select_option('huge');page.wait_for_function('token.width===3 && token.height===3')
        select.select_option('default');page.wait_for_function('actor.system.size==="medium" && token.width===1');expect(select).to_have_value('medium')
        select.select_option('huge');page.wait_for_function('token.width===3 && token.height===3')
        page.evaluate('async()=>{sheet._configurationLocked=true;await paint()}');expect(select).to_be_disabled()
        page.evaluate('''async()=>{const {FastNRINPCSheet}=await import('fnri/module/sheets/sheets.mjs');actor.type='npc';window.sheet=new FastNRINPCSheet({actor});sheet._configurationLocked=false;await paint()}''')
        expect(select).to_have_value('huge');select.select_option('small');page.wait_for_function('actor.system.size==="small" && token.width===1')
        print('PASS native select, PC/NPC actual sheet handler, lock, prototype/linked token size (mock documents)')
    finally:browser.close()
