import {nextOwnTurnExpiry} from '../abilities/temporary-hp-cast.mjs';
import {stableDocumentId} from '../data/document-id.mjs';

const SCOPE = 'fast-nri-v14';
const EVENT = 'fnriSourceTurnStart';
const sourceTurnKey = (combat, combatantId) => stableDocumentId('fst',[combat.id,combatantId]);

export function captureSourceTurnExpiry(actor, combat, origin) {
  const {turnStart} = nextOwnTurnExpiry(actor,combat,null,origin);
  return turnStart ? {key:sourceTurnKey(combat,turnStart.combatantId),round:turnStart.notBeforeRound} : null;
}

export function sourceTurnIsPending(expiry, combat) {
  if (!expiry || !combat?.started || combat.round > expiry.round) return false;
  const turn = (combat.turns ?? []).findIndex(combatant => sourceTurnKey(combat,combatant.id) === expiry.key);
  return turn >= 0 && (combat.round < expiry.round || combat.turn < turn);
}

export function setSourceTurnExpiry(data, expiry) {
  const flags = data.flags[SCOPE];
  flags.effectEnding = 'particular';
  flags.sourceTurnExpiry = expiry;
  data.duration = {value:null,expiry:EVENT};
}

export function registerSourceTurnExpiry() {
  const config = CONFIG.ActiveEffect;
  config.expiryEvents[EVENT] = game.i18n.localize('FASTNRI.Damage.sourceTurnExpiry');
  config.documentClass = class extends config.documentClass {
    isExpiryEvent(event, context) {
      if (this.duration.expiry !== EVENT) return super.isExpiryEvent(event,context);
      const expiry = this.getFlag(SCOPE,'sourceTurnExpiry');
      const combat = context?.combat;
      return event === EVENT && !!expiry && combat?.started && !!combat.combatant &&
        combat.round >= expiry.round && sourceTurnKey(combat,combat.combatant.id) === expiry.key;
    }
  };
}

export async function expireSourceTurnEffects(combat, combatant, context) {
  if (!game.user?.isGM || !combat?.started || context?.skipped || !combatant?.id || combat.combatant?.id !== combatant.id) return;
  await foundry.documents.ActiveEffect.registry.refresh(EVENT,{combat});
}
