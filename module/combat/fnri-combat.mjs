/** Native v14 Combat lifecycle, following the technical pattern used by PF2e
 * and dnd5e systems. Core invokes _onEndTurn on one designated active GM. */
import {remindConditionsAtTurnStart,expireInformationalMarkers} from '../effects/condition-turn.mjs';
import {settleGeneralEffectEndTurn} from '../effects/effect-ending-turn.mjs';
import {settlePeriodicEndTurn} from '../damage/periodic-turn.mjs';
import {settleTempHpTurnStart,settleTempHpTurnEnd} from '../damage/temporary-hp-layers.mjs';
import {combatStartResourceUpdate} from '../data/classes.mjs';
import {queueActorWrite} from '../data/ability-accounting.mjs';

/** Start only on the initiating client via native startCombat. A repeated
 * combatant for one linked Actor is not a separate pool. Synthetic Actors
 * have their own UUID. Failure to update a resource does not block play. */
export async function recoverCombatStartResources(combat) {
  const actors=new Map();
  for(const c of combat.combatants??[]){
    const actor=c.actor;
    if(actor?.type==='character'&&actor.uuid)actors.set(actor.uuid,actor);
  }
  const failures=[];
  for(const actor of actors.values()){
    try {
      await queueActorWrite(actor,async()=>{
        const patch=combatStartResourceUpdate(actor);
        if(!Object.keys(patch).length)return;
        if(!(actor.isOwner||actor.canUserModify?.(game.user,'update')||game.user?.isGM))throw new Error('Actor update unavailable');
        await actor.update(patch,{fnriJournal:{kind:'combatStart'}});
      });
    } catch(error){failures.push(actor);console.error('Fast NRI | Combat start resource recovery failed',actor.uuid,error);}
  }
  return failures;
}
export class FastNRICombat extends foundry.documents.Combat {
  async startCombat() {
    const wasStarted=this.started;
    const result=await super.startCombat();
    if(!wasStarted&&this.started){
      const failures=await recoverCombatStartResources(this);
      if(failures.length)globalThis.ui?.notifications?.warn(game.i18n.localize('FASTNRI.Hints.combatResourceRecoveryFailed'));
    }
    return result;
  }
  async _onStartTurn(combatant,context) {
    await super._onStartTurn(combatant,context);
    try {await settleTempHpTurnStart(this,combatant,context);}
    catch(error){console.error('Fast NRI | temporary HP start failed',error); }
    try {await remindConditionsAtTurnStart(this,combatant,context);}
    catch(error){console.warn('Fast NRI | condition reminder failed',error);}
  }
  async _onEndTurn(combatant,context) {
    await super._onEndTurn(combatant,context);
    if (context?.skipped || !this.started) return;
    // A failed subsystem must not prevent the other independent end-turn work.
    for (const [label,settle] of [
      ['periodic damage',settlePeriodicEndTurn],
      ['general effect ending',settleGeneralEffectEndTurn],
      ['temporary HP',settleTempHpTurnEnd],
      ['marker expiry',expireInformationalMarkers]
    ]) {
      try {await settle(this,combatant,context);}
      catch(error){console.error(`Fast NRI | ${label} end-turn failed`,error);}
    }
  }
}
