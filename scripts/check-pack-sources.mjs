/**
 * Read-only structural audit of native Foundry compendium JSON sources.
 * Validates identities and content references before compiling LevelDB.
 * Does not launch Foundry, change documents or modify the game world.
 */
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFileSync, readdirSync} from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'system.json'), 'utf8'));
const sourceDir = join(root, 'packs', '_source');
const docIds = new Set();
const packNames = new Set();
const content = new Map();
const references = [];
const types = {Item: new Set(['weapon', 'armor', 'gear', 'ability', 'item']),
  Actor: new Set(['character', 'npc'])};

const fail = (file, reason) => { throw Error(`${file}: ${reason}`); };
const validId = value => typeof value === 'string' && /^[A-Za-z0-9]{16}$/.test(value);
const plainObject = obj => obj !== null && typeof obj === 'object' && !Array.isArray(obj);

function collectReferences(value, file, path = '') {
  if (Array.isArray(value)) {
    value.forEach((child, index) => collectReferences(child, file, `${path}[${index}]`));
    return;
  }
  if (!plainObject(value)) return;
  for (const [name, child] of Object.entries(value)) {
    if (name === 'effectRefs') {
      if (!Array.isArray(child)) fail(file, `${path}.effectRefs must be an array`);
      child.forEach((reference, index) => {
        if (!plainObject(reference) || typeof reference.contentId !== 'string' ||
            !validId(reference.effectId)) fail(file, `${path}.effectRefs[${index}] is invalid`);
        references.push({file, path:`${path}.effectRefs[${index}]`, ...reference});
      });
    } else collectReferences(child, file, path ? `${path}.${name}` : name);
  }
}

if (!Array.isArray(manifest.packs) || manifest.packs.length === 0)
  fail('system.json', 'Missing native packs');
let count = 0;
for (const pack of manifest.packs) {
  const location = `system.json:packs.${pack.name}`;
  if (!pack.name || packNames.has(pack.name) || !types[pack.type] ||
      pack.system !== manifest.id || pack.path !== `packs/${pack.name}`)
    fail(location, 'Invalid or duplicate pack metadata');
  packNames.add(pack.name);
  const dir = join(sourceDir, pack.name);
  const files = readdirSync(dir).filter(name => name.endsWith('.json')).sort();
  if (files.length === 0) fail(dir, 'No document JSON files');
  for (const filename of files) {
    const file = join(dir, filename);
    const card = JSON.parse(readFileSync(file, 'utf8'));
    if (!plainObject(card) || !validId(card._id) || !card.name?.trim() ||
        !types[pack.type].has(card.type) || !plainObject(card.system))
      fail(file, 'Malformed native document source');
    if (!filename.endsWith(`--${card._id}.json`))
      fail(file, 'File name must end with the persistent _id');
    const id = card._id;
    if (docIds.has(id)) fail(file, `Duplicate document _id ${id}`);
    docIds.add(id);
    const contentId = card.flags?.[manifest.id]?.contentId;
    if (typeof contentId !== 'string' || !contentId.trim() || content.has(contentId))
      fail(file, `Missing or duplicate contentId: ${contentId}`);
    const effects = new Map();
    if (card.effects !== undefined && !Array.isArray(card.effects))
      fail(file, 'effects must be an array');
    for (const effect of card.effects ?? []) {
      if (!validId(effect?._id) || effects.has(effect._id))
        fail(file, `Malformed or duplicate embedded ActiveEffect ID ${effect?._id}`);
      effects.set(effect._id,effect);
    }
    content.set(contentId, {file, type:pack.type, effects});
    collectReferences(card.system, file, 'system');
    count++;
  }
}
for (const {file, path, contentId, effectId} of references) {
  const target = content.get(contentId);
  const effect = target?.type === 'Item' ? target.effects.get(effectId) : null;
  if (!effect)
    fail(file, `${path} points to missing Item ActiveEffect: ${contentId}/${effectId}`);
  if (effect.transfer === true)
    fail(file, `${path} points to a transferring Item ActiveEffect: ${contentId}/${effectId}`);
}
console.log(`Native compendium JSON sources: ${count} documents in ${manifest.packs.length} packs; ${references.length} valid effect references`);
