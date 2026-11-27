/** Built-in role definitions, analogous to the built-in race catalogue.
 * Free-text role names remain valid; only recognised roles have built-in rules.
 * Permanent contributions are derived from the selected role, not embedded effects.
 */
const ROLES = Object.freeze({
  heir: {name:'Наследник', startingWealth:5, defenses:{fortitude:2,will:2}, racialChoices:1,
    rollContributions:['society','persuasion','deception','intimidation'].map(id=>({
      label:'Наследник',kind:'modifier',value:'1d10',kinds:['skill'],skillId:`core_${id}`,defaultEnabled:false
    }))}
});
const normalize=value=>String(value??'').trim().toLocaleLowerCase('ru');
// World role cards are ordinary Items. The engine knows fields, not campaign roles.
const ROLE_PREFIX='world-role:';
const DEFENSE_KEYS=['awareness','reflex','fortitude','will'];
export const worldRoleReference=id=>ROLE_PREFIX+id;
export function isWorldRoleCard(item){
  return item?.type==='item'&&!item.parent&&!item.pack&&item.system?.mechanics?.roleDefinition?.version===1;
}
function worldRole(item){
  if(!isWorldRoleCard(item)||!item.id||!String(item.name??'').trim())return null;
  const data=item.system.mechanics.roleDefinition.defenses??{};
  return [worldRoleReference(item.id),{name:item.name,defenses:Object.fromEntries(DEFENSE_KEYS.filter(k=>Number.isFinite(data[k])).map(k=>[k,data[k]]))}];
}
function worldRoles(){return (globalThis.game?.items?.contents??[]).map(worldRole).filter(Boolean);}
export function roleDefinition(system) {
  const raw=String(system?.role??'').trim();
  const name=normalize(raw);
  if(raw.startsWith(ROLE_PREFIX))return worldRole(globalThis.game?.items?.get?.(raw.slice(ROLE_PREFIX.length)))??worldRoles().find(([id])=>id===raw)??null;
  return Object.entries(ROLES).find(([id,rule])=>name===id||name===normalize(rule.name)) ?? null;
}
// Names are labels only: duplicate names are disambiguated by stable Item ID.
export function roleOptions(){
  const rows=[...Object.entries(ROLES).map(([id,r])=>({value:r.name,name:r.name,id})),...worldRoles().map(([id,r])=>({value:id,name:r.name,id}))];
  return rows.map(row=>({...row,label:rows.filter(other=>normalize(other.name)===normalize(row.name)).length>1?`${row.name} [${row.id}]`:row.name}));
}
export const roleNames=()=>roleOptions().map(row=>row.label);
export const roleLabel=system=>roleDefinition(system)?.[1]?.name??(String(system?.role??'').startsWith(ROLE_PREFIX)?'':system?.role??'');
// Refresh only PCs referencing the changed external card. No writes or sockets.
export function registerWorldRoles(){
  const refresh=(id=null)=>{
    const actors=new Set(globalThis.game?.actors?.contents??[]);
    for(const token of globalThis.canvas?.tokens?.placeables??[])if(token.actor)actors.add(token.actor);
    for(const actor of actors){
      const role=String(actor.system?.role??'');
      if(actor.type!=='character'||!role.startsWith(ROLE_PREFIX)||(id&&role!==worldRoleReference(id)))continue;
      // reset returns the model to source; normal preparation recomputes bonuses.
      actor.reset?.();actor.prepareData?.();
      if(actor.sheet?.rendered)actor.sheet.render();
    }
  };
  Hooks.once('ready',()=>refresh());
  const changed=item=>{if(item?.type==='item'&&!item.parent&&!item.pack)refresh(item.id);};
  for(const hook of ['createItem','updateItem','deleteItem'])Hooks.on(hook,changed);
}
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
