/** Local sheet protection, not a permission check or a game-rule restriction. */
const CONFIG_ACTIONS = new Set([
  'chooseIdentity','chooseTradition','editRacialProperties','changeRacialSubproperty',
  'resetSkillDice','addSkill','addSpecialization','removeSkill',
  'addResource','removeResource','addEquipmentSlot','removeEquipmentSlot'
]);
const SKILL_LIST_ACTIONS = new Set(['addSkill','addSpecialization','removeSkill','removeSpecialization']);
export function hideWhenLocked(control) {
  const d=control?.dataset??{};
  return d.fnriLockSection!==undefined || SKILL_LIST_ACTIONS.has(d.action) || SKILL_LIST_ACTIONS.has(d.skillAction) || d.skillAction==='remove';
}
const LIVE_FIELDS = new Set(['system.hp.current','system.hp.temp','system.potionsUsed','system.wealth','system.notes']);
export function configurationControl(control) {
  const d=control?.dataset??{};
  if (CONFIG_ACTIONS.has(d.action) || hideWhenLocked(control) || d.skillAction!==undefined || d.skillRelease!==undefined || d.skillDie!==undefined || d.skillCustomDie!==undefined || d.skillUpgrade!==undefined || d.skillFormula!==undefined || d.skillUseAssigned!==undefined) return true;
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
  for (const control of root.querySelectorAll('input,select,textarea,button,[data-fnri-lock-section]')) {
    if (locked && hideWhenLocked(control)) {
      if (!control.hidden) {
        control.hidden=true;
        control.dataset.fnriLockHidden='true';
      }
    } else if (control.dataset.fnriLockHidden==='true') {
      control.hidden=false;
      delete control.dataset.fnriLockHidden;
    }
    if (locked && configurationControl(control) && 'disabled' in control) {
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

const SCOPE='fast-nri-v14';
const INITIAL='sheetInitiallyUnlocked';
const lockKey=actor=>actor?.id&&`sheetLock_${actor.id}`;
// The Actor flag is only an initial UI preference for newly created PC documents.
// Each user stores their own explicit preference, including a locked new PC.
export function initialSheetLock(actor,user=globalThis.game?.user){
  if(actor?.type!=='character')return true;
  const key=lockKey(actor);
  const saved=key?user?.getFlag?.(SCOPE,key):undefined;
  if(typeof saved==='boolean')return saved;
  return actor.getFlag?.(SCOPE,INITIAL)!==true;
}
export async function saveSheetLock(actor,locked,user=globalThis.game?.user){
  const key=lockKey(actor);
  if(actor?.type==='character'&&key&&user?.setFlag)await user.setFlag(SCOPE,key,Boolean(locked));
}
export function registerInitialSheetLock(){
  Hooks.on('preCreateActor',(actor,_data,_options,userId)=>{
    if(actor.type==='character'&&userId===game.user?.id)
      actor.updateSource({[`flags.${SCOPE}.${INITIAL}`]:true});
  });
}
