/**
 * Fast NRI 7.0 — read-only baseline actions from the common Rulebook.
 * These are NOT Items and do not occupy a slot or consume an action counter.
 * The public helper reuses the existing check/pre-roll/chat pipeline.
 * Consequences and spatial preconditions remain under the participants'
 * control until their generic engines are implemented and agreed upon.
 */
import {declareAction,actionText} from './action-declaration.mjs';
import { skillFormula, postCheckRoll } from './checks.mjs';
import { standardSkillEntry, BASIC_SKILLS } from '../data/skills-catalog.mjs';
import { hasCondition } from '../spatial/geometry.mjs';
import { bestiaryAttackExpression } from './attack-core.mjs';

const skill = id => `core_${id}`;
const SKILL_NAMES = new Map(BASIC_SKILLS.map(entry => [entry.id, entry]));
const rows = [
  // Movement / free-form actions use Foundry tokens or existing card paths.
  ['move','Перемещение','movement'],
  ['standingJump','Прыжок с места','movement'],
  ['runningJump','Прыжок с разбега','movement'],
  ['step','Шаг','movement'],
  ['stand','Встать','movement'],
  ['dash','Рывок','manual'],
  ['swapPlaces','Поменяться местами','manual'],
  ['prepare','Подготовка','manual'],
  ['aidAlly','Помочь союзнику','manual'],
  // Rolls use only the named basic skill. No specialization substitution.
  ['climb','Карабканье','skill','athletics',null],
  ['forceAidAlly','Помочь союзнику · Силовой рывок','skill','athletics','fortitude'],
  ['freeAlly','Освободить союзника','skill','athletics','fortitude'],
  ['trip','Сбить с ног','maneuver','athletics','reflex'],
  ['grapple','Захватить','maneuver','athletics','fortitude'],
  ['escape','Вырваться','skill','athletics','fortitude'],
  ['reposition','Переместить','maneuver','athletics','fortitude'],
  ['shove','Толкнуть','maneuver','athletics','fortitude'],
  ['slip','Проскользнуть','skill','acrobatics','reflex'],
  ['hide','Скрыться','skill','stealth','awareness'],
  ['firstAid','Первая помощь','skill','medicine',null,5],
  ['distract','Отвлечение','skill','deception','awareness'],
  ['demoralize','Деморализовать','skill','intimidation','will']
];

export const STANDARD_ACTIONS = Object.freeze(Object.fromEntries(rows.map(
  ([id, name, mode, skillId = null, defenseStat = null, fixedDifficulty = null]) => [id,
    Object.freeze({id, name, mode, skillId, defenseStat, fixedDifficulty,
      skillChoices: Object.freeze(id === 'escape' ? ['athletics','acrobatics'] : skillId ? [skillId] : [])})]
)));

/** Current definition only. Mechanics of a private card may supersede it. */
export function standardAction(id) { return Object.hasOwn(STANDARD_ACTIONS,id) ? STANDARD_ACTIONS[id] : null; }

const numeric = value => typeof value === 'number' && Number.isFinite(value) ? value : 0;
const die = value => {
  const s = String(value ?? '').trim();
  if (/^d[1-9]\d*$/i.test(s)) return `1${s.toLowerCase()}`;
  return /^1d[1-9]\d*$/i.test(s) ? s.toLowerCase() : '';
};

function namedSkill(actor, skillId) {
  const rowId=skill(skillId);
  const entry=actor?.system?.skills?.[rowId];
  return entry ?? standardSkillEntry(SKILL_NAMES.get(skillId));
}

/**
 * Maneuver check: 1d20 + Athletics die + combat die + applicable modifiers.
 * Bestiary NPCs use their attack formula unless their card specifies another.
 * This returns the formula only; it never imposes a hand/target requirement.
 */
export function standardManeuverFormula(actor) {
  const bestiary = bestiaryAttackExpression(actor);
  if (bestiary) return bestiary;
  const athletics=namedSkill(actor,'athletics');
  const athleticsDice=String(athletics?.dice ?? '').trim();
  const mod=numeric(athletics?.modifier);
  let result=`1d20${athleticsDice?` + (${athleticsDice})`:''}`;
  if (actor?.type !== 'npc') {
    const combat=die(actor?.system?.combatDie);
    if (combat) result+=` + (${combat})`;
  }
  if (mod) result+=` + (${mod})`;
  return result;
}

/** Existing preparation UI and ChatMessage, no new visual elements.
 * Exposes the check result for explicit follow-up without applying it.
 * Manual actions declare their intent, without changing the game situation.
 */
export async function rollStandardAction(actor, actionId, {
  skillId = null, difficulty = null, targetTokens = null, skipPreroll = false, mode = null
} = {}) {
  const action=standardAction(actionId);
  if (!action) throw new Error(`Unknown standard action: ${String(actionId)}`);
  if (!actor?.system) throw new Error('An Actor is required to roll a standard action');
  if (action.mode === 'manual' || action.mode === 'movement') {
    const message=await declareAction({actor,label:action.name,description:actionText(`cards.${action.id}.description`)});
    return {action, roll:null, message, result:null, targetResults:[], manual:true, cancelled:!message};
  }
  const chosen = skillId ?? action.skillId;
  if (!action.skillChoices.includes(chosen))
    throw new Error(`Unsupported skill for ${action.id}; use the existing skill check for an exception`);
  const rowId=skill(chosen);
  const formulaForActor = prepared => action.mode === 'maneuver'
    ? standardManeuverFormula(prepared)
    : skillFormula(namedSkill(prepared,chosen));
  const checkDifficulty = action.fixedDifficulty ??
    (!action.defenseStat && Number.isFinite(difficulty) ? difficulty : null);
  const check=await postCheckRoll({
    actor, formula:formulaForActor(actor), formulaForActor,
    kind:action.mode === 'maneuver' ? 'maneuver' : 'skill',skillId:rowId,
    defenseStat:action.defenseStat,
    targetDefense:action.defenseStat ?? (checkDifficulty === null ? null : `DC ${checkDifficulty}`),
    difficulty:checkDifficulty,label:action.name, skipPreroll,
    targetTokens,standardActionId:action.id,
    compareEachTarget:action.id === 'hide',
    recordRecipient:action.id === 'firstAid',
    targetDifficultyModifier:action.id === 'forceAidAlly'
      ? token => hasCondition(token?.actor,['unconscious']) ? -5 : 0
      : null,
    mode
  });
  return {action, roll:check?.roll??null, message:check?.message??null,
    result:check?.result??null, targetResults:check?.targetResults??[],
    manual:false, cancelled:check===null};
}
