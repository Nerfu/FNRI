/**
 * Stage 3C.4B — reactive healing is resolved as part of ONE incoming hit.
 * Rulebook: when incoming damage WOULD drop positive HP to 0, heal first,
 * then deal damage. When already at 0 HP, or when damage is not lethal,
 * resolve the damage first, then the reaction healing. Neither order
 * publishes an intermediate Actor HP state. No UI, Item consumption or
 * intervention accounting is implied by passing an already resolved amount.
 */
import {planHpChange} from './damage-core.mjs';
import {planDeathTransition,deathStateOf,deathStateUpdate} from './death-lifecycle.mjs';

const validAmount=value=>typeof value==='number' && Number.isFinite(value) && value>=0;

/** Pure calculation: the response is a *healing amount*, not a temporary-HP
 * grant, and has already been resolved under its own HP-gain rules. */
export function planResponsiveDamage(hp,damageAmount,healingAmount,{ignoreTempHp=false,preventZero=false}={}) {
  if (!validAmount(damageAmount) || !validAmount(healingAmount))
    throw Error('Reactive damage and healing must be finite non-negative amounts');
  const original=planHpChange(hp,0,'damage').before;
  const unhealedHit=planHpChange(hp,damageAmount,'damage',{ignoreTempHp});
  const healingFirst=original.current>0 && unhealedHit.after.current===0 &&
    unhealedHit.after.current<original.current;
  let heal,damage;
  if (healingFirst) {
    heal=planHpChange(hp,healingAmount,'heal');
    damage=planHpChange({...hp,...heal.after,...(heal.tempHpState?{tempHpState:heal.tempHpState}:{})},damageAmount,'damage',{ignoreTempHp,preventZero});
  } else {
    damage=planHpChange(hp,damageAmount,'damage',{ignoreTempHp,preventZero});
    heal=planHpChange({...hp,...damage.after,...(damage.tempHpState?{tempHpState:damage.tempHpState}:{})},healingAmount,'heal');
  }
  const after=healingFirst?damage.after:heal.after;
  const damageHpAmount=Math.max(0,damage.before.current-damage.after.current);
  return {
    kind:'damage',before:original,after,
    delta:{current:after.current-original.current,temp:after.temp-original.temp},
    requested:damage.requested,actual:damage.actual,
    healingRequested:heal.requested,healingApplied:heal.actual,
    order:healingFirst?'healing-before-damage':'damage-before-healing',
    damagePhase:damage,healingPhase:heal,damageHpAmount,
    ...(damage.tempHpState?{beforeTempHpState:original.tempHpState??hp.tempHpState,
      tempHpState:damage.tempHpState}:{}),
    response:{version:1,healingRequested:heal.requested,healingApplied:heal.actual,
      order:healingFirst?'healing-before-damage':'damage-before-healing'}
  };
}

/** Compute the final death transition without publishing an intermediate 0 HP.
 * If already at zero and the hit kills the character, subsequent ordinary
 * healing never silently resurrects them. A player/GM may still edit Actor.
 */
export async function planResponsiveDeath(actor,plan,{degree=null,naturalD20=null}={}) {
  const damage=plan.damagePhase;
  const death=await planDeathTransition(actor,{
    before:damage.before.current,after:damage.after.current,
    kind:'damage',hitPointsDamage:damage.damageThroughTemp,degree,naturalD20
  });
  if (plan.order!=='damage-before-healing' || plan.healingPhase.after.current<=0)
    return death;
  const old=deathStateOf(actor);
  if (old.dead===true || death.after?.dead===true) return death;
  if (!death.changed && old.version!==1) return death;
  // The damage consequences were calculated first; living healing then
  // clears the counter. Prone remains in place during effect reconciliation.
  return {...death,changed:true,needsEffects:true,before:death.before??old,after:null,
    patch:deathStateUpdate(actor,null,'responsive-healing')};
}
