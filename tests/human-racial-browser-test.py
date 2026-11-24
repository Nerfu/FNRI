#!/usr/bin/env python3
"""Actual Combat Master preroll and racial editor warnings/removal."""
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
        page.add_style_tag(content=(root/'styles/fast-nri.css').read_text() + "\n#preroll { width: 328px }")
        from playwright.sync_api import expect
        page.evaluate('''async () => {
          const S='fast-nri-v14';
          const {prepareRoll}=await import('fnri/module/rolls/roll-context.mjs');
          const {openRacialPropertyEditor}=await import('fnri/module/sheets/racial-property-picker.mjs');
          const mk=(id,name,rule,contentId)=>({id,uuid:'Actor.Hero.Item.'+id,name,type:'ability',system:{mechanics:{racialProperty:rule}},flags:{[S]:{contentId}},getFlag(s,k){return this.flags[s]?.[k]}});
          const master=mk('master','Мастер боя',{races:['human']},'fnri7.rulebook.racial.master-boia');
          const innate=mk('innate','Умелый',{innateOnly:true},'fnri7.rulebook.racial.umelyi');
          const wrong=mk('wrong','Драконье свойство',{races:['draconic']},'custom.wrong');
          wrong.system.description='Проверка описания. '+ 'ДлиннаяСтрока'.repeat(80);
          const own=[master,innate,mk('a','A',{universal:true},'custom.a'),mk('b','B',{universal:true},'custom.b')];
          const actor={id:'Hero',type:'character',items:{contents:own,get(id){return own.find(i=>i.id===id)}},system:{race:'Человек',combatDie:'d10'},effects:{contents:[]},uuid:'Actor.Hero',name:'Hero',flags:{[S]:{}},getFlag(s,k){return this.flags[s]?.[k]}};
          window.racialWorld={};globalThis.game={settings:{get:(_s,k)=>window.racialWorld[k]??false},user:{flags:{},getFlag(s,k){return this.flags[k]},async setFlag(s,k,v){this.flags[k]=v}},i18n:{localize:k=>({ 'FASTNRI.GameReroll.exhausted':'Нет оставшихся применений','FASTNRI.AbilityChat.dailyRemaining':'Осталось в день: {remaining}','FASTNRI.RacialProperties.wrongRace':'Чужая раса','FASTNRI.RacialProperties.limitReached':'Превышен предел','FASTNRI.RacialProperties.limitMissingOne':'Осталось выбрать {remaining} свойство','FASTNRI.RacialProperties.limitMissingFew':'Осталось выбрать {remaining} свойства','FASTNRI.RacialProperties.limitMissingMany':'Осталось выбрать {remaining} свойств'}[k]??k),lang:'ru'},packs:{get:()=>({getDocuments:async()=>[master,innate,wrong]})}};
          window.foundry={applications:{api:{DialogV2:{wait:cfg=>{
            const form=document.querySelector('#preroll');form.innerHTML=cfg.content;
            cfg.render({}, {element:form});
            return new Promise(resolve=>{window.submitPreroll=async()=>resolve(await cfg.buttons[0].callback({}, {form}));});
          }}}}};
          window.openAttack=(exhausted)=>{actor.flags[S].accountingEvents=exhausted?{x:{type:'use',sourceItemUuid:master.uuid}}:{};window.resultPromise=prepareRoll({actor,kind:'attack',usesCombatDie:true,formula:'1d20 + 1d10'});};
          window.openRaces=()=>{void openRacialPropertyEditor(actor,{add:async card=>{own.push(card)},remove:async id=>{own.splice(own.findIndex(i=>i.id===id),1)}});};
          window.openAttack(false);
        }''')
        field=page.locator('label.fnri-preroll-choice').filter(has_text='Мастер боя').locator('input')
        formula=page.locator('[data-fnri-preview-formula]')
        expect(field).not_to_be_checked();expect(formula).to_have_text('1d20 + 1d10')
        expect(page.locator('[data-fnri-preroll]')).to_contain_text('Осталось в день: 1')
        field.check();expect(formula).to_have_text('1d20 + 1d12')
        page.evaluate('submitPreroll()');assert page.evaluate('async()=> (await window.resultPromise).expression')=='1d20 + 1d12'
        page.evaluate('openAttack(true)');expect(page.locator('[data-fnri-preroll]')).to_contain_text('Нет оставшихся применений')
        expect(field).not_to_be_checked();expect(field).to_be_enabled();field.check();expect(formula).to_have_text('1d20 + 1d12')
        page.evaluate('submitPreroll()');assert page.evaluate('async()=> (await window.resultPromise).expression')=='1d20 + 1d12'
        page.evaluate('openRaces()')
        row=page.locator('.fnri-racial-option').filter(has_text='Драконье свойство')
        expect(row).to_have_count(0)
        toggle=page.locator('[data-racial-show-all]');expect(toggle).not_to_be_checked();toggle.check()
        expect(row.locator("button")).to_be_disabled()
        expect(page.locator('[data-racial-status]')).to_be_hidden()
        expect(page.locator('.fnri-racial-option .fnri-racial-warning')).to_have_count(0)
        row.locator("summary").click()
        page.wait_for_function("""() => {
          const list = document.querySelector('[data-racial-options]');
          return list.scrollWidth === list.clientWidth;
        }""")
        page.evaluate("racialWorld.racialAllowExcess=true;openRaces()")
        expect(row.locator("button")).to_be_enabled()
        row.locator("button").click()
        expect(row.locator("button")).to_have_attribute("aria-pressed", "true")
        expect(page.locator('[data-racial-count]')).to_contain_text('4 / 3')
        expect(page.locator('[data-racial-status]')).to_be_hidden()
        row.locator("button").click()
        expect(row.locator("button")).to_have_attribute("aria-pressed", "false")
        expect(page.locator('[data-racial-count]')).to_contain_text('3 / 3')
        expect(page.locator('[data-racial-status]')).to_be_hidden()
        page.get_by_role("button", name="Мастер боя").click()
        expect(page.locator('[data-racial-status]')).to_have_text('Осталось выбрать 1 свойство')
        expect(page.get_by_role("button", name="Умелый")).to_be_disabled()
        page.evaluate("racialWorld.racialAllowInnateRemoval=true;openRaces()")
        page.get_by_role("button", name="Умелый").click()
        expect(page.get_by_role("button", name="Умелый")).to_have_attribute("aria-pressed", "false")
        page.evaluate('openRaces()');expect(toggle).to_be_checked()
        page.evaluate("""async()=>{
          const {registerFreeHp}=await import('fnri/module/damage/free-hp.mjs');
          const S='fast-nri-v14', message={id:'potion1',flags:{[S]:{itemUseResult:{potion:true,results:[]}}},getFlag(s,k){return this.flags[s]?.[k]}};
          const actor={uuid:'Actor.receiving',name:'Receiver',isOwner:true,system:{potionsUsed:3},items:{contents:[]},flags:{[S]:{}},getFlag(s,k){return this.flags[s]?.[k]},async update(changes){for(const [path,v] of Object.entries(changes)){let target=this;const keys=path.split('.');for(const k of keys.slice(0,-1))target=target[k]??={};target[keys.at(-1)]=v}}};
          game.messages={get:id=>id===message.id?message:null};window.canvas={tokens:{controlled:[{actor,name:actor.name}]}};
          window.potionNotices=[];window.ui={notifications:{warn:s=>potionNotices.push(s),info:s=>potionNotices.push(s)}};
          window.Hooks={callbacks:[],on(name,fn){if(name==='renderChatMessageHTML')this.callbacks.push(fn)}};
          const html=document.createElement('div');html.className='message-content';document.body.append(html);
          registerFreeHp();for(const cb of Hooks.callbacks)cb(message,html);window.potionActor=actor;
        }""")
        receipt=page.locator('[data-fnri-potion-receipt]');expect(receipt).to_be_visible();receipt.click()
        page.wait_for_function('potionActor.system.potionsUsed===4');assert page.evaluate("potionNotices.includes('FASTNRI.Potions.over')")
        receipt.click();page.wait_for_function("potionNotices.includes('FASTNRI.Potions.alreadyReceived')");assert page.evaluate('potionActor.system.potionsUsed')==4
        print('PASS Combat Master, racial filter and persistence, warnings, innate removal, potion receipt DOM and repeat protection')
    finally:
        browser.close()
