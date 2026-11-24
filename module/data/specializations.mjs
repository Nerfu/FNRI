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
