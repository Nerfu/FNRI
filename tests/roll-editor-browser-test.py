#!/usr/bin/env python3
"""Chromium: real native controls from v0.1.14 roll editor HTML; v14-shim, not server."""
from pathlib import Path
from subprocess import check_output
from playwright.sync_api import sync_playwright
r=Path(__file__).resolve().parents[1]
script='''import {renderRollEditorContent} from "./module/damage/roll-editor.mjs";
const ID="fast-nri-v14";
globalThis.game={user:{id:"gm",isGM:true},i18n:{localize:k=>k.split(".").at(-1)}};
const c={version:2,isIntervention:true,parts:[
 {id:"die",kind:"die",faces:4,original:1,value:0,excluded:true,formula:"1d4"},
 {id:"die2",kind:"die",faces:8,original:5,value:5,excluded:false,formula:"1d8"},
 {id:"fix",kind:"fixed",original:2,value:2,excluded:false,formula:"+2"}],history:[],adjustments:{penalty:0,resistance:0,vulnerability:0}};
const m={getFlag:(scope,k)=> k==="weaponDamage"?c:null};
console.log(renderRollEditorContent(m));'''
html=check_output(['node','--input-type=module','--eval',script],cwd=r,text=True)
with sync_playwright() as p:
  browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  try:
    page=browser.new_page(viewport={'width':420,'height':720})
    page.set_content('<form id="editor">'+html+'</form>')
    page.add_style_tag(content=(r/'styles/fast-nri.css').read_text())
    assert page.locator('input[type=radio]').count()==0,'actions must not be radio buttons'
    assert page.locator('input[type=number]').count()==0,'number inputs appear only in a popup'
    assert page.locator('button[data-fnri-editor-op="reroll:0"]').count()==1
    assert page.locator('button[data-fnri-editor-op="restore:0"]').count()==1
    assert page.locator('button[data-fnri-editor-op="reset:0"]').count()==1
    assert page.locator('button[data-fnri-editor-op="set:0"]').count()==1
    assert page.locator('button[data-fnri-editor-op="reroll:2"]').count()==0,'fixed bonus cannot be rerolled'
    assert page.locator('button[data-fnri-editor-op="offset"]').count()==0,'damage card has no roll offset'
    assert page.locator('input[name=intervention]').is_checked()
    assert not page.locator('input[name=critical]').is_checked()
    assert page.locator('select').count()==0,'no dropdown in editor'
    assert page.locator('[disabled]').count()==0,'no disabled controls'
    page.locator('input[name=intervention]').uncheck()
    page.locator('input[name=critical]').check()
    values=page.locator('#editor').evaluate('form => Object.fromEntries(new FormData(form))')
    assert values['critical']=='true' and values['criticalPresent']=='1'
    assert values['interventionPresent']=='1' and 'intervention' not in values
    assert page.locator('button[data-fnri-editor-op="set:1"]').get_attribute('type')=='button'
    assert page.locator('.fnri-roll-editor').evaluate('(e)=> e.scrollHeight > e.clientHeight'), 'long editor scrolls'
    print('PASS Chromium: action buttons, no radio or numeric fields, independent intervention and critical checkboxes, no disabled buttons, scrolling')
  finally: browser.close()
