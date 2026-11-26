#!/usr/bin/env python3
"""Actual publication controls, Foundry documents and Roll mocked."""
import base64,json,re
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
root=Path(__file__).resolve().parents[1]
imports={}
for file in sorted((root/'module').rglob('*.mjs')):
    def specifier(match):
        target=(file.parent/match.group(3)).resolve()
        return match.group(1)+match.group(2)+'fnri/'+target.relative_to(root).as_posix()+match.group(2)
    source=re.sub(r'(\bfrom\s+|\bimport\s+)([\"\'])(\.[^\"\']+)\2',specifier,file.read_text())
    imports['fnri/'+file.relative_to(root).as_posix()]='data:text/javascript;base64,'+base64.b64encode(source.encode()).decode()
def load(folder,prefix):
    return json.loads(next((root/'packs/_source'/folder).glob(prefix+'--*.json')).read_text())
cards=[load('weapons',p) for p in ('volshebnaia-palochka','zhezl','bozhestvennyi-simvol')]+[load('abilities','razrushenie-misticheskii-zariad')]
translations=json.loads((root/'lang/ru.json').read_text())['FASTNRI']['AbilityChat']
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    try:
        page=browser.new_page(viewport={'width':300,'height':650})
        page.set_content('<script type="importmap">'+json.dumps({'imports':imports})+'</script><article class="chat-message" data-message-id="pub"><div class="message-content">Объявление заклинания</div></article>')
        page.add_style_tag(content=(root/'styles/fast-nri.css').read_text())
        page.evaluate('''async ({cards,translations})=>{
          const ID='fast-nri-v14',hooks={},messages=new Map(),docs=new Map();
          const {registerAbilityChat}=await import('fnri/module/abilities/ability-chat.mjs');
          window.actor={id:'A',uuid:'Actor.A',documentName:'Actor',isOwner:true,hasPlayerOwner:true,type:'character',system:{className:'Волшебник',spellRange:4,combatDie:'d6',equipment:{leftHand:'wand'},resources:{magic:{kind:'class',current:2,max:2}}},items:new Map(),effects:{contents:[]},flags:{},getRollData(){return {}},getFlag(s,k){return this.flags?.[s]?.[k]},async update(changes){for(const [key,value] of Object.entries(changes)){let t=this;const parts=key.split('.');for(const k of parts.slice(0,-1))t=t[k]??={};t[parts.at(-1)]=value;}hooks.updateActor?.forEach(fn=>fn(this));}};
          docs.set(actor.uuid,actor);Object.defineProperty(actor.items,'contents',{get(){return [...this.values()]}});
          for(let i=0;i<cards.length;i++){
            const id=['wand','rod','symbol','spell'][i],doc={...cards[i],id,uuid:'Actor.A.Item.'+id,documentName:'Item',parent:actor};
            actor.items.set(id,doc);docs.set(doc.uuid,doc);
          }
          const spell=actor.items.get('spell'),execution=spell.system.mechanics.executions[0];
          execution.attack.spellEnergy='wizard';execution.accounting={resourceCosts:[{resourceId:'magic',kind:'class',amount:1}]};
          window.notes=[];window.dialogs=0;window.results=[];
          const local=k=>translations[k.split('.').at(-1)]??k;
          window.game={user:{id:'p',targets:new Set(),isGM:false},i18n:{localize:local,format:(k,v)=>Object.entries(v).reduce((s,[key,value])=>s.replace('{'+key+'}',value),local(k))},messages:{get:id=>messages.get(id)},settings:{get:()=> 'public'}};
          window.ui={notifications:{warn:s=>notes.push(s)}};window.canvas={tokens:{controlled:[]}};
          window.fromUuid=async id=>docs.get(id);
          window.foundry={applications:{api:{DialogV2:{input:async()=>{dialogs++;throw Error('unexpected weapon dialog')},wait:async()=>{dialogs++;return null;}}}}};
          window.Hooks={on:(k,fn)=>(hooks[k]??=[]).push(fn)};
          window.ChatMessage={getSpeaker:()=>({actor:'A'}),async create(data){const m={id:'res'+results.length,...data,getFlag(s,k){return this.flags?.[s]?.[k]}};messages.set(m.id,m);results.push(m);return m;}};
          window.Roll=class{static validate(){return true}constructor(formula){this.formula=formula;this.total=10;this.dice=[{faces:20,number:1,results:[{result:7,active:true}]}];}async evaluate(){return this}toJSON(){return {formula:this.formula,total:this.total,dice:this.dice}}async toMessage(data){return {...data,rolls:[this.toJSON()]}}};
          window.pub={id:'pub',whisper:['p'],blind:false,flags:{[ID]:{abilityPublication:{version:1,actorUuid:actor.uuid,itemUuid:spell.uuid}}},getFlag(s,k){return this.flags?.[s]?.[k]}};
          messages.set('pub',pub);registerAbilityChat();window.render=()=>hooks.renderChatMessageHTML.forEach(fn=>fn(pub,document.querySelector('.chat-message')));window.changed=()=>hooks.updateActor.forEach(fn=>fn(actor));render();
        }''',{'cards':cards,'translations':translations})
        options=page.locator('[data-fnri-ability-options]')
        buttons=options.locator('button')
        expect(buttons).to_have_count(4)
        expect(buttons.nth(0)).to_contain_text('Волшебная палочка')
        expect(buttons.nth(0)).to_contain_text('Дистанция: 8 кл.')
        expect(buttons.nth(1)).to_contain_text('Жезл')
        expect(buttons.nth(1)).to_contain_text('Не удерживается')
        expect(buttons.nth(2)).to_contain_text('Заряженное')
        expect(buttons.nth(3)).to_contain_text('Без Оружия заклинателя')
        assert buttons.nth(1).is_enabled()
        for theme in ('theme-light','theme-dark'):
            page.evaluate('(t)=>document.documentElement.className=t',theme)
            for width in (280,360,420):
                page.set_viewport_size({'width':width,'height':650})
                assert options.evaluate('(e)=>e.scrollWidth<=e.clientWidth')
        buttons.nth(1).click(modifiers=['Shift'])
        page.wait_for_function('results.length===1 && actor.system.resources.magic.current===1')
        assert page.evaluate('dialogs===0 && results[0].flags["fast-nri-v14"].weaponAttack.weaponItemUuid==="Actor.A.Item.rod" && results[0].whisper[0]==="p" && actor.system.equipment.leftHand==="wand"')
        assert page.evaluate('notes.some(s=>s.includes("Не удерживается"))')
        page.evaluate('actor.system.equipment={leftHand:"rod"};changed()')
        expect(buttons.nth(0)).to_contain_text('Жезл')
        expect(buttons.nth(1)).to_contain_text('Заряженное')
        expect(buttons.nth(2)).to_contain_text('Не удерживается')
        page.evaluate('actor.system.resources.magic.current=0;changed()')
        charged=buttons.filter(has_text='Заряженное')
        expect(charged).not_to_contain_text('может не хватить ресурса')
        assert charged.is_enabled()
        charged.click(modifiers=['Shift'])
        page.wait_for_function('results.length===2 && actor.flags["fast-nri-v14"].accountingEvents.res1.chargedWeaponUuid==="Actor.A.Item.rod"')
        expect(charged).to_contain_text('Заряд исчерпан')
        assert charged.is_enabled()
        assert page.evaluate('actor.system.resources.magic.current===0')
        # Same first-message UI for an explicitly authored non-attack spell.
        # No new class content: replace only the fixture's execution in memory.
        page.evaluate("""()=>{
          const s=actor.items.get('spell');
          s.system.mechanics.spell={spellEnergy:'wizard',spellRange:'current'};
          s.system.mechanics.executions=[{id:'ward',type:'temporaryHp',label:'Защита',amount:5,target:'self',accounting:{resourceCosts:[{resourceId:'magic',kind:'class',amount:1}]}}];
          changed();
        }""")
        expect(buttons).to_have_count(4)
        expect(buttons.nth(0)).to_contain_text('Защита')
        expect(charged).to_contain_text('Заряд исчерпан')
        assert charged.is_enabled()
        charged.click()
        page.wait_for_function('results.length===3 && actor.flags["fast-nri-v14"].accountingEvents.res2.chargedWeaponUuid==="Actor.A.Item.rod"')
        assert page.evaluate('results[2].flags["fast-nri-v14"].abilityResult.amount===5 && results[2].flags["fast-nri-v14"].abilityExecution.spellWeaponUuid==="Actor.A.Item.rod" && actor.system.resources.magic.current===0 && dialogs===0')
        page.evaluate('pub.isContentVisible=false;render()')
        expect(options).to_have_count(0)
        page.evaluate('pub.isContentVisible=true;actor.isOwner=false;render()')
        expect(options).to_have_count(0)
        print('PASS real publication buttons: readiness order, warnings, narrow chat, Shift click, selected source, accounting, audience and live refresh')
    finally:browser.close()
