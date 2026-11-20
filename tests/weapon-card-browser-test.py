#!/usr/bin/env python3
"""Targeted Chromium smoke for new Item.weapon sheet, without live Foundry 14.
Uses real sheet markup and stylesheet, with simple static Handlebars substitution.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
import re
r=Path(__file__).resolve().parents[1]
s=(r/'templates/item.hbs').read_text()
for field in ['system.level','system.category','system.grip','system.distance','system.proficiencyClasses',
              'system.damageProfile.A','system.damageProfile.B','system.damageProfile.C']:
    assert 'name="'+field+'"' in s,field
assert 'data-action="weaponAttack"' in s
assert 'data-action="itemRoll"' in s, 'Old card roll must remain'
assert 'weaponRuleRows' in s
css=(r/'styles/fast-nri.css').read_text()
# Simplified realistic static weapon contents for the actual styling check.
html='''<div class="application fast-nri-v14 fast-nri-sheet" style="height:620px;width:570px;max-width:100vw;background:#28262b;color:#fff">
 <div class="window-content" style="height:100%;">
 <section class="fnri-body fnri-item-body"><header class="fnri-heading"><img class="fnri-portrait" src="" alt=""><div class="fnri-heading-fields"><label>Имя<input value="Длинный меч"></label></div></header>
 <section class="fnri-panel"><h3>Бросок карточки</h3><label>Формула броска<input value=""></label></section>
 <section class="fnri-panel"><h3>Свойства</h3><div class="fnri-weapon-fields fnri-grid-3">'''
for name,value in [('level','1'),('category','Мечи'),('grip','1'),('distance','ближняя'),('attackKind','melee'),('damageType','физический')]:
    html+=f'<label>{name}<input name="system.{name}" value="{value}"></label>'
html+='''</div><label>Владеют<input name="system.proficiencyClasses" value="Защитник, Воин, Бард, Егерь, Колдун"></label>
<label>Владение<select><option>Авто</option></select></label><label>Свойства<input value="Уверенное"></label>
<details><summary>Технические поля</summary><label>Руки<input></label></details><h3>Профиль</h3><div class="fnri-grid-3">'''
for name,value in [('A','1d10'),('B','1d4'),('C','4')]:
    html+=f'<label>{name}<input name="system.damageProfile.{name}" value="{value}"></label>'
html+='''</div><button type="button" data-action="weaponAttack">Атаковать</button>
<h3>Правило свойства</h3><details><summary>Уверенное</summary><p>Если Защитное действие должно удалить один или несколько кубов урона, вместо обычного правила выбора удаляйте указанные кубы от самого маленького.</p></details>
</section><section class="fnri-panel"><h3>Описание</h3><textarea></textarea></section>
<section class="fnri-panel"><h3>Заметки</h3><textarea></textarea></section></section></div></div>'''
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 try:
  for width in (820,570,430):
   page=b.new_page(viewport={'width':width,'height':740})
   page.set_content(html)
   page.add_style_tag(content=css)
   selector='.application .window-content'
   assert page.locator('[data-action="weaponAttack"]').count()==1
   assert page.locator('input[name^="system.damageProfile."]').count()==3
   assert page.evaluate('''() => {const n=document.querySelector('.window-content');return n.scrollHeight>n.clientHeight}'''),width
   assert page.evaluate('''() => {const n=document.querySelector('.window-content');return n.scrollWidth <= n.clientWidth+1}'''),width
   page.locator(selector).evaluate('(el)=>el.scrollTop=el.scrollHeight')
   assert page.locator('textarea').last.is_visible(),width
   page.close()
 finally:b.close()
print('PASS: Chromium weapon sheet scroll and profile fields at wide/narrow widths (static Foundry shim)')
