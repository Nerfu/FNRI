/**
 * A per-execution duration stamp for source-specific temporary HP.
 * Native Combat provides the next actual turn; no synthetic timers or actions.
 * Caster-relative timing is fixed on publication, not on application.
 */
const object=value=>value && typeof value==='object' && !Array.isArray(value)?value:{};

/** A unique Combatant is needed. A linked Actor represented twice by two
 * combatants is ambiguous: do not silently choose either token's turn.
 */
export function nextOwnTurnExpiry(actor, combat, timestamp=null, sourceToken=null) {
  const expires={};
  if(typeof timestamp==='number' && Number.isFinite(timestamp)) {
    expires.worldTime=timestamp+600; // Rulebook absolute 10 in-game minute limit
  }
  if(!combat?.started || !Number.isInteger(combat.round))return expires;
  const combatants=Array.from(combat.turns??[]);
  let matches=combatants.flatMap((combatant,index)=>
    combatant?.actor?.uuid===actor?.uuid ? [{combatant,index}]:[]);
  const tokenUuid=sourceToken?.document?.uuid??sourceToken?.uuid;
  if(matches.length>1 && tokenUuid)matches=matches.filter(({combatant})=>combatant.token?.uuid===tokenUuid);
  if(matches.length!==1)return expires;
  const {combatant,index}=matches[0];
  const currentIndex=Number.isInteger(combat.turn)?combat.turn:null;
  const upcoming=currentIndex!==null && currentIndex<index;
  expires.turnStart={combatId:combat.id,combatantId:combatant.id,
    notBeforeRound:combat.round+(upcoming?0:1)};
  return expires;
}

export function abilityTempHpExpiry(actor,execution,{combat=null,worldTime=null,sourceToken=null}={}) {
  const duration=object(execution?.duration);
  if(duration.kind==='nextOwnTurn')return {...nextOwnTurnExpiry(actor,combat,worldTime,sourceToken),
    ...(duration.marker==='shadowShield'?{marker:'shadowShield'}:{})};
  return {};
}

/** Expired results are advisory; callers may still apply them. */
export function hasTempHpResultExpired(expiry,{combat=null,worldTime=null}={}) {
  const due=object(expiry);
  if(typeof due.worldTime==='number' && typeof worldTime==='number' &&
      Number.isFinite(worldTime) && worldTime>=due.worldTime)return true;
  const turn=object(due.turnStart);
  if(!turn.combatId || combat?.id!==turn.combatId || !combat.started ||
      !Number.isInteger(turn.notBeforeRound) || !Number.isInteger(combat.round))return false;
  if(combat.round>turn.notBeforeRound)return true;
  if(combat.round<turn.notBeforeRound)return false;
  const index=Array.from(combat.turns??[]).findIndex(row=>row?.id===turn.combatantId);
  return index>=0 && Number.isInteger(combat.turn) && combat.turn>=index;
}
