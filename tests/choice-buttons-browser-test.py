#!/usr/bin/env python3
"""Actual shared option buttons in Chromium, including native form submission."""
from pathlib import Path
from base64 import b64encode
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
module_url='data:text/javascript;base64,'+b64encode((root/'module/rolls/button-choice.mjs').read_bytes()).decode()
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    try:
        page=browser.new_page(viewport={'width':400,'height':500})
        page.set_content('<form id="choice"></form>')
        page.add_style_tag(content=(root/'styles/fast-nri.css').read_text())
        page.evaluate('''async url => {
          const api=await import(url);
          const form=document.querySelector('#choice');
          const rows=[{value:'first',label:'Самозащита'},{value:'second',label:'Уворот · ⚠ Недостаточно Вмешательств'}];
          form.innerHTML=api.buttonChoiceMarkup('Вмешательства');
          api.renderButtonChoices(form,rows);
          window.refresh=()=>api.renderButtonChoices(form,rows,form.elements.choice.value);
        }''',module_url)
        assert page.locator('select').count()==0
        assert page.locator('button').count()==2
        assert page.locator('button').first.get_attribute('aria-pressed')=='true'
        page.get_by_role('button',name='Уворот · ⚠ Недостаточно Вмешательств').click()
        assert page.locator('button').last.get_attribute('aria-pressed')=='true'
        assert page.locator('button').first.get_attribute('aria-pressed')=='false'
        assert page.evaluate("new FormData(document.querySelector('form')).get('choice')")=='second'
        page.evaluate('refresh()')
        assert page.locator('button').last.get_attribute('aria-pressed')=='true'
        print('PASS choice buttons: native DOM, clickable warning, hidden form value and selection retention')
    finally:
        browser.close()
