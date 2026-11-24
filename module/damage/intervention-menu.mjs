import {buttonChoiceMarkup,renderButtonChoices} from '../rolls/button-choice.mjs';
import {interventionWarnings} from '../data/intervention-availability.mjs';

const SYSTEM_ID = 'fast-nri-v14';
const FLAG = 'showAllInterventions';
const local = key => game.i18n.localize(`FASTNRI.InterventionOptions.${key}`);
let pendingChoice;
let saveQueue = Promise.resolve();

export function showAllInterventions() {
  return pendingChoice?.checked ?? (game.user.getFlag(SYSTEM_ID, FLAG) === true);
}

function rememberShowAll(checked) {
  const choice = {checked};
  pendingChoice = choice;
  const user = game.user;
  saveQueue = saveQueue.then(async () => {
    await user.setFlag(SYSTEM_ID, FLAG, checked);
    if (pendingChoice === choice) pendingChoice = undefined;
  })
    .catch(error => console.warn('Fast NRI | could not remember intervention menu preference', error));
}

const optionKey = option => option.key ?? option.id;
const optionName = option => option.label ?? option.name;

export async function chooseIntervention({actor, choices, title, confirmLabel}) {
  let showAll = showAllInterventions();
  let displayed = [];
  const answer = await foundry.applications.api.DialogV2.input({
    window: {title},
    content: `<label><input type="checkbox" data-fnri-intervention-show-all><span data-fnri-show-all-label></span></label>
      <p data-fnri-option-label></p>${buttonChoiceMarkup(title)}`,
    ok: {label: confirmLabel}, rejectClose: false,
    render(_event, dialog) {
      const element = dialog.element;
      const input = element.querySelector('input[name="choice"]');
      const toggle = element.querySelector('[data-fnri-intervention-show-all]');
      element.querySelector('[data-fnri-option-label]').textContent = local('method');
      element.querySelector('[data-fnri-show-all-label]').textContent = local('showAll');
      toggle.checked = showAll;
      function updateOptions() {
        displayed = choices(showAll);
        const options = displayed.map(option => {
          const warnings = option.standalone ? [] : interventionWarnings(actor, option.item, option.accounting ?? option.rule?.accounting);
          const name = optionName(option);
          return {label: warnings.length ? `${name} · ⚠ ${warnings.join(', ')}` : name, value: optionKey(option)};
        });
        renderButtonChoices(element, options, input.value);
        if (!options.length) {
          const list = element.querySelector('[data-fnri-button-choices]');
          const empty = list.ownerDocument.createElement('p');
          empty.textContent = local('none');
          list.replaceChildren(empty);
        }
      }
      updateOptions();
      toggle.onchange = () => {
        showAll = toggle.checked;
        rememberShowAll(showAll);
        updateOptions();
      };
    }
  });
  if (!answer?.choice) return null;
  const selected = displayed.find(option => optionKey(option) === answer.choice);
  return selected ? choices(showAll).find(option =>
    optionKey(option) === answer.choice && optionName(option) === optionName(selected)) ?? null : null;
}
