#!/usr/bin/env python3
"""Real sheet actions and DOM event integration in Chromium, with Foundry v14 shim.
Checks retained HP, resource, navigation and save behavior against the current sheet lock contract.
"""
from pathlib import Path
from browser_test_helpers import expand_actor_template, load_real_sheet
from playwright.sync_api import sync_playwright
from bs4 import BeautifulSoup
r=Path(__file__).resolve().parents[1]
css=(r/'styles/fast-nri.css').read_text()
# Validate structural shape of both real templates.
for actor_type in ('character','npc'):
  t=expand_actor_template(r,f'{actor_type}.hbs')
  parsed=BeautifulSoup(t,'html.parser')
  assert len(parsed.select('[data-fnri-section]'))==7
  assert len(parsed.select('[data-fnri-quick-hp]'))==(0 if actor_type=='character' else 1)
  assert len(parsed.select('[data-fnri-hp-math]'))==(2 if actor_type=='character' else 0)
  assert len(parsed.select('[data-fnri-save-state]'))==1
  assert len(parsed.select('[data-fnri-skill-filter]'))==1
  assert len(parsed.select('[data-fnri-skill-entry]'))==3
  assert not parsed.select('[data-action="openSkillEditor"], [data-action="toggleCharacterEditor"]')
  assert len(parsed.select('[data-action="rollAbility"]'))==1
  assert [x.get('data-fnri-section') for x in parsed.select('details[data-fnri-section]')]==[
    'identity','parameters','ac','defenses','effects','resources','wealth']
  assert parsed.select('[data-fnri-panel="characteristics"]')[0].find('details')
  for kind in ('potions','row'):
    buttons=parsed.select(f'button[data-action="adjustResource"][data-resource="{kind}"]')
    assert sorted(b['data-delta'] for b in buttons)==['-1','1']
  assert len(parsed.select('.fnri-resource-row'))==2
  assert len(parsed.select('.fnri-resource-warning'))==(4 if actor_type=='character' else 3)
  assert len(parsed.select('select[data-row-collection="resources"][data-row-field="assignment"]'))==1

