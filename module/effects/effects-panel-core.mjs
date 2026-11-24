/**
 * Fast NRI v14 effects panel: document identity, source and permissions.
 * Pure helpers, kept independent of Foundry UI for regression tests.
 * Unlike PF2e's condition Items, Fast NRI effects are native ActiveEffects.
 */
import { readEffectState, strengthStep, writeEffectState, retireZeroStrengthEffect } from './effect-state.mjs';

export function selectedEffectActor(controlledTokens, assignedCharacter) {
  return controlledTokens?.[0]?.actor ?? assignedCharacter ?? null;
}

export function applicablePanelEffects(actor) {
  if (!actor) return [];
  // v14: transferred Item effects are NOT copied into actor.effects.
  const all = actor.allApplicableEffects?.() ?? actor.effects?.contents ?? [];
  return Array.from(all).filter(effect => effect?.uuid && !effect.disabled && readEffectState(effect).strength !== 0)
    .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? ''), gameLanguage()));
}

function gameLanguage() {
  return globalThis.game?.i18n?.lang ?? 'ru';
}

export function getEffectByIdentity(actor, actorUuid, effectUuid) {
  if (!actor || actor.uuid !== actorUuid || !effectUuid) return null;
  // Resolve from the actor's current applicable collection, never from an icon
  // path or a stale stored Document reference.
  return applicablePanelEffects(actor).find(effect => effect.uuid === effectUuid) ?? null;
}

export function effectSource(effect) {
  if (effect?.parent?.documentName === 'Actor') return 'actor';
  if (effect?.parent?.documentName === 'Item') return 'item';
  return 'other';
}

export function mayManageEffect(actor, effect) {
  if (!actor?.isOwner || !effect?.parent?.isOwner) return false;
  if (effectSource(effect) === 'actor') return effect.parent === actor;
  // An Item effect can only be changed through an owned Item embedded in
  // exactly this Actor, not a world/compendium Item with an identical icon.
  if (effectSource(effect) === 'item') {
    const parentItem = effect.parent;
    return parentItem.parent === actor && actor.items?.get?.(parentItem.id) === parentItem;
  }
  return false;
}

/**
 * Shared button actions. The system edits only native effect documents.
 * Shift+left opens the combined editor; left/right edit ONLY configured
 * strength. No implicit relation with level, magnitude, duration or modifiers.
 */
export async function applyPanelClick(actor, effect, button, { shiftKey = false, openEditor = null } = {}) {
  if (!actor || !effect) return 'missing';
  if (button !== 0 && button !== 2) return 'ignored';
  if (button === 0 && shiftKey) {
    if (!mayManageEffect(actor, effect)) {
      // A user without ownership may still inspect the native read-only sheet.
      if (effect.sheet?.render) await effect.sheet.render({ force: true });
      return 'viewed';
    }
    if (openEditor) await openEditor(actor, effect);
    else if (effect.sheet?.render) await effect.sheet.render({ force: true });
    return 'opened';
  }
  if (!mayManageEffect(actor, effect)) return 'forbidden';
  const state = readEffectState(effect);
  if (button === 0) {
    const operation = strengthStep(state, +1);
    if (operation.kind === 'none' || operation.kind === 'limit') return 'no-change';
    await writeEffectState(effect, { ...state, strength: operation.value });
    return 'increased-strength';
  }
  if (state.strength !== null) {
    const operation = strengthStep(state, -1);
    if (operation.kind === 'update') {
      await writeEffectState(effect, { ...state, strength: operation.value });
      return 'decreased-strength';
    }
    if (operation.kind === 'zero') {
      const result = await retireZeroStrengthEffect(effect, {...state, strength: 0});
      return result === 'disabled' ? 'disabled-item' : 'deleted-actor';
    }
    return 'no-change';
  }
  if (effectSource(effect) === 'item') {
    // A transferred effect is an Item definition, not an actor-specific copy.
    await effect.update({ disabled: true });
    return 'disabled-item';
  }
  await effect.delete();
  return 'deleted-actor';
}

export function panelEffectData(actor) {
  return applicablePanelEffects(actor).map(effect => {
    const source = effectSource(effect);
    const rawDuration = effect.duration?.label;
    const duration = typeof rawDuration === 'string' && rawDuration.trim() ? rawDuration.trim() : '';
    const state = readEffectState(effect);
    return {
      ...state, hasStrength: state.strength !== null && state.strength > 0,
      hasEffectLevel: state.effectLevel !== null, hasMagnitude: state.magnitude !== null,
      name: effect.name ?? '', icon: effect.img || 'icons/svg/aura.svg',
      uuid: effect.uuid, actorUuid: actor.uuid, source,
      isItemEffect: source === 'item', editable: mayManageEffect(actor, effect),
      duration,
      description: String(effect.description ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 280),
      origin: source === 'item' ? (effect.parent?.name ?? '') : ''
    };
  });
}
