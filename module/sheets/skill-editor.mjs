import {skillAllocationDisplay,summaryOpenAfterRefresh} from './skill-allocation-display.mjs';
import {applySheetLock} from './sheet-lock.mjs';
import { BASIC_SKILLS, BASIC_SKILLS_BY_ROW_ID, SKILL_GROUPS } from '../data/skills-catalog.mjs';
import { canMoveSkillDie, resolveSkillAllocation } from '../data/skill-allocation.mjs';
import { classDefinition } from '../data/classes.mjs';

const loc = key => game.i18n.localize('FASTNRI.' + key);
const skillText = key => loc('SkillAllocation.' + key);
const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const skillName = id => BASIC_SKILLS.find(skill => skill.id === id)?.name ?? id;
const faces = [4, 6, 8, 10, 12];
const rawSystem = actor => actor.toObject?.(true)?.system ?? actor.system;
const button = (action, label, attrs = '') =>
  `<button type="button" data-skill-action="${action}" ${attrs}>${esc(label)}</button>`;
const field = (id, key) =>
  `data-row-collection="skills" data-row-id="${esc(id)}" data-row-field="${key}"`;
const input = (id, key, value, label) =>
  `<input type="text" ${field(id, key)} value="${esc(value)}" aria-label="${esc(label)}"${key === 'modifier' ? ' inputmode="decimal" placeholder="±0"' : ''}>`;
const option = (value, label) => `<option value="${esc(value)}">${esc(label)}</option>`;
const poolOption = die => `assign:${die.id}:${die.skill ?? ''}`;

function customDiceButtons(id, dice, formula) {
  return `<div class="fnri-skill-edit-dice">${dice.map(die => button('die', die.replace(/^1d/, 'd'),
    `data-id="${esc(id)}" data-die="${die}" aria-pressed="${formula === die}"`)).join('')}</div>`;
}

export function skillUpgradeCandidates(allocation, upgrade) {
  return allocation.dice.filter(die =>
    die.size === upgrade.size && !allocation.upgrades.some(other => other.id !== upgrade.id && other.target === die.id));
}

function upgradeOptions(allocation, upgrade) {
  const next = faces[faces.indexOf(upgrade.size) + 1];
  const direction = `d${upgrade.size} → d${next}`;
  const options = skillUpgradeCandidates(allocation, upgrade).sort((a, b) => a.id.localeCompare(b.id));
  return `<label class="fnri-skill-upgrade"><span>${esc(upgrade.source)} · <strong>${direction}</strong></span>
    <select data-skill-upgrade="${esc(upgrade.id)}">
      ${option('', skillText('unassignedUpgrade'))}
      ${options.map((die, index) => {
        const label = die.skill ? skillName(die.skill) : `${skillText('freeDie')} ${index + 1}`;
        return `<option value="${esc(die.id)}"${die.id === upgrade.target ? ' selected' : ''}>${esc(label)} · ${esc(die.source)}</option>`;
      }).join('')}
    </select></label>`;
}

function skillDieLabel(die, skill) {
  const pieces = [`d${die.face}`, die.source];
  if (die.face !== die.size) pieces.push(`d${die.size} → d${die.face}`);
  if (die.allowed && !die.allowed.includes(skill)) pieces.push(skillText('outsideSkillList'));
  return pieces.join(' · ');
}

function poolChoices(allocation, skill) {
  // Equal free dice from the same source share one menu entry. Each actual
  // choice still names its die ID, including upgraded or restricted dice.
  const groups = new Map();
  for (const die of allocation.free.filter(canMoveSkillDie)) {
    const key = JSON.stringify([die.face, die.size, die.source, die.preferred, die.allowed]);
    const existing = groups.get(key);
    if (existing) existing.count++;
    else groups.set(key, {die, count: 1});
  }
  const free = [...groups.values()].map(({die, count}) =>
    option(poolOption(die), skillDieLabel(die, skill) + (count > 1 ? ` × ${count}` : '')));
  const transfer = allocation.dice.filter(die => die.skill && die.skill !== skill && canMoveSkillDie(die))
    .map(die => option(poolOption(die), `d${die.face} · ${skillName(die.skill)} → ${skillText('move')}` +
      (die.face !== die.size ? ` · d${die.size} → d${die.face}` : '') +
      (die.allowed && !die.allowed.includes(skill) ? ` · ${skillText('outsideSkillList')}` : '')));
  return [
    free.length && `<optgroup label="${esc(skillText('free'))}">${free.join('')}</optgroup>`,
    transfer.length && `<optgroup label="${esc(skillText('transfer'))}">${transfer.join('')}</optgroup>`
  ].filter(Boolean).join('');
}

