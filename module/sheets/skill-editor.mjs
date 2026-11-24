import { BASIC_SKILLS, SKILL_GROUPS } from '../data/skills-catalog.mjs';
import { resolveSkillAllocation } from '../data/skill-allocation.mjs';
import { classDefinition } from '../data/classes.mjs';

const loc = key => game.i18n.localize('FASTNRI.' + key);
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

function diceButtons(id, dice, formula, free) {
  return `<div class="fnri-skill-edit-dice">${dice.map(die => {
    const label = die.replace(/^1d/, 'd');
    const manual = free && !free.has(Number(die.slice(2))) && die !== formula;
    return button('die', label, `data-id="${esc(id)}" data-die="${die}" aria-pressed="${formula === die}"` +
      (manual ? ` class="fnri-skill-manual-die" title="${esc(loc('SkillAllocation.manualDie'))}"` : ''));
  }).join('')}</div>`;
}

export function skillUpgradeCandidates(allocation, upgrade) {
  return allocation.dice.filter(die =>
    die.size === upgrade.size && !allocation.upgrades.some(other => other.id !== upgrade.id && other.target === die.id));
}

function upgradeOptions(allocation, upgrade) {
  const next = faces[faces.indexOf(upgrade.size) + 1];
  const direction = `d${upgrade.size} → d${next}`;
  const options = skillUpgradeCandidates(allocation, upgrade);
  return `<label class="fnri-skill-upgrade"><span>${esc(upgrade.source)} · <strong>${direction}</strong></span>
    <select data-skill-upgrade="${esc(upgrade.id)}">
      <option value="">${esc(loc('SkillAllocation.unassignedUpgrade'))}</option>
      ${options.map((die, index) => {
        const label = die.skill ? skillName(die.skill) : `${loc('SkillAllocation.freeDie')} ${index + 1}`;
        return `<option value="${esc(die.id)}"${die.id === upgrade.target ? ' selected' : ''}>${esc(label)} · ${esc(die.source)}</option>`;
      }).join('')}
    </select></label>`;
}

export function skillEditorMarkup(actor) {
  const raw = rawSystem(actor);
  const allocation = resolveSkillAllocation(raw, actor.items?.contents ?? []);
  const rule = classDefinition(raw);
  const freeCounts = new Map(faces.map(face => [face, allocation.free.filter(die => die.face === face).length])
    .filter(([, count]) => count));
  const pool = [...freeCounts].map(([face, count]) => `<span>d${face} × ${count}</span>`).join(' ');
  const warnings = allocation.warnings.map(({code, skill, expected, actual}) => {
    const text = [loc('SkillAllocation.' + code), skill && skillName(skill),
      expected !== undefined && `(${expected || '—'} → ${actual || '—'})`].filter(Boolean).join(' ');
    return `<small class="fnri-racial-warning">${esc(text)}</small>`;
  }).join('');
  const sources = allocation.dice.map(die =>
    `<li>${esc(die.source)} · d${die.face} → ${esc(die.skill ? skillName(die.skill) : loc('SkillAllocation.freeDie'))}</li>`).join('');
  const dice = faces.map(face => '1d' + face);
  const groups = SKILL_GROUPS.map(group => `<section class="fnri-skill-edit-group">
    <h3>${esc(loc('SkillGroups.' + group))}</h3>
    ${BASIC_SKILLS.filter(skill => skill.group === group).map(({id: skill, name}) => {
      const id = 'core_' + skill;
      const stored = raw.skills?.[id];
      const assigned = allocation.rows[skill];
      const formula = allocation.active ? assigned.formula : actor.system.skills?.[id]?.dice ?? stored?.dice ?? '';
      const die = allocation.dice.find(die => die.id === assigned.die);
      const manual = assigned.override !== null && formula !== assigned.expected;
      const subtitle = manual ? `${loc('CharacterEditor.custom')} · ${formula || '—'}` : die?.source;
      return `<div class="fnri-skill-edit-row">
        <div><strong>${esc(name)}</strong>${subtitle ? `<small>${esc(subtitle)}</small>` : ''}</div>
        ${diceButtons(id, dice, formula, allocation.active ? freeCounts : null)}
        ${input(id, 'modifier', stored?.modifier, `${name} · ${loc('Fields.checkModifier')}`)}
        <div class="fnri-skill-edit-formula">${input(id, 'dice', formula, `${name} · ${loc('CharacterEditor.custom')}`)}</div>
      </div>`;
    }).join('')}</section>`).join('');
  const custom = Object.entries(raw.skills ?? {}).filter(([id]) => !BASIC_SKILLS.some(skill => 'core_' + skill.id === id))
    .map(([id, skill]) => `<div class="fnri-skill-edit-custom">
      ${input(id, 'name', skill.name, loc('Fields.name'))}
      <select ${field(id, 'kind')} aria-label="${esc(loc('Fields.checkKind'))}">
        <option value="skill"${skill.kind !== 'specialization' ? ' selected' : ''}>${esc(loc('Fields.skill'))}</option>
        <option value="specialization"${skill.kind === 'specialization' ? ' selected' : ''}>${esc(loc('Fields.specialization'))}</option>
      </select>
      ${diceButtons(id, skill.kind === 'specialization' ? ['2d6', '2d4'] : dice, skill.dice)}
      ${input(id, 'dice', skill.dice, loc('Fields.dice'))}
      ${input(id, 'modifier', skill.modifier, loc('Fields.checkModifier'))}
      ${button('remove', '×', `data-id="${esc(id)}" aria-label="${esc(loc('Actions.removeSkill'))}"`)}
    </div>`).join('');
  return `<div class="fnri-skill-edit-toolbar"><strong>${esc(loc('SkillAllocation.free'))}</strong>
    <div class="fnri-skill-edit-pool">${pool || '—'}</div>${button('reset',loc('SkillAllocation.reset'))}</div>
    ${rule?.traditions ? `<div class="fnri-skill-edit-option">${esc(loc('SkillAllocation.traditionLabel'))}
      ${button('tradition', skillName(raw.classTradition) || loc('CharacterChoice.choose'))}</div>` : ''}
    ${allocation.upgrades.length ? `<div class="fnri-skill-upgrades">${allocation.upgrades.map(upgrade => upgradeOptions(allocation, upgrade)).join('')}</div>` : ''}
    ${warnings ? `<details data-skill-disclosure="warnings"><summary>${esc(loc('SkillAllocation.warnings'))} (${allocation.warnings.length})</summary>${warnings}</details>` : ''}
    <label class="fnri-skill-edit-toggle"><input type="checkbox" data-skill-manual>${esc(loc('CharacterEditor.manualFormulas'))}</label>
    ${groups}
    <details data-skill-disclosure="sources"><summary>${esc(loc('CharacterEditor.sources'))}</summary><ul>${sources}</ul></details>
    <h3>${esc(loc('Sections.customChecks'))}</h3>${custom}
    <div class="fnri-skill-edit-option">${button('addSkill',loc('Actions.addSkill'))}${button('addSpecialization',loc('Actions.addSpecialization'))}</div>`;
}

