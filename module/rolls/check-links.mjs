import { BASIC_SKILLS_BY_ROW_ID, standardSkillEntry } from '../data/skills-catalog.mjs';
import { postCheckRoll, skillFormula } from './checks.mjs';
import { rollStandardAction, standardAction } from './standard-actions.mjs';

const PATTERN = /@Check\[\s*([a-z][a-z_\d]*)\s*(?:\|\s*dc\s*:\s*([+-]?\d+(?:[.,]\d+)?))?\s*\](?:\{([^{}\r\n]*)\})?/gi;
const local = key => game.i18n.localize(`FASTNRI.CheckLinks.${key}`);
const boundLinks = new WeakSet();
const pendingLinks = new WeakSet();

export function parseCheckLink(id, rawDifficulty) {
  const key = id?.toLowerCase();
  const action = key === 'climb' ? standardAction(key) : null;
  const skillId = `core_${key}`;
  const skill = BASIC_SKILLS_BY_ROW_ID.get(skillId);
  if (!action && !skill) return null;
  let difficulty = null;
  if (rawDifficulty !== undefined) {
    if (!/^[+-]?\d+(?:[.,]\d+)?$/.test(rawDifficulty)) return null;
    difficulty = Number(rawDifficulty.replace(',', '.'));
    if (!Number.isFinite(difficulty)) return null;
  }
  return {key, action, skill, skillId, difficulty};
}

export function hasCheckLinks(text) {
  for (const [, id, difficulty] of String(text ?? '').matchAll(PATTERN)) {
    if (parseCheckLink(id, difficulty)) return true;
  }
  return false;
}

function linkActor() {
  const tokens = globalThis.canvas?.tokens?.controlled ?? [];
  if (tokens.length > 1) {
    ui.notifications?.warn(local('oneToken'));
    return null;
  }
  const actor = tokens.length ? tokens[0].actor : game.user.character;
  if (!actor || !(game.user.isGM || actor.isOwner || actor.canUserModify?.(game.user, 'update'))) {
    ui.notifications?.warn(local('noActor'));
    return null;
  }
  return actor;
}

async function runCheck(event) {
  event.preventDefault();
  const link = event.currentTarget;
  if (link.closest('[contenteditable="true"]') || pendingLinks.has(link)) return;
  const check = parseCheckLink(link.dataset.fnriCheck, link.dataset.fnriDifficulty);
  if (!check) return;
  const actor = linkActor();
  if (!actor) return;
  pendingLinks.add(link);
  try {
    const options = {
      difficulty: check.difficulty,
      skipPreroll: event.shiftKey
    };
    if (check.action) {
      await rollStandardAction(actor, check.action.id, options);
    } else {
      const entry = actor.system.skills?.[check.skillId] ?? standardSkillEntry(check.skill);
      await postCheckRoll({...options, actor, label: check.skill.name, kind: 'skill', skillId: check.skillId,
        formula: skillFormula(entry),
        formulaForActor: prepared => skillFormula(prepared?.system?.skills?.[check.skillId] ?? entry)
      });
    }
  } catch (error) {
    console.error('Fast NRI | document check failed', error);
    ui.notifications?.warn(game.i18n.localize('FASTNRI.Hints.rollFailed'));
  } finally {
    pendingLinks.delete(link);
  }
}

export function registerCheckLinks() {
  CONFIG.TextEditor.enrichers.push({
    id: 'fnri-check-link',
    pattern: new RegExp(PATTERN),
    async enricher([, id, difficulty, label]) {
      const check = parseCheckLink(id, difficulty);
      if (!check) return null;
      const link = document.createElement('a');
      link.className = 'fnri-check-link';
      link.href = '#';
      link.dataset.fnriCheck = check.key;
      link.textContent = label?.trim() || (check.action ? local('climb') : check.skill.name);
      if (check.difficulty !== null) {
        link.dataset.fnriDifficulty = difficulty;
        link.title = game.i18n.format('FASTNRI.CheckLinks.difficulty', {value: check.difficulty});
      }
      return link;
    },
    onRender(element) {
      const link = element.querySelector('a.fnri-check-link');
      if (!link || boundLinks.has(link)) return;
      boundLinks.add(link);
      link.addEventListener('click', runCheck);
    }
  });
}
