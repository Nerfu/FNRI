import {BASIC_SKILLS_BY_ROW_ID} from './skills-catalog.mjs';

/** Group membership is presentation metadata, never an eligibility restriction. */
export function skillGroupForRow(id, entry) {
  return BASIC_SKILLS_BY_ROW_ID.get(id)?.group ?? entry?.group ?? '';
}

/** Named specializations available to a skill check. Same-group entries first;
 * preserve order within each partition, never exclude other groups. */
export function specializationChoices(skills, skillId) {
  const group = skillGroupForRow(skillId, skills?.[skillId]);
  return Object.entries(skills ?? {})
    .filter(([id, entry]) => id !== skillId && entry?.kind === 'specialization' && String(entry.name ?? '').trim())
    .map(([id, entry]) => ({...entry, id}))
    .sort((a, b) => Number(Boolean(group && b.group === group)) - Number(Boolean(group && a.group === group)));
}

/** A specialization contributes its prepared dice and numeric modifier, not
 * another check (no additional d20). Keep one switch per specialization. */
export function specializationValue(entry) {
  const dice = String(entry?.dice ?? '').trim();
  const modifier = typeof entry?.modifier === 'number' && Number.isFinite(entry.modifier) ? entry.modifier : 0;
  return [dice, modifier ? String(modifier) : ''].filter(Boolean).join(' + ') || '0';
}

export function specializationEntries(actor, skillId) {
  if (!skillId) return [];
  return specializationChoices(actor?.system?.skills, skillId).map(entry => ({
    uuid: 'specialization:' + entry.id, id: entry.id, specializationId: entry.id,
    sourceType: 'specialization', sourceUuid: actor?.uuid ?? null,
    name: entry.name, group: entry.group ?? '', native: false, nativeChanges: [],
    effect: null, actorOwned: false, onUse: 'none', modifier: null, replacement: null,
    parts: [{id:'specialization',kind:'modifier',label:entry.name,value:specializationValue(entry),defaultEnabled:false}]
  }));
}

/** Re-read the effective specialization after the shared effect-filtering
 * step. Never add its raw modifier as a second bonus. */
export function preparedSpecializationEntry(entry, actor) {
  if (!entry.specializationId) return entry;
  const prepared = actor?.system?.skills?.[entry.specializationId];
  if (!prepared) return {...entry,parts:[]};
  return {...entry,parts:entry.parts.map(part => ({...part,value:specializationValue(prepared)}))};
}
