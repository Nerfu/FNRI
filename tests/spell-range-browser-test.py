#!/usr/bin/env python3
"""Actual preroll range markup at several widths and themes."""
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
        page.set_content('<script type="importmap">'+json.dumps({'imports':imports})+'</script><main></main>')
        page.add_style_tag(content=(root/'styles/fast-nri.css').read_text())
        page.evaluate("""async () => {
          globalThis.game={i18n:{localize:k=>k}};
          const {renderRollPreparation}=await import('fnri/module/rolls/roll-context.mjs');
          window.draw=(distance,theme,attack)=>{
            document.documentElement.className=theme;
            const spatialInfo={distanceSpaces:distance,spellRange:8,...(attack?{formation:{threats:0,formation:1}}:{}),...(distance>8?{spellRangeWarning:'Цель вне дистанции заклинания'}:{})};
            document.querySelector('main').innerHTML=renderRollPreparation([],{label:'Мистический заряд',formula:'1d20+1d6',spatialInfo});
          };
        }""")
        for width in (360,420,760):
            page.set_viewport_size({'width':width,'height':650})
            for theme in ('theme-light','theme-dark'):
                for distance in (8,13):
                    for attack in (True,False):
                        page.evaluate('([distance,theme,attack])=>draw(distance,theme,attack)',[distance,theme,attack])
                        info=page.locator('.fnri-spatial-info')
                        assert f'{distance} / 8 клеток' in info.inner_text()
                        assert ('Угрозы:' in info.inner_text())==attack
                        assert page.locator('.fnri-spell-range-warning').count()==int(distance>8)
                        assert info.evaluate('(e)=>e.scrollWidth<=e.clientWidth')
        print('PASS spell range actual preroll markup, warning, widths 360/420/760, light and dark')
    finally:
        browser.close()
