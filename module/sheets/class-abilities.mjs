import {abilitySource} from '../data/ability-source.mjs';
import { actorClassDefinition, DOUBLE_INVOCATION_ID } from '../data/classes.mjs';
import { queueActorWrite } from '../data/ability-accounting.mjs';

const SCOPE = 'fast-nri-v14';
const INDEX_FIELD = `flags.${SCOPE}.contentId`;
const INDEX_FIELDS = [INDEX_FIELD, `flags.${SCOPE}.source`, 'type', 'img'];
const contentId = entry => entry?.getFlag?.(SCOPE, 'contentId') ?? entry?.flags?.[SCOPE]?.contentId ?? entry?.[INDEX_FIELD];
const classIds = actor => actorClassDefinition(actor)?.abilityIds ?? [];
const owned = (actor, id) => actor.items.contents.find(item => item.type === 'ability' && contentId(item) === id);
const pack = () => game.packs?.get?.(`${SCOPE}.abilities`);

export async function missingClassAbilityRows(actor) {
  const missing = classIds(actor).filter(id => !owned(actor, id));
  const source = pack();
  if (!missing.length || !source?.getIndex) return [];
  try {
    const index = await source.getIndex({ fields: INDEX_FIELDS });
    const entries = new Map((index.contents ?? [...index]).filter(entry => entry.type === 'ability')
      .map(entry => [contentId(entry), entry]));
    return missing.flatMap(id => {
      const entry = entries.get(id);
      return entry ? [{name: entry.name, img: entry.img, classContentId: id, compendiumOnly: true, classAbility: true,
        abilitySource:abilitySource(actor,entry,{classContentId:id}),
        doubleInvocation: id === DOUBLE_INVOCATION_ID}] : [];
    });
  } catch (error) {
    console.warn('Fast NRI | class abilities index unavailable', error);
    return [];
  }
}

export async function classAbilityCard(actor, id) {
  if (!classIds(actor).includes(id)) return null;
  const existing = owned(actor, id);
  if (existing) return existing;
  const source = pack();
  if (!source?.getIndex) return null;
  const index = await source.getIndex({fields: INDEX_FIELDS});
  const matches = (index.contents ?? [...index]).filter(entry => entry.type === 'ability' && contentId(entry) === id);
  if (matches.length !== 1) return null;
  const card = await source.getDocument(matches[0]._id);
  return card?.type === 'ability' && contentId(card) === id ? card : null;
}

export function useClassAbilityCard(actor, id) {
  return queueActorWrite(actor, async () => {
    const card = await classAbilityCard(actor, id);
    if (!card || !classIds(actor).includes(id)) return null;
    const existing = owned(actor, id);
    if (existing) return existing;
    const data = card.toObject();
    delete data.folder;
    delete data._stats;
    if (actor.items.has(data._id)) delete data._id;
    try {
      const [item] = await actor.createEmbeddedDocuments('Item', [data], {keepId: Boolean(data._id)});
      return item;
    } catch (error) {
      const concurrent = owned(actor, id);
      if (!concurrent) throw error;
      return concurrent;
    }
  });
}
