/** Card-authorable defensive area intervention selectors for the existing
 * 'Вмешаться' dialog. A card declares values; no script or name matching.
 * Attacking / pre-attack interventions remain separate ordinary actions.
 */
import {CHECK_DEFENSES} from '../rolls/attack-properties.mjs';
const typed=x=>x&&typeof x==='object'&&!Array.isArray(x)?x:{};
export function areaInterventionChoices(actor,{targetDefense='ac',showAll=false,answered=false,
  canProtectSelf=true,canProtectAlly=true}={}) {
  if (!showAll && answered) return [];
  const choices=['step','leap'].map(movement=>({
    key:`builtin:dodge:${movement}`,label:game.i18n.localize(`FASTNRI.InterventionOptions.dodge${movement==='step'?'Step':'Leap'}`),
    stat:'reflex',kind:'dodge',movement,reduction:1,naturalTwentyCancels:true,mayProtectAlly:false,item:null
  }));
  if(CHECK_DEFENSES.includes(targetDefense))choices.push({key:'builtin:counter',
    label:game.i18n.localize('FASTNRI.Damage.counteraction'),stat:targetDefense,kind:'counteraction',
    reduction:1,naturalTwentyCancels:true,mayProtectAlly:false,item:null});
  for(const item of actor?.items?.contents??[]){
    // Explicit authoring only. Item cards with the ordinary isIntervention
    // property must not be automatically treated as defensive area actions.
    const declared=item.system?.mechanics?.areaInterventions;
    if(!Array.isArray(declared))continue;
    for(const [index,raw] of declared.entries()){
      const entry=typed(raw),stat=entry.defenseStat;
      if(!CHECK_DEFENSES.includes(stat)||typeof entry.label!=='string'||!entry.label.trim())continue;
      if(!Number.isInteger(entry.degreeReduction) || entry.degreeReduction<0 || entry.degreeReduction>3)continue;
      if(!showAll && entry.requiresDefense && entry.requiresDefense!==targetDefense)continue;
      choices.push({key:`item:${item.id}:${index}`,label:`${item.name} · ${entry.label.trim()}`,
        stat,kind:'card',reduction:entry.degreeReduction,
        naturalTwentyCancels:entry.naturalTwentyCancels!==false,
        mayProtectAlly:entry.mayProtectAlly===true,
        formula:typeof entry.rollFormula==='string'&&entry.rollFormula.trim()?entry.rollFormula.trim():null,
        item,accounting:entry.accounting&&typeof entry.accounting==='object'&&!Array.isArray(entry.accounting)
          ?entry.accounting:null});
    }
  }
  return showAll ? choices : choices.filter(choice => choice.mayProtectAlly ? canProtectAlly : canProtectSelf);
}
