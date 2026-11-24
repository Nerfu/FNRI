/**
 * Fast NRI 7.0 / Foundry VTT v14: explicitly apply an Item's authored
 * non-transfer ActiveEffect to an owned Actor as a NEW effect instance.
 *
 * Item effects are the source of truth. There is no second schema, no
 * forced actor-level inference, no recovery log and no alteration of the
 * original Item or any previously applied effect.
 */
import { readEffectState } from './effect-state.mjs';
import { readEffectChangeRows, calculateEffectChangePlan, CALC_SCOPE, CALC_KEY } from './effect-formulas.mjs';

/** Target priority: exactly one targeted token, else one controlled token,
 * else the Item's Actor parent. Ambiguity requires an explicit selection.
 * Deliberately does not derive a target from the content of a card. */
export function resolveCardEffectTarget(item, { targets = [], controlled = [] } = {}) {
  const targetList = Array.from(targets ?? []);
  const selectedList = Array.from(controlled ?? []);
  if (targetList.length > 1) throw Error('Выбрано несколько целей эффекта; оставьте одну');
  if (targetList.length === 1) return targetList[0]?.actor ?? null;
  if (selectedList.length > 1) throw Error('Выделено несколько токенов; оставьте один');
  if (selectedList.length === 1) return selectedList[0]?.actor ?? null;
  return item?.parent?.documentName === 'Actor' ? item.parent : null;
}

function cloneData(effect) {
  if (typeof effect?.toObject !== 'function') throw Error('Исходный эффект недоступен');
  const value = effect.toObject(true);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Некорректный документ эффекта');
  return structuredClone(value);
}

/** Pure preparation: evaluates enabled per-row formulas for the TARGET,
 * retaining manual overrides, other native change fields and arbitrary
 * effect flags. All formulas must validate before any Actor write. */
export function createCardEffectData(item, template, target) {
  if (!item || template?.parent !== item || !template?.uuid) throw Error('Эффект не принадлежит карточке');
  if (template.transfer === true) throw Error('Переносимый эффект уже действует через предмет; отдельное наложение не требуется');
  if (!target || target.documentName !== 'Actor') throw Error('Не выбран персонаж для эффекта');
  const copy = cloneData(template);
  delete copy._id;
  delete copy._stats;
  // A newly applied instance must use its own duration start, not the
  // creation timestamp of the template in the Item collection.
  delete copy.start;
  if (copy.duration && typeof copy.duration === 'object') {
    for (const key of ['startTime','startRound','startTurn','remaining','elapsed','expired','start']) delete copy.duration[key];
  }
  copy.disabled = false;
  copy.transfer = false;
  copy.origin = template.uuid;
  // The destination Actor's current source data is used for formula @actor.*.
  const instance = {system:copy.system ?? {},flags:copy.flags ?? {},parent:target};
  const rows = readEffectChangeRows(instance);
  if (rows.some(row => row.auto)) {
    const plan = calculateEffectChangePlan(instance, {
      rows, state:readEffectState(instance), actor:target, strict:true
    });
    copy.system = {...instance.system,changes:plan.changes};
    copy.flags ??= {};
    copy.flags[CALC_SCOPE] ??= {};
    copy.flags[CALC_SCOPE][CALC_KEY] = plan.metadata;
  }
  return copy;
}

/** A persisted effect is created only through the Actor's native API.
 * Ownership must be checked on the destination Actor (not just the Item).
 */
export async function applyCardEffect(item, template, target, {resultMessageId=null}={}) {
  if (!target?.isOwner || typeof target.createEmbeddedDocuments !== 'function')
    throw Error('Нет прав на изменение выбранного персонажа');
  // Idempotence is scoped to a single result message and a target. Another
  // independently executed ability can still apply its own effect instance.
  if (resultMessageId) {
    const applied=(target.effects?.contents??[]).find(effect=>
      effect.getFlag?.('fast-nri-v14','abilityResultMessageId')===resultMessageId);
    if (applied) return applied;
  }
  const data = createCardEffectData(item,template,target);
  if (resultMessageId) {
    data.flags ??= {};
    data.flags['fast-nri-v14'] ??= {};
    data.flags['fast-nri-v14'].abilityResultMessageId=resultMessageId;
  }
  const created = await target.createEmbeddedDocuments('ActiveEffect',[data]);
  if (!Array.isArray(created) || created.length !== 1 || !created[0]?.id)
    throw Error('Foundry не подтвердил создание эффекта');
  return created[0];
}
