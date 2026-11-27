/**
 * Fast NRI: small, read-only character journal, based on Actor update diffs.
 * Uses the initiator-only preUpdateActor hook: the change and its history record
 * are one document update, not a second asynchronous update or a chat log.
 * Only HP, temporary HP, class resource changes and explicitly tracked ability uses
 * are recorded. No background polling, arbitrary action log or UI actions.
 */
import {serverTimestamp} from './server-clock.mjs';
import {classResourceIds} from './ability-accounting.mjs';
const SCOPE = 'fast-nri-v14';
const GROUP_MS = 30_000;
const journalObject = actor => actor.getFlag?.(SCOPE, 'changeJournal') ?? {};
const tr = key => game.i18n.localize(`FASTNRI.Journal.${key}`);
const has = (obj,key) => !!obj && Object.hasOwn(obj,key);
const asObject = x => x && typeof x === 'object' && !Array.isArray(x) ? x : {};
const str = value => value === null || value === undefined ? '—' : String(value);
const labelFor = (change, actor) => {
  if (change.type === 'hp') return tr('hp');
  if (change.type === 'hpMax') return tr('hpMax');
  if (change.type === 'temp') return tr('temp');
  const row = actor.system?.resources?.[change.resourceId];
  const title = row?.name || change.name || tr('unnamedResource');
  return change.type === 'resourceMax' ? `${title} (${tr('maximum')})` : title;
};

/** The hook receives the pre-update Actor and an addressable differential. */
export function registerActorJournal() {
  Hooks.on('preUpdateActor', (actor, changed, options, userId) => {
    if (game.system?.id !== SCOPE || userId !== game.user?.id) return;
    if (!['character','npc'].includes(actor?.type)) return;
    if (options?.fnriJournal?.skip === true) return;
    const delta = foundry.utils.expandObject(changed);
    const old = actor.toObject?.(true)?.system ?? actor.system;
    const lines = [];
    const hp = asObject(delta.system?.hp);
    for (const [field,type] of [['current','hp'],['temp','temp'],['max','hpMax']]) {
      if (!has(hp,field)) continue;
      const before = old.hp?.[field] ?? null;
      const after = hp[field];
      if (before !== after) lines.push({type,key:`hp.${field}`,before,after});
    }
    if(has(delta.system,'potionsUsed')){
      const before=old.potionsUsed??0,after=delta.system.potionsUsed??0;
      if(before!==after)lines.push({type:'resource',key:'potionsUsed',name:game.i18n.localize('FASTNRI.Potions.name'),before,after});
    }
    // Reuse the existing per-message ability-use event, including its class costs.
    const accounting = asObject(delta.flags?.[SCOPE]?.accountingEvents);
    const usage = Object.values(accounting).find(e => e?.type === 'use' || e?.type === 'reset');
    const resourceEdits = Object.entries(asObject(delta.system?.resources)).map(([id,row])=>id.startsWith('-=')?[id.slice(2),null]:[id,row]);
    const previousResources = asObject(old.resources);
    const classIds = new Set();
    if (resourceEdits.length) {
      const nextResources = {...previousResources};
      for (const [id,changedRow] of resourceEdits) {
        if (changedRow && typeof changedRow === 'object') {
          nextResources[id] = {...previousResources[id],...changedRow};
        } else {
          delete nextResources[id];
        }
      }
      for (const id of classResourceIds(actor, previousResources, usage?.classResourceChanges)) classIds.add(id);
      for (const id of classResourceIds(actor, nextResources)) classIds.add(id);
    }
    for (const [id,changedRow] of resourceEdits) {
      if (!classIds.has(id)) continue;
      const previous = previousResources[id];
      const name = changedRow?.name || previous?.name || '';
      if (!previous) {
        if (changedRow && typeof changedRow === 'object')
          lines.push({type:'added',key:`resources.${id}.added`,resourceId:id,name});
        continue;
      }
      if (!changedRow || typeof changedRow !== 'object') {
        lines.push({type:'removed',key:`resources.${id}.removed`,resourceId:id,name});
        continue;
      }
      for (const [field,type] of [['current','resource'],['max','resourceMax']]) {
        if (!has(changedRow,field)) continue;
        const before = previous[field] ?? null;
        const after = changedRow[field];
        if (before !== after)
          lines.push({type,key:`resources.${id}.${field}`,resourceId:id,name,before,after});
      }
    }
    const cooldown = usage?.type === 'use' && usage.trackedFrequency === true;
    const reset = usage?.type === 'reset';
    const rest = usage?.type === 'rest' || options?.fnriJournal?.kind === 'rest';
    if (!lines.length && !cooldown && !reset && !rest) return;
    const at = serverTimestamp();
    const actorId = userId;
    const explicit = asObject(options?.fnriJournal);
    const automatic = Boolean(usage) || Boolean(explicit.kind && explicit.kind !== 'manual');
    const entries = asObject(journalObject(actor));
    // ID keys are random non-index strings. Insertion order reflects event
    // order even when two changes share a millisecond timestamp.
    const latest = Object.entries(entries).at(-1);
    const canGroup = !automatic && latest && latest[1]?.type === 'manual' &&
      latest[1]?.by === actorId && at - (latest[1]?.lastAt ?? latest[1]?.at ?? 0) <= GROUP_MS;
    const key = canGroup ? latest[0] : foundry.utils.randomID();
    const event = canGroup ? structuredClone(latest[1]) : {
      type:automatic ? 'automatic' : 'manual', by:actorId, at,
      lastAt:at, reason:'', lines:[]
    };
    event.lastAt = at;
    if (lines.length) event.lines.push(...lines);
    if (automatic) {
      event.reason = usage?.sourceName || explicit.reason || '';
      event.action = usage?.type || explicit.kind || '';
      if (cooldown) {
        event.ability = {
          name:usage.sourceName || tr('ability'), cooldownRounds:usage.cooldownRounds ?? null,
          frequency:usage.frequency ?? null
        };
      }
      if (reset) event.reset = {name:usage.sourceName || tr('ability'), type:usage.reset};
      if (rest) event.rest = true;
      // HP metadata contains only a deliberately supplied reason. Never copy
      // private ChatMessage text or UUIDs into an Actor-readable journal.
    }
    foundry.utils.setProperty(changed, `flags.${SCOPE}.changeJournal.${key}`, event);
  });
}

