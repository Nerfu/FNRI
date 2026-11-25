import {tokenSide} from '../data/actor-side.mjs';
import {tokenDistance} from '../spatial/geometry.mjs';

/** Fast NRI v14: actor-level Projection link, not token-level ownership.
 * One ability Item may refer to any number of world Actors. Each projection
 * Actor stores ONE authoritative link to a caster + one embedded ability Item.
 * An unlinked Token inherits this link from its BASE world Actor.
 */
export const PROJECTION_SCOPE = 'fast-nri-v14';
export const PROJECTION_TEMPLATE_ID = 'fnri7.rulebook.actor.warlock.projection-template';
const FLAG = 'projection';
const isWorldActor = actor => actor?.documentName === 'Actor' && !actor.isToken && !actor.pack;
const canEdit = document => !!document && (document.canUserModify?.(game.user, 'update') === true || game.user?.isGM === true);

export function worldProjectionActor(value) {
  const actor = value?.documentName === 'Token' ? value.actor : value?.actor?.documentName === 'Actor' ? value.actor : value;
  if (!actor || actor.documentName !== 'Actor') return null;
  if (!actor.isToken) return isWorldActor(actor) ? actor : null;
  // v14 TokenDocument.baseActor identifies the shared world Actor;
  // actor itself is synthetic and its current HP MUST remain independent.
  const tokenDoc = actor.token ?? value?.document ?? value;
  const base = tokenDoc?.baseActor ?? game.actors?.get(tokenDoc?.actorId ?? actor.id);
  return isWorldActor(base) ? base : null;
}

export function projectionLink(value) {
  const actor = worldProjectionActor(value);
  const raw = actor?.getFlag?.(PROJECTION_SCOPE, FLAG);
  if (![1, 2].includes(raw?.version) || typeof raw.casterUuid !== 'string') return null;
  return { ...raw, abilityUuid: typeof raw.abilityUuid === 'string' ? raw.abilityUuid : null };
}

export function isProjectionActor(value) {
  const actor = worldProjectionActor(value);
  return !!actor && (!!projectionLink(actor) || actor.getFlag(PROJECTION_SCOPE, 'projectionIdentity') === true ||
    actor.getFlag(PROJECTION_SCOPE, 'projectionTemplate') === true);
}

export function projectionCaster(value) {
  const link = projectionLink(value);
  const caster = link?.casterUuid ? game.actors?.contents?.find(a => a.uuid === link.casterUuid) : null;
  return isWorldActor(caster) ? caster : null;
}

export function worldProjectionAbility(item) {
  if (item?.documentName !== 'Item' || item.parent?.documentName !== 'Actor') return null;
  const caster = worldProjectionActor(item.parent);
  return caster?.items?.get(item.id) ?? null;
}

export function projectionActorsForAbility(item) {
  item = worldProjectionAbility(item);
  if (!item) return [];
  return (game.actors?.contents ?? []).filter(actor => {
    const link = projectionLink(actor);
    return link?.version === 2 && link.casterUuid === item.parent.uuid && link.abilityUuid === item.uuid;
  }).sort((a, b) => a.name.localeCompare(b.name));
}

export function findProjectionActors(caster) {
  if (!isWorldActor(caster)) return [];
  return (game.actors?.contents ?? []).filter(actor => projectionLink(actor)?.casterUuid === caster.uuid);
}

// Legacy convenience API; no 'only one' assumption and no silent actor creation.
export function findProjectionActor(caster) { return findProjectionActors(caster)[0] ?? null; }

function validProjectionAbility(item) {
  return item?.type === 'ability' && Array.isArray(item.system?.mechanics?.executions) &&
    item.system.mechanics.executions.some(e => e.type === 'projection');
}

