/**
 * Optional, instance-local state of a native Foundry 14 ActiveEffect.
 * The rules, not this storage schema, decide if level, strength or magnitude
 * participate in calculations. Duration remains the CORE duration document.
 * No migration: effects without this flag continue to behave as before.
 */
import { recalculationPatch } from './effect-formulas.mjs';

export const EFFECT_FLAG_SCOPE = 'fast-nri-v14';
export const EFFECT_STATE_KEY = 'effectState';

function optionalFinite(value, integer = false) {
  if (value === '' || value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || (integer && !Number.isInteger(value))) return null;
  return value;
}

/** Read without modifying persisted effects, including old/foreign flags. */
export function readEffectState(effect) {
  const raw = effect?.flags?.[EFFECT_FLAG_SCOPE]?.[EFFECT_STATE_KEY] ?? {};
  const strength = optionalFinite(raw.strength, true);
  return {
    effectLevel: optionalFinite(raw.effectLevel, true),
    strength: strength !== null && strength >= 0 ? strength : null,
    magnitude: optionalFinite(raw.magnitude)
  };
}

function enteredNumber(value, name, { integer = false, min = -Infinity } = {}) {
  if (value === '' || value === null || value === undefined) return null;
  const text = String(value).trim().replace(',', '.');
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) throw new Error(`Invalid ${name}`);
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || (integer && !Number.isInteger(parsed)) || parsed < min) {
    throw new Error(`Invalid ${name}`);
  }
  return parsed;
}

/** Accept explicit optional user inputs, never infer level from source/target. */
export function validateEffectStateInput(raw = {}) {
  const effectLevel = enteredNumber(raw.effectLevel, 'effectLevel', { integer: true, min: 0 });
  const strength = enteredNumber(raw.strength, 'strength', { integer: true, min: 0 });
  const magnitude = enteredNumber(raw.magnitude, 'magnitude');
  return { effectLevel, strength, magnitude };
}

/** Zero is a removal/disable action, not a persistent active effect. */
export async function retireZeroStrengthEffect(effect, nextState) {
  if (!effect?.parent?.isOwner) throw Error('Effect edit not permitted');
  if (nextState.strength !== 0) throw Error('Effect strength must be zero');
  if (effect.parent.documentName === 'Actor') {
    await effect.delete();
    return 'removed';
  }
  if (effect.parent.documentName === 'Item') {
    // Item effect definitions remain in the card, but stop applying.
    await effect.update({
      [`flags.${EFFECT_FLAG_SCOPE}.${EFFECT_STATE_KEY}`]: nextState,
      disabled: true
    });
    return 'disabled';
  }
  throw Error('Unsupported effect parent');
}

/** User-controlled edit; duration is separately stored in Foundry's core duration. */
export async function writeEffectState(effect, input) {
  if (!effect?.parent?.isOwner || typeof effect?.setFlag !== 'function') throw Error('Effect edit not permitted');
  const next = validateEffectStateInput(input);
  if (next.strength === 0) {
    await retireZeroStrengthEffect(effect, next);
    return next;
  }
  const recalculation = recalculationPatch(effect, next);
  if (recalculation && typeof effect.update === 'function') {
    // Keep the new state and its calculated change values in one document update.
    const { errors, ...patch } = recalculation;
    await effect.update({[`flags.${EFFECT_FLAG_SCOPE}.${EFFECT_STATE_KEY}`]: next, ...patch});
    if (errors.length) globalThis.ui?.notifications?.warn?.(
      game.i18n.localize('FASTNRI.EffectPanel.FormulaPartialFailure'));
  } else {
    await effect.setFlag(EFFECT_FLAG_SCOPE, EFFECT_STATE_KEY, next);
  }
  return next;
}

/** Does NOT create automatic level/strength-to-modifier links without card rules. */
export function strengthStep(state, direction) {
  if (state.strength === null) return { kind: 'none' };
  const next = state.strength + direction;
  if (direction > 0) return { kind: 'update', value: next };
  if (direction < 0) return next > 0 ? { kind: 'update', value: next } : { kind: 'zero' };
  return { kind: 'none' };
}

export const DURATION_UNITS = Object.freeze([
  'years', 'months', 'days', 'hours', 'minutes', 'seconds', 'rounds', 'turns'
]);

export function validateCoreDurationInput(input, existing) {
  const units = input.units;
  if (!DURATION_UNITS.includes(units)) throw Error('Unknown duration units');
  const value = enteredNumber(input.value, 'duration', { min: 0 });
  // Only update the two editable duration fields. Preserve start/expiry state.
  return { units, value };
}
