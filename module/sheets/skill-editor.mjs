import {BASIC_SKILLS} from '../data/skills-catalog.mjs';
import {resolveSkillAllocation} from '../data/skill-allocation.mjs';
import {classDefinition} from '../data/classes.mjs';
const loc=k=>game.i18n.localize('FASTNRI.'+k);
const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const name=id=>BASIC_SKILLS.find(s=>s.id===id)?.name??id;
const btn=(action,label,attrs='')=>`<button type="button" data-skill-action="${action}" ${attrs}>${esc(label)}</button>`;
const input=(id,field,value,label)=>`<input type="text" data-row-collection="skills" data-row-id="${esc(id)}" data-row-field="${field}" value="${esc(value)}" aria-label="${esc(label)}">`;
export function skillEditorMarkup(actor){
  const raw=actor.toObject?.(true)?.system??actor.system, items=actor.items?.contents??[];
  const a=resolveSkillAllocation(raw,items), rule=classDefinition(raw);
  const pool=[4,6,8,10,12].map(size=>`<span>d${size} × ${a.free.filter(d=>d.face===size).length}</span>`).join('');
  const row=(id,label,formula,modifier,source='')=>{
    const dice=['1d4','1d6','1d8','1d10','1d12'];
    return `<div class="fnri-skill-edit-row"><div><strong>${esc(label)}</strong>${source?`<small>${esc(source)}</small>`:''}</div><div class="fnri-skill-edit-dice">${dice.map(d=>btn('die',d.slice(1),`data-id="${esc(id)}" data-die="${d}" aria-pressed="${formula===d}"`)).join('')}</div>${input(id,'dice',formula,`${label} · ${loc('CharacterEditor.custom')}`)}${input(id,'modifier',modifier,`${label} · ${loc('Fields.checkModifier')}`)}</div>`;
  };
  const warnings=a.warnings.map(w=>`<small class="fnri-racial-warning">${esc([loc('SkillAllocation.'+w.code),w.skill?name(w.skill):'',w.expected!==undefined?`(${w.expected||'—'} → ${w.actual||'—'})`:''].filter(Boolean).join(' '))}</small>`).join('');
  const sources=a.dice.map(d=>`<li>${esc(d.source)} · d${d.face} → ${esc(d.skill?name(d.skill):loc('SkillAllocation.freeDie'))}</li>`).join('');
  const core=BASIC_SKILLS.map(s=>{const id='core_'+s.id, stored=raw.skills?.[id]??{}, prepared=actor.system.skills?.[id]??stored;const d=a.dice.find(d=>d.skill===s.id);return row(id,s.name,a.active?a.rows[s.id].formula:prepared.dice??'',stored.modifier,d?`${d.source} · d${d.face}`:'');}).join('');
  const custom=Object.entries(raw.skills??{}).filter(([id])=>!BASIC_SKILLS.some(s=>'core_'+s.id===id)).map(([id,s])=>`<div class="fnri-skill-edit-custom">${input(id,'name',s.name,loc('Fields.name'))}<select data-row-collection="skills" data-row-id="${esc(id)}" data-row-field="kind"><option value="skill" ${s.kind!=='specialization'?'selected':''}>${esc(loc('Fields.skill'))}</option><option value="specialization" ${s.kind==='specialization'?'selected':''}>${esc(loc('Fields.specialization'))}</option></select><div class="fnri-skill-edit-dice">${(s.kind==='specialization'?['2d6','2d4']:['1d4','1d6','1d8','1d10','1d12']).map(d=>btn('die',d,`data-id="${esc(id)}" data-die="${d}" aria-pressed="${s.dice===d}"`)).join('')}</div>${input(id,'dice',s.dice,loc('Fields.dice'))}${input(id,'modifier',s.modifier,loc('Fields.checkModifier'))}${btn('remove','×',`data-id="${esc(id)}" aria-label="${esc(loc('Actions.removeSkill'))}"`)}</div>`).join('');
  return `<div class="fnri-skill-edit-toolbar"><strong>${esc(loc('SkillAllocation.free'))}</strong><div class="fnri-skill-edit-pool">${pool}</div>${btn('reset',loc('SkillAllocation.reset'))}</div>${rule?.traditions?`<div class="fnri-skill-edit-option">${esc(loc('SkillAllocation.traditionLabel'))} ${btn('tradition',name(raw.classTradition)||loc('CharacterChoice.choose'))}</div>`:''}${a.upgrades.map(u=>`<div class="fnri-skill-edit-option">${esc(u.source)} · d${u.size} ${btn('upgrade',u.target?`${name(a.dice.find(d=>d.id===u.target)?.skill)||loc('SkillAllocation.freeDie')} · d${a.dice.find(d=>d.id===u.target)?.face}`:loc('CharacterChoice.choose'),`data-id="${esc(u.id)}"`)}</div>`).join('')}<div class="fnri-skill-edit-warnings">${warnings}</div><div class="fnri-skill-edit-head"><span>${esc(loc('Fields.skill'))}</span><span>${esc(loc('Fields.dice'))}</span><span>${esc(loc('CharacterEditor.custom'))}</span><span>${esc(loc('Fields.checkModifier'))}</span></div>${core}<details><summary>${esc(loc('CharacterEditor.sources'))}</summary><ul>${sources}</ul></details><h3>${esc(loc('Sections.customChecks'))}</h3>${custom}<div class="fnri-skill-edit-option">${btn('addSkill',loc('Actions.addSkill'))}${btn('addSpecialization',loc('Actions.addSpecialization'))}</div>`;
}
/** Separate Foundry window, live field writes, no second copy of Actor data. */
export async function openSkillEditor(sheet,actions){
  const {DialogV2}=foundry.applications.api;
  let pending=Promise.resolve();
  await DialogV2.wait({window:{title:loc('CharacterEditor.skills')},position:{width:680},content:`<div class="fnri-skill-editor" data-skill-editor>${skillEditorMarkup(sheet.actor)}</div>`,rejectClose:false,buttons:[{action:'done',label:loc('CharacterEditor.done')}],render:(_event,dialog)=>{
    const root=dialog.element.querySelector('[data-skill-editor]');
    if(!root||root.dataset.bound)return;root.dataset.bound='true';
    const refresh=()=>{if(root.isConnected)root.innerHTML=skillEditorMarkup(sheet.actor);};
    const run=(op,redraw=true)=>{pending=pending.then(async()=>{if(!sheet.isEditable)return;await op();await sheet._flushWrites();if(redraw)refresh();}).catch(e=>{console.warn('Fast NRI | skill editor',e);ui.notifications?.warn(loc('Hints.saveFailed'));refresh();});};
    root.addEventListener('change',event=>{const c=event.target;if(!c.matches('[data-row-field]'))return;event.stopPropagation();run(()=>actions.save(c),c.dataset.rowField==='dice'||c.dataset.rowField==='kind');});
    root.addEventListener('click',event=>{const b=event.target.closest('[data-skill-action]');if(!b)return;event.preventDefault();const {skillAction,id,die}=b.dataset;
      run(()=>{switch(skillAction){case 'die':{const raw=sheet.actor.toObject?.(true)?.system??sheet.actor.system;const a=resolveSkillAllocation(raw,sheet.actor.items?.contents??[]);const current=a.active&&id.startsWith('core_')?a.rows[id.slice(5)]?.formula:raw.skills?.[id]?.dice;const control=document.createElement('input');Object.assign(control.dataset,{rowCollection:'skills',rowId:id,rowField:'dice'});control.value=current===die?'':die;return actions.save(control);}case 'reset':return actions.reset();case 'tradition':return actions.chooseTradition();case 'upgrade':return actions.chooseUpgrade(id);case 'remove':return actions.remove(id);case 'addSkill':return actions.add('skill');case 'addSpecialization':return actions.add('specialization');}});
    });
  }});
  await pending;
  await sheet._flushWrites();
}