/** Read the current scene only. Never guess between conflicting tokens. */
function initialProjectionDisposition(caster) {
  if(caster.type === "character" && [1,-1].includes(caster.prototypeToken?.disposition)) return caster.prototypeToken.disposition;
  const scene = globalThis.canvas?.scene;
  const tokens = scene ? [...(caster.getActiveTokens?.() ?? [])].filter(t =>
    t?.document?.parent?.id === scene.id) : [];
  const sides = tokens.length ? [...new Set(tokens.map(tokenSide))] :
    [caster.prototypeToken?.disposition];
  return sides.length === 1 && [1, -1].includes(sides[0]) ? sides[0] : null;
}

/** Native permissions on the receiver AND on the embedded ability.
 * Transfer is a single update on the receiving Actor; the old card is read-only
 * and its list instantly stops matching. No custom GM socket or forced edits.
 */
export async function linkProjectionActor(item, candidate) {
  item = worldProjectionAbility(item);
  const actor = worldProjectionActor(candidate);
  if (!validProjectionAbility(item) || !actor || actor.uuid === item.parent.uuid)
    throw new Error('Требуется Actor Проекции и карточка способности Колдуна');
  if (!canEdit(item) || !canEdit(item.parent) || !canEdit(actor))
    throw new Error('Нет штатного права Foundry на изменение способности или Actor Проекции');
  const previous = projectionLink(actor);
  const same = previous?.version === 2 && previous.casterUuid === item.parent.uuid &&
    previous.abilityUuid === item.uuid;
  if (same) return { actor, previous, changed: false };
  // Identity is retained after unlinking, so the short projection sheet remains.
  const rules = actor.getFlag(PROJECTION_SCOPE, 'projectionRules');
  const disposition = !previous && actor.getFlag(PROJECTION_SCOPE, 'projectionIdentity') !== true
    ? initialProjectionDisposition(item.parent) : null;
  await actor.update({
    [`flags.${PROJECTION_SCOPE}.${FLAG}`]: {
      version: 2, casterUuid: item.parent.uuid, abilityUuid: item.uuid,
      ...(Number.isFinite(rules?.baseSpellRangeSpaces) ? { rangeSpaces: rules.baseSpellRangeSpaces } :
        Number.isFinite(previous?.rangeSpaces) ? {rangeSpaces: previous.rangeSpaces} : {})
    },
    [`flags.${PROJECTION_SCOPE}.projectionIdentity`]: true,
    'prototypeToken.actorLink': false,
    ...(disposition !== null ? {'prototypeToken.disposition': disposition} : {})
  });
  return { actor, previous, changed: true };
}

export async function unlinkProjectionActor(item, actor) {
  item = worldProjectionAbility(item);
  const base = worldProjectionActor(actor);
  const link = projectionLink(base);
  if (!validProjectionAbility(item) || link?.version !== 2 ||
    link.casterUuid !== item.parent.uuid || link.abilityUuid !== item.uuid)
    throw new Error('Связь этой Проекции с выбранной способностью не найдена');
  if (!canEdit(item) || !canEdit(item.parent) || !canEdit(base))
    throw new Error('Нет штатного права Foundry на изменение связи');
  await base.unsetFlag(PROJECTION_SCOPE, FLAG);
  return base;
}

export function isProjectionToken(token, caster = null) {
  if (!token?.actor || token?.document?.actorLink !== false) return false;
  const linked = projectionCaster(token.actor);
  return !!linked && (!caster || linked.uuid === caster.uuid);
}

/** Resolve only one controlled origin. No target selection is touched.
 * Ordinary spell use remains possible without a selected Projection.
 */
