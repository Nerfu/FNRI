/** Built-in role definitions, analogous to the built-in race catalogue.
 * Free-text role names remain valid; only recognised roles have built-in rules.
 * Permanent contributions are derived from the selected role, not embedded effects.
 */
const ROLES = Object.freeze({
  heir: {name:'Наследник', defenses:{fortitude:2,will:2}, racialChoices:1,
    rollContributions:['society','persuasion','deception','intimidation'].map(id=>({
      label:'Наследник',kind:'modifier',value:'1d10',kinds:['skill'],skillId:`core_${id}`,defaultEnabled:false
    }))}
});
const normalize=value=>String(value??'').trim().toLocaleLowerCase('ru');
export function roleDefinition(system) {
  const name=normalize(system?.role);
  return Object.entries(ROLES).find(([id,rule])=>name===id||name===normalize(rule.name)) ?? null;
}
export const roleNames=()=>Object.values(ROLES).map(rule=>rule.name);
/** Foundry prepares the model from fresh source before each derived-data pass.
 * Do not write to source or add a synthetic ActiveEffect.
 */
export function prepareRoleDefenses(system) {
  const rule=roleDefinition(system)?.[1];
  for(const [key,bonus] of Object.entries(rule?.defenses??{}))
    if(Number.isFinite(system.defenses?.[key])) system.defenses[key]+=bonus;
}
export function actorRoleDefinition(actor) {
  return actor?.type==='character'?roleDefinition(actor.system):null;
}
export function roleRacialChoices(actor) {
  return actorRoleDefinition(actor)?.[1]?.racialChoices??0;
}