function skillRow(skill, allocation, raw, openFormula) {
  const id = 'core_' + skill.id;
  const row = allocation.rows[skill.id];
  const die = allocation.dice.find(die => die.id === row.die);
  const formula = row.formula.replace(/^1(d\d+)$/, '$1') || '—';
  const manual = row.override !== null;
  const label = manual ? `${formula} · ${skillText('manualLabel')}` : formula;
  const source = [
    die?.locked && loc('Fields.className'),
    die?.source,
    die && die.face !== die.size && `d${die.size} → d${die.face}`
  ].filter(Boolean).join(' · ');
  const sourceLabel = manual && die ? `d${die.face} · ${source}` : source;
  const editableAssignment = !die || canMoveSkillDie(die);
  return `<div class="fnri-skill-edit-row">
    <div><strong>${esc(skill.name)}</strong>${sourceLabel ? `<small>${esc(sourceLabel)}</small>` : ''}</div>
    <select data-skill-die="${skill.id}" aria-label="${esc(skill.name + ' · ' + loc('Fields.dice'))}" title="${esc(label)}">
      <option value="" data-assigned-die="${esc(row.die)}">${esc(label)}</option>
      ${editableAssignment ? poolChoices(allocation, skill.id) : ''}
      ${canMoveSkillDie(die) ? option('release', skillText('release')) : ''}
      ${option('manual', loc('CharacterEditor.custom') + '…')}
      ${manual ? option('use-assigned', skillText('useAssigned')) : ''}
    </select>
    ${input(id, 'modifier', raw.skills?.[id]?.modifier, `${skill.name} · ${loc('Fields.checkModifier')}`)}
    ${openFormula === skill.id ? `<label class="fnri-skill-edit-formula">
      <span>${esc(loc('CharacterEditor.custom'))}</span>
      <input type="text" data-skill-formula="${skill.id}" value="${esc(row.formula)}">
    </label>` : ''}
  </div>`;
}

function customRows(raw, kind) {
  return Object.entries(raw.skills ?? {})
    .filter(([id, skill]) => !BASIC_SKILLS_BY_ROW_ID.has(id) &&
      (skill.kind === 'specialization') === (kind === 'specialization'))
    .map(([id, skill]) => `<div class="fnri-skill-edit-custom">
      ${input(id, 'name', skill.name, loc('Fields.name'))}
      <select ${field(id, 'kind')} aria-label="${esc(loc('Fields.checkKind'))}">
        <option value="skill"${kind === 'skill' ? ' selected' : ''}>${esc(loc('Fields.skill'))}</option>
        <option value="specialization"${kind === 'specialization' ? ' selected' : ''}>${esc(loc('Fields.specialization'))}</option>
      </select>
      ${customDiceButtons(id, faces.map(face => '1d' + face), skill.dice)}
      ${input(id, 'dice', skill.dice, loc('Fields.dice'))}
      ${input(id, 'modifier', skill.modifier, loc('Fields.checkModifier'))}
      ${button('remove', '×', `data-id="${esc(id)}" aria-label="${esc(loc('Actions.removeSkill'))}"`)}
    </div>`).join('');
}

