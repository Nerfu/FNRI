import {abilitySource} from '../data/ability-source.mjs';
import { actorClassDefinition, DOUBLE_INVOCATION_ID, CLASSES } from '../data/classes.mjs';
import { queueActorWrite } from '../data/ability-accounting.mjs';

import {chooseCharacterOption} from './character-choice.mjs';
import {creatureNature} from '../data/racial-properties.mjs';
import {itemGrip,weaponProficiency} from '../equipment/equipment.mjs';

const SCOPE = 'fast-nri-v14';
const INDEX_FIELD = `flags.${SCOPE}.contentId`;
const INDEX_FIELDS = [INDEX_FIELD, `flags.${SCOPE}.source`, 'type', 'img'];
const contentId = entry => entry?.getFlag?.(SCOPE, 'contentId') ?? entry?.flags?.[SCOPE]?.contentId ?? entry?.[INDEX_FIELD];
const classIds = actor => actorClassDefinition(actor)?.abilityIds ?? [];
const owned = (actor, id) => actor.items.contents.find(item => item.type === 'ability' && contentId(item) === id);
const pack = () => game.packs?.get?.(`${SCOPE}.abilities`);

export async function missingClassAbilityRows(actor) {
  const missing = classIds(actor).filter(id => !owned(actor, id));
  const source = pack();
  if (!missing.length || !source?.getIndex) return [];
  try {
    const index = await source.getIndex({ fields: INDEX_FIELDS });
    const entries = new Map((index.contents ?? [...index]).filter(entry => entry.type === 'ability')
      .map(entry => [contentId(entry), entry]));
    return missing.flatMap(id => {
      const entry = entries.get(id);
      return entry ? [{name: entry.name, img: entry.img, classContentId: id, compendiumOnly: true, classAbility: true,
        abilitySource:abilitySource(actor,entry,{classContentId:id}),
        doubleInvocation: id === DOUBLE_INVOCATION_ID}] : [];
    });
  } catch (error) {
    console.warn('Fast NRI | class abilities index unavailable', error);
    return [];
  }
}

export async function classAbilityCard(actor, id) {
  if (!classIds(actor).includes(id)) return null;
  const existing = owned(actor, id);
  if (existing) return existing;
  const source = pack();
  if (!source?.getIndex) return null;
  const index = await source.getIndex({fields: INDEX_FIELDS});
  const matches = (index.contents ?? [...index]).filter(entry => entry.type === 'ability' && contentId(entry) === id);
  if (matches.length !== 1) return null;
  const card = await source.getDocument(matches[0]._id);
  return card?.type === 'ability' && contentId(card) === id ? card : null;
}

export function useClassAbilityCard(actor, id) {
  return queueActorWrite(actor, async () => {
    const card = await classAbilityCard(actor, id);
    if (!card || !classIds(actor).includes(id)) return null;
    const existing = owned(actor, id);
    if (existing) return existing;
    const data = card.toObject();
    delete data.folder;
    delete data._stats;
    data.flags[SCOPE].automaticClassAbility=true;
    if (actor.items.has(data._id)) delete data._id;
    try {
      const [item] = await actor.createEmbeddedDocuments('Item', [data], {keepId: Boolean(data._id)});
      return item;
    } catch (error) {
      const concurrent = owned(actor, id);
      if (!concurrent) throw error;
      return concurrent;
    }
  });
}

/** Explicit class selection/creation only. Reuse the same owned Item path as
 * manual publication. No writes on render, no world scan. */
export async function grantClassAbilities(actor) {
  await queueActorWrite(actor,async()=>{
    const ids=classIds(actor);
    const obsolete=actor.items.contents.filter(item=>item.type==='ability'&&item.getFlag(SCOPE,'automaticClassAbility')===true&&!ids.includes(contentId(item)));
    if(obsolete.length)await actor.deleteEmbeddedDocuments('Item',obsolete.map(i=>i.id));
  });
  const ids = [...classIds(actor)];
  for (const id of ids) {
    if (!classIds(actor).includes(id)) return;
    const item = await useClassAbilityCard(actor, id);
    if (!item && classIds(actor).includes(id)) {
      throw new Error(`Class ability unavailable: ${id}`);
    }
  }
}


