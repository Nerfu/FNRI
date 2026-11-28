import assert from 'node:assert/strict';
import {calculateHpBarLayout,hpTokenDocumentClass,hpActorClass,hpTokenClass,touchesHp,registerTokenPresentation} from '../module/token/token-visuals.mjs';
import {classifyHpFeedback,feedbackFromMessage,feedbackTokens,registerHpFeedback} from '../module/token/hp-feedback.mjs';
const S='fast-nri-v14';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,`${a} != ${b}`);
const layout=(current,max,temp)=>calculateHpBarLayout({value:current,max,temp});
assert.deepEqual(layout(100,100,0),{green:1,gap:0,blue:0});
assert.deepEqual(layout(60,100,0),{green:.6,gap:.4,blue:0});
let parts=layout(60,100,20);near(parts.green,.5);near(parts.gap,1/3);near(parts.blue,1/6);
parts=layout(60,100,300);near(parts.green,.18);near(parts.gap,.12);near(parts.blue,.7);
parts=layout(0,100,20);near(parts.green,0);near(parts.blue,1/6);
assert.deepEqual(layout(0,0,0),{green:0,gap:1,blue:0});
near(layout(0,0,10).blue,.7);
near(layout(200,100,-1).green,1);
for(const [v,m,t] of [[1,10,10],[0,100,30],[1,0,5],[Infinity,Infinity,Infinity],[100,100,1000]]){
  const {green,gap,blue}=layout(v,m,t);near(green+gap+blue,1);assert.ok(green>=0&&gap>=0&&blue<=.7);
}
const makeActor=(uuid,type='npc')=>({uuid,type,system:{hp:{current:60,max:100,temp:20}},getFlag(){return null}});
const linked=makeActor('Actor.one','character');
const actor=makeActor('Scene.a.Token.b.Actor.n');
const sibling=makeActor('Scene.a.Token.c.Actor.n');
class CoreDoc {
  getBarAttribute(...args){return {core:args};}
  static getTrackedAttributes(){return {bar:[['resource']],value:[['speed']]};}
}
class CoreActor {modifyTokenAttribute(...args){this.call=args;return Promise.resolve(this);}}
class CoreToken {_drawBar(...args){this.core=args;}}
const Doc=hpTokenDocumentClass(CoreDoc),doc=new Doc();doc.actor=actor;doc.bar1={attribute:'hp'};doc.bar2={attribute:'resource'};
assert.deepEqual(doc.getBarAttribute('bar1'),{type:'bar',attribute:'hp',value:60,max:100,editable:true});
assert.deepEqual(doc.getBarAttribute('bar2'),{core:['bar2',{}]});
assert.equal(doc.getBarAttribute('bar2',{alternative:'hp'}).value,60);
assert.deepEqual(Doc.getTrackedAttributes('npc'),{bar:[['resource'],['hp']],value:[['speed']]});
assert.deepEqual(Doc.getTrackedAttributes('unrelated'),{bar:[['resource']],value:[['speed']]});
const A=hpActorClass(CoreActor),a=new A();Object.assign(a,actor);
await a.modifyTokenAttribute('hp',-5,true,true);assert.deepEqual(a.call,['hp.current',55,false,false]);
await a.modifyTokenAttribute('hp',120,false,true);assert.deepEqual(a.call,['hp.current',100,false,false]);
await a.modifyTokenAttribute('hp',-100,true,true);assert.deepEqual(a.call,['hp.current',0,false,false]);
await a.modifyTokenAttribute('resource',7,true,true);assert.deepEqual(a.call,['resource',7,true,true]);
assert.equal(a.system.hp.temp,20);assert.ok(!Object.hasOwn(a.system.hp,'value'));
const handlers=new Map();globalThis.Hooks={on(name,fn){const f=handlers.get(name)??[];f.push(fn);handlers.set(name,f);}};
const emit=(name,...args)=>{for(const fn of handlers.get(name)??[])fn(...args);};
globalThis.CONST={TOKEN_DISPLAY_MODES:{ALWAYS:50},TEXT_ANCHOR_POINTS:{TOP:2}};
globalThis.CONFIG={Token:{objectClass:CoreToken,documentClass:CoreDoc},Actor:{documentClass:CoreActor}};
globalThis.game={user:{id:'player',isGM:false}};
const renders=[],texts=[];
const placed=(a,uuid,{hidden=false,visible=true}={})=>({document:{actor:a,uuid,hidden,height:1},isVisible:visible,h:100,center:{x:100,y:100},renderFlags:{set:data=>renders.push({uuid,data})}});
const t1=placed(actor,'Scene.a.Token.b'),t2=placed(sibling,'Scene.a.Token.c'),t3=placed(linked,'Scene.a.Token.d'),t4=placed(linked,'Scene.a.Token.e',{hidden:true}),t5=placed(linked,'Scene.a.Token.f',{visible:false});
globalThis.canvas={ready:true,initialized:true,dimensions:{size:120},tokens:{placeables:[t1,t2,t3,t4,t5]},interface:{createScrollingText(origin,text,options){texts.push({origin,text,options});return Promise.resolve();}}};
registerTokenPresentation();registerHpFeedback();
const movement={autoRotate:true,showRuler:true};emit('preMoveToken',{},movement);assert.deepEqual(movement,{autoRotate:false,showRuler:true});
const updates=[];actor.updateSource=patch=>updates.push(patch);
emit('preCreateActor',actor,{});assert.deepEqual(updates.pop(),{'prototypeToken.displayBars':50,'prototypeToken.bar1.attribute':'hp'});
emit('preCreateActor',actor,{prototypeToken:{displayBars:0,bar1:{attribute:'resource'}}});assert.equal(updates.length,0);
emit('preCreateActor',actor,{prototypeToken:{bar1:{attribute:'hp'}}});assert.deepEqual(updates.pop(),{'prototypeToken.displayBars':50});
const placePatches=[];actor.prototypeToken={displayBars:50,bar1:{attribute:'hp'}};
const newDoc={actor,updateSource:patch=>placePatches.push(patch)};
emit('preCreateToken',newDoc,{});assert.deepEqual(placePatches.pop(),{displayBars:50,'bar1.attribute':'hp'});
emit('preCreateToken',newDoc,{displayBars:0,bar1:{attribute:'resource'}});assert.equal(placePatches.length,0);
assert.ok(touchesHp({'system.hp.temp':4}));assert.ok(touchesHp({system:{hp:{current:1}}}));assert.ok(touchesHp({[`flags.${S}.tempHpState.layers.id`]:{}}));assert.ok(!touchesHp({name:'x'}));
emit('updateActorDelta',{parent:{actor}},{system:{hp:{temp:12}}},{});assert.deepEqual(renders.pop(),{uuid:t1.document.uuid,data:{refreshBars:true}});
assert.equal(renders.length,0);
// Real drawing method records fill, size and exact placement, without a live PIXI runtime.
const graphics={log:[],clear(){this.log.push(['clear']);return this;},lineStyle(...a){this.log.push(['line',...a]);return this;},beginFill(...a){this.log.push(['fill',...a]);return this;},drawRect(...a){this.log.push(['rect',...a]);return this;},drawRoundedRect(...a){this.log.push(['rounded',...a]);return this;},position:{set(...a){graphics.log.push(['position',...a]);}}};
const Token=hpTokenClass(CoreToken),token=new Token();Object.assign(token,{document:{actor,height:1},h:100,w:100});
actor.getFlag=(_s,k)=>k==='tempHpState'?{version:1,layers:{a:{initial:20,remaining:20},b:{initial:10,remaining:10}}}:null;
token._drawBar(0,graphics,{attribute:'hp'});let rects=graphics.log.filter(x=>x[0]==='rect');
near(rects[0][3],97.5*.5);near(rects[1][3],97.5/6);assert.deepEqual(graphics.log.at(-1),['position',0,90]);
assert.ok(graphics.log.some(x=>x[0]==='fill'&&x[1]===0x35c759));assert.ok(graphics.log.some(x=>x[0]==='fill'&&x[1]===0x4f9ee8));
graphics.log=[];token.document.height=2;token._drawBar(1,graphics,{attribute:'hp'});assert.deepEqual(graphics.log.at(-1),['position',0,0]);assert.ok(graphics.log.some(x=>x[0]==='rounded'&&x[4]===16));
token._drawBar(0,graphics,{attribute:'resource'});assert.equal(token.core[2].attribute,'resource');
actor.getFlag=()=>null;
assert.deepEqual(classifyHpFeedback({current:20,temp:5},{current:13,temp:0}),[{kind:'damage',amount:12}]);
assert.deepEqual(classifyHpFeedback({current:13,temp:0},{current:17,temp:8}),[{kind:'healing',amount:4},{kind:'tempHp',amount:8}]);
assert.deepEqual(classifyHpFeedback({current:13,temp:0},{current:13,temp:0}),[]);
const msg=(flags,visible=true,content=true)=>({visible,isContentVisible:content,getFlag(_s,k){return flags[k];}});
const report={version:1,kind:'damage',actorUuid:actor.uuid,tokenUuid:t1.document.uuid,before:{current:60,temp:20},after:{current:53,temp:15},reverted:false};
const m=msg({hpReport:report});
assert.deepEqual(feedbackFromMessage(m).entries,[{kind:'damage',amount:12}]);
assert.equal(feedbackFromMessage(msg({hpReport:report},false)),null);
assert.equal(feedbackFromMessage(msg({hpReport:report},true,false)),null);
emit('createChatMessage',m);assert.equal(texts.at(-1).text,'−12');assert.equal(texts.at(-1).options.textStyle.fill,0xff0000);assert.equal(texts.at(-1).options.duration,1200);
assert.equal(texts.length,1);
emit('createChatMessage',msg({hpReport:report},true,false));assert.equal(texts.length,1);
emit('updateChatMessage',m,{[`flags.${S}.hpReport.pendingUndo`]:'123'});assert.equal(texts.length,1);
Object.assign(report,{reverted:true,reverseBefore:{current:50,temp:15},reverseAfter:{current:57,temp:20}});
emit('updateChatMessage',m,{[`flags.${S}.hpReport.reverted`]:true});assert.deepEqual(texts.slice(-2).map(x=>x.text),['+7','+5']);assert.deepEqual(texts.slice(-2).map(x=>x.options.textStyle.fill),[0x00ff00,0x4f9ee8]);assert.equal(texts.at(-1).origin.x-texts.at(-2).origin.x,28);
emit('createChatMessage',m);assert.equal(texts.length,3);
emit('createChatMessage',msg({periodicReceipt:{targetActorUuid:actor.uuid,tokenUuid:t1.document.uuid,damage:9,hpDelta:-3}}));assert.equal(texts.at(-1).text,'−3');
emit('createChatMessage',msg({periodicHealingReport:{actorUuid:actor.uuid,tokenUuid:t1.document.uuid,hpDelta:2}}));assert.equal(texts.at(-1).text,'+2');
emit('createChatMessage',msg({periodicReceipt:{targetActorUuid:actor.uuid,damage:999}}));assert.equal(texts.length,5);
assert.deepEqual(feedbackTokens({actorUuid:linked.uuid}),[t3]);assert.deepEqual(feedbackTokens({actorUuid:linked.uuid,tokenUuid:t4.document.uuid}),[]);
assert.deepEqual(feedbackTokens({actorUuid:actor.uuid,tokenUuid:t2.document.uuid}),[]);
assert.deepEqual(feedbackTokens({actorUuid:actor.uuid,tokenUuid:'Scene.other.Token.b'}),[]);
game.user.isGM=true;assert.deepEqual(feedbackTokens({actorUuid:linked.uuid}),[t3,t4]);game.user.isGM=false;
// Actor and ActorDelta double notifications consume one local snapshot. Managed combat writes do not display a second number.
const change={'system.hp.current':55},options={};
emit('preUpdateActor',actor,change,options,'player');emit('preUpdateActorDelta',{parent:{actor}},change,options,'player');actor.system.hp.current=55;
emit('updateActorDelta',{parent:{actor}},change,options,'player');emit('updateActor',actor,change,options,'player');assert.equal(texts.length,6);assert.equal(texts.at(-1).text,'−5');
const managed={fnriTempHp:'managed',fnriDeathLifecycle:'managed'};emit('preUpdateActor',actor,change,managed,'player');actor.system.hp.current=50;emit('updateActor',actor,change,managed,'player');assert.equal(texts.length,6);
const expired={fnriTempHp:'managed',fnriJournal:{kind:'temp'}};emit('preUpdateActor',actor,{'system.hp.temp':0},expired,'player');actor.system.hp.temp=0;emit('updateActor',actor,{'system.hp.temp':0},expired,'player');assert.equal(texts.length,6);
const other={};emit('preUpdateActor',actor,change,other,'other');actor.system.hp.current=49;emit('updateActor',actor,change,other,'other');assert.equal(texts.length,6);
canvas.ready=false;emit('createChatMessage',msg({periodicHealingReport:{actorUuid:actor.uuid,hpDelta:5}}));assert.equal(texts.length,6);
console.log('PASS token HP: old bar geometry, max-of-layers, native HUD and resources, rotation, real report deltas, undo, periodic, synthetic identity, visibility, local edits, no double feedback or expiry damage');
