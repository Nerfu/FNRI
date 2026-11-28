/** The party is organizational only. Native Actor.folder is the sole placement. */
const SYSTEM = 'fast-nri-v14';
const ROLES = ['party', 'archive'];

/** Create only the missing system folders, once on the designated GM's ready. */
export async function ensurePartyFolders() {
  if (!game.user?.isActiveGM) return [];
  const existing = new Set(game.folders.contents
    .filter(folder => folder.type === 'Actor')
    .map(folder => folder.getFlag(SYSTEM, 'partyFolder')));
  const missing = ROLES.filter(role => !existing.has(role));
  if (!missing.length) return [];
  return game.folders.documentClass.createDocuments(missing.map(role => ({
    name: game.i18n.localize(`FASTNRI.PartyFolders.${role}`),
    type: 'Actor',
    folder: null,
    sorting: 'm',
    flags: {[SYSTEM]: {partyFolder: role}}
  })));
}