/** One additional level-one weapon, independent of other proficiency sources. */
export function clericWeaponOptions(entries){
  const cleric={system:{className:CLASSES.cleric.name},items:{contents:[]}};
  return entries.filter(w=>w.type==='weapon'&&w.system?.level===1&&itemGrip(w)==='1'&&
    !weaponProficiency(w,cleric).proficient&&contentId(w)).sort((a,b)=>a.name.localeCompare(b.name,'ru'));
}
async function clericWeaponCatalog(){
  const source=game.packs?.get?.(`${SCOPE}.weapons`);
  if(!source?.getIndex)throw Error('Weapon catalog unavailable');
  const index=await source.getIndex({fields:[INDEX_FIELD,'type','system.level','system.grip','system.hands','system.proficiencyClasses','system.proficiencyMode']});
  return clericWeaponOptions(index.contents??[...index]);
}
const selectedWeapon=item=>item.system?.mechanics?.weaponProficiency?.weaponContentIds?.[0];
export async function classWeaponProficiencyName(item){
  if(!selectedWeapon(item))return '';
  return (await clericWeaponCatalog()).find(w=>contentId(w)===selectedWeapon(item))?.name??'';
}
const openWeaponChoices=new WeakSet();
export async function editClassWeaponProficiency(item,{initial=false}={}){
  const actor=item.parent;
  if(!actor?.isOwner||item.system?.mechanics?.weaponProficiency?.chooseAdditional!==true||openWeaponChoices.has(item))return;
  openWeaponChoices.add(item);
  const live=()=>actor.items.get(item.id)===item&&(!initial||actorClassDefinition(actor)===CLASSES.cleric);
  const path='system.mechanics.weaponProficiency.weaponContentIds';
  try{
    if(initial&&selectedWeapon(item))await queueActorWrite(actor,async()=>{if(live())await item.update({[path]:[]});});
    const choices=await clericWeaponCatalog();
    if(!live())return;
    const localize=k=>game.i18n.localize('FASTNRI.'+k);
    const selection=await chooseCharacterOption({title:item.name,names:choices.map(w=>w.name),
      current:choices.find(w=>contentId(w)===selectedWeapon(item))?.name,
      searchLabel:localize('RacialProperties.search'),clearLabel:localize('CharacterChoice.clear'),cancelLabel:localize('RacialProperties.cancel')});
    if(selection===null)return;
    const chosen=choices.find(w=>w.name===selection);
    await queueActorWrite(actor,async()=>{if(live())await item.update({[path]:chosen?[contentId(chosen)]:[]});});
  }finally{openWeaponChoices.delete(item);}
}

/** Initial or explicit choice; existing Nature is preserved, including racial Nature. */
export async function editClassNature(item){
  const actor=item.parent;
  if(!actor?.isOwner||!item.system?.mechanics?.classNature||openWeaponChoices.has(item))return;
  const live=()=>actor.items.get(item.id)===item;
  const path='system.mechanics.classNature.selection';
  const existing=creatureNature(actor,{exclude:item});
  if(existing){if(live())await item.update({[path]:existing});return;}
  openWeaponChoices.add(item);
  try{
    const choices={holy:'Святой',unholy:'Нечестивый'};
    const localize=k=>game.i18n.localize('FASTNRI.'+k);
    const selection=await chooseCharacterOption({title:item.name,names:Object.values(choices),current:choices[item.system.mechanics.classNature.selection],searchLabel:localize('RacialProperties.search'),clearLabel:localize('CharacterChoice.clear'),cancelLabel:localize('RacialProperties.cancel')});
    if(selection===null)return;
    await queueActorWrite(actor,async()=>{if(live())await item.update({[path]:creatureNature(actor,{exclude:item})??Object.keys(choices).find(k=>choices[k]===selection)??''});});
  }finally{openWeaponChoices.delete(item);}
}
