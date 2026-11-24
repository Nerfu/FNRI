/** Every directed attack has −4, −6 and −10 available. If the spatial
 * calculation or an ActiveEffect yields a source of that value, the common
 * roll UI shows the individual sources INSTEAD of this bare fallback switch.
 * This does not inspect lighting, walls or scenery. */
export const HINDRANCE_LEVELS=Object.freeze([4,6,10]);
export function attackSituationalEntries(){
  return HINDRANCE_LEVELS.map(level=>({
    uuid:`hindrance:fallback:${level}`,sourceUuid:null,sourceType:'situational',
    id:`fallback-${level}`,name:'Штраф помехи',effect:null,native:false,
    nativeChanges:[],actorOwned:false,onUse:'none',fallbackPenalty:level,
    parts:[{id:'fallback',kind:'modifier',label:'',value:String(-level),
      nonStackingGroup:'hindrance',defaultEnabled:false}]
  }));
}
