/** Attack kind and Reach are independent of distance. No Item is mutated.
 * Numeric positive distance gives the Reach trait ONLY to a melee weapon.
 * Legacy descriptive distance stays readable but is not guessed as a number.
 */
export const DEFENSE_ABILITIES=Object.freeze(['fortitude','reflex','will']);
export const TARGET_DEFENSES=Object.freeze(['ac',...DEFENSE_ABILITIES]);
export function normalizeAttackKind(kind) {
  const value=String(kind??'').trim().toLowerCase();
  if(value==='melee')return 'melee';
  if(['ranged','distance','throw'].includes(value))return 'ranged';
  if(value==='focus')return 'focus';
  return null;
}
export function numericDistance(value) {
  if(typeof value==='number')return Number.isFinite(value) && value>=0?value:null;
  const text=String(value??'').trim();
  if(!text)return 0;
  if(!/^\d+(?:[.,]\d+)?$/.test(text))return null;
  const n=Number(text.replace(',','.'));return Number.isFinite(n)?n:null;
}
export function hasComputedReach({attackKind,distance}={}) {
  return normalizeAttackKind(attackKind)==='melee' && (numericDistance(distance)??0)>0;
}
export function effectiveWeaponProperties(system,{reachName='Досягаемость'}={}) {
  const kind=normalizeAttackKind(system?.attackKind);
  const properties=String(system?.properties??'').split(/[,;]+/).map(s=>s.trim()).filter(Boolean);
  // Computed property takes precedence over obsolete editable Reach text.
  const withoutReach=kind ? properties.filter(s=>!['досягаемость','reach'].includes(s.toLowerCase())) : properties;
  if(hasComputedReach(system))withoutReach.push(reachName);
  return [...new Set(withoutReach)].join(', ');
}
export function explicitInterventionFromCard(item) {
  return [true,'true',1,'1'].includes(item?.system?.mechanics?.isIntervention);
}
export function messageIntervention(msg) {
  const id='fast-nri-v14';
  const get=key=>msg?.getFlag?.(id,key) ?? msg?.flags?.[id]?.[key];
  const override=get('interventionOverride');
  if(typeof override==='boolean')return override;
  return !!(get('weaponDamage')?.isIntervention || get('weaponAttack')?.isIntervention || get('checkRoll')?.isIntervention);
}
