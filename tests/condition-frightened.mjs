import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {acceptPreroll} from './foundry-test-helpers.js';
import {isFrightened} from '../module/effects/condition-calculations.mjs';
import {prepareRoll,frightenedCheckEntry,fixedRollComponents,visibleRollInfluences} from '../module/rolls/roll-context.mjs';
import {postCheckRoll} from '../module/rolls/checks.mjs';
import {naturalAttackingD20,resolveCheckDegree,resolveAttackDegree} from '../module/rolls/attack-core.mjs';
import {computedRollTotal,rollSnapshot} from '../module/damage/roll-editor.mjs';
import {modifierGroups} from '../module/sheets/modifier-view.mjs';
const scope='fast-nri-v14';
const card=JSON.parse(readFileSync(new URL('../packs/_source/conditions/napugan--fci0nffr44waqv55.json',import.meta.url)));
const effect=card.effects[0], hud={...effect,flags:{[scope]:{...effect.flags[scope],hudCondition:true}}};
const actor={id:'A',uuid:'Actor.A',type:'npc',hasPlayerOwner:true,name:'Actor',system:{},items:{contents:[]},effects:{contents:[effect,hud]},getRollData:()=>({check:'1d20+1d4'})};
const original=JSON.stringify(actor.effects.contents);
for(const value of [effect,hud,{statuses:new Set(['fnri7-frightened'])},{flags:{[scope]:{conditionId:'frightened'}}}])assert.equal(isFrightened({effects:{contents:[value]}}),true);
for(const value of [{...effect,disabled:true},{...effect,active:false},{...effect,isSuppressed:true},{...effect,expired:true},{...effect,duration:{expired:true}},{...effect,flags:{[scope]:{conditionId:'frightened',effectState:{strength:0}}}},{name:card.name,img:card.img}])assert.equal(isFrightened({effects:{contents:[value]}}),false);
assert.equal(isFrightened({allApplicableEffects:function*(){yield effect;},effects:{contents:[]}}),true);
assert.equal(isFrightened(null),false);
globalThis.game={i18n:{localize:k=>k},user:{targets:new Set()}};
let config,die=20;
globalThis.foundry={applications:{api:{DialogV2:{wait:async c=>{config=c;return acceptPreroll(c);}}}}};
globalThis.Roll=class {
 static validate(){return true;}
 static replaceFormulaData(f,d){return f.replace('@check',d.check);}
 constructor(expression){this.formula=expression;}
 async evaluate(){this.dice=[{faces:20,number:1,results:[{result:die}]}];this.total=die+(this.formula.includes('(-2)')?-2:0);return this;}
 async toMessage(data){return {...data,id:'test',rolls:[this]};}
};
globalThis.ChatMessage={getSpeaker:()=>({actor:'A'})};
for(const kind of ['skill','attack','ability','intervention','maneuver']){
 const ctx=await prepareRoll({actor,kind,formula:'1d20 + 1d6',skipDialog:true});
 assert.equal(ctx.expression,'1d20 + 1d6 + (-2)');
 assert.equal(ctx.selected.filter(e=>e.id==='frightened').length,1);
 assert.equal(ctx.hindrance,null);
 assert.equal(fixedRollComponents(ctx).filter(p=>p.value===-2).length,1);
 assert.equal(visibleRollInfluences(ctx,{hasPlayerOwner:false},'public')[0].uuid,undefined);
}
for(const [kind,formula] of [['damage','1d20'],['heal','1d20'],['ability','1d200'],['ability','1d6'],['skill','1d8']]){
 const ctx=await prepareRoll({actor,kind,formula,skipDialog:true});assert.equal(ctx.expression,formula);
}
assert.ok(frightenedCheckEntry(actor,{kind:'ability',formula:'@check'}));
assert.ok(frightenedCheckEntry(actor,{kind:'skill',formulaForActor:()=> 'd20'}));
assert.equal((await prepareRoll({actor,kind:'ability',formula:'1d20',effectEnding:true,skipDialog:true})).expression,'1d20');
const normal=await prepareRoll({actor,kind:'skill',formula:'1d20'});assert.equal(normal.expression,'1d20 + (-2)');
assert.match(config.content,/FASTNRI.Preroll.frightened/);assert.match(config.content,/-2/);
foundry.applications.api.DialogV2.wait=async c=>acceptPreroll({...c,content:c.content.replace(/ checked/g,'')});
assert.equal((await prepareRoll({actor,kind:'skill',formula:'1d20'})).expression,'1d20');
const hindrance={uuid:'test-hindrance',sourceType:'situational',name:'Hindrance',parts:[{id:'h',kind:'modifier',value:'-6',nonStackingGroup:'hindrance'}]};
const combined=await prepareRoll({actor,kind:'attack',formula:'1d20',extraEntries:[hindrance],skipDialog:true});
assert.equal(combined.expression,'1d20 + (-2) + (-6)');assert.equal(combined.hindrance.value,-6);
for(const [value,degree] of [[20,'great'],[1,'failure'],[12,'success']]){
 die=value;const result=await postCheckRoll({actor,formula:'1d20',difficulty:10,kind:'skill',skipPreroll:true});
 assert.equal(result.roll.total,value-2);assert.equal(result.result.degree,degree);assert.equal(naturalAttackingD20(result.roll),value);
 const state=rollSnapshot(result.message);assert.equal(computedRollTotal(state),value-2);assert.equal(state.components.filter(p=>p.kind==='fixed'&&p.value===-2).length,1);
 state.components.find(p=>p.kind==='die').value=15;assert.equal(computedRollTotal(state),13);
 state.components.find(p=>p.kind==='fixed').excluded=true;assert.equal(computedRollTotal(state),15);
}
assert.equal(resolveCheckDegree({total:18,naturalD20:20,difficulty:50}).degree,'great');
assert.equal(resolveAttackDegree({total:18,naturalD20:20,ac:{partial:10,success:20,great:30}}).attackNaturalTwentyDamageMultiplier,2);
const exempt=await postCheckRoll({actor,formula:'1d20',difficulty:10,effectEnding:true,skipPreroll:true});assert.equal(exempt.roll.total,die);
const group=modifierGroups(actor).find(g=>g.name.endsWith('ModifierView.rollKinds.d20Check'));
assert.equal(group.total,'—');assert.equal(group.sources.length,1);assert.equal(group.sources[0].value,'-2');
assert.equal(JSON.stringify(actor.effects.contents),original);
actor.effects.contents=[hud];assert.equal((await prepareRoll({actor,kind:'skill',formula:'1d20',skipDialog:true})).expression,'1d20 + (-2)');
actor.effects.contents=[];assert.equal((await prepareRoll({actor,kind:'skill',formula:'1d20',skipDialog:true})).expression,'1d20');
console.log('PASS A2.2 frightened: active sources, common checks, effect-ending exemption, optional override, hindrance stacking, natural dice, editor delta, read-only modifier view');
