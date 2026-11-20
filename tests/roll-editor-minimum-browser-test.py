#!/usr/bin/env python3
"""Chromium: short single confirmation above dice maximum, auto-fix below 1, no warning in list."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import re
source=(Path(__file__).resolve().parents[1]/'module/damage/roll-editor.mjs').read_text(encoding='utf8')
source=re.sub(r'^import [^\n]+\n','',source,flags=re.M)
source=re.sub(r'\bexport (?=(async )?(function|const))','',source)
shim='''
const copy=v=>JSON.parse(JSON.stringify(v));
const calculateDamage=card=>({total:card.parts.reduce((n,p)=>n+(p.excluded?0:p.value),0)});
const criticalDamageRule=()=>({triggered:false});
const messageIntervention=()=>false;
const refreshDamageMessage=()=>{};
const changePart=()=>({});
'''
with sync_playwright() as playwright:
 browser=playwright.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 try:
  page=browser.new_page()
  page.set_content('<main></main>')
  page.add_script_tag(content=shim+source)
  state=page.evaluate('''async()=>{
    window.game={user:{isGM:true},i18n:{localize:k=>k.split('.').at(-1)}};
    const die={kind:'die',id:'d',faces:6,formula:'1d6',value:3,original:3};
    const msg={flags:{'fast-nri-v14':{weaponDamage:{version:2,parts:[die],history:[],adjustments:{}}}},getFlag(scope,key){return this.flags[scope][key];}};
    let warnings=0,confirmations=0,lastText='';
    const dialog={input:async()=>({newValue:'-5'}),prompt:async opts=>{warnings++;lastText=opts.content;},confirm:async()=>{throw Error('should not ask about -5');}};
    const low=await promptEditorNumber(msg,'set:0',dialog);
    dialog.input=async()=>({newValue:'12'});
    dialog.confirm=async opts=>{confirmations++;lastText=opts.content;return true;};
    const high=await promptEditorNumber(msg,'set:0',dialog);
    const markup=renderRollEditorContent({flags:{'fast-nri-v14':{weaponDamage:{version:2,parts:[{...die,value:12}],history:[],adjustments:{}}}},getFlag(scope,key){return this.flags[scope][key];}});
    return {low,high,warnings,confirmations,lastText,hasWarning:markup.includes('⚠'),hasHint:markup.includes('outOfRangeHint')};
  }''')
  assert state['low']==1,state
  assert state['high']==12,state
  assert state['warnings']==1 and state['confirmations']==1,state
  assert '1d6: 12 &gt; 6' in state['lastText'],state
  assert not state['hasWarning'] and not state['hasHint'],state
  print('PASS Chromium: no extra explanatory text, short one-time popup, die minimum 1, overface confirmed')
 finally:
  browser.close()
