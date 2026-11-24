import {skillAllocationDisplay} from './skill-allocation-display.mjs';
import { BASIC_SKILLS } from '../data/skills-catalog.mjs';
import { canMoveSkillDie } from '../data/skill-allocation.mjs';

const loc = key => game.i18n.localize('FASTNRI.' + key);
const skillText = key => loc('SkillAllocation.' + key);
const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const skillName = id => BASIC_SKILLS.find(skill => skill.id === id)?.name ?? id;
const faces = [4, 6, 8, 10, 12];
const option = (value, label) => `<option value="${esc(value)}">${esc(label)}</option>`;
const poolOption = die => `assign:${die.id}:${die.skill ?? ''}`;

export function skillUpgradeCandidates(allocation, upgrade) {
  return allocation.dice.filter(die =>
    die.size === upgrade.size && !allocation.upgrades.some(other => other.id !== upgrade.id && other.target === die.id));
}

/** One selector per basic skill. An upgrade follows its actual die ID. */
export function skillRowUpgradeChoices(allocation, die) {
  if (!die) return [];
  return allocation.upgrades.flatMap(upgrade => {
    if (upgrade.target===die.id) return [{upgrade, action:'remove-upgrade'}];
    if (!skillUpgradeCandidates(allocation, upgrade).some(candidate=>candidate.id===die.id)) return [];
    return [{upgrade,action:'upgrade'}];
  });
}

function rowUpgradeOptions(allocation, die) {
  const choices=skillRowUpgradeChoices(allocation,die);
  return choices.map(({upgrade,action})=>{
    const next=faces[faces.indexOf(upgrade.size)+1];
    const target=allocation.dice.find(row=>row.id===upgrade.target);
    const label=action==='remove-upgrade'
      ? skillText('removeUpgrade')+' · '+upgrade.source
      : skillText('applyUpgrade')+` d${upgrade.size} → d${next} · ${upgrade.source}`+
        (target ? ` (${skillText('move')} · ${target.skill?skillName(target.skill):skillText('freeDie')})` : '');
    return option(`${action}:${upgrade.id}:${die.id}`,label);
  }).join('');
}

function skillDieLabel(die, skill) {
  const pieces = [`d${die.face}`, die.source];
  if (die.face !== die.size) pieces.push(`d${die.size} → d${die.face}`);
  return pieces.join(' · ');
}

function poolChoices(allocation, skill) {
  // Equal free dice from the same source share one menu entry. Each actual
  // choice still names its die ID, including upgraded or restricted dice.
  const groups = new Map();
  for (const die of allocation.free.filter(canMoveSkillDie)) {
    const key = JSON.stringify([die.face, die.size, die.source, die.preferred, die.allowed]);
    const existing = groups.get(key);
    if (existing) existing.count++;
    else groups.set(key, {die, count: 1});
  }
  const free = [...groups.values()].map(({die, count}) =>
    option(poolOption(die), skillDieLabel(die, skill) + (count > 1 ? ` × ${count}` : '')));
  const transfer = allocation.dice.filter(die => die.skill && die.skill !== skill && canMoveSkillDie(die))
    .map(die => option(poolOption(die), `d${die.face} · ${skillName(die.skill)} → ${skillText('move')}` +
      (die.face !== die.size ? ` · d${die.size} → d${die.face}` : '')));
  return [
    free.length && `<optgroup label="${esc(skillText('free'))}">${free.join('')}</optgroup>`,
    transfer.length && `<optgroup label="${esc(skillText('transfer'))}">${transfer.join('')}</optgroup>`
  ].filter(Boolean).join('');
}

/** View data for the one selector in the existing core skill row. */
export function skillPoolControl(skill, allocation) {
  const row=allocation.rows[skill.id];
  const die=allocation.dice.find(d=>d.id===row.die);
  const formula=row.formula.replace(/^1(d\d+)$/, '$1') || '—';
  const manual=row.override!==null;
  const label=manual?`${formula} · ${skillText('manualLabel')}`:formula;
  const source=[die?.locked&&loc('Fields.className'),die?.source,
    die&&die.face!==die.size&&`d${die.size} → d${die.face}`].filter(Boolean).join(' · ');
  return {skill:skill.id,source:manual&&die?`d${die.face} · ${source}`:source,formula:row.formula,
    markup:`<select data-skill-die="${esc(skill.id)}" aria-label="${esc(skill.name+' · '+loc('Fields.dice'))}" title="${esc(label)}">
      <option value="" data-assigned-die="${esc(row.die)}">${esc(label)}</option>
      ${!die||canMoveSkillDie(die)?poolChoices(allocation,skill.id):''}
      ${canMoveSkillDie(die)?option('release',skillText('release')):''}
      ${rowUpgradeOptions(allocation,die)}
      ${option('manual',loc('CharacterEditor.custom')+'…')}
      ${manual?option('use-assigned',skillText('useAssigned')):''}
    </select>`};
}

export function skillDistributionView(allocation) {
  const {showPool,complete}=skillAllocationDisplay(allocation);
  return {showPool,complete,
    free:[...faces].reverse().map(face=>({face,count:allocation.free.filter(d=>d.face===face).length})).filter(d=>d.count),
    sources:allocation.dice.map(d=>`${d.source} · d${d.face} → ${d.skill?skillName(d.skill):skillText('freeDie')}`),
    upgrades:allocation.upgrades.map(u=>{const die=allocation.dice.find(d=>d.id===u.target);return `${u.source} · d${u.size} → d${faces[faces.indexOf(u.size)+1]} · ${die?(die.skill?skillName(die.skill):skillText('freeDie')):skillText('unassignedUpgrade')}`;}),
    warnings:allocation.warnings.map(({code,skill,expected,actual})=>[skillText(code),skill&&skillName(skill),expected!==undefined&&`(${expected||'—'} → ${actual||'—'})`].filter(Boolean).join(' '))};
}