function journalLineRows(entry, actor) {
  const groups = new Map();
  for (const change of entry.lines ?? []) {
    const id = change.key;
    const row = groups.get(id);
    if (change.type === 'added' || change.type === 'removed') {
      groups.set(id, {label:labelFor(change,actor),value:tr(change.type)});
      continue;
    }
    if (!row) groups.set(id, {label:labelFor(change,actor),values:[change.before,change.after]});
    else row.values.push(change.after);
  }
  return [...groups.values()].map(row => ({
    label:row.label, value:row.values ? row.values.map(str).join(' → ') : row.value
  }));
}

/** Prepare plain, escaped-by-Handlebars view rows, with no new sheet actions. */
export function actorJournalRows(actor) {
  const locale = game.i18n?.lang ?? 'ru';
  return Object.values(asObject(journalObject(actor)))
    .filter(entry => entry && (entry.lines?.length || entry.ability || entry.reset || entry.rest))
    .sort((a,b) => (b.lastAt ?? b.at ?? 0) - (a.lastAt ?? a.at ?? 0))
    .map(entry => {
      const by = game.users?.get(entry.by)?.name ?? '';
      const time = Number.isFinite(entry.at) ? new Intl.DateTimeFormat(locale, {
        year:'numeric',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',timeZoneName:'short'
      }).format(new Date(entry.at)) : '';
      const items = journalLineRows(entry, actor);
      if (entry.ability) {
        const suffix = Number.isInteger(entry.ability.cooldownRounds) && entry.ability.cooldownRounds > 0 ?
          `${tr('cooldown')}: ${str(entry.ability.cooldownRounds)} ${tr('rounds')}` : tr('limitedUse');
        items.push({label:entry.ability.name,value:suffix});
      }
      if (entry.reset) items.push({label:entry.reset.name,value:tr('reset')});
      if (entry.rest) items.push({label:items.length?tr('abilities'):tr('allResourcesAndAbilities'),value:tr('restored')});
      return {
        time, author:by,
        title:entry.rest ? tr('rest') : entry.type === 'manual' ? tr('manual') : entry.reason || tr('automatic'),
        items
      };
    });
}
