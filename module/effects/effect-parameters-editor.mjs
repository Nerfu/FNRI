/**
 * Native Foundry VTT 14 ActiveEffect + independent per-change calculations.
 * A value field is read-only only when its own Auto checkbox is enabled and
 * its formula evaluates. An invalid formula leaves a manual path available.
 */
import {
  readEffectState, DURATION_UNITS, validateCoreDurationInput, validateEffectStateInput, retireZeroStrengthEffect
} from './effect-state.mjs';
import {
  readEffectChangeRows, evaluateEffectFormula, calculateEffectChangePlan, CALC_SCOPE, CALC_KEY
} from './effect-formulas.mjs';
import { mayManageEffect } from './effects-panel-core.mjs';

const t = key => game.i18n.localize(`FASTNRI.EffectPanel.${key}`);
const escapeHtml = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const val = value => value === null || value === undefined ? '' : String(value);
const ownerActor = effect => effect.parent?.documentName === 'Actor' ? effect.parent :
  effect.parent?.documentName === 'Item' ? effect.parent.parent : null;
const canEdit = (actor,effect) => mayManageEffect(actor,effect) ||
  (!actor && effect?.parent?.documentName === 'Item' && effect.parent.isOwner && !effect.parent.parent);
const deferred = (formula,actor) => !actor && String(formula ?? '').includes('@actor.system.');

function changeRowsHTML(effect, rows, state) {
  if (!rows.length) return `<p>${escapeHtml(t('NoChangeRows'))}</p>`;
  return rows.map((row, i) => {
    let preview = row.manualValue;
    let error = '';
    if (row.auto) {
      try { preview = deferred(row.formula,ownerActor(effect)) ? t('AfterApplication') :
        String(evaluateEffectFormula(row.formula,{state,actor:ownerActor(effect)})); }
      catch (err) { error = String(err.message); }
    }
    const locked = row.auto && !error;
    return `<div class="fnri-ep-change-row" data-fnri-calculation-row="${i}">`+
      `<div class="fnri-ep-change-heading"><strong>${escapeHtml(row.key || t('UnknownChange'))}</strong>`+
      `<span>${escapeHtml(row.type)}</span>${row.detached ? `<em>${escapeHtml(t('ReboundWarning'))}</em>` : ''}</div>`+
      `<label class="fnri-ep-auto"><input type="checkbox" data-fnri-auto name="auto_${i}" ${row.auto?'checked':''} ${!row.formula.trim()?'disabled':''}>`+
      `${escapeHtml(t('Auto'))}</label>`+
      `<label class="fnri-ep-field"><span>${escapeHtml(t('ChangeFormula'))}</span>`+
      `<input name="formula_${i}" data-fnri-formula type="text" maxlength="256" value="${escapeHtml(row.formula)}" placeholder="-1 * @strength"></label>`+
      `<label class="fnri-ep-field"><span>${escapeHtml(t('ChangeValue'))}</span>`+
      `<input name="value_${i}" data-fnri-value data-manual-value="${escapeHtml(row.manualValue)}" type="text" value="${escapeHtml(locked?preview:row.manualValue)}" ${locked?'readonly':''}></label>`+
      `<small class="fnri-ep-error" data-fnri-row-error role="status">${escapeHtml(error)}</small>`+
      `</div>`;
  }).join('');
}

/** Update read-only previews without writing any Actor/Item/Effect documents. */
export function updateEffectFormulaEditorPreview(root, {actor=null}={}) {
  const find = name => root.querySelector(`[name="${name}"]`);
  let state;
  try {
    const base=readEffectStateFromEditor(find);
    state=validateEffectStateInput(base);
  } catch (err) {
    root.querySelectorAll('[data-fnri-row-error]').forEach(el => {el.textContent=String(err.message);});
    return false;
  }
  // Saving zero retires the effect; formula validation cannot block removal.
  if (state.strength === 0) return true;
  let valid=true;
  for (const rowEl of root.querySelectorAll('[data-fnri-calculation-row]')) {
    const formula=rowEl.querySelector('[data-fnri-formula]');
    const auto=rowEl.querySelector('[data-fnri-auto]');
    const value=rowEl.querySelector('[data-fnri-value]');
    const error=rowEl.querySelector('[data-fnri-row-error]');
    auto.disabled=!formula.value.trim();
    if (auto.disabled) auto.checked=false;
    error.textContent='';
    if (auto.checked) {
      try {
        if (deferred(formula.value,actor)) {
          evaluateEffectFormula(formula.value,{state,actor:null,deferActor:true});
          value.value=t('AfterApplication');
        } else value.value=String(evaluateEffectFormula(formula.value,{state,actor}));
        value.readOnly=true;
      } catch (err) {
        valid=false;
        value.readOnly=false;
        value.value=value.dataset.manualValue ?? '';
        error.textContent=String(err.message);
      }
    } else {
      value.readOnly=false;
      value.value=value.dataset.manualValue ?? '';
    }
  }
  return valid;
}

function readEffectStateFromEditor(find) {
  return Object.fromEntries(['effectLevel','strength','magnitude']
    .map(field=>[field,find(field)?.value ?? '']));
}

