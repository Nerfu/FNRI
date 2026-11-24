/** Local sheet protection, not a permission check or a game-rule restriction. */
const CONFIG_ACTIONS = new Set([
  'chooseIdentity','chooseTradition','editRacialProperties','changeRacialSubproperty',
  'openSkillEditor','resetSkillDice','addSkill','addSpecialization','removeSkill',
  'addResource','removeResource','addEquipmentSlot','removeEquipmentSlot'
]);
const LIVE_FIELDS = new Set(['system.hp.current','system.hp.temp','system.potionsUsed','system.wealth','system.notes']);
export function configurationControl(control) {
  const d=control?.dataset??{};
  if (CONFIG_ACTIONS.has(d.action)) return true;
  if (d.action==='createItem') return d.type==='ability';
  if (d.action==='deleteItem') return Boolean(control.closest?.('[data-fnri-panel="abilities"]'));
  if (d.fnriDicePicker!==undefined || d.fnriCustomDice!==undefined) return true;
  if (d.rowCollection==='skills') return true;
  if (d.rowCollection==='resources') return d.rowField!=='current';
  if (d.rowCollection==='equipmentSlots') return d.rowField!=='itemId';
  const name=control?.name??'';
  return name==='name' || (name.startsWith('system.') && !LIVE_FIELDS.has(name));
}
export function applySheetLock(root, locked) {
  if (!root) return;
  for (const control of root.querySelectorAll('input,select,textarea,button')) {
    if (locked && configurationControl(control)) {
      if (!control.disabled) {
        control.disabled=true;
        control.dataset.fnriLockDisabled='true';
      }
    } else if (control.dataset.fnriLockDisabled==='true') {
      control.disabled=false;
      delete control.dataset.fnriLockDisabled;
    }
  }
  root.classList?.toggle('fnri-config-locked',locked);
}
