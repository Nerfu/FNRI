/**
 * PF2e-inspired panel for Fast NRI native ActiveEffect documents (Foundry v14).
 * Does not modify the Token HUD, duplicate effects, or introduce stack rules.
 */
import { selectedEffectActor, getEffectByIdentity, applyPanelClick, panelEffectData } from './effects-panel-core.mjs';
import { openEffectParametersEditor } from './effect-parameters-editor.mjs';
import { refreshActorDependentFormulas, recalculationPatch } from './effect-formulas.mjs';
import { readEffectState, retireZeroStrengthEffect } from './effect-state.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const SYSTEM_ID = 'fast-nri-v14';

function t(key) { return game.i18n.localize(`FASTNRI.EffectPanel.${key}`); }

export class FastNRIEffectsPanel extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: 'fnri-effects-panel',
    tag: 'section',
    classes: ['fnri-effects-panel'],
    window: { frame: false, positioned: false },
    actions: { effectClick: { handler: this.#onEffectClick, buttons: [0, 2] } }
  };

  static PARTS = {
    main: {
      template: `systems/${SYSTEM_ID}/templates/effects-panel.hbs`,
      root: true, scrollable: ['']
    }
  };

  get panelActor() {
    return selectedEffectActor(canvas?.tokens?.controlled, game.user?.character);
  }

  static async #onEffectClick(event, target) {
    event.preventDefault();
    const actor = this.panelActor;
    const effect = getEffectByIdentity(actor, target.dataset.actorUuid, target.dataset.effectUuid);
    if (!effect) { this.refresh(); return; }
    try {
      const result = await applyPanelClick(actor, effect, event.button, {
        shiftKey: event.shiftKey, openEditor: openEffectParametersEditor
      });
      if (result === 'forbidden') ui.notifications?.warn(t('NoPermission'));
    } catch (error) {
      console.error('Fast NRI | effects panel action failed', error);
      ui.notifications?.error(t('ActionFailed'));
    } finally {
      this.refresh();
    }
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.panelActor;
    return {
      ...context, actorName: actor?.name ?? '', hasActor: !!actor,
      effects: panelEffectData(actor),
      title: t('Title'), itemLabel: t('FromItem'), leftHint: t('LeftHint'),
      rightHint: t('RightHint'), shiftHint: t('ShiftHint'),
      levelLabel: t('Level'), strengthLabel: t('Strength'), magnitudeLabel: t('Magnitude'), emptyHint: t('Empty')
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    // PF2e uses this same v14 host for the selected token effects panel.
    // Body fallback keeps the panel reachable on a custom UI layout.
    const host = document.getElementById('ui-right-column-1') ?? document.body;
    if (this.element.parentElement !== host) host.appendChild(this.element);
  }

  refresh() {
    if (this.rendered) void this.render().catch(error =>
      console.error('Fast NRI | effects panel refresh failed', error));
  }
}

/** Native document updates may come from external sheets or imports. */
function reconcileZeroStrength(effect, userId) {
  if (!effect?.parent?.isOwner || userId !== game.user?.id || effect.disabled) return;
  const state = readEffectState(effect);
  if (state.strength !== 0) return;
  void retireZeroStrengthEffect(effect, state).catch(error =>
    console.error('Fast NRI | zero effect strength cleanup failed', error));
}

export function registerEffectsPanel() {
  const panel = new FastNRIEffectsPanel();
  const refresh = typeof foundry.utils.debounce === "function"
    ? foundry.utils.debounce(() => panel.refresh(), 100)
    : () => panel.refresh();
  Hooks.once('ready', () => {
    void panel.render({ force: true }).catch(error =>
      console.error('Fast NRI | effects panel initial render failed', error));
  });
  // Token focus is deliberately tracked independently of Token HUD events.
  Hooks.on('controlToken', refresh);
  Hooks.on('canvasReady', () => {
    // The right column may be rebuilt when changing scenes.
    void panel.render({ force: true }).catch(error =>
      console.error('Fast NRI | effects panel canvas render failed', error));
  });
  Hooks.on('updateToken', refresh);
  Hooks.on('deleteToken', refresh);
  Hooks.on('updateActor', (actor, changes, _options, userId) => {
    refresh();
    // Single-writer per event, respecting native ownership. Only source
    // `system` edits trigger this; normal effect updates do not reenter it.
    if (userId !== game.user?.id) return;
    void refreshActorDependentFormulas(actor, changes).then(result => {
      if (result.errors.length) console.warn('Fast NRI | effect formula update warnings', result.errors);
    }).catch(error => console.error('Fast NRI | actor effect formula refresh failed', error));
  });
  Hooks.on('createActiveEffect', (effect, _options, userId) => {
    reconcileZeroStrength(effect, userId);
    // Core TokenLayer creates the copy; resolve its auto-change formulas
    // against the actual target Actor after the native document exists.
    if (userId === game.user?.id && effect?.parent?.documentName === 'Actor' &&
        effect.parent.isOwner && !effect.disabled && readEffectState(effect).strength !== 0) {
      try {
        const patch=recalculationPatch(effect,readEffectState(effect));
        if(patch?.['system.changes']?.some((row,i)=>
          String(row.value)!==String(effect.system?.changes?.[i]?.value))) {
          const {errors,...update}=patch;
          if(errors?.length)console.warn('Fast NRI | copied effect formula warnings',errors);
          void effect.update(update).catch(error=>console.error('Fast NRI | copied effect formula',error));
        }
      }catch(error){console.error('Fast NRI | effect-on-token recalculation failed',error);}
    }
    refresh();
  });
  Hooks.on('updateActiveEffect', (effect, _changes, _options, userId) => {
    reconcileZeroStrength(effect, userId);
    refresh();
  });
  Hooks.on('deleteActiveEffect', refresh);
  Hooks.on('createItem', refresh);
  Hooks.on('updateItem', refresh);
  Hooks.on('deleteItem', refresh);
  Hooks.on('updateUser', (user, changes) => {
    if (user.id === game.user.id && 'character' in changes) refresh();
  });
  return panel;
}
