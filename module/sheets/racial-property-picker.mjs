import {
  RACIAL_SYSTEM_ID, racialLabel as label, racialContentId, racialPropertyRule,
  racialPropertyChoices, selectedRacialPropertyChoice, racialState, racialAddWarnings
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

export function racialPropertyRows(actor) {
  return actor.items.contents.filter(racialPropertyRule).map(item => {
    const rule = racialPropertyRule(item);
    const choice = selectedRacialPropertyChoice(rule);
    return {id: item.id, name: item.name, choice: choice?.label ?? "", configurable: racialPropertyChoices(rule).length > 0};
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
    <p data-racial-count></p>
    <p class="fnri-racial-warning" data-racial-over hidden>${esc(label("limitExceeded"))}</p>
    <div class="fnri-racial-options" data-racial-options></div>
    <p class="fnri-racial-empty" data-racial-empty hidden>${esc(label("noneToAdd"))}</p>
    <section data-racial-owned>
      <h3>${esc(label("owned"))}</h3>
      <ul class="fnri-racial-owned-list"></ul>
    </section>
    <button type="button" data-racial-add disabled>${esc(label("addConfirm"))}</button>
  </div>`;
  return DialogV2.wait({
    window: {title: label("title")}, content, rejectClose: false,
    buttons: [{action: "closePicker", label: label("cancel")}],
    render: (_event, dialog) => {
      const root = dialog.element.querySelector("[data-racial-picker]");
      if (!root || root.dataset.bound) return;
      root.dataset.bound = "true";
      const search = root.querySelector("[data-racial-search]");
      const showAll = root.querySelector("[data-racial-show-all]");
      showAll.checked = (pendingFilter && pendingFilter.user===game.user ? pendingFilter.checked : game.user?.getFlag?.(RACIAL_SYSTEM_ID,"racialShowAll")) === true;
      const count = root.querySelector("[data-racial-count]");
      const over = root.querySelector("[data-racial-over]");
      const owned = root.querySelector("[data-racial-owned]");
      const ownedList = owned.querySelector("ul");
      const list = root.querySelector("[data-racial-options]");
      const empty = root.querySelector("[data-racial-empty]");
      const addButton = root.querySelector("[data-racial-add]");
      dialog.element.querySelector('button[data-action="closePicker"]')?.before(addButton);
      let selected = null;
      let mutating = false;

      const refreshOwned = state => {
        const rows = racialPropertyRows(actor);
        const removeLabel = esc(label("remove"));
        owned.hidden = rows.length === 0;
        ownedList.innerHTML = rows.map(row => {
          const name = row.choice ? `${row.name} · ${row.choice}` : row.name;
          return `<li>
            <span>${esc(name)}</span>
            <button type="button" data-racial-remove="${esc(row.id)}"
              title="${removeLabel}" aria-label="${removeLabel}: ${esc(row.name)}">
              <i class="fa-solid fa-trash" aria-hidden="true"></i></button>
          </li>`;
        }).join("");
      };

      const refreshAvailable = (state = racialState(actor)) => {
        const query = normalizeSearch(search.value);
        count.textContent = `${label("selectedCount")}: ${state.used} / ${state.max ?? "—"}`;
        over.hidden = state.max === null || state.used <= state.max;
        const available = cards.filter(card => {
          const warnings = racialAddWarnings(actor, card, state);
          return !warnings.includes("duplicate") && (showAll.checked || !warnings.includes("wrongRace")) &&
            normalizeSearch(card.name).includes(query);
        });
        if (!available.some(card => card.id === selected)) selected = null;
        const expanded = new Set([...list.querySelectorAll("details[open]")].map(node => node.dataset.card));
        const scroll = list.scrollTop;
        list.innerHTML = available.map(card => {
          const description = card.system.description || card.system.effect || card.system.notes;
          return `<div class="fnri-racial-option">
            <button type="button" class="fnri-racial-pick" data-racial-id="${esc(card.id)}"
              aria-pressed="${card.id === selected}">${esc(card.name)}</button>
            ${racialAddWarnings(actor, card, state).map(warning => `<small class="fnri-racial-warning">⚠ ${esc(label(warning))}</small>`).join("")}
            ${description ? `<details class="fnri-racial-info" data-card="${esc(card.id)}"${expanded.has(card.id) ? " open" : ""}>
              <summary aria-label="${esc(label("description"))}" title="${esc(label("description"))}">?</summary>
              <div class="fnri-racial-description">${esc(description)}</div></details>` : ""}
          </div>`;
        }).join("");
        list.scrollTop = scroll;
        empty.hidden = available.length > 0;
        addButton.disabled = selected === null || mutating;
      };

      const applyChange = async operation => {
        if (mutating) return;
        mutating = true;
        addButton.disabled = true;
        try {
          await operation();
        } catch (error) {
          console.warn("Fast NRI | racial property edit failed", error);
          ui.notifications?.warn(label("unavailable"));
        } finally {
          mutating = false;
          if (search.isConnected) {
            const state = racialState(actor);
            refreshOwned(state);
            refreshAvailable(state);
            search.focus();
          }
        }
      };

      showAll.addEventListener("change", () => {
        refreshAvailable();
        rememberFilter(showAll.checked);
      });
      search.addEventListener("input", () => refreshAvailable());
      search.addEventListener("keydown", event => {
        if (event.key === "Enter") event.preventDefault();
      });
      list.addEventListener("click", event => {
        const button = event.target.closest("[data-racial-id]");
        if (!button || mutating) return;
        selected = button.dataset.racialId;
        for (const row of list.querySelectorAll("[data-racial-id]")) {
          row.setAttribute("aria-pressed", String(row === button));
        }
        addButton.disabled = false;
      });
      addButton.addEventListener("click", () => {
        const card = cards.find(entry => entry.id === selected);
        if (!card || mutating) return;
        selected = null;
        void applyChange(() => add(card));
      });
      ownedList.addEventListener("click", event => {
        const button = event.target.closest("[data-racial-remove]");
        if (button) void applyChange(() => remove(button.dataset.racialRemove));
      });
      const state = racialState(actor);
      refreshOwned(state);
      refreshAvailable(state);
      search.focus();
    }
  });
}

export async function chooseRacialSubproperty(item) {
  const rule = racialPropertyRule(item);
  const choices = racialPropertyChoices(rule);
  if (!choices.length) return null;
  const {DialogV2} = foundry.applications.api;
  const content = `<div class="fnri-racial-options" data-racial-subproperties>${choices.map(choice =>
    `<button type="button" class="fnri-racial-pick" data-racial-id="${esc(choice.id)}"
      aria-pressed="${choice.id === rule.selection}">${esc(choice.label)}</button>`).join("")}</div>`;
  let selection = null;
  await DialogV2.wait({
    window: {title: item.name}, content, rejectClose: false,
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
  const rule = foundry.utils.deepClone(racialPropertyRule(card));
  if (selection) rule.selection = selection;
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
