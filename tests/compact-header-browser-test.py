#!/usr/bin/env python3
"""Chromium layout check using the actual actor header/Characteristics HTML & CSS.
Static representative actor data, not a running Foundry installation.
"""
from pathlib import Path
import re
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
css=(root/'styles/fast-nri.css').read_text()
translations={
  'FASTNRI.Sections.ac':'Три порога КЗ','FASTNRI.Fields.acShort':'КЗ',
  'FASTNRI.Fields.combatDie':'Куб боя','FASTNRI.Fields.speed':'Скорость',
  'FASTNRI.Fields.hpCurrent':'HP сейчас','FASTNRI.Fields.hpMax':'HP максимум',
  'FASTNRI.Sections.characteristics':'Характеристики',
}

def preview(actor_type):
    source=(root/'templates'/f'{actor_type}.hbs').read_text()
    assert source.count('class="fnri-summary-stat"')==4
    assert source.count('name="system.hp.current"')==2
    assert source.rindex('name="system.hp.current"') > source.index('fnri-tabs')
    # Render exactly the header portion; detailed fields are checked in template.
    s=source[:source.index('<nav class="fnri-tabs"')]
    for key, val in translations.items():
      s=s.replace('{{localize "'+key+'"}}',val).replace("{{localize '"+key+"'}}",val)
    for key,val in {'actor.name':'Боб','actor.img':'', 'summary.hp':'18 / 25', 'summary.ac':'10 / 18 / 22',
                    'summary.combatDie':'d10', 'summary.speed':'7','summary.tempHP':'+3',
                    'system.className':'Воин','system.level':'3','system.role':'Герой', 'system.rank':'1',
                    'system.hp.current':'18','system.hp.max':'25','system.hp.temp':'3'}.items():
      s=s.replace('{{'+key+'}}',val)
    # Remove Handlebars directives but preserve representative editable header controls.
    s=re.sub(r'{{[#/][^}]*}}','',s)
    s=re.sub(r'{{[^}]*}}','',s)
    s+='<nav class="fnri-tabs"><button>Навыки</button></nav><input name="system.defenses.will" value="10">'
    return '<div class="application fast-nri-v14 fast-nri-sheet" style="width:760px; max-width:100vw; height:690px; background:#24222a; color:white"><div class="window-content" style="height:100%">'+s+'</div></div>'

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    try:
        for actor_type in ['character','npc']:
          for width in [1000,580,460]:
            page=browser.new_page(viewport={'width':width,'height':800})
            page.set_content(preview(actor_type))
            page.add_style_tag(content=css)
            summary=page.locator('.fnri-persistent')
            nav=page.locator('.fnri-tabs')
            assert summary.is_visible() and nav.is_visible()
            assert page.locator('.fnri-summary-stat').count()==4
            assert page.locator('input[name="system.hp.current"]').count()==1
            height=summary.bounding_box()['height']
            assert height < (160 if width>=681 else 190), (actor_type,width,height)
            assert page.evaluate('''() => {
              const box=document.querySelector('.fnri-summary-stats');
              return box.scrollWidth <= box.clientWidth + 1;
            }'''),(actor_type,width,'summary overflow')
            # All detailed fields occur below the tab bar.
            assert page.locator('input[name="system.defenses.will"]').bounding_box()['y']>nav.bounding_box()['y']
            page.close()
    finally:browser.close()
print('PASS: Chromium compact actor/NPC header at 760/580/460 px, details in first tab')
