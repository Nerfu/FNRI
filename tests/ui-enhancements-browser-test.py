#!/usr/bin/env python3
"""Real sheet actions and DOM event integration in Chromium, with Foundry v14 shim.
Tests six v0.1.10 UI changes without pretending to start a Foundry server.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
from bs4 import BeautifulSoup
r=Path(__file__).resolve().parents[1]
css=(r/'styles/fast-nri.css').read_text()
source=(r/'module/sheets/sheets.mjs').read_text().replace('export class ','class ')
source='\n'.join(line for line in source.splitlines() if not line.startswith('import '))
source='// Equipment/attack internals are covered by separate Node tests; these browser tests target legacy UI behavior.\nconst itemSlot=()=>null, equipmentKind=()=>null, itemGrip=()=>"1", hasFreeSecondHand=()=>true;\nconst isPhysicalWeaponCard=()=>false, isPhysicalOtherItemAttack=()=>false;\nconst explicitInterventionFromCard=()=>false, normalizeAttackKind=()=>null, effectiveWeaponProperties=()=>"", hasComputedReach=()=>false;\nconst resolveUnarmedAction=()=>({name:"Безоружная атака",conflict:false});\n'+source
# Validate structural shape of both real templates.
for actor_type in ('character','npc'):
  t=(r/'templates'/f'{actor_type}.hbs').read_text()
  parsed=BeautifulSoup(t,'html.parser')
  assert len(parsed.select('[data-fnri-section]'))==7
  assert len(parsed.select('[data-fnri-quick-hp]'))==1
  assert len(parsed.select('[data-fnri-save-state]'))==1
  assert len(parsed.select('[data-fnri-skill-filter]'))==1
  assert len(parsed.select('[data-fnri-skill-entry]'))==2
  assert len(parsed.select('[data-action="rollAbility"]'))==1
  assert [x.get('data-fnri-section') for x in parsed.select('details[data-fnri-section]')]==[
    'identity','parameters','ac','defenses','effects','resources','wealth']
  assert parsed.select('[data-fnri-panel="characteristics"]')[0].find('details')

html='''<div class="application fast-nri-v14 fast-nri-sheet" style="width:760px;height:690px"><section class="fnri-body" id="sheet">
<div class="fnri-persistent"><header class="fnri-summary-heading"><img class="fnri-portrait" src="" alt=""><b>Hero</b><span data-fnri-save-state data-state="saved"></span></header><div class="fnri-summary-stats">
<div class="fnri-summary-stat"><button type="button" data-action="toggleQuickHp" aria-expanded="false">HP 11 / 15</button></div>
<div class="fnri-summary-stat">AC 10/15/20</div><div class="fnri-summary-stat">d10</div><div class="fnri-summary-stat">7</div></div>
<div data-fnri-quick-hp hidden><label>Current HP<input name="system.hp.current" data-dtype="Number" data-integer="true" value="11"></label><label>Temp HP<input name="system.hp.temp" data-dtype="Number" data-integer="true" value="0"></label></div></div>
<nav class="fnri-tabs"><button data-fnri-target="characteristics">Characteristics</button><button data-fnri-target="skills">Skills</button><button data-fnri-target="abilities">Abilities</button></nav>
<div data-fnri-panel="characteristics"><details data-fnri-section="resources" open><summary>Resources</summary><input name="system.wealth" value="10"></details></div>
<div data-fnri-panel="skills"><select data-fnri-skill-filter><option value="all">All</option><option value="assigned">With dice</option></select>
<button data-action="toggleSkillGroup" data-group="physical" aria-expanded="true">Physical</button>
<div data-fnri-skill-group-content="physical"><div data-fnri-skill-entry data-fnri-dice-assigned="false">Acrobatics</div><div data-fnri-skill-entry data-fnri-dice-assigned="true">Athletics</div></div></div>
<div data-fnri-panel="abilities"><li data-item-id="ab1"><button data-action="rollAbility">Roll ability</button></li></div>
</section></div>'''
shim='''
const flags={}; const rolls=[];const errors=[];
window.savedFlags=flags;window.rolls=rolls;
window.game={user:{getFlag(_system,key){return flags[key]},setFlag(_system,key,v){flags[key]=v;return Promise.resolve(v)}},
  i18n:{localize(key){return key}},settings:{get(){return 'gm'}}};
window.ui={notifications:{error(x){errors.push(x)},warn(x){errors.push(x)}}};
window.foundry={applications:{api:{HandlebarsApplicationMixin:Parent=>Parent,DialogV2:{confirm:async()=>true}},
 sheets:{ActorSheetV2:class {constructor({actor}){this.actor=actor;this.element=document.querySelector('#sheet');this.isEditable=true;}
 async _onRender(){} async _prepareContext(){return {}}},ItemSheetV2:class{}}}};
const SKILL_GROUPS=['physical'];const BASIC_SKILLS=[];const BASIC_SKILLS_BY_ROW_ID=new Map();
const standardSkillEntry=()=>({});const skillFormula=()=>'';
const itemFormula=i=>i.system.rollFormula;
const postRoll=async data=>{rolls.push(data);return data;};
window.actor={id:'actorA',name:'Hero',type:'character',system:{
 hp:{current:11,max:15,temp:0},skills:{},resources:{},equipment:{},equipmentSlots:{},
 ac:{partial:10,success:15,great:20},defenses:{awareness:8,reflex:8,fortitude:8,will:8}},
 _source:{system:{hp:{current:11,max:15,temp:0},skills:{},resources:{},equipment:{},equipmentSlots:{}}},
 items:{contents:[{id:'ab1',type:'ability',sort:0,img:'',name:'Mystic Power',system:{rollFormula:'2d6+1'}}],
 get(id){return this.contents.find(x=>x.id===id)}},effects:{contents:[]},async update(changes){
 await new Promise(resolve=>setTimeout(resolve,20));if(this.fail)throw new Error('db failure');
 for(const [key,val] of Object.entries(changes)){let target=this.system;const parts=key.slice(7).split('.');
 while(parts.length>1){const part=parts.shift();target=target[part]||(target[part]={});}target[parts[0]]=val;}
 }};
window.errors=errors;
'''
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 try:
  page=browser.new_page(viewport={'width':900,'height':800})
  page.set_content(html)
  page.add_style_tag(content=css)
  page.add_script_tag(content=shim+'\n'+source+'''
window.sheet=new FastNRICharacterSheet({actor:window.actor});
window.sheet._onRender({},{});
for(const button of document.querySelectorAll('.fnri-tabs [data-fnri-target]'))button.addEventListener('click',e=>
 FastNRICharacterSheet.DEFAULT_OPTIONS.actions.fnriSwitchTab.call(window.sheet,e,button));
for(const button of document.querySelectorAll('[data-action="toggleSkillGroup"]'))button.addEventListener('click',e=>
 FastNRICharacterSheet.DEFAULT_OPTIONS.actions.toggleSkillGroup.call(window.sheet,e,button));
for(const button of document.querySelectorAll('[data-action="toggleQuickHp"]'))button.addEventListener('click',e=>
 FastNRICharacterSheet.DEFAULT_OPTIONS.actions.toggleQuickHp.call(window.sheet,e,button));
for(const button of document.querySelectorAll('[data-action="rollAbility"]'))button.addEventListener('click',e=>
 FastNRICharacterSheet.DEFAULT_OPTIONS.actions.rollAbility.call(window.sheet,e,button));
''')
  assert page.locator('[data-fnri-quick-hp]').is_hidden()
  page.locator('[data-action="toggleQuickHp"]').click()
  assert page.locator('[data-fnri-quick-hp]').is_visible()
  assert page.locator('[data-action="toggleQuickHp"]').get_attribute('aria-expanded')=='true'
  inp=page.locator('[name="system.hp.current"]')
  inp.fill('12');inp.press('Tab')
  page.wait_for_function("window.actor.system.hp.current===12")
  assert page.locator('[data-fnri-save-state]').get_attribute('data-state')=='saved'
  page.locator('[data-action="toggleQuickHp"]').click()
  assert page.locator('[data-fnri-quick-hp]').is_hidden()
  # Filter and collapse are local UI; no writes to actor.
  page.locator('[data-fnri-skill-filter]').select_option('assigned')
  assert page.locator('[data-fnri-skill-entry]:visible').count()==1
  page.locator('[data-action="toggleSkillGroup"]').click()
  assert page.locator('[data-fnri-skill-group-content]').is_hidden()
  page.locator('[data-action="toggleSkillGroup"]').click()
  assert page.locator('[data-fnri-skill-group-content]').is_visible()
  assert page.locator('[data-fnri-skill-entry]:visible').count()==1
  # Native details persists in same sheet across _prepareContext calls.
  page.locator('[data-fnri-section="resources"] summary').click()
  page.wait_for_function("window.sheet._sectionState.get('resources')===false")
  assert page.evaluate('window.sheet._sectionState.get("resources")') is False
  # Tab persistence lives on User only, not Actor and survives fresh sheet.
  page.locator('[data-fnri-target="skills"]').click()
  page.wait_for_function("window.savedFlags.sheetTab_actorA==='skills'")
  assert page.evaluate("(new FastNRICharacterSheet({actor:window.actor}))._selectedTab")=='skills'
  # Ability roll uses Item's own formula and native message visibility.
  page.locator('[data-fnri-target="abilities"]').click()
  page.locator('[data-action="rollAbility"]').click()
  page.wait_for_function('window.rolls.length===1')
  assert page.evaluate('window.rolls[0].formula')=='2d6+1'
  assert page.evaluate('window.rolls[0].mode')=='gm'
  # Failure must stay visible, then clearing the failed field restores saved.
  page.evaluate('window.actor.fail=true')
  page.locator('[data-action="toggleQuickHp"]').click()
  inp=page.locator('[name="system.hp.temp"]');inp.fill('3');inp.press('Tab')
  page.wait_for_function("document.querySelector('[data-fnri-save-state]').dataset.state==='error'")
  assert page.evaluate('window.errors.length')>0
  page.evaluate('window.actor.fail=false')
  inp.fill('4');inp.press('Tab')
  page.wait_for_function("document.querySelector('[data-fnri-save-state]').dataset.state==='saved'")
  assert page.evaluate('window.actor.system.hp.temp')==4
  page.close()
 finally:browser.close()
print('PASS: Chromium quick HP, save/error/retry, skill filter/groups, collapsible details, tab flags, ability roll')
