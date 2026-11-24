#!/usr/bin/env python3
"""Real searchable menu DOM with DialogV2 shim; not a live Foundry server."""
from pathlib import Path
from base64 import b64encode
from playwright.sync_api import sync_playwright, expect
root=Path(__file__).resolve().parents[1]
source='data:text/javascript;base64,'+b64encode((root/'module/sheets/character-choice.mjs').read_bytes()).decode()
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    try:
        page=browser.new_page()
        page.set_content('<div id="dialog"></div>')
        page.evaluate('''async url=>{
          const {chooseCharacterOption}=await import(url);
          window.foundry={applications:{api:{DialogV2:{wait:cfg=>new Promise(resolve=>{
            const el=document.querySelector('#dialog');el.innerHTML=cfg.content;
            const close=()=>resolve(null);window.cancelChoice=close;cfg.render({}, {element:el,close});
          })}}}};
          window.openChoice=()=>{window.pendingChoice=chooseCharacterOption({title:'Класс',names:['Воин','Колдун','Волшебник','Друид'],current:'Колдун',searchLabel:'Поиск',clearLabel:'Снять выбор',cancelLabel:'Отмена'});};
        }''',source)
        page.evaluate('openChoice()')
        expect(page.locator('[data-character-value]')).to_have_count(4)
        expect(page.get_by_role('button',name='Колдун')).to_have_attribute('aria-pressed','true')
        page.locator('[data-character-search]').fill('ВОЛ');expect(page.locator('[data-character-value]')).to_have_count(1)
        page.get_by_role('button',name='Волшебник').click();assert page.evaluate('pendingChoice')=='Волшебник'
        page.evaluate('openChoice()');page.get_by_role('button',name='Снять выбор').click();assert page.evaluate('pendingChoice')==''
        page.evaluate('openChoice()');page.evaluate('cancelChoice()');assert page.evaluate('pendingChoice') is None
        markup=(root/'templates/character.hbs').read_text()
        assert markup.count('data-action="chooseIdentity"')==3
        assert '{{#if showAdditionalRacialProperties}}' in markup
        assert markup.index('RacialProperties.title') < markup.index('RacialProperties.additional')
        assert 'data-action="editRacialProperties"' in markup
        print('PASS searchable choices, active selection, case-insensitive search, select/clear/cancel, ancestry guard in PC template')
    finally:browser.close()
