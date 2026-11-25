import {rerollParts} from '../rolls/game-reroll.mjs';
import { canReadChatContent } from '../data/chat-visibility.mjs';
import { CHECK_DEFENSES, messageIntervention } from '../rolls/attack-properties.mjs';
import { areaCoverCandidates } from '../damage/area-attack.mjs';
import { coverAllyItem, coverScope, hasIntervened, directedCoverCandidates, isCurrentDirectedCoverSource } from '../damage/cover-ally-state.mjs';

const SYSTEM_ID = 'fast-nri-v14';

/** Use only the currently visible snapshot and tokens of this exact Actor. */
export function interventionSources(actor, actionId, {showAll = false} = {}) {
  const tokens = (globalThis.canvas?.tokens?.placeables ?? []).filter(token => token.actor?.uuid === actor.uuid &&
    (game.user.isGM || token.document.hidden !== true));
  const actorTokens = new Set([actor.token?.uuid, ...tokens.map(token => token.document.uuid)].filter(Boolean));
  const matches = uuid => actorTokens.has(uuid) || uuid === actor.uuid;
  const messages = (game.messages?.contents ?? []).filter(canReadChatContent);
  if (actionId === 'coverAlly') {
    if (!coverAllyItem(actor)) return [];
    return messages.flatMap(message => {
      const card = message.getFlag(SYSTEM_ID, 'weaponDamage');
      if (!card || card.areaRootMessageId && card.areaRootMessageId !== message.id) return [];
      const candidates = card.areaAttack ? areaCoverCandidates : directedCoverCandidates;
      const eligible = tokens.filter(token => candidates(message, token).length);
      return eligible.length ? [{message, label:card.name+(hasIntervened(message,actor)?' · ⚠ '+game.i18n.localize('FASTNRI.Damage.repeatIntervention'):''), tokens:eligible}] : [];
    }).reverse();
  }
  const sources = [];
  for (const message of messages) {
    const continuation=message.getFlag(SYSTEM_ID,'weaponDamage')?.previousMessageId || message.getFlag(SYSTEM_ID,'checkRoll')?.previousMessageId;
    if (messageIntervention(message) && !continuation) continue;
    const damage = message.getFlag(SYSTEM_ID, 'weaponDamage');
    if (damage?.cancelled || damage?.parts?.some(part => part.pending)) continue;
    if(damage?.version===2 && !damage.areaAttack && !isCurrentDirectedCoverSource(message))continue;
    const area = damage?.areaAttack;
    const directedCheck = CHECK_DEFENSES.includes(damage?.targetDefense);
    if (area?.version === 1) {
      if (damage.areaRootMessageId && damage.areaRootMessageId !== message.id) continue;
      if ((actionId === 'dodge' || actionId === 'counteraction' && directedCheck) &&
        area.targets.some(target => matches(target.uuid))) {
        const targets = new Set(area.targets.map(target => target.uuid));
        sources.push({message, label: damage.name, tokens: tokens.filter(token => targets.has(token.document.uuid))});
      }
    } else if (damage?.version === 2 && matches(damage.originalTargetUuid)) {
      if (actionId === 'selfDefense' && !directedCheck || actionId === 'counteraction' && directedCheck) {
        sources.push({message, label: damage.name, directCheck: directedCheck,
          tokens: tokens.filter(token => token.document.uuid === damage.originalTargetUuid)});
      }
    } else if (actionId === 'counteraction' && !damage) {
      const check = message.getFlag(SYSTEM_ID, 'checkRoll');
      if (CHECK_DEFENSES.includes(check?.targetDefense) && matches(check.result?.targetUuid)) {
        sources.push({message, label: check.label, directCheck: true});
      }
    }
  }
  // Display only the newest eligible snapshot for each original action.
  const seen=new Set();
  return sources.reverse().filter(source=>{
    const scope=coverScope(source.message);
    if(seen.has(scope))return false;
    seen.add(scope);
    if(hasIntervened(source.message,actor))source.label+=' · ⚠ '+game.i18n.localize('FASTNRI.Damage.repeatIntervention');
    return true;
  });
}

export function talismanSources(actor) {
  const sources = [];
  for (const message of game.messages?.contents ?? []) {
    if (!canReadChatContent(message)) continue;
    const check = message.getFlag(SYSTEM_ID, 'checkRoll');
    const attack = message.getFlag(SYSTEM_ID, 'weaponAttack');
    const damage = message.getFlag(SYSTEM_ID, 'weaponDamage');
    if (!rerollParts(message,actor).length) continue;
    const label = check?.label ?? attack?.name ?? damage?.name ?? message.alias;
    const totals = message.rolls.map(roll => roll.total).join(' / ');
    sources.push({message, name: [label, totals].filter(Boolean).join(' · ')});
  }
  return sources.reverse();
}

export async function openChatSource(message, {focusDefense = false} = {}) {
  if (!canReadChatContent(game.messages?.get(message.id))) return false;
  const chat = ui.chat;
  if (!chat) return false;
  if (!chat.rendered) await chat.render({force: true});
  chat.activate();
  const find = () => chat.element?.querySelector(`[data-message-id="${CSS.escape(message.id)}"]`);
  let element = find();
  if (!element) {
    const rendered = chat.element?.querySelector('[data-message-id]');
    const earlier = game.messages.contents.findIndex(candidate => candidate.id === rendered?.dataset.messageId);
    const index = game.messages.contents.indexOf(message);
    if (index >= 0 && (earlier < 0 || index < earlier)) {
      await chat.renderBatch((earlier < 0 ? game.messages.contents.length : earlier) - index);
      element = find();
    }
  }
  if (!element || !canReadChatContent(game.messages?.get(message.id))) return false;
  element.scrollIntoView({block: 'center'});
  if (focusDefense) element.querySelector('.fnri-intervene-button, .fnri-area-actions button')?.focus({preventScroll: true});
  return true;
}
