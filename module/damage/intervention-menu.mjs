import {interventionWarningGroups} from '../data/intervention-availability.mjs';

const SYSTEM_ID = 'fast-nri-v14';
const FLAG = 'showAllInterventions';
const local = key => game.i18n.localize(`FASTNRI.InterventionOptions.${key}`);
let pendingChoice;
let saveQueue = Promise.resolve();

export function showAllInterventions() {
  return pendingChoice?.checked ?? (game.user.getFlag(SYSTEM_ID, FLAG) === true);
}

function rememberShowAll(checked) {
  const choice = {checked};
  pendingChoice = choice;
  const user = game.user;
  saveQueue = saveQueue.then(async () => {
    await user.setFlag(SYSTEM_ID, FLAG, checked);
    if (pendingChoice === choice) pendingChoice = undefined;
  })
    .catch(error => console.warn('Fast NRI | could not remember intervention menu preference', error));
}

const optionKey = option => option.key ?? option.id;
const optionName = option => option.label ?? option.name;

/** All methods remain actionable. A warning common to every concrete option
 * appears once; exceptions (e.g. a free intervention) keep their own warning. */
export function interventionMenuRows(actor,options,repeat=false) {
  const rows=options.map(option=>({option,...(option.standalone?{common:[],individual:[]}:
    interventionWarningGroups(actor,option.item,option.accounting??option.rule?.accounting))}));
  const concrete=rows.filter(row=>!row.option.standalone);
  const common=concrete.length?concrete[0].common.filter(w=>concrete.every(row=>row.common.includes(w))):[];
  return {common:[...(repeat?[game.i18n.localize('FASTNRI.Damage.repeatIntervention')]:[]),...common],rows:rows.map(row=>({
    option:row.option,warnings:[...row.common.filter(w=>!common.includes(w)),...row.individual]}))};
}

export async function chooseIntervention({actor, choices, title, repeated=()=>false}) {
  let showAll=showAllInterventions(), selection=null;
  await foundry.applications.api.DialogV2.wait({
    window:{title},rejectClose:false,
    content:`<label><input type="checkbox" data-fnri-intervention-show-all><span data-fnri-show-all-label></span></label>
      <div data-fnri-intervention-warnings class="fnri-intervention-warnings"></div><div data-fnri-button-choices class="fnri-button-choices" role="group"></div>`,
    buttons:[{action:'cancel',label:game.i18n.localize('FASTNRI.RacialProperties.cancel')}],
    render(_event,dialog){
      const element=dialog.element,toggle=element.querySelector('[data-fnri-intervention-show-all]');
      const list=element.querySelector('[data-fnri-button-choices]'),commonBox=element.querySelector('[data-fnri-intervention-warnings]');
      element.querySelector('[data-fnri-show-all-label]').textContent=local('showAll');
      toggle.checked=showAll;
      const node=(tag,text)=>{const n=list.ownerDocument.createElement(tag);n.textContent=text;return n;};
      function updateOptions(){
        const {common,rows}=interventionMenuRows(actor,choices(showAll),repeated());
        commonBox.replaceChildren(...common.map(w=>node('p',`⚠ ${w}`)));
        list.replaceChildren(...rows.map(({option,warnings})=>{
          const button=node('button',optionName(option));button.type='button';button.value=String(optionKey(option));
          if(warnings.length){const note=node('small',`⚠ ${warnings.join(' · ')}`);note.className='fnri-intervention-option-warning';button.append(note);}
          button.onclick=()=>{
            if(selection)return;
            const current=choices(showAll).find(o=>optionKey(o)===optionKey(option)&&optionName(o)===optionName(option));
            if(!current){updateOptions();return;}
            // If the warnings changed while the menu was open, refresh instead
            // of silently accepting stale information. Next click still works.
            const live=interventionMenuRows(actor,choices(showAll),repeated());
            const liveRow=live.rows.find(r=>optionKey(r.option)===optionKey(current));
            if(JSON.stringify(live.common)!==JSON.stringify(common)||JSON.stringify(liveRow?.warnings)!==JSON.stringify(warnings)){updateOptions();return;}
            selection={...current,menuWarningsShown:true,repeatWarningShown:repeated()};
            void dialog.close();
          };return button;
        }));
        if(!rows.length)list.replaceChildren(node('p',local('none')));
      }
      updateOptions();
      toggle.onchange=()=>{showAll=toggle.checked;rememberShowAll(showAll);updateOptions();};
    }
  });
  return selection;
}