export function resolveSpellOrigin(caster,{controlled=null,scene=null,allowProjection=true}={}){
  const worldCaster=worldProjectionActor(caster);
  const tokens=controlled??globalThis.canvas?.tokens?.controlled??[];
  const currentScene=scene??globalThis.canvas?.scene??null;
  const casterToken=token=>token.actor?.uuid===caster?.uuid ||
    !caster?.isToken && token.actor?.id===caster?.id;
  const projectionToken=token=>allowProjection && isProjectionToken(token,worldCaster??caster);
  const selected=[...tokens].filter(t=>!currentScene || t?.document?.parent?.id===currentScene.id);
  const valid=selected.filter(t=>casterToken(t) || projectionToken(t));
  let chosen=null,warning=null;
  if(valid.length===1 && (selected.length===1 || !allowProjection)){
    chosen=valid[0];
  } else if(allowProjection && selected.length>1){
    warning='Неоднозначный источник: выделите один токен Колдуна или его Проекции';
  } else if(allowProjection && selected.length===1){
    warning='Выделенный токен не связан с этим Колдуном; используется обычный источник';
  }
  if(!chosen){
    const casterTokens=[...(caster?.getActiveTokens?.()??[])].filter(t=>
      !currentScene || t?.document?.parent?.id===currentScene.id);
    if(casterTokens.length===1)chosen=casterTokens[0];
    else if(allowProjection && casterTokens.length>1)
      warning=warning??'У Колдуна несколько токенов: источник неоднозначен';
  }
  const chosenProjection=chosen && projectionToken(chosen);
  if(chosenProjection){
    // Token remains only a spatial origin. Range is advisory.
    const ownTokens=[...(caster?.getActiveTokens?.()??[])].filter(t=>
      !currentScene || t?.document?.parent?.id===currentScene.id);
    if(ownTokens.length===1){
      const range=Number(projectionLink(chosen.actor)?.rangeSpaces);
      if(Number.isFinite(range) && range>0){
        const grid=globalThis.canvas?.grid;
        const distance=grid?.isSquare
          ? tokenDistance(ownTokens[0],chosen,grid)
          : projectionSpatialPreview({point:ownTokens[0].center},[chosen],{grid}).distanceSpaces;
        if(Number.isFinite(distance) && distance>range)
          warning=`Проекция дальше ${range} клеток от Колдуна (${distance}); по Рулбуку она исчезает`;
      }
    }
  }
  const doc=chosen?.document;
  const center=chosen?.center ?? (doc && globalThis.canvas?.grid?.size ? {
    x:doc.x+(doc.width??1)*globalThis.canvas.grid.size/2,
    y:doc.y+(doc.height??1)*globalThis.canvas.grid.size/2}:null);
  return {
    kind:chosenProjection?'projection':'caster',
    tokenUuid:doc?.uuid??null,sceneId:doc?.parent?.id??null,
    tokenName:chosen?.name??caster?.name??'',
    point:center&&Number.isFinite(center.x)&&Number.isFinite(center.y)?{x:center.x,y:center.y}:null,
    warning
  };
}

/** Measure a known token origin by occupied cells on a square grid. */
export function projectionSpatialPreview(origin,targets=[],{grid=null}={}){
  const selected=[...(targets??[])];
  const target=selected.length===1?selected[0]:null;
  const measureGrid=grid??globalThis.canvas?.grid;
  const scene=(target?.document??target)?.parent;
  if(origin?.sceneId && scene?.id!==origin.sceneId)return {distanceSpaces:null};
  if(measureGrid?.isSquare && origin?.tokenUuid){
    const source=scene?.tokens?.find(token=>token.uuid===origin.tokenUuid);
    return {distanceSpaces:source ? tokenDistance(source,target,measureGrid) : null};
  }
  if(!origin?.point || !target?.center || !measureGrid?.measurePath || measureGrid.isGridless)
    return {distanceSpaces:null};
  try{
    const result=measureGrid.measurePath([origin.point,target.center]);
    return {distanceSpaces:Number.isFinite(result?.spaces)?result.spaces:null};
  }catch{return {distanceSpaces:null};}
}

/** Current AC follows caster; projection retains its own HP/conditions.
 * ActiveEffects and other rules that alter the caster's CURRENT AC are read,
 * not copied to the template or persistently written into token actors.
 */
export function projectionArmorForToken(token){
  const caster=projectionCaster(token?.actor);
  const ac=caster?.system?.ac;
  return ac && [ac.partial,ac.success,ac.great].every(Number.isFinite)
    ? {partial:ac.partial,success:ac.success,great:ac.great} : null;
}