/** Separate Foundry window with live writes to the existing Actor. */
export async function openSkillEditor(sheet, actions) {
  const { DialogV2 } = foundry.applications.api;
  let pending = Promise.resolve();
  await DialogV2.wait({
    window: {title: loc('CharacterEditor.skills')}, position: {width: 560},
    content: `<div class="fnri-skill-editor" data-skill-editor>${skillEditorMarkup(sheet.actor)}</div>`,
    rejectClose: false, buttons: [{action: 'done', label: loc('CharacterEditor.done')}],
    render: (_event, dialog) => {
      const root = dialog.element.querySelector('[data-skill-editor]');
      if (!root || root.dataset.bound) return;
      root.dataset.bound = 'true';

      function refresh() {
        if (!root.isConnected) return;
        const focused = document.activeElement;
        const controls = () => [...root.querySelectorAll('[data-row-field],[data-skill-action],[data-skill-upgrade],[data-skill-manual]')];
        const key = element => JSON.stringify(element.dataset);
        const focusKey = root.contains(focused) ? key(focused) : null;
        const expanded = [...root.querySelectorAll('details[open]')].map(detail => detail.dataset.skillDisclosure);
        const scroll = root.scrollTop;
        root.innerHTML = skillEditorMarkup(sheet.actor);
        root.querySelector('[data-skill-manual]').checked = root.classList.contains('fnri-skill-show-formulas');
        for (const detail of root.querySelectorAll('details')) detail.open = expanded.includes(detail.dataset.skillDisclosure);
        if (focusKey) controls().find(element => key(element) === focusKey)?.focus({preventScroll: true});
        root.scrollTop = scroll;
      }

      function run(operation, redraw = true) {
        pending = pending.then(async () => {
          if (!sheet.isEditable) return;
          await operation();
          await sheet._flushWrites();
          if (redraw) refresh();
        }).catch(error => {
          console.warn('Fast NRI | skill editor', error);
          ui.notifications?.warn(loc('Hints.saveFailed'));
          refresh();
        });
      }

      root.addEventListener('change', event => {
        const target = event.target;
        if (target.matches('[data-skill-manual]')) {
          root.classList.toggle('fnri-skill-show-formulas', target.checked);
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
        if (!pressed) return;
        event.preventDefault();
        const {skillAction, id, die} = pressed.dataset;
        const commands = {
          die: () => {
            const raw = rawSystem(sheet.actor);
            const allocation = resolveSkillAllocation(raw, sheet.actor.items?.contents ?? []);
            const current = allocation.active && id.startsWith('core_')
              ? allocation.rows[id.slice(5)]?.formula : raw.skills?.[id]?.dice;
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
  });
  await pending;
  await sheet._flushWrites();
}
