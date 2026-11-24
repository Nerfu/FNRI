import {
  RACIAL_SYSTEM_ID, racialLabel as label, racialContentId, racialPropertyRule,
  racialPropertyChoices, selectedRacialPropertyChoice, racialState, racialAddWarnings, racialPermissions, racialAddBlock, racialRemoveBlock, racialChoicesForItem, selectedRacialChoiceForItem
} from "../data/racial-properties.mjs";

const esc = value => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
let pendingFilter;
let filterWrites=Promise.resolve();
function rememberFilter(checked){
  const user=game.user;
  const choice={checked,user};pendingFilter=choice;
  filterWrites=filterWrites.then(async()=>{
    await user.setFlag(RACIAL_SYSTEM_ID,"racialShowAll",checked);
    if(pendingFilter===choice)pendingFilter=undefined;
  }).catch(error=>console.warn("Fast NRI | racial filter preference",error));
}
const normalizeSearch = value => value.toLocaleLowerCase("ru").replaceAll("ё", "е").trim();

function sameProperty(actor, item) {
  const id = racialContentId(item);
  return id ? actor.items.contents.find(owned => owned.type === "ability" && racialContentId(owned) === id) : null;
}

export function racialChoiceWarning(state) {
  return state.max !== null && state.used < state.max ? "limitMissing" : "";
}

export function racialChoiceStatus(state) {
  const key = racialChoiceWarning(state);
  if (!key) return "";
  const remaining=state.max-state.used;
  const form=remaining%100>=11&&remaining%100<=14?'Many':remaining%10===1?'One':remaining%10>=2&&remaining%10<=4?'Few':'Many';
  const template=label(game.i18n.lang==='ru'?'limitMissing'+form:remaining===1?'limitMissingOne':'limitMissingMany');
  return template.replace('{remaining}',String(remaining));
}

export function racialPropertyRows(actor, state = racialState(actor)) {
  return actor.items.contents.filter(racialPropertyRule).map(item => {
    const rule = racialPropertyRule(item);
    const choice = selectedRacialChoiceForItem(item,actor);
    return {id: item.id, name: item.name, choice: choice?.label ?? "",
      innate: state.innate.has(racialContentId(item)), configurable: racialChoicesForItem(item,actor).length > 0};
  });
}

export async function racialCatalog() {
  const pack = game.packs.get(`${RACIAL_SYSTEM_ID}.abilities`);
  if (!pack) throw Error(label("unavailable"));
  const cards = (await pack.getDocuments()).filter(racialPropertyRule);
  return cards.sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
}

