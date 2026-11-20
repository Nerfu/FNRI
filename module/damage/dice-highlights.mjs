/** Color exact minimum and maximum outcomes of individual dice (PF2e-style).
 * Read-only DOM decoration: no changes to Roll or active result values.
 * Marks only aligned dice tooltip groups, so complex custom roll markup is left alone.
 */
const ID='fast-nri-v14';
const hasRollFlag=m=>['weaponAttack','weaponDamage','checkRoll'].some(k=>!!m?.getFlag?.(ID,k));

export function highlightDiceResults(message,html) {
  if(!hasRollFlag(message) || !html?.querySelectorAll) return 0;
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
