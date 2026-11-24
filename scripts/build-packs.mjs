import { deepStrictEqual, equal } from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compilePack, extractPack } from '@foundryvtt/foundryvtt-cli';

const base = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(base, 'system.json'), 'utf8'));
const collections = { Item: 'items', Actor: 'actors' };

function withPackKeys(document, collection, id = document._id) {
  const keyed = { ...document, _key: `!${collection}!${id}` };
  for (const field of ['items', 'effects']) {
    if (!Array.isArray(document[field])) continue;
    keyed[field] = document[field].map(child =>
      withPackKeys(child, `${collection}.${field}`, `${id}.${child._id}`));
  }
  return keyed;
}

function withoutPackKeys(document) {
  const { _key, ...source } = document;
  for (const field of ['items', 'effects']) {
    if (Array.isArray(source[field])) source[field] = source[field].map(withoutPackKeys);
  }
  return source;
}

const temporary = mkdtempSync(join(tmpdir(), 'fnri-packs-'));
try {
  for (const pack of manifest.packs) {
    const collection = collections[pack.type];
    if (!collection || pack.system !== manifest.id) throw Error(`Invalid source pack: ${pack.name}`);
    const source = join(base, 'packs', '_source', pack.name);
    const destination = join(base, pack.path);
    const staged = join(temporary, pack.name, 'staged');
    const extracted = join(temporary, pack.name, 'extracted');
    mkdirSync(staged, { recursive: true });

    const originals = new Map();
    for (const file of readdirSync(source).filter(name => name.endsWith('.json'))) {
      const document = JSON.parse(readFileSync(join(source, file), 'utf8'));
      originals.set(document._id, document);
      // The CLI skips documents without _key, including otherwise valid Foundry sources.
      writeFileSync(join(staged, file), JSON.stringify(withPackKeys(document, collection)));
    }
    if (!originals.size) throw Error(`Empty source pack: ${pack.name}`);

    rmSync(destination, { recursive: true, force: true });
    await compilePack(staged, destination);
    await extractPack(destination, extracted, {
      transformName: document => `${document._id}.json`
    });

    const packed = readdirSync(extracted);
    equal(packed.length, originals.size, `Unexpected document count in ${pack.name}`);
    for (const file of packed) {
      const document = withoutPackKeys(JSON.parse(readFileSync(join(extracted, file), 'utf8')));
      deepStrictEqual(document, originals.get(document._id), `Compiled document mismatch: ${pack.name}/${file}`);
    }
    console.log(`Compiled and verified ${pack.name}: ${originals.size} documents`);
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