export async function openRacialPropertyEditor(actor, {add, remove}) {
  let cards = [];
  try {
    cards = await racialCatalog();
  } catch (error) {
    console.warn("Fast NRI | racial property catalog unavailable", error);
    ui.notifications?.warn(label("unavailable"));
  }
  const {DialogV2} = foundry.applications.api;
  const content = `<div data-racial-picker>
    <input type="search" data-racial-search placeholder="${esc(label("search"))}" aria-label="${esc(label("search"))}">
    <label><input type="checkbox" data-racial-show-all>${esc(label("showAll"))}</label>
    <div class="fnri-racial-count"><span data-racial-count></span>
      <small class="fnri-racial-warning" data-racial-status role="status"></small></div>
    <div class="fnri-racial-options" data-racial-options></div>
    <p class="fnri-racial-empty" data-racial-empty hidden>${esc(label("noneToAdd"))}</p>
  </div>`;
  const subscriptions=[];
  try { return await DialogV2.wait({
    window: {title: label("additional")}, position: {width: 440}, content, rejectClose: false,
    buttons: [{action: "closePicker", label: label("cancel")}],
    render: (_event, dialog) => {
      const root = dialog.element.querySelector("[data-racial-picker]");
      if (!root || root.dataset.bound) return;
      root.dataset.bound = "true";
      const search = root.querySelector("[data-racial-search]");
      const showAll = root.querySelector("[data-racial-show-all]");
      showAll.checked = (pendingFilter?.user === game.user
        ? pendingFilter?.checked : game.user?.getFlag?.(RACIAL_SYSTEM_ID, "racialShowAll")) === true;
      const count = root.querySelector("[data-racial-count]");
      const status = root.querySelector("[data-racial-status]");
      const list = root.querySelector("[data-racial-options]");
      const empty = root.querySelector("[data-racial-empty]");
      let visible = [];
      let mutating = false;

      function refresh(focusKey) {
        const state = racialState(actor);
        const permissions = racialPermissions();
        const query = normalizeSearch(search.value);
        const owned = actor.items.contents.filter(racialPropertyRule);
        const keyOf = item => racialContentId(item) || item.id;
        const keys = new Set(owned.map(keyOf));
        const sources = [
          ...owned.map(item => ({item, ownedItem: true})),
          ...cards.filter(card => !keys.has(keyOf(card))).map(item => ({item, ownedItem: false}))
        ].sort((a, b) => a.item.name.localeCompare(b.item.name, game.i18n.lang));
        visible = sources.flatMap(({item, ownedItem}) => {
          const warnings = ownedItem ? [] : racialAddWarnings(actor, item, state);
          if ((!ownedItem && !showAll.checked && warnings.includes("wrongRace")) ||
              !normalizeSearch(item.name).includes(query)) return [];
          const choice = ownedItem ? selectedRacialChoiceForItem(item,actor) : null;
          const blocked = ownedItem ? racialRemoveBlock(actor,item,permissions) : racialAddBlock(actor,item,permissions);
          return [{item, ownedItem, blocked, choice, key: keyOf(item)}];
        });
        const message = racialChoiceStatus(state);
        count.textContent = `${label("selectedCount")} ${state.used} / ${state.max ?? "—"}`;
        status.textContent = message;
        status.hidden = !message;
        const expanded = new Set([...list.querySelectorAll("details[open]")].map(node => node.dataset.card));
        const scroll = list.scrollTop;
        list.innerHTML = visible.map(({item, ownedItem, blocked, choice, key}, index) => {
          const description = item.system.description || item.system.effect || item.system.notes;
          const name = choice ? `${item.name} · ${choice.label}` : item.name;
          return `<div class="fnri-racial-option">
            <button type="button" class="fnri-racial-pick" data-racial-index="${index}" aria-pressed="${ownedItem}"${blocked ? ' disabled' : ''}>
              <span class="fnri-racial-mark" aria-hidden="true">${ownedItem ? "✓" : "+"}</span><span>${esc(name)}</span>
            </button>
            ${description ? `<details class="fnri-racial-info" data-card="${esc(key)}"${expanded.has(key) ? " open" : ""}>
              <summary aria-label="${esc(label("description"))}" title="${esc(label("description"))}">?</summary>
              <div class="fnri-racial-description">${esc(description)}</div></details>` : ""}
          </div>`;
        }).join("");
        empty.hidden = visible.length > 0;
        list.scrollTop = scroll;
        if (focusKey != null) {
          const index = visible.findIndex(row => row.key === focusKey);
          const next=list.querySelector(`[data-racial-index="${index}"]`);
          (next && !next.disabled ? next : search).focus({preventScroll: true});
        }
      }

      showAll.addEventListener("change", () => {
        refresh();
        rememberFilter(showAll.checked);
      });
      search.addEventListener("input", () => refresh());
      search.addEventListener("keydown", event => {
        if (event.key === "Enter") event.preventDefault();
      });
      list.addEventListener("click", async event => {
        const button = event.target.closest("[data-racial-index]");
        const row = button && visible[button.dataset.racialIndex];
        if (!row || mutating || button.disabled) return;
        const blocked = row.ownedItem ? racialRemoveBlock(actor,row.item) : racialAddBlock(actor,row.item);
        if (blocked) { refresh(row.key); return; }
        mutating = true;
        list.setAttribute("aria-busy", "true");
        try {
          if (row.ownedItem) await remove(row.item.id);
          else await add(row.item);
        } catch (error) {
          console.warn("Fast NRI | racial property edit failed", error);
          ui.notifications?.warn(label("unavailable"));
        } finally {
          mutating = false;
          list.removeAttribute("aria-busy");
          if (root.isConnected) refresh(row.key);
        }
      });
      refresh();
      search.focus();
      const sameActor=doc=>doc===actor||Boolean(doc?.uuid&&doc.uuid===actor.uuid);
      const onChange=doc=>{
        if (!mutating&&root.isConnected&&(sameActor(doc)||sameActor(doc?.parent))) refresh();
      };
      const onSettings=setting=>{
        if (!mutating&&root.isConnected&&String(setting?.key??'').startsWith(RACIAL_SYSTEM_ID+'.racial')) refresh();
      };
      for(const [event,callback] of [['updateActor',onChange],['createItem',onChange],['updateItem',onChange],['deleteItem',onChange],['updateSetting',onSettings]]){
        const id=globalThis.Hooks?.on?.(event,callback);
        if(id!==undefined)subscriptions.push([event,id]);
      }
    }
  }); } finally {
    for(const [event,id] of subscriptions) globalThis.Hooks?.off?.(event,id);
  }
}