export function skillEditorMarkup(actor, openFormula = null) {
  const raw = rawSystem(actor);
  const allocation = resolveSkillAllocation(raw, actor.items?.contents ?? []);
  const rule = classDefinition(raw);
  const {showPool,complete} = skillAllocationDisplay(allocation);
  const pool = [...faces].reverse().map(face => {
    const count = allocation.free.filter(die => die.face === face).length;
    return count ? `<span>d${face} × ${count}</span>` : '';
  }).join('');
  const warnings = allocation.warnings.map(({code, skill, expected, actual}) => {
    const text = [skillText(code), skill && skillName(skill),
      expected !== undefined && `(${expected || '—'} → ${actual || '—'})`].filter(Boolean).join(' ');
    return `<small class="fnri-racial-warning">${esc(text)}</small>`;
  }).join('');
  const sources = allocation.dice.map(die =>
    `<li>${esc(die.source)} · d${die.face} → ${esc(die.skill ? skillName(die.skill) : skillText('freeDie'))}</li>`).join('');
  const upgrades = allocation.upgrades.map(upgrade => {
    const die = allocation.dice.find(row => row.id === upgrade.target);
    const next = faces[faces.indexOf(upgrade.size) + 1];
    const destination = die ? (die.skill ? skillName(die.skill) : skillText('freeDie')) : skillText('unassignedUpgrade');
    return `<li>${esc(upgrade.source)} · d${upgrade.size} → d${next} · ${esc(destination)}</li>`;
  }).join('');
  const groups = SKILL_GROUPS.map(group => `<section class="fnri-skill-edit-group">
    <h3>${esc(loc('SkillGroups.' + group))}</h3>
    ${BASIC_SKILLS.filter(skill => skill.group === group).map(skill =>
      skillRow(skill, allocation, raw, openFormula)).join('')}</section>`).join('');

  return `<div class="fnri-skill-edit-toolbar">${showPool ? `<strong>${esc(skillText('free'))}</strong>
    <div class="fnri-skill-edit-pool" role="status">${pool}</div>` : ''}${button('reset',skillText('reset'))}</div>
    <div class="fnri-skill-edit-body">
      ${rule?.traditions ? `<div class="fnri-skill-edit-option">${esc(skillText('traditionLabel'))}
        ${button('tradition', skillName(raw.classTradition) || loc('CharacterChoice.choose'))}</div>` : ''}
      ${allocation.upgrades.length ? `<div class="fnri-skill-upgrades">${allocation.upgrades.map(upgrade => upgradeOptions(allocation, upgrade)).join('')}</div>` : ''}
      ${warnings ? `<details data-skill-disclosure="warnings"><summary>${esc(skillText('warnings'))} (${allocation.warnings.length})</summary>${warnings}</details>` : ''}
      <div class="fnri-skill-edit-head" aria-hidden="true"><span>${esc(loc('Fields.skill'))}</span><span>${esc(loc('Fields.dice'))}</span><span>${esc(skillText('modifierShort'))}</span></div>
      ${groups}
      <section class="fnri-skill-edit-custom-group" data-skill-custom="specialization">
        <h3>${esc(skillText('specializations'))}</h3>${customRows(raw, 'specialization')}
        ${button('addSpecialization',loc('Actions.addSpecialization'))}
      </section>
      <section class="fnri-skill-edit-custom-group" data-skill-custom="skill">
        <h3>${esc(skillText('customSkills'))}</h3>${customRows(raw, 'skill')}
        ${button('addSkill',loc('Actions.addSkill'))}
      </section>
      ${sources || upgrades ? `<details class="fnri-skill-distribution" data-skill-disclosure="sources" data-allocation-complete="${complete}"${complete ? '' : ' open'}>
        <summary>${esc(skillText('distributionSummary'))}</summary>
        ${sources ? `<h4>${esc(skillText('distributionDice'))}</h4><ul>${sources}</ul>` : ''}
        ${upgrades ? `<h4>${esc(skillText('distributionUpgrades'))}</h4><ul>${upgrades}</ul>` : ''}
      </details>` : ''}
    </div>`;
}

