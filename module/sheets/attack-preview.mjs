/** Only presents card-owned attack data; never changes an Item or a Roll. */
import {ATTACK_DEGREES,parsePhysicalAttackProfile} from '../rolls/attack-core.mjs';
export {effectiveWeaponProperties,hasComputedReach,numericDistance} from '../rolls/attack-properties.mjs';

export function compactPhysicalProfile(profile) {
  const parsed=parsePhysicalAttackProfile(profile);
  if(!parsed.ok) return '';
  if(parsed.partsByDegree) return ATTACK_DEGREES.map(degree=>profile.degrees[degree]).join(' / ');
  const [a,b,c]=parsed.parts;
  return `${a.formula}/${b.formula}/+${c.value}`;
}

export function attackCardDetails({distance='',properties='',reach=null,range=null,rangeLabel='',reachLabel=''}={}) {
  const explicit=String(distance ?? '').trim();
  const base=explicit || (Number.isFinite(range) ? `${rangeLabel}: ${range}` :
    (Number.isFinite(reach) ? `${reachLabel}: ${reach}` : ''));
  return [base,String(properties ?? '').trim()].filter(Boolean).join(' · ');
}
