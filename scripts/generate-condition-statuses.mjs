/** Build the HUD registry from the authoritative condition compendium sources.
 * Run with --check in tests: never silently let the shipped registry drift. */
import {readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const dir = join(root, 'packs/_source/conditions');
const destination = join(root, 'module/effects/condition-statuses.generated.mjs');
const scope = 'fast-nri-v14';
const cards = readdirSync(dir).filter(name => name.endsWith('.json')).sort()
  .map(name => JSON.parse(readFileSync(join(dir, name), 'utf8')));
const entries = {};
const cardLinks = {};
for (const card of cards) {
  const condition = card.system?.mechanics?.condition;
  if (!condition?.id) throw Error(`Missing condition ID: ${card.name}`);
  const effects = card.effects ?? [];
  cardLinks[condition.id] = {name:card.name, uuid:`Compendium.${scope}.conditions.Item.${card._id}`};
  if ((condition.instantaneous === true || condition.createActiveEffect === false) && condition.informationalMarker !== true) {
    if (effects.length) throw Error(`Instantaneous condition has an AE: ${card.name}`);
    continue;
  }
  const id = `fnri7-${condition.id}`;
  if (Object.hasOwn(entries, id) || effects.length !== 1) throw Error(`Invalid HUD template: ${card.name}`);
  const effect = structuredClone(effects[0]);
  if (effect.flags?.[scope]?.conditionId !== condition.id || effect.statuses?.length !== 1 ||
      effect.statuses[0] !== id || effect.transfer !== false || effect.disabled !== false ||
      effect.showIcon !== 2 || effect.name !== card.name || effect.img !== card.img)
    throw Error(`Inconsistent condition card and AE: ${card.name}`);
  if (condition.informationalMarker === true && (effect.flags?.[scope]?.informationalMarker !== true || effect.system?.changes?.length !== 0)) throw Error(`Invalid informational marker: ${card.name}`);
  // A HUD-created effect receives its own native identity and start time.
  delete effect._id;
  delete effect._stats;
  delete effect.start;
  entries[id] = {...effect, id, hud: true};
}
const output = '// Generated from packs/_source/conditions by scripts/generate-condition-statuses.mjs.\n// Do not edit: change the approved source card and regenerate.\nexport const CONDITION_STATUSES = '+JSON.stringify(entries, null, 2)+';\nexport const CONDITION_CARD_LINKS = '+JSON.stringify(cardLinks, null, 2)+';\n';
if (process.argv.includes('--check')) {
  if (readFileSync(destination, 'utf8') !== output) throw Error('HUD registry differs from condition compendium sources; run npm run generate:conditions');
} else writeFileSync(destination, output);
console.log(`Native HUD registry: ${Object.keys(entries).length} condition templates`);
