/** Color exact minimum and maximum outcomes of individual dice (PF2e-style).
 * Read-only DOM decoration: no changes to Roll or active result values.
 * Marks only aligned dice tooltip groups, so complex custom roll markup is left alone.
 */
const ID='fast-nri-v14';
const hasRollFlag=m=>['weaponAttack','weaponDamage','checkRoll','areaIntervention','manualAction'].some(k=>!!m?.getFlag?.(ID,k));

export function highlightDiceResults(message,html) {
  if(message?.visible===false||message?.isContentVisible===false||!hasRollFlag(message) || !html?.querySelectorAll) return 0;
  const groups=[...html.querySelectorAll('.dice-tooltip .dice')];
  const dice=(message.rolls??[]).flatMap(roll=>roll?.dice??[]).filter(d=>Number.isInteger(d.faces) && d.faces>=2);
  // Never associate dice results with unrelated tooltip groups.
  if(groups.length!==dice.length) return 0;
  let count=0;
  for(let i=0;i<dice.length;i++) {
    const die=dice[i];
    const nodes=[...groups[i].querySelectorAll('.dice-rolls .roll')];
    const all=die.results??[];
    const active=all.filter(r=>r.active!==false);
    const entries=nodes.length===all.length ? all : nodes.length===active.length ? active : null;
    if(!entries) continue;
    for(let j=0;j<nodes.length;j++) {
      const value=entries[j]?.result;
      // If the tooltip is not a plain numerical die, do not guess.
      if(!Number.isInteger(value) || Number(nodes[j].textContent?.trim())!==value) continue;
      if(value===1){nodes[j].classList.add('fnri-die-min');count++;}
      if(value===die.faces){nodes[j].classList.add('fnri-die-max');count++;}
    }
  }
  return count;
}

/** Select the message's own check Roll, never the attack inherited by damage. */
export function checkRollIndex(message){
  const get=k=>message?.getFlag?.(ID,k);
  const rolls=message?.rolls??[];
  if(get('weaponAttack') && (rolls.length===1 || rolls.length===2&&get('weaponDamage')?.areaAttack))return 0;
  if(rolls.length!==1)return null;
  const damage=get('weaponDamage');
  if(damage)return damage.intervention&&Number.isFinite(damage.intervention.total)&&!damage.postDefenseOrigin?0:null;
  return get('checkRoll')||get('areaIntervention')||get('manualAction')?0:null;
}
export function currentCheckNatural(message,index=checkRollIndex(message)){
  if(index===null)return null;
  const roll=message.rolls?.[index],dice=roll?.dice??[];
  // A separate d20 term or multiple active d20s makes base identity ambiguous.
  const terms=dice.filter(d=>d.faces===20);
  if(terms.length!==1||terms[0].number!==1)return null;
  const active=terms[0].results?.filter(r=>r.active!==false&&!r.discarded)??[];
  if(active.length!==1)return null;
  const edit=message.getFlag?.(ID,`rollEditNative${index}`)??(index===0&&!message.getFlag?.(ID,'weaponDamage')?message.getFlag?.(ID,'rollEdit'):null);
  let value=active[0].result;
  if(edit){
    const base=(edit.components??[]).filter(p=>p.kind==='die'&&p.faces===20&&!p.added);
    const current=(edit.components??[]).filter(p=>p.kind==='die'&&p.faces===20&&!p.excluded);
    if(base.length!==1||base[0].excluded||current.length!==1||base[0].original!==value)return null;
    value=base[0].value;
  }
  return Number.isInteger(value)&&value>=1&&value<=20?value:null;
}
export function highlightCheckTotal(message,html){
  if(!html?.querySelectorAll)return;
  for(const n of html.querySelectorAll('.fnri-check-natural-one, .fnri-check-natural-twenty'))n.classList.remove('fnri-check-natural-one','fnri-check-natural-twenty');
  if(message?.visible===false||message?.isContentVisible===false)return;
  const index=checkRollIndex(message),natural=currentCheckNatural(message,index);
  if(natural!==1&&natural!==20)return;
  const edited=message.getFlag?.(ID,`rollEditNative${index}`)??(index===0&&!message.getFlag?.(ID,'weaponDamage')?message.getFlag?.(ID,'rollEdit'):null);
  const native=[...html.querySelectorAll('.dice-roll .dice-total')];
  const target=edited?html.querySelector?.(`[data-fnri-roll-index="${index}"]`):
    native.length===message.rolls.length&&Number(native[index]?.textContent?.trim())===message.rolls[index].total?native[index]:null;
  target?.classList.add(natural===1?'fnri-check-natural-one':'fnri-check-natural-twenty');
}