/** Separate Foundry window with live writes to the existing Actor. */
export async function openSkillEditor(sheet, actions) {
  const { DialogV2 } = foundry.applications.api;
  let pending = Promise.resolve();
  let openFormula = null;
  let latestInput = null;
  let syncLock;
  try { await DialogV2.wait({
    window: {title: loc('CharacterEditor.skills')}, position: {width: 560},
    content: `<div class="fnri-skill-editor" data-skill-editor>${skillEditorMarkup(sheet.actor)}</div>`,
    rejectClose: false, buttons: [{action: 'done', label: loc('CharacterEditor.done')}],
    render: (_event, dialog) => {
      const root = dialog.element.querySelector('[data-skill-editor]');
      if (!root || root.dataset.bound) return;
      root.dataset.bound = 'true';
      syncLock=()=>applySheetLock(root,!!sheet.configurationLocked || !sheet.isEditable);
      sheet._syncSkillEditorLock=syncLock;
      syncLock();

      function refresh() {
        if (!root.isConnected) return;
        const focused = document.activeElement;
        const fields = '[data-row-field],[data-skill-action],[data-skill-upgrade],[data-skill-die],[data-skill-formula]';
        const key = element => JSON.stringify(element.dataset);
        const focusKey = root.contains(focused) ? key(focused) : null;
        const expanded = [...root.querySelectorAll('details[open]')].map(detail => detail.dataset.skillDisclosure);
        const oldSummary = root.querySelector('[data-allocation-complete]');
        const prior = oldSummary ? {complete:oldSummary.dataset.allocationComplete==='true',open:oldSummary.open} : null;
        const scroll = root.querySelector('.fnri-skill-edit-body').scrollTop;
        root.innerHTML = skillEditorMarkup(sheet.actor, openFormula);
        syncLock();
        for (const detail of root.querySelectorAll('details')) {
          if (detail.hasAttribute('data-allocation-complete')) {
            if (prior) detail.open = summaryOpenAfterRefresh(prior.complete,prior.open,detail.dataset.allocationComplete==='true');
          } else detail.open = expanded.includes(detail.dataset.skillDisclosure);
        }
        const next = focusKey && [...root.querySelectorAll(fields)].find(element => key(element) === focusKey);
        // Keep a text draft if an earlier asynchronous edit refreshed the editor
        // while a different field was being typed.
        if (next && latestInput?.field === focused) {
          next.value = latestInput.value;
          latestInput.field = next;
        }
        next?.focus({preventScroll: true});
        root.querySelector('.fnri-skill-edit-body').scrollTop = scroll;
      }

      function run(operation, redraw = true) {
        pending = pending.then(async () => {
          if (!sheet.isEditable || sheet.configurationLocked) return;
          await operation();
          await sheet._flushWrites();
          if (redraw) refresh();
        }).catch(error => {
          console.warn('Fast NRI | skill editor', error);
          ui.notifications?.warn(loc('Hints.saveFailed'));
          refresh();
        });
      }

      root.addEventListener('input', event => {
        if (event.target.matches('input[type="text"]')) latestInput = {field: event.target, value: event.target.value};
      });
      root.addEventListener('change', event => {
        if (!sheet.isEditable || sheet.configurationLocked) return;
        const target = event.target;
        if (latestInput?.field === target) latestInput = null;
        if (target.matches('[data-skill-die]')) {
          const {skillDie} = target.dataset;
          const previous = target.options[0].dataset.assignedDie || null;
          const command = target.value;
          target.value = '';
          if (command === 'manual') {
            openFormula = openFormula === skillDie ? null : skillDie;
            refresh();
            if (openFormula) root.querySelector('[data-skill-formula]')?.focus();
          } else if (command === 'use-assigned') {
            if (openFormula === skillDie) openFormula = null;
            run(() => actions.manual(skillDie, null));
          } else if (command === 'release' || command.startsWith('assign:')) {
            const [, dieId, from] = command.split(':');
            run(() => actions.assign(skillDie, {dieId: dieId || null, from: from || null, previous}));
          }
        } else if (target.matches('[data-skill-formula]')) {
          const {skillFormula} = target.dataset;
          const value = target.value;
          run(() => actions.manual(skillFormula, value));
        } else if (target.matches('[data-skill-upgrade]')) {
          const {skillUpgrade} = target.dataset;
          const value = target.value;
          run(() => actions.upgrade(skillUpgrade, value || null));
        } else if (target.matches('[data-row-field]')) {
          event.stopPropagation();
          const control = target.cloneNode();
          control.value = target.value;
          run(() => actions.save(control), ['dice', 'kind', 'name'].includes(target.dataset.rowField));
        }
      });
      root.addEventListener('click', event => {
        const pressed = event.target.closest('[data-skill-action]');
        if (!pressed || !sheet.isEditable || sheet.configurationLocked) return;
        event.preventDefault();
        const {skillAction, id, die} = pressed.dataset;
        const commands = {
          die: () => {
            const current = rawSystem(sheet.actor).skills?.[id]?.dice;
            const control = document.createElement('input');
            Object.assign(control.dataset, {rowCollection: 'skills', rowId: id, rowField: 'dice'});
            control.value = current === die ? '' : die;
            return actions.save(control);
          },
          reset: actions.reset,
          tradition: actions.chooseTradition,
          remove: () => actions.remove(id),
          addSkill: () => actions.add('skill'),
          addSpecialization: () => actions.add('specialization')
        };
        if (Object.hasOwn(commands, skillAction)) run(commands[skillAction]);
      });
    }
  }); } finally {
    if (sheet._syncSkillEditorLock===syncLock) delete sheet._syncSkillEditorLock;
  }
  await pending;
  await sheet._flushWrites();
}
