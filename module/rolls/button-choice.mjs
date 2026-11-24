/** Shared presentation for choice dialogs; no rules or permissions here. */
const esc = value => String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
export const buttonChoiceMarkup = label => `<div class="fnri-button-choices" data-fnri-button-choices role="group" aria-label="${esc(label)}"></div><input type="hidden" name="choice" value="">`;

export function renderButtonChoices(element, rows, preferred = '') {
  const list = element.querySelector('[data-fnri-button-choices]');
  const input = element.querySelector('input[name="choice"]');
  const selected = rows.some(row => String(row.value) === String(preferred)) ? String(preferred) : String(rows[0]?.value ?? '');
  input.value = selected;
  const buttons = rows.map(row => {
    const button = list.ownerDocument.createElement('button');
    button.type = 'button';
    button.value = String(row.value);
    button.textContent = row.label;
    button.setAttribute('aria-pressed', String(button.value === selected));
    button.onclick = () => {
      input.value = button.value;
      for (const candidate of buttons) candidate.setAttribute('aria-pressed', String(candidate === button));
    };
    return button;
  });
  list.replaceChildren(...buttons);
  return input;
}

export async function chooseByButtons({title, rows, confirmLabel, intro = ''}) {
  if (!rows.length) return null;
  const result = await foundry.applications.api.DialogV2.input({
    window: {title}, content: (intro ? `<p>${esc(intro)}</p>` : '') + buttonChoiceMarkup(title),
    ok: {label: confirmLabel}, rejectClose: false,
    render(_event, dialog) { renderButtonChoices(dialog.element, rows); }
  });
  return rows.find(row => String(row.value) === result?.choice) ?? null;
}
