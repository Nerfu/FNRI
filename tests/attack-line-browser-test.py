#!/usr/bin/env python3
"""Actual preroll DOM with mocked Actor and DialogV2: attack-line geometry and manual hindrance."""
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
        page.add_style_tag(content=(root/'styles/fast-nri.css').read_text())
        page.evaluate('''async () => {
          globalThis.game={user:{isGM:true},i18n:{localize:k=>k}};
          const {prepareRoll}=await import('fnri/module/rolls/roll-context.mjs');
          const {spatialAttackContext}=await import('fnri/module/spatial/spatial-context.mjs');
          const scene={id:'scene'},grid={isSquare:true,size:100,getCenterPoint:({i,j})=>({x:j*100+50,y:i*100+50}),measurePath:([a,b])=>({spaces:Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y))/100})};
          const actor={name:'Creature',uuid:'Actor.same',system:{hp:{current:10},equipment:{}},items:{contents:[]},effects:{contents:[]}};
          const token=(id,cells)=>({name:id,actor,visible:true,document:{uuid:'Scene.scene.Token.'+id,id,parent:scene,x:0,y:0,width:3,height:3,disposition:1,getOccupiedGridSpaceOffsets:()=>cells.map(([i,j])=>({i,j}))}});
          const source=token('Source',[[0,0],[1,0]]),target=token('Target',[[0,4],[1,4]]),a=token('A',[[0,1],[0,2]]),b=token('B',[[1,1],[1,2]]);
          window.foundry={applications:{api:{DialogV2:{wait:cfg=>{
            const form=document.querySelector('#preroll');form.innerHTML=cfg.content;
            cfg.render({}, {element:form});
            return new Promise(resolve=>{window.submitPreroll=async()=>resolve(await cfg.buttons[0].callback({}, {form}));});
          }}}}};
          window.openCheck=blocked=>{
            const tokens=[source,target,a,...(blocked?[b]:[])];
            const ctx=spatialAttackContext({origin:{tokenUuid:source.document.uuid},targetTokens:[target],attackKind:'ranged',scene,grid,tokens});
            window.resultPromise=prepareRoll({actor,kind:'attack',formula:'1d20',extraEntries:ctx.entries,spatialInfo:ctx});
          };
          window.openCheck(true);
        }''')
        from playwright.sync_api import expect
        formula=page.locator('[data-fnri-preview-formula]')
        obstacle=page.locator('label.fnri-preroll-choice').filter(has_text='Существа на линии атаки').locator('input')
        expect(formula).to_have_text('1d20 + (-4)')
        expect(obstacle).to_be_checked()
        obstacle.uncheck();expect(formula).to_have_text('1d20')
        obstacle.check();expect(formula).to_have_text('1d20 + (-4)')
        page.evaluate('submitPreroll()')
        assert page.evaluate('async()=> (await window.resultPromise).expression')=='1d20 + (-4)'
        page.evaluate('openCheck(false)')
        expect(obstacle).to_have_count(0)
        expect(formula).to_have_text('1d20')
        manual=page.locator('[data-fnri-hindrance-level="4"] input[type="checkbox"]').first
        manual.check();expect(formula).to_have_text('1d20 + (-4)')
        page.evaluate('submitPreroll()')
        assert page.evaluate('async()=> (await window.resultPromise).expression')=='1d20 + (-4)'
        print('PASS P.3.2 line DOM: blocked lanes, clear alternative, manual toggle and fallback')
    finally:
        browser.close()
