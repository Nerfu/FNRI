import {projectionArmorForToken} from '../projection/projection.mjs';
import {formationForTarget} from '../spatial/formation.mjs';
import {spatialDefenderSnapshot} from '../spatial/spatial-context.mjs';
/** Attack kind and Reach are independent of distance. No Item is mutated.
 * Numeric positive distance gives the Reach trait ONLY to a melee weapon.
 * Legacy descriptive distance stays readable but is not guessed as a number.
 */
export const DEFENSE_ABILITIES=Object.freeze(['fortitude','reflex','will']);
export const CHECK_DEFENSES=Object.freeze(['awareness',...DEFENSE_ABILITIES]);
export const TARGET_DEFENSES=Object.freeze(['ac',...CHECK_DEFENSES]);

export function isAreaAttack(properties) {
  return /(?:^|[,;\s])(?:область действия|area)(?:$|[,;\s])/i.test(String(properties));
}

export function selectedTargetSnapshot(targets, defense='ac') {
  const tokens = [...(targets ?? [])];
  if (tokens.length !== 1) return {status:tokens.length ? 'multiple' : 'none',name:null};
  const [token] = tokens;
  const system = token?.actor?.system;
  const details = {name:token?.name ?? null,uuid:token?.document?.uuid ?? token?.uuid ?? null};
  let snapshot;
  if (CHECK_DEFENSES.includes(defense)) {
    const difficulty = system?.defenses?.[defense];
    snapshot=Number.isFinite(difficulty)
      ? {...details,status:'one',difficulty} : {...details,status:'missingDefense'};
  } else if (defense !== 'ac') snapshot={...details,status:'unknownDefense'};
  else {
    const ac = projectionArmorForToken(token) ?? system?.ac;
    snapshot=[ac?.partial,ac?.success,ac?.great].every(Number.isFinite)
      ? {...details,status:'one',ac:{partial:ac.partial,success:ac.success,great:ac.great}}
      : {...details,status:'missingAC'};
  }
  // Surrounding is defender-side, never a toggleable attacker penalty.
  // Check once for this target; do not create/persist an ActiveEffect.
  const scene=globalThis.canvas?.scene,grid=globalThis.canvas?.grid;
  if(snapshot.status!=='one'||!scene||grid?.isSquare!==true ||
    token?.document?.parent?.id!==scene.id)return snapshot;
  const formation=formationForTarget(token,globalThis.canvas?.tokens?.placeables??[],{grid});
  return spatialDefenderSnapshot(snapshot,{formation},token.actor);
}
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
