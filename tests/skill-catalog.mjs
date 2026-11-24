import assert from 'node:assert/strict';
import {BASIC_SKILLS, SKILL_GROUPS, BASIC_SKILLS_BY_ROW_ID, initialSkillEntries} from '../module/data/skills-catalog.mjs';
const expected = {
  "physical": [
    "acrobatics",
    "athletics",
    "stealth"
  ],
  "practical": [
    "sleight_of_hand",
    "craft",
    "medicine"
  ],
  "field": [
    "survival",
    "perception",
    "nature"
  ],
  "magical": [
    "arcana",
    "mysticism",
    "religion"
  ],
  "social": [
    "society",
    "persuasion",
    "deception",
    "intimidation"
  ]
};
assert.deepEqual(SKILL_GROUPS, Object.keys(expected));
assert.equal(BASIC_SKILLS.length, 16);
for (const [group, ids] of Object.entries(expected)) {
  assert.deepEqual(BASIC_SKILLS.filter(skill => skill.group === group).map(skill => skill.id), ids);
}
assert.equal(new Set(BASIC_SKILLS.map(skill => skill.id)).size, 16);
assert.equal(BASIC_SKILLS_BY_ROW_ID.get('core_mysticism').name, 'Мистицизм');
assert.equal(BASIC_SKILLS_BY_ROW_ID.get('core_perception').name, 'Восприятие');
const entries = initialSkillEntries();
assert.equal(Object.keys(entries).filter(id => id.startsWith('core_')).length, 16);
for (const skill of BASIC_SKILLS) assert.equal(entries['core_' + skill.id].catalogId, skill.id);
console.log('PASS: five skill groups, 16 skills and stable catalogue IDs');