/** Editor is available from Shift + Left click on a precise ActiveEffect UUID. */
export async function openEffectParametersEditor(actor, effect) {
  if (!canEdit(actor, effect)) {
    if (effect.sheet?.render) await effect.sheet.render({ force: true });
    return;
  }
  const state=readEffectState(effect);
  const duration=effect.duration ?? {};
  const rows=readEffectChangeRows(effect);
  const editField=(field,key,value,opts='') =>
    `<label class="fnri-ep-field"><span>${escapeHtml(t(key))}</span>`+
    `<input name="${field}" type="number" value="${escapeHtml(val(value))}" ${opts}></label>`;
  const content=`<section class="fnri-effect-parameters-editor" data-fnri-effects-editor>`+
    `<p>${escapeHtml(t('ParametersHelp'))}</p>`+
    editField('effectLevel','Level',state.effectLevel,'min="0" step="1"')+
    editField('strength','Strength',state.strength,'min="0" step="1"')+
    editField('magnitude','Magnitude',state.magnitude,'step="any"')+
    `<fieldset><legend>${escapeHtml(t('ChangeRows'))}</legend>`+
    `<p>${escapeHtml(t('FormulaHelp'))}</p>`+
    changeRowsHTML(effect,rows,state)+
    `</fieldset>`+
    `<fieldset><legend>${escapeHtml(t('Duration'))}</legend>`+
    `<p>${escapeHtml(t('DurationNote'))}</p>`+
    editField('durationValue','DurationValue',duration.value,'min="0" step="any"')+
    `<label class="fnri-ep-field"><span>${escapeHtml(t('DurationUnits'))}</span>`+
    `<select name="durationUnits">`+
    (!DURATION_UNITS.includes(duration.units) ? `<option value="" selected>${escapeHtml(t('DurationUnchanged'))}</option>` : '')+
    DURATION_UNITS.map(unit=>`<option value="${unit}" ${duration.units===unit?'selected':''}>${escapeHtml(t('Unit_'+unit))}</option>`).join('')+
    `</select></label></fieldset>`+
    `</section>`;

  const choice=await foundry.applications.api.DialogV2.wait({
    window:{title:`${t('EditParameters')}: ${effect.name}`},
    content,rejectClose:false,
    render:(_event,dialog)=>{
      const root=dialog.element?.querySelector?.('[data-fnri-effects-editor]');
      if (!root || root.dataset.fnriBound) return;
      root.dataset.fnriBound='true';
      const saveButton=dialog.element?.querySelector?.('button[data-action="save"]');
      const refresh=()=>{
        const valid=updateEffectFormulaEditorPreview(root,{actor:ownerActor(effect)});
        if (saveButton) saveButton.disabled=!valid;
      };
      root.addEventListener('input', event=>{
        const target=event.target;
        if (target?.matches?.('[data-fnri-value]') && !target.readOnly)
          target.dataset.manualValue=target.value;
        if (target?.matches?.('[data-fnri-formula]')) {
          const row=target.closest('[data-fnri-calculation-row]');
          const auto=row?.querySelector('[data-fnri-auto]');
          if (auto && !auto.dataset.fnriTouched && target.value.trim()) auto.checked=true;
        }
        refresh();
      });
      root.addEventListener('change',event=>{
        if (event.target?.matches?.('[data-fnri-auto]')) event.target.dataset.fnriTouched='true';
        refresh();
      });
      refresh();
    },
    buttons:[
      {action:'save',label:t('Save'),default:true,callback:(_event,button)=>{
        const form=button.form;
        const find=name=>form?.elements?.namedItem?.(name);
        const proposedRows=rows.map((row,i)=>{
          const el=find(`value_${i}`);
          const formula=String(find(`formula_${i}`)?.value ?? '').trim();
          return {...row,formula,auto:Boolean(find(`auto_${i}`)?.checked && formula),
            manualValue:String(el?.dataset?.manualValue ?? el?.value ?? '')};
        });
        return {action:'save',fields:Object.fromEntries(new FormData(form).entries()),rows:proposedRows};
      }},
      {action:'native',label:t('NativeEditor'),callback:()=>({action:'native'})},
      {action:'cancel',label:t('Cancel'),callback:()=>({action:'cancel'})}
    ]
  });
  if (choice?.action==='native') {
    if (effect.sheet?.render) await effect.sheet.render({force:true});
    return;
  }
  if (choice?.action!=='save') return;
  if (!canEdit(actor,effect)) throw Error(t('OwnershipChanged'));
  if (JSON.stringify(readEffectState(effect)) !== JSON.stringify(state))
    throw Error(t('ParametersChanged'));
  // Validate entire planned document update before touching any persisted field.
  const nextState=validateEffectStateInput(choice.fields);
  if (nextState.strength === 0) {
    await retireZeroStrengthEffect(effect, nextState);
    return;
  }
  const nextDuration=choice.fields.durationUnits === '' ?
    {value:duration.value,units:duration.units} : validateCoreDurationInput({
      value:choice.fields.durationValue,units:choice.fields.durationUnits
    });
  const currentRows=readEffectChangeRows(effect);
  if (currentRows.length!==rows.length || currentRows.some((row,i)=>row.anchor!==rows[i].anchor ||
    row.appliedValue!==rows[i].appliedValue || row.formula!==rows[i].formula || row.auto!==rows[i].auto))
    throw Error(t('ChangesChanged'));
  const patch={};
  if (JSON.stringify(state)!==JSON.stringify(nextState))
    patch['flags.fast-nri-v14.effectState']=nextState;
  if (duration.value!==nextDuration.value || duration.units!==nextDuration.units)
    patch.duration=nextDuration;
  if (rows.length) {
    const plan=calculateEffectChangePlan(effect,{rows:choice.rows,state:nextState,actor:ownerActor(effect),deferActor:true});
    patch[`flags.${CALC_SCOPE}.${CALC_KEY}`]=plan.metadata;
    if (plan.changed) patch['system.changes']=plan.changes;
  }
  if (Object.keys(patch).length) await effect.update(patch);
}
