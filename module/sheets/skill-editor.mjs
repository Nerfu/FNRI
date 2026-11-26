import {skillAllocationDisplay} from './skill-allocation-display.mjs';
import { BASIC_SKILLS } from '../data/skills-catalog.mjs';
import { canMoveSkillDie, skillNominalChoices, skillAllocationMode } from '../data/skill-allocation.mjs';

const loc = key => game.i18n.localize('FASTNRI.' + key);
const skillText = key => loc('SkillAllocation.' + key);
const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const skillName = id => BASIC_SKILLS.find(skill => skill.id === id)?.name ?? id;
const faces = [4, 6, 8, 10, 12];
const option = (value, label) => `<option value="${esc(value)}">${esc(label)}</option>`;

export function skillUpgradeCandidates(allocation, upgrade) {
  return allocation.dice.filter(die =>
    die.size === upgrade.size && !allocation.upgrades.some(other => other.id !== upgrade.id && other.target === die.id));
}

function poolChoices(allocation,skill,mode){
  return skillNominalChoices(allocation,skill,mode).map(({size,warning})=>option(`nominal:${size}`,`d${size}${warning?' ⚠':''}`)).join('');
}

/** View data for the one selector in the existing core skill row. */
export function skillPoolControl(skill, allocation, mode=skillAllocationMode()) {
  const row=allocation.rows[skill.id];
  const die=allocation.dice.find(d=>d.id===row.die);
  const formula=row.formula.replace(/^1(d\d+)$/, '$1') || '—';
  const manual=row.override!==null;
  const restricted=mode==='warning'&&allocation.warnings.some(w=>w.skill===skill.id);
  const label=formula+(restricted?' ⚠':'');
  const removable=canMoveSkillDie(die)||mode==='free'&&(manual||!!die);
  const source=[die?.locked&&loc('Fields.className'),die?.source,
    die&&die.face!==die.size&&`d${die.size} → d${die.face}`].filter(Boolean).join(' · ');
  return {skill:skill.id,manualAllowed:mode==='free',manual,restricted,removable,source:manual&&die?`d${die.face} · ${source}`:source,formula:row.formula,
    markup:`<select data-skill-die="${esc(skill.id)}" aria-label="${esc(skill.name+' · '+loc('Fields.dice'))}">
      <option value="" data-assigned-die="${esc(row.die)}">${esc(label)}</option>
      ${poolChoices(allocation,skill.id,mode)}
      ${removable?option('release',skillText('release')):''}
      ${mode==='free'?option('manual',loc('CharacterEditor.custom')+'…'):''}
    </select>`};
}

export function skillDistributionView(allocation,mode=skillAllocationMode()) {
  const warnings=mode==='warning'?allocation.warnings:[];
  const {showPool,complete}=skillAllocationDisplay({...allocation,warnings});
  const groups=new Map();
  for(const die of allocation.free){
    const key=JSON.stringify([die.source,die.allowed??null]);
    if(!groups.has(key))groups.set(key,{source:die.source,rules:die.allowed?.map(skillName).join(', ')||skillText('unrestrictedRules'),dice:[]});
    const group=groups.get(key), entry=group.dice.find(d=>d.face===die.face);
    if(entry)entry.count++;else group.dice.push({face:die.face,count:1});
  }
  const mandatory=allocation.dice.filter(d=>d.locked||d.preferred&&!d.displaced).map(d=>({source:d.source,face:d.face,skill:skillName(d.skill)}));
  const upgradeControls=allocation.upgrades.map(u=>({id:u.id,source:u.source,from:u.size,to:faces[faces.indexOf(u.size)+1],target:u.target??'',options:skillUpgradeCandidates(allocation,u).map(d=>({id:d.id,selected:d.id===u.target,label:`${d.skill?skillName(d.skill):skillText('freeDie')} · ${d.source}`}))}));
  return {showPool,complete,groups:[...groups.values()],mandatory,upgradeControls,
    free:[...faces].reverse().map(face=>({face,count:allocation.free.filter(d=>d.face===face).length})).filter(d=>d.count),
    sources:allocation.dice.map(d=>`${d.source} · d${d.face} → ${d.skill?skillName(d.skill):skillText('freeDie')}`),
    upgrades:allocation.upgrades.map(u=>{const die=allocation.dice.find(d=>d.id===u.target);return `${u.source} · d${u.size} → d${faces[faces.indexOf(u.size)+1]} · ${die?(die.skill?skillName(die.skill):skillText('freeDie')):skillText('unassignedUpgrade')}`;}),
    warnings:warnings.map(({code,skill,expected,actual})=>[skillText(code),skill&&skillName(skill),expected!==undefined&&`(${expected||'—'} → ${actual||'—'})`].filter(Boolean).join(' '))};
}
