/**
 * Foundry v14 bootstrap smoke test. Does not emulate the full Foundry client.
 * Checks that ES-module imports initialize and all registered sheet classes
 * have a supported subtype/default mapping.
 */
import assert from "node:assert/strict";
import {readFileSync, existsSync} from "node:fs";
import {pathToFileURL} from "node:url";
import {resolve, dirname} from "node:path";

const root = resolve(dirname(new URL(import.meta.url).pathname), "..");
const manifest = JSON.parse(readFileSync(resolve(root,"system.json"),"utf8"));
assert.equal(manifest.type, "system");
assert.equal(manifest.id, "fast-nri-v14");
assert.ok(manifest.esmodules.includes("main.mjs"));
assert.ok(manifest.download.includes("/v" + manifest.version + "/"));
for (const path of [
  "main.mjs", "module/data/models.mjs", "module/sheets/sheets.mjs",
  "templates/character.hbs", "templates/npc.hbs", "templates/item.hbs",
  "lang/ru.json", "lang/en.json", "styles/fast-nri.css"
]) assert.ok(existsSync(resolve(root,path)), "Missing " + path);

const hooks = new Map();
const registrations = [];
const Field = class { constructor(...args) { this.args = args; } };
const Model = class {};
const Sheet = class {};
const makeLabel = name => "fast-nri-v14." + name;
globalThis.Hooks = {once(name,fn) {hooks.set(name,fn)}};
globalThis.CONFIG = {Actor:{dataModels:{}},Item:{dataModels:{}}};
globalThis.game = {user:{isGM:true},system:{id:"fast-nri-v14"}};
globalThis.ui = {notifications:{warn(message){throw new Error(message)}}};
globalThis.foundry = {
  data:{fields:{StringField:Field,NumberField:Field,SchemaField:Field,ObjectField:Field}},
  abstract:{TypeDataModel:Model},
  applications:{
    api:{HandlebarsApplicationMixin(Base){return class extends Base{}}},
    sheets:{ActorSheetV2:Sheet,ItemSheetV2:Sheet},
    apps:{DocumentSheetConfig:{
      registerSheet(doc,namespace,cls,options){registrations.push({doc,namespace,cls,options})},
      getSheetClassesForSubType(type,subtype) {
        const possible=registrations.filter(r =>
          r.doc.documentName === type && (!r.options.types || r.options.types.includes(subtype)));
        const sheetClasses=Object.fromEntries(possible.map(r=>[makeLabel(r.cls.name),r.cls.name]));
        const defaults=possible.filter(r=>r.options.makeDefault);
        return {sheetClasses,defaultClass:defaults.at(-1)?.cls.name??""};
      }
    }}
  },
  documents:{
    Actor:class { static documentName="Actor" },
    Item:class { static documentName="Item" }
  }
};

await import(pathToFileURL(resolve(root,"main.mjs")).href);
assert.equal(typeof hooks.get("init"),"function");
hooks.get("init")();
assert.equal(registrations.length,3);
assert.deepEqual(Object.keys(CONFIG.Actor.dataModels).sort(),["character","npc"]);
assert.deepEqual(Object.keys(CONFIG.Item.dataModels).sort(),["ability","armor","gear","item","weapon"]);
assert.deepEqual(registrations[0].options.types,undefined,"Actor fallback must cover all subtypes");
assert.deepEqual(registrations[1].options.types,["npc"]);
assert.equal(registrations[2].options.types,undefined,"Item fallback must cover all subtypes");
assert.equal(typeof hooks.get("ready"),"function");
hooks.get("ready")();

const {FastNRICharacterSheet,FastNRINPCSheet,FastNRIItemSheet} =
  await import(pathToFileURL(resolve(root,"module/sheets/sheets.mjs")).href);
for (const cls of [FastNRICharacterSheet,FastNRINPCSheet,FastNRIItemSheet]) {
  assert.equal(cls.DEFAULT_OPTIONS.tag??"form","form");
  const parts=Object.values(cls.PARTS);
  assert.equal(parts.length,1);
  assert.equal(parts[0].root,true);
  assert.ok(existsSync(resolve(root,parts[0].template.replace("systems/fast-nri-v14/",""))));
}
for (const path of ["templates/character.hbs", "templates/npc.hbs", "templates/item.hbs"]) {
  const html = readFileSync(resolve(root,path),"utf8");
  assert.ok(html.includes('class="fnri-number"'), "Missing visible numeric fields: " + path);
  assert.ok(html.includes('data-dtype="Number"'), "Missing typed number handling: " + path);
  assert.ok(!html.includes('type="number"'), "Old problematic numeric input in " + path);
}
const styles = readFileSync(resolve(root,"styles/fast-nri.css"),"utf8");
assert.ok(styles.includes("input.fnri-number"),"No scoped numeric input styling");

// The Actor and Item sheets share the same ApplicationV2 scroll layout.
assert.ok(styles.includes("FNRI 0.1.5: ApplicationV2 single scroll container"));
assert.ok(styles.includes(".application.fast-nri-v14.fast-nri-sheet .window-content"));
assert.match(styles, /overflow-y:\s*auto\s*!important/);
assert.match(styles, /height:\s*auto\s*!important/);
assert.ok(styles.includes("padding-bottom: 36px"));
console.log("Bootstrap smoke test PASS: models, sheet registration, form roots and assets.");
