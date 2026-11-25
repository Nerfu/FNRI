/** Independent execution uses existing roll/accounting; no fictional attack. */
import {declareAction,canExecuteAction,actionText,escapeActionText as esc} from '../rolls/action-declaration.mjs';
import {canReadChatContent} from '../data/chat-visibility.mjs';
import {postCheckRoll} from '../rolls/checks.mjs';
import {selfDefenseFormula,availableInterventions} from './interventions.mjs';
import {counteractionFormula} from './counteraction.mjs';
import {coverAllyItem} from './cover-ally-state.mjs';
import {areaInterventionChoices} from './area-card-interventions.mjs';
import {CHECK_DEFENSES,DEFENSE_ABILITIES} from '../rolls/attack-properties.mjs';
import {interventionWarnings} from '../data/intervention-availability.mjs';
import {chooseIntervention} from './intervention-menu.mjs';
const label=id=>actionText(`cards.${id}.name`);
const description=id=>actionText(`cards.${id}.description`);
const tr=k=>game.i18n.localize(`FASTNRI.Damage.${k}`);
export function standaloneInterventionChoices(actor){
  const choices=[{id:'selfDefense',name:label('selfDefense'),builtin:true},{id:'counteraction',name:label('counteraction'),counteraction:true},
    ...areaInterventionChoices(actor,{showAll:true}).map(c=>({...c,id:c.key,name:c.label})),
    ...availableInterventions(actor).filter(c=>!c.builtin)];
  const cover=coverAllyItem(actor);
  if(cover)choices.push({id:'coverAlly',name:label('coverAlly'),kind:'coverAlly',item:cover});
  return choices;
}
/** Append independent methods not already offered in the linked context. */
export function completeInterventionChoices(actor, options) {
  const key=choice=>choice.counteraction||choice.kind==='counteraction'?'counteraction':choice.builtin?'selfDefense':choice.kind==='coverAlly'?'coverAlly':choice.id??choice.key;
  const seen=new Set(options.map(key));
  return [...options,...standaloneInterventionChoices(actor).filter(choice=>!seen.has(key(choice))).map(choice=>({...choice,independent:true}))];
}
async function chooseStat(stats){
  const result=await foundry.applications.api.DialogV2.input({window:{title:tr('chooseDefense')},content:`<select name="defense">${stats.map(stat=>`<option value="${esc(stat)}">${esc(tr('stat_'+stat))}</option>`).join('')}</select>`,ok:{label:tr('select')},rejectClose:false});
  return stats.includes(result?.defense)?result.defense:null;
}
export async function standaloneIntervention(actor,id=null,{choice=null,stat=null,source=null,skipPreroll=false,actionId=null,accountingItem=null}={}){
  if(!canExecuteAction(actor)||(source&&!canReadChatContent(source)))return null;
  if(!choice){
    const choices=()=>standaloneInterventionChoices(actor).filter(c=>id==='dodge'?c.kind==='dodge':id?c.id===id:true);
    const options=choices();
    choice=options.length===1?options[0]:await chooseIntervention({actor,choices,title:tr('intervention'),confirmLabel:tr('intervention')});
    if(!choice)return null;
  }
  const item=choice.item??null,rule=choice.rule??null,execution=rule??(choice.accounting?{accounting:choice.accounting}:null);
  const kind=choice.kind??(choice.counteraction?'counteraction':choice.builtin?'selfDefense':choice.id);
  const name=choice.name??choice.label??label(kind);
  const warnings=interventionWarnings(actor,item,execution?.accounting??null);
  if(warnings.length&&!choice.menuWarningsShown)ui.notifications?.warn(warnings.join(', '));
  const declare=()=>declareAction({actor,item:accountingItem??item,label:name,description:item?.system?.description??(kind==='coverAlly'?description('coverAlly'):description(id??kind)),source,isIntervention:true,execution,actionId});
  if(kind==='coverAlly')return declare();
  const self=kind==='selfDefense'||rule?.effect?.kind==='directedDefense'||item?.system?.mechanics?.selfDefense?.activation==='intervention';
  const counter=kind==='counteraction'||kind==='dodge'||choice.stat;
  let formula=String(choice.formula??rule?.rollFormula??item?.system?.rollFormula??'').trim(),formulaForActor=null;
  if(self||counter){
    const stats=self?DEFENSE_ABILITIES:CHECK_DEFENSES;
    stat=choice.stat??stat??(kind==='dodge'?'reflex':null);
    if(!stats.includes(stat))stat=await chooseStat(stats);
    if(!stat)return null;
    if(!formula){
      formulaForActor=a=>self?selfDefenseFormula(a,null,stat).expression:
        counteractionFormula(a,stat,{allowMissingDefense:true});
      formula=formulaForActor(actor);
      if(!Number.isFinite(actor.system?.defenses?.[stat]))ui.notifications?.warn(tr('missingDefense'));
    }
  }
  if(!formula)return declare();
  return postCheckRoll({actor,formula,formulaForActor,label:name,kind:'intervention',defenseStat:stat,sourceItem:item,accountingItem,actionId,execution,isIntervention:true,skipPreroll,targetTokens:[],audienceMessage:source});
}
