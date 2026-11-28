import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read = path => readFileSync(new URL('../'+path, import.meta.url), 'utf8');
const editableAttrs = '{{#if editable}}data-action="editImage" data-edit="img"{{/if}}';
for (const kind of ['character','npc']) {
  const template = read(`templates/${kind}.hbs`);
  const portraits = [...template.matchAll(/<img class="fnri-portrait"[^>]*>/g)].map(m=>m[0]);
  assert.equal(portraits.length, 2, `${kind}: compact and full portrait`);
  for (const portrait of portraits) {
    assert.ok(portrait.includes('src="{{actor.img}}"'));
    assert.ok(portrait.includes(editableAttrs), 'native action and Tokenizer selector must share the editable guard');
    const readonly = portrait.replace(editableAttrs, '');
    assert.doesNotMatch(readonly, /data-(?:action|edit)=/);
  }
}
const sheet = read('module/sheets/sheets.mjs');
assert.match(sheet, /editable:\s*this\.isEditable/);
assert.match(sheet, /extends HandlebarsApplicationMixin\(ActorSheetV2\)/);
assert.doesNotMatch(sheet, /\beditImage\s*:/, 'inherit native editImage action');
assert.match(read('styles/fast-nri.css'), /\.fnri-portrait\[data-action="editImage"\]\s*\{\s*cursor: pointer;/);
console.log('Portrait contract: PC/NPC, compact/full, native action, Tokenizer selector, readonly guard PASS');
