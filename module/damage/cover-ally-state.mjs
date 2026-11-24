import {canReadChatContent, chatAudience} from '../data/chat-visibility.mjs';
import {stableDocumentId} from '../data/document-id.mjs';
import {calculateDamage, coverAllyDice, planCoverAlly} from './damage-core.mjs';
import {previewDeclaredDamageDefenses} from './periodic-damage.mjs';
import {messageIntervention} from '../rolls/attack-properties.mjs';
import {minimumCellGap, sameScene} from '../spatial/geometry.mjs';

const ID = 'fast-nri-v14';
export const COVER_ALLY_ID = 'builtin:coverAlly';
const flag = (message, key) => message?.getFlag?.(ID, key);
const messages = () => game.messages?.contents ?? [];
const doc = token => token?.document ?? token;
export const coverActorKey = actor => stableDocumentId('cva', actor?.uuid);

export function coverAllyItem(actor) {
  return actor?.items?.contents?.find(item => item.type === 'ability' &&
    (item.system?.mechanics?.grantsAction === 'coverAlly' ||
      flag(item, 'contentId') === 'fnri7.rulebook.racial.samootverzhennyi')) ?? null;
}

export function coverScope(message) {
  const card = flag(message, 'weaponDamage');
  if (card?.areaAttack?.version === 1) return card.areaRootMessageId ?? message.id;
  return card?.attackMessageId ?? message?.id;
}

export function sameCoverAudience(left, right) {
  const a = chatAudience(left), b = chatAudience(right);
  return a.blind === b.blind && a.whisper.length === b.whisper.length &&
    a.whisper.every(id => b.whisper.includes(id));
}

export function coverRecords(message, tokenUuid = null) {
  const scope = coverScope(message);
  return messages().flatMap(entry => {
    const cover = flag(entry, 'coverAlly');
    if (cover?.version !== 1 || cover.scope !== scope || (tokenUuid && cover.allyToken !== tokenUuid) ||
        !canReadChatContent(entry) || !sameCoverAudience(entry, message)) return [];
    return [{...cover, messageId: entry.id}];
  });
}

/** A transfer already applied to HP cannot be charged again by ordinary clicks. */
export function hasCoverApplication(key) {
  return messages().some(message => {
    const report = flag(message, 'hpReport');
    return report?.coverApplicationKey === key && report.reverted !== true;
  });
}

export function coverReportId(key) {
  const undone = messages().filter(message => {
    const report = flag(message, 'hpReport');
    return report?.coverApplicationKey === key && report.reverted === true;
  }).length;
  return stableDocumentId('cph',[key,undone]);
}

export function hasDamageForCoverTarget(message, token) {
  const uuid = doc(token)?.uuid;
  const scope = coverScope(message);
  return messages().some(entry => {
    const report = flag(entry, 'hpReport');
    if (report?.kind !== 'damage' || report.reverted === true || !canReadChatContent(entry)) return false;
    if (report.tokenUuid ? report.tokenUuid !== uuid : report.actorUuid !== token.actor?.uuid) return false;
    const origin = game.messages.get(report.sourceMessageId);
    return origin && coverScope(origin) === scope;
  });
}

export function applyCoverExclusions(card, covers) {
  let current = card;
  for (const cover of covers) {
    const plan = planCoverAlly(current, cover.partId);
    if (!plan || plan.redirectedDamage !== cover.amount) return null;
    current = plan.allyCard;
  }
  return current;
}

export function coverRecipients(defender, uuids = []) {
  const defenderDoc = doc(defender);
  if (!defender?.actor || defenderDoc.hidden === true || defender.visible === false) return [];
  const explicit = new Set([...(game.user?.targets ?? [])].map(token => doc(token)?.uuid));
  return (globalThis.canvas?.tokens?.placeables ?? []).filter(ally => {
    const token = doc(ally);
    if (!ally.actor || ally.actor.uuid === defender.actor.uuid || ally.visible === false ||
        token.hidden === true || !sameScene(defender, ally) || minimumCellGap(defender, ally) !== 1) return false;
    if (uuids.length && !uuids.includes(token.uuid)) return false;
    const known = [1, -1].includes(defenderDoc.disposition) && [1, -1].includes(token.disposition);
    return known ? defenderDoc.disposition === token.disposition : explicit.has(token.uuid);
  });
}

export function isCurrentDirectedCoverSource(message) {
  const card = flag(message, 'weaponDamage');
  if (!canReadChatContent(message) || card?.version !== 2 || card.areaAttack || card.cancelled ||
      card.parts?.some(part => part.pending)) return false;
  if (card.attackMessageId && messageIntervention(game.messages?.get(card.attackMessageId))) return false;
  if (messageIntervention(message) && !card.previousMessageId) return false;
  const scope = coverScope(message);
  const current = messages().findLast(entry => {
    const snapshot = flag(entry, 'weaponDamage');
    return snapshot?.version === 2 && !snapshot.areaAttack && coverScope(entry) === scope &&
      canReadChatContent(entry) && sameCoverAudience(entry, message);
  });
  return current?.id === message.id;
}

export function directedCoverTargets(message, defender) {
  if (!isCurrentDirectedCoverSource(message)) return [];
  const card = flag(message, 'weaponDamage');
  const targets = card.originalTargetUuid ? [card.originalTargetUuid] : [];
  return coverRecipients(defender, targets).filter(ally => !hasDamageForCoverTarget(message, ally));
}

export function directedCoverSnapshot(message, ally) {
  const card = flag(message, 'weaponDamage');
  const immune = new Set(previewDeclaredDamageDefenses(ally.actor, card)?.immunePartIds ?? []);
  const masked = {...card,parts:card.parts.map(part => ({...part,immune:part.immune || immune.has(part.id)}))};
  const records = coverRecords(message, doc(ally).uuid);
  if (records.some(cover => cover.sourceId !== message.id || cover.sourceRevision !== (card.revision ?? 0) ||
    coverActorKey(ally.actor) !== cover.allyKey)) return null;
  const adjusted = applyCoverExclusions(masked, records);
  if (!adjusted) return null;
  const defenses = previewDeclaredDamageDefenses(ally.actor, adjusted);
  if (defenses?.complete) adjusted.adjustments = {...adjusted.adjustments,
    resistance:Math.max(Number(card.adjustments?.resistance)||0,defenses.resistance),
    vulnerability:Math.max(Number(card.adjustments?.vulnerability)||0,defenses.vulnerability)};
  return adjusted;
}

export function directedCoverCandidates(message, defender) {
  return directedCoverTargets(message,defender).flatMap(ally => {
    const card = directedCoverSnapshot(message,ally);
    return coverAllyDice(card).length && calculateDamage(card).total>0 ? [{ally,card}] : [];
  });
}