html='''<div class="application fast-nri-v14 fast-nri-sheet" style="width:760px;height:690px"><section class="fnri-body" id="sheet">
<div class="fnri-persistent"><header class="fnri-summary-heading"><img class="fnri-portrait" src="" alt=""><b>Hero</b><span data-fnri-save-state data-state="saved"></span></header><div class="fnri-summary-stats">
<div class="fnri-summary-stat"><button type="button" data-action="toggleQuickHp" aria-expanded="false">HP 11 / 15</button></div>
<div class="fnri-summary-stat">AC 10/15/20</div><div class="fnri-summary-stat">d10</div><div class="fnri-summary-stat">7</div></div>
<button data-action="toggleSheetLock">Lock</button><div class="fnri-hp-inputs"><label>Current HP<input name="system.hp.current" data-dtype="Number" data-integer="true" data-fnri-hp-math value="11"></label><label>Temp HP<input name="system.hp.temp" data-dtype="Number" data-integer="true" data-fnri-hp-math value="0"></label></div></div>
<nav class="fnri-tabs"><button data-fnri-target="characteristics">Characteristics</button><button data-fnri-target="skills">Skills</button><button data-fnri-target="abilities">Abilities</button></nav>
<div data-fnri-panel="characteristics"><details data-fnri-section="resources" open><summary>Resources</summary><input name="system.wealth" value="10"><div class="fnri-entry fnri-resource-row" data-fnri-resource="potions"><span>Potions</span><button data-action="adjustResource" data-resource="potions" data-delta="-1">−</button><input name="system.potionsUsed" data-dtype="Number" data-integer="true" value="3" class="fnri-number"><span>/</span><span>3</span><button data-action="adjustResource" data-resource="potions" data-delta="1">+</button><span></span></div><div class="fnri-entry fnri-resource-row" data-fnri-resource="mana"><input data-row-collection="resources" data-row-id="mana" data-row-field="name" value="Mana"><button data-action="adjustResource" data-resource="row" data-id="mana" data-delta="-1">−</button><input data-row-collection="resources" data-row-id="mana" data-row-field="current" value="2" class="fnri-number"><span>/</span><input data-row-collection="resources" data-row-id="mana" data-row-field="max" value="4" class="fnri-number"><button data-action="adjustResource" data-resource="row" data-id="mana" data-delta="1">+</button><button>Delete</button></div></details></div>
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
 async _onRender(){} async _prepareContext(){return {}} async render(){this.rendered=true;}},ItemSheetV2:class{}}}};
const SKILL_GROUPS=['physical'];const BASIC_SKILLS=[];const BASIC_SKILLS_BY_ROW_ID=new Map();
const standardSkillEntry=()=>({});const skillFormula=()=>'';
const itemFormula=i=>i.system.rollFormula;
window.Roll=class {static validate(){return true;}constructor(formula){this.formula=formula;this.total=7;this.dice=[];}async evaluate(){return this;}async toMessage(data,options){rolls.push({formula:this.formula,mode:options.messageMode});return {id:'msg1',...data};}};
window.ChatMessage={getSpeaker:()=>({actor:'actorA'})};
foundry.applications.api.DialogV2.wait=async cfg=>cfg.buttons[0].callback({}, {form:{elements:{namedItem:()=>null},querySelectorAll:()=>[]}});
window.actor={isOwner:true,hasPlayerOwner:true,id:'actorA',name:'Hero',type:'character',system:{
 hp:{current:11,max:15,temp:0},skills:{},potionsUsed:3,resources:{mana:{name:"Mana",current:2,max:4}},equipment:{},equipmentSlots:{},
 ac:{partial:10,success:15,great:20},defenses:{awareness:8,reflex:8,fortitude:8,will:8}},
 _source:{system:{hp:{current:11,max:15,temp:0},skills:{},resources:{},equipment:{},equipmentSlots:{}}},
 items:{contents:[{id:'ab1',type:'ability',sort:0,img:'',name:'Mystic Power',getFlag(){return null;},system:{rollFormula:'2d6+1'}}],
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
  load_real_sheet(page,r,html,shim,after="""
for(const button of document.querySelectorAll('.fnri-tabs [data-fnri-target]'))button.addEventListener('click',e=>
 sheetActions.fnriSwitchTab.call(window.sheet,e,button));
for(const action of ['toggleSkillGroup','toggleQuickHp','rollAbility','adjustResource','toggleSheetLock'])
 for(const button of document.querySelectorAll(`[data-action="${action}"]`))button.addEventListener('click',e=>sheetActions[action].call(window.sheet,e,button));
""")
  page.add_style_tag(content=css)
  page.evaluate("sheet._configurationLocked=true;sheet._applyConfigurationLock()")
  inp=page.locator('[name="system.hp.current"]')
  temp=page.locator('[name="system.hp.temp"]')
  def edit(field, value, key, result, enter=False):
   field.fill(value);field.press('Enter' if enter else 'Tab')
   page.wait_for_function(f'actor.system.hp.{key}==={result}')
   page.wait_for_function("document.querySelector('[data-fnri-save-state]').dataset.state==='saved'")
   assert field.input_value()==str(result)
  edit(inp,'12','current',12)
  # Persistent editable inputs in both lock states; relative and absolute sums.
  for unlocked in (False,True):
   if unlocked:
    page.locator('[data-action="toggleSheetLock"]').click()
    page.wait_for_function('sheet.configurationLocked===false')
   assert inp.is_visible() and temp.is_visible()
   assert inp.is_enabled() and temp.is_enabled()
   edit(inp,'+5','current',17,True)
   edit(inp,'- 3 + 1','current',15)
   edit(inp,'18-4+2','current',16)
   edit(inp,'12','current',12)
   edit(temp,'+5','temp',5)
   edit(temp,'-2','temp',3)
   edit(temp,'0','temp',0)
  # Consecutive relative operations read the persisted value inside the queue.
  inp.evaluate("b=>{b.value='+2';b.dispatchEvent(new Event('change'));b.value='-1';b.dispatchEvent(new Event('change'))}")
  page.wait_for_function('actor.system.hp.current===13')
  page.wait_for_function("document.querySelector('[data-fnri-save-state]').dataset.state==='saved'")
  for invalid in ('1d6','1.5','3*2','1 2','1++2','9007199254740992'):
   inp.fill(invalid);inp.press('Tab')
   assert page.evaluate('actor.system.hp.current')==13
   assert not inp.evaluate('b=>b.validity.valid')
  edit(inp,'12','current',12)
  page.locator('[data-action="toggleSheetLock"]').click()
  page.wait_for_function('sheet.configurationLocked===true')
  # Filter and collapse are local UI; no writes to actor.
  page.locator('[data-fnri-target="skills"]').click()
  page.locator('[data-fnri-skill-filter]').select_option('assigned')
  assert page.locator('[data-fnri-skill-entry]:visible').count()==1
  page.locator('[data-action="toggleSkillGroup"]').click()
  assert page.locator('[data-fnri-skill-group-content]').is_hidden()
  page.locator('[data-action="toggleSkillGroup"]').click()
  assert page.locator('[data-fnri-skill-group-content]').is_visible()
  assert page.locator('[data-fnri-skill-entry]:visible').count()==1
  # Opening the local lock exposes all rows without losing the saved filter.
  page.locator('[data-action="toggleSheetLock"]').click()
  page.wait_for_function('sheet.configurationLocked===false')
  assert page.locator('[data-fnri-skill-entry]:visible').count()==2
  page.locator('[data-action="toggleSheetLock"]').click()
  page.wait_for_function('sheet.configurationLocked===true')
  assert page.locator('[data-fnri-skill-entry]:visible').count()==1
  # Real actions, including rapid clicks while the delayed write is pending.
  page.locator('[data-fnri-target="characteristics"]').click()
  plus=page.locator('[data-fnri-resource="potions"] button[data-delta="1"]')
  plus.evaluate('(b)=>{b.click();b.click()}')
  page.wait_for_function('actor.system.potionsUsed===5')
  page.locator('[data-fnri-resource="potions"] button[data-delta="-1"]').click()
  page.wait_for_function('actor.system.potionsUsed===4')
  page.locator('[data-fnri-resource="mana"] button[data-delta="1"]').click()
  page.wait_for_function('actor.system.resources.mana.current===3')
  page.locator('[data-fnri-resource="mana"] button[data-delta="-1"]').click()
  page.wait_for_function('actor.system.resources.mana.current===2')
  assert page.evaluate('actor.system.resources.mana.max')==4
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
