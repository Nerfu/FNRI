/**
 * Look up Item-authored templates in native Fast NRI system compendiums.
 * Each contentId is authored once in its JSON card. No world import, duplicate
 * catalog, migration, name matching or world writes are required.
 */
const SYSTEM_ID = 'fast-nri-v14';
const INDEX_FIELD = `flags.${SYSTEM_ID}.contentId`;

function itemContentId(item) {
  return item?.flags?.[SYSTEM_ID]?.contentId ?? null;
}

/**
 * A contentId identifies ONE template. Duplicate identities are treated as
 * ambiguous instead of silently selecting a random pack entry.
 * A world Item is only a fallback for an explicitly authored world template
 * when no corresponding system compendium card is available.
 */
export async function resolveSystemContentItem(contentId) {
  if (typeof contentId !== 'string' || !contentId.trim()) return null;
  const matches = [];
  for (const pack of game.packs?.values() ?? []) {
    if (pack.documentName !== 'Item' || !pack.collection.startsWith(`${SYSTEM_ID}.`)) continue;
    let index;
    try {
      index = await pack.getIndex({ fields: [INDEX_FIELD] });
    } catch (error) {
      // Unavailable content is never a reason to block an Actor HP update.
      console.warn(`Fast NRI | cannot index system content pack ${pack.collection}`, error);
      continue;
    }
    const entries = index?.contents ?? Array.from(index ?? []);
    for (const entry of entries) {
      const sourceId = entry?.flags?.[SYSTEM_ID]?.contentId ?? entry?.[INDEX_FIELD];
      if (sourceId === contentId) matches.push({pack, id:entry._id});
    }
  }
  if (matches.length > 1) return null;
  if (matches.length === 1) {
    try {
      const card = await matches[0].pack.getDocument(matches[0].id);
      if (card?.documentName === 'Item' && itemContentId(card) === contentId) return card;
    } catch (error) {
      console.warn(`Fast NRI | cannot read compendium item ${contentId}`, error);
    }
  }
  const world = (game.items?.contents ?? []).filter(item => itemContentId(item) === contentId);
  return world.length === 1 ? world[0] : null;
}