export async function chooseRacialSubproperty(item, actor = item?.parent) {
  const rule = racialPropertyRule(item);
  const choices = racialChoicesForItem(item,actor);
  if (!choices.length) return null;
  const {DialogV2} = foundry.applications.api;
  const content = `<div class="fnri-racial-options" data-racial-subproperties>${choices.map(choice =>
    `<button type="button" class="fnri-racial-pick" data-racial-id="${esc(choice.id)}"
      aria-pressed="${choice.id === rule.selection}">${esc(choice.label)}</button>`).join("")}</div>`;
  let selection = null;
  await DialogV2.wait({
    window: {title: item.name}, position: {width: 400}, content, rejectClose: false,
    buttons: [{action: "cancel", label: label("cancel")}],
    render: (_event, dialog) => {
      const choicesList = dialog.element.querySelector("[data-racial-subproperties]");
      if (!choicesList || choicesList.dataset.bound) return;
      choicesList.dataset.bound = "true";
      choicesList.addEventListener("click", event => {
        const button = event.target.closest("[data-racial-id]");
        if (!button || selection !== null) return;
        selection = button.dataset.racialId;
        void dialog.close();
      });
    }
  });
  return selection;
}

export async function addRacialProperty(actor, card, selection, {automatic = false} = {}) {
  const existing = sameProperty(actor, card);
  if (racialPropertyRule(existing)) return existing;
  if (racialAddBlock(actor,card)) return null;
  const rule = foundry.utils.deepClone(racialPropertyRule(card));
  if (selection && racialChoicesForItem(card,actor).some(choice=>choice.id===selection)) rule.selection = selection;
  if (existing) {
    // Keep an existing manually acquired card and its UUID.
    await existing.update({"system.mechanics.racialProperty": rule}, {fnriPicker: true});
    return existing;
  }
  const data = card.toObject();
  delete data.folder;
  delete data._stats;
  data.system.mechanics.racialProperty = rule;
  if (automatic) data.flags[RACIAL_SYSTEM_ID].automaticRacialProperty = true;
  if (actor.items.has(data._id)) delete data._id;
  try {
    const [item] = await actor.createEmbeddedDocuments("Item", [data], {keepId: Boolean(data._id), fnriPicker: true});
    return item;
  } catch (error) {
    const concurrent = sameProperty(actor, card);
    if (!racialPropertyRule(concurrent)) throw error;
    return concurrent;
  }
}
