#!/usr/bin/env python3
"""Chromium: verify built-in selection, source/prepare discrepancy, and saving only touched record.
Narrow Foundry API mock; full live-world integration remains user testing.
"""
from pathlib import Path
from browser_test_helpers import expand_actor_template, load_real_sheet
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
for name in ('character','npc'):
    template=expand_actor_template(root,f'{name}.hbs')
    for required in ('{{#each catalogGroups}}','{{#each this.rows}}','fnri-core-skill-name','data-fnri-dice-picker="skill"','data-row-field="modifier"','{{#each skillRows}}',('data-action="openSkillEditor"' if name=='character' else 'data-action="addSpecialization"')):
        assert required in template, (name,required)

html='''<div id="sheet"><div id="skills">
<span class="fnri-core-skill-name">Аркана</span>
<select data-fnri-dice-picker="skill" data-row-id="core_arcana">
<option value="">—</option><option value="1d4">d4</option><option value="1d8">d8</option><option value="1d10">d10</option><option value="__custom__">Своя формула…</option></select>
<input data-fnri-custom-dice data-row-collection="skills" data-row-id="core_arcana" data-row-field="dice" value="" hidden>
<input data-row-collection="skills" data-row-id="core_arcana" data-row-field="modifier" value="" />
</div></div>'''
shim='''window.game={i18n:{localize:key=>key},settings:{get:()=>"public"}};
window.ui={notifications:{warn:()=>{},error:()=>{}}};
window.foundry={applications:{api:{HandlebarsApplicationMixin:Parent=>Parent,DialogV2:{}},sheets:{ActorSheetV2:class {
 constructor({actor}){this.actor=actor;this.element=document.getElementById('sheet');this.isEditable=true;}
 async _onRender(){} async _prepareContext(){return {};}
},ItemSheetV2:class {}}}};
window.actor={id:'a',type:'character',name:'Герой',system:{skills:{},resources:{},equipment:{},equipmentSlots:{}},
 _source:{system:{skills:{old:{name:'Свой',kind:'skill',dice:'3d4',modifier:0},core_arcana:{name:'Аркана',kind:'skill',dice:'1d10',modifier:5}},resources:{},equipment:{},equipmentSlots:{}}},
 items:{contents:[]},effects:{contents:[]},
 toObject(){return structuredClone(this._source)},updates:[],
 async update(change){this.updates.push(change);
   for(const [key,val] of Object.entries(change)){
     const bits=key.slice(7).split('.');let data=this._source.system;
     while(bits.length>1){const next=bits.shift();data[next]??={};data=data[next];}
     data[bits[0]]=val;
   }
 }};'''
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    try:
        page=browser.new_page()
        load_real_sheet(page,root,html,shim)
        # Source record exists, while prepared record is missing. A dice edit
        # must NOT reset the original name or modifier.
        page.locator('[data-fnri-dice-picker="skill"]').select_option('1d8')
        page.wait_for_function("window.actor._source.system.skills.core_arcana.dice==='1d8'")
        entry=page.evaluate('window.actor._source.system.skills.core_arcana')
        assert entry['name']=='Аркана' and entry['modifier']==5,entry
        changes=page.evaluate('window.actor.updates')
        assert changes==[{'system.skills.core_arcana.dice':'1d8'}],changes
        assert page.evaluate('window.actor._source.system.skills.old.dice')=='3d4'
        # Browser changes to modifier must remain addressable after updating dice
        page.locator('[data-row-field="modifier"]').fill('4')
        page.locator('[data-row-field="modifier"]').press('Tab')
        page.wait_for_function("window.actor._source.system.skills.core_arcana.modifier===4")
        # Original Actor name unchanged, and 15 catalogue skills can be prepared
        result=page.evaluate('''async () => {
          const ctx=await window.sheet._prepareContext({});
          return {count:ctx.catalogGroups.flatMap(x=>x.rows).length,custom:ctx.skillRows[0].name};
        }''')
        assert result=={'count':15,'custom':'Свой'},result
        page.close()
    finally:
        browser.close()
print('PASS: Chromium 15 Rulebook skills, source/prepared discrepancy, addressable dice/modifier edits, custom skill preserved')
