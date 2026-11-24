import {canReadChatContent,chatAudience,currentMessageMode} from '../data/chat-visibility.mjs';
import {createPrivateAreaSourceMessage} from '../data/private-area-source.mjs';
import {parseAreaDamageProfile} from '../damage/area-damage-profile.mjs';
import {captureAreaOutcomeInstructions} from '../equipment/area-outcome-snapshot.mjs';
import {finishCardAccounting,normalizedCardActionId} from '../data/ability-accounting.mjs';
import {attackAugmentEntries,selectedAttackAugments,attackAugmentWarnings,attackAugmentDamageParts,readAttackAugmentDamageParts} from '../rolls/attack-augmentations.mjs';
import {cardEffectLinks} from '../effects/chat-effect-links.mjs';
import {projectionSpatialPreview,resolveSpellOrigin} from '../projection/projection.mjs';
import {spatialAttackContext} from '../spatial/spatial-context.mjs';
/**
 * Fast NRI 7.0: directed physical weapon attacks with optional native target.
 * Does not change HP, effects, time, resources or document ownership.
 * Weapon fields and damage formulas are owned by the Item; rule core is shared.
 */
import {
  bestiaryAttackExpression, resolveAttackDegree, resolveCheckDegree, naturalAttackingD20, parseStandardPhysicalProfile,
  standardPhysicalPartsForDegree
} from '../rolls/attack-core.mjs';
import {snapshotDamageParts} from '../damage/damage-core.mjs';
import {parseMagicAttackProfile,magicAttackPartsForDegree,magicCombatAttackExpression} from '../rolls/magic-attack-profile.mjs';
import {prepareRoll,finalizeRollEffects,visibleRollInfluences,preparedDamageDefinitions,fixedRollComponents,redactActorSourceForAudience,selectedRollParts} from '../rolls/roll-context.mjs';
import {CHECK_DEFENSES,selectedTargetSnapshot,normalizeAttackKind,effectiveWeaponProperties,explicitInterventionFromCard,messageIntervention,isAreaAttack} from '../rolls/attack-properties.mjs';
import {itemAttackRules} from '../equipment/item-properties.mjs';
import {itemSlot} from '../equipment/equipment.mjs';
import {inheritedAttackTraits} from '../data/racial-properties.mjs';
import {combinedWeaponAttackRules,selectedWeaponTraitIds,
  selectedWeaponPropertyNames,resolveAbilityWeapon,weaponTraitOptions,autoRerollWeaponParts} from '../equipment/weapon-traits.mjs';

export const SYSTEM_ID = 'fast-nri-v14';
const DEGREES = ['partial', 'success', 'great'];
const safe = value => String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
  .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const local = key => game.i18n.localize('FASTNRI.Weapon.' + key);
const tokenDocument = token => token?.document??token;
const isHiddenToken = token => tokenDocument(token)?.hidden===true;
const rerollLabel=key=>game.i18n.localize(`FASTNRI.GameReroll.${key}`);
const autoEntry=(rule,requiresAny=[])=>({requiresAny,uuid:`weapon-auto-reroll:${rule}`,sourceType:'weapon',name:rerollLabel(rule),
  native:false,nativeChanges:[],onUse:'none',actorOwned:false,
  parts:[{id:'auto',kind:'weaponTrait',label:rerollLabel('autoReroll'),defaultEnabled:false,
    value:rule==='catalyst'?`${rerollLabel('traitHint')} · ${rerollLabel('catalystHint')}`:rerollLabel('traitHint')}]});
const autoSelected=(context,rule)=>context.selected.some(e=>e.uuid===`weapon-auto-reroll:${rule}`&&selectedRollParts(e).some(p=>p.id==='auto'));
const autoRerollFlavor=history=>history?.length?` · ${safe(rerollLabel('autoReroll'))}: `+
  history.map(h=>`${safe(rerollLabel(h.rule))} ${safe(h.before.value)} → ${safe(h.after.value)}`).join('; '):'';


/** A single GM-only chat warning for hidden area targets. Never put a hidden
 * target's identity in an attack card, its flags, a public roll or a player
 * notification. The message itself is a native Foundry whisper to GMs. */
async function warnGmHiddenAreaTargets(tokens) {
  if (!game.user?.isGM || !tokens?.length) return;
  const gmIds = (game.users?.contents ?? []).filter(user => user.isGM).map(user => user.id);
  if (!gmIds.length) return;
  const names = tokens.map(token => safe(token?.name ?? token?.document?.name ?? 'Скрытая цель'));
  const list = names.map(name => `<li>${name}</li>`).join('');
  try {
    await ChatMessage.create({
      speaker: {alias: 'Fast NRI'},
      content: `<strong>Скрытые цели исключены из автоматического расчёта области</strong>` +
        `<ul>${list}</ul>`,
      whisper: gmIds,
      blind: false
    });
  } catch (error) {
    console.error('Fast NRI | private hidden area warning failed', error);
    ui.notifications?.warn('Скрытые цели исключены из расчёта области. Предупреждение в скрытом чате не опубликовано.');
  }
}


export function isPhysicalWeaponCard(item) {
  return item?.type === 'weapon' && item.system?.attackKind !== 'focus' &&
    parseStandardPhysicalProfile(item.system?.damageProfile).ok;
}

/** The printed class list suggests *ordinary* proficiency, but explicit card
 * overrides win. This never removes proficiency granted by another ability:
 * such users select 'yes' on their weapon Item (or provide a custom formula).
 */
export function attackExpressionForWeapon(item, actor) {
  const override = String(item?.system?.rollFormula ?? '').trim();
  if (override) return { expression: override, source: 'card-formula', warning: null };
  const bestiary = bestiaryAttackExpression(actor);
  if (bestiary) return { expression: bestiary, source: 'standard', warning: null };
  const mode = String(item?.system?.proficiencyMode ?? 'auto');
  const owners = String(item?.system?.proficiencyClasses ?? '').split(',').map(s=>s.trim()).filter(Boolean);
  const cls = String(actor?.system?.className ?? '').trim();
  const proficient = mode === 'yes' || (mode !== 'no' && cls !== '' && owners.includes(cls));
  const combatRaw = String(actor?.system?.combatDie ?? '').trim();
  const combatDie = /^d([1-9]\d*)$/i.test(combatRaw) ? '1' + combatRaw.toLowerCase() :
    (/^1d([1-9]\d*)$/i.test(combatRaw) ? combatRaw.toLowerCase() : '');
  return {
    expression: proficient && combatDie ? `1d20 + ${combatDie}` : '1d20',
    source: 'standard',
    warning: mode === 'auto' && !cls ? 'unknownProficiency' : null
  };
}

export {selectedTargetSnapshot, naturalAttackingD20};

/** A single chat pipeline for held weapons, other item attacks and unarmed. */
export async function sendAttackSnapshot({actor = null, name, profile, damageType = 'физический',
  properties = '', sourceUuid = null, expression, warning = null, sourceKind = 'weapon', profileKind='physical',
  attackKind = 'melee', criticalMultiplier = null, criticalThreshold=20, targetDefense = 'ac',
  selfDefenseRule=null,isIntervention=false,gripWarning=false,skipPreroll=false,
  formulaForActor=null,usesCombatDie=false,sourceItem=null,weaponItem=null,actionId=null,accountingItem=null,execution=null,audienceMessage=null,targetTokens=null,spatialOrigin=null,
  defenseCheckModifier=0,defenseRemovalOrder='highest',
  greatSelfDefenseModifier=0,rerollWeaponLowOnce=false,catalystDeclared=false} = {}) {
  const validProfile=profileKind==='magic' ? parseMagicAttackProfile(profile).ok :
    profileKind==='physical' && parseStandardPhysicalProfile(profile).ok;
  if (!validProfile) throw new Error('Invalid typed attack profile');
  const usedWeapon=weaponItem??(sourceItem?.type==='weapon'?sourceItem:null);
  const traitOptions=weaponTraitOptions(usedWeapon);
  const sweepingIds=profileKind==='physical'?traitOptions.filter(o=>o.effect?.rerollWeaponLowOnce===true).map(o=>o.id):[];
  const sweepingAvailable=profileKind==='physical'&&(rerollWeaponLowOnce||sweepingIds.length>0);
  const directCatalyst=profileKind==='magic'&&catalystDeclared&&['магический','magical','magic'].includes(String(damageType).trim().toLowerCase());
  const spellAugmentGates=profileKind==='physical'&&heldSpellCatalyst(actor)?attackAugmentEntries(actor,{kind:'attack',weaponItem:usedWeapon,attackKind:normalizeAttackKind(attackKind)})
    .filter(entry=>attackAugmentDamageParts([entry.augment]).some(part=>part.spellDamage&&['магический','magical','magic'].includes(part.damageType.toLowerCase())))
    .map(entry=>({entryUuid:entry.uuid,partId:entry.parts[0].id})):[];
  const prerollEntries=[...(sweepingAvailable&&!sweepingIds.length?[autoEntry('sweeping')]:[]),
    ...(directCatalyst||spellAugmentGates.length?[autoEntry('catalyst',directCatalyst?[]:spellAugmentGates)]:[])];
  // A different target may be selected while the preroll stays open. Lock the
  // declaration's token selection here, independently for each attack.
  const allDeclaredTargets=targetTokens??[...(game.user?.targets??[])];
  const areaDeclared=isAreaAttack(properties);
  // Hidden area targets never participate in chat-facing calculations, even
  // when the main roll is GM-only. A GM may resolve them manually instead.
  const hiddenAreaTargets=areaDeclared ?
    allDeclaredTargets.filter(isHiddenToken) : [];
  const declaredTargets=areaDeclared ?
    allDeclaredTargets.filter(token=>!isHiddenToken(token)) : allDeclaredTargets;
  // Resolve before opening the preroll; later token selection cannot alter this attack.
  spatialOrigin ??= actor ? resolveSpellOrigin(actor,{allowProjection:false}) : null;
  if (spatialOrigin?.warning) ui.notifications?.warn(spatialOrigin.warning);
  // Snapshot geometry at declaration, just like the target and chosen origin.
  // Every calculated attack modifier appears as its own existing preroll checkbox.
  const space=spatialAttackContext({origin:spatialOrigin,targetTokens:declaredTargets,
    weaponItem:usedWeapon,attackKind:normalizeAttackKind(attackKind),properties});
  const distanceSpaces=globalThis.canvas?.grid?.isHexagonal
    ? projectionSpatialPreview(spatialOrigin,declaredTargets).distanceSpaces
    : space.distanceSpaces;
  for(const note of space.warnings) ui.notifications?.warn(note);
  const context = await prepareRoll({actor,kind:'attack',formula:expression,formulaForActor,
    skipDialog:skipPreroll,label:name,sourceItem,weaponItem:usedWeapon,
    attackKind:normalizeAttackKind(attackKind),extraEntries:space.entries,prerollEntries,spatialInfo:space,
    targetActor:!areaDeclared&&declaredTargets.length===1?declaredTargets[0]?.actor:null,
    targetToken:!areaDeclared&&declaredTargets.length===1?declaredTargets[0]:null,
    attackProperties:properties,usesCombatDie});
  if (context === null) return null;
  expression = context.expression;
  // Checkbox choices are resolved BEFORE the attack, then reused by damage,
  // defensive checks and read-only outcome previews for this same attack.
  const hasTraitOptions=traitOptions.length>0;
  const chosenTraitIds=hasTraitOptions?selectedWeaponTraitIds(context,usedWeapon):[];
  const catalystAvailable=directCatalyst||spellAugmentGates.some(gate=>context.selected.some(entry=>entry.uuid===gate.entryUuid&&selectedRollParts(entry).some(part=>part.id===gate.partId)));
  const autoRerollTraits={sweeping:sweepingAvailable&&(sweepingIds.some(id=>chosenTraitIds.includes(id))||autoSelected(context,'sweeping')),
    catalyst:catalystAvailable&&autoSelected(context,'catalyst')};
  // An unchecked auto box leaves the actual weapon property and the manual
  // reroll menu available. Other trait switches retain their previous behavior.
  const selectedTraitIds=hasTraitOptions?[...new Set([...chosenTraitIds,...sweepingIds])]:null;
  const chosenRules=hasTraitOptions?combinedWeaponAttackRules(sourceItem,usedWeapon,selectedTraitIds):null;
  if(chosenRules) {defenseCheckModifier=chosenRules.defenseCheckModifier;
    defenseRemovalOrder=chosenRules.defenseRemovalOrder;
    greatSelfDefenseModifier=chosenRules.greatSelfDefenseModifier;
    rerollWeaponLowOnce=chosenRules.rerollWeaponLowOnce;
    // Show only enabled weapon properties; unrelated ability properties remain.
    const ownProperties=sourceItem && sourceItem!==usedWeapon ? properties.split(',').map(s=>s.trim())
      .filter(Boolean).filter(s=>!weaponTraitOptions(usedWeapon).some(o=>o.label===s)) : [];
    properties=[...ownProperties,...selectedWeaponPropertyNames(usedWeapon,selectedTraitIds)].join(', ');}
  const racialTraits=inheritedAttackTraits(actor,sourceItem,properties);
  properties=[properties,...racialTraits].filter(Boolean).join(', ');
  const attackAugments=selectedAttackAugments(context);
  // Resources/equipment may change while the preroll is open. Recheck at
  // confirmation using the SAME advisory card rules, never disable the roll.
  for(const augment of attackAugments) {
    const warnings=attackAugmentWarnings({actor,weaponItem:usedWeapon,
      attackKind:normalizeAttackKind(attackKind),rule:augment.rule,item:augment.item});
    if(warnings.length)ui.notifications?.warn(`${augment.item.name}: ${warnings.join('; ')}`);
  }
  const sharedActionId=normalizedCardActionId(actionId);
  if (typeof Roll.validate === 'function' && !Roll.validate(expression)) throw new Error('Invalid attack formula');
  const target = selectedTargetSnapshot(declaredTargets,targetDefense);
  const roll = await new Roll(expression, context.actor?.getRollData?.() ?? {}).evaluate();
  const natural = naturalAttackingD20(roll);
  const rollResult = {total:roll.total,naturalD20:natural};
  const degree = target.status === 'one' && natural !== null
    ? targetDefense === 'ac'
      ? resolveAttackDegree({...rollResult,ac:target.ac})
      : resolveCheckDegree({...rollResult,difficulty:target.difficulty})
    : null;
  const suggestion = degree?.ok && degree.degree !== 'failure' ? degree.degree : null;
  const mode = audienceMessage ? (audienceMessage.blind ? 'blind' : (audienceMessage.whisper?.length ? 'gm' : 'public')) : currentMessageMode();
  const areaAudience=areaDeclared ? chatAudience(audienceMessage ?? ChatMessage.applyMode({},mode)) : null;
  const privateAreaSource=areaDeclared && redactActorSourceForAudience(actor,areaAudience);
  const hideSource=privateAreaSource || (!areaDeclared && !!actor && actor.hasPlayerOwner!==true &&
    (audienceMessage ? redactActorSourceForAudience(actor,audienceMessage) : ['public','ic'].includes(mode)));
  const damageAdditions=attackAugmentDamageParts(attackAugments,{redactSources:hideSource});
  // Do not expose hidden GM-controlled token coordinates/UUIDs in a public
  // ChatMessage flag; the caster's selected point remains private in that case.
  const publicOrigin=hideSource&&spatialOrigin ? {kind:spatialOrigin.kind,
    tokenName:spatialOrigin.kind==='projection'?'Проекция':'Источник',
    tokenUuid:null,sceneId:null,point:null} : spatialOrigin;
  const isArea=areaDeclared;
  // The Item, not a hardcoded spell name, owns any exception to the ordinary
  // 2/3-die area profile. Persist validated instructions with THIS attack.
  const rawAreaDamageProfile=isArea ?
    (execution?.attack?.areaDamageProfile ?? sourceItem?.system?.mechanics?.attack?.areaDamageProfile) : null;
  const parsedAreaDamageProfile=rawAreaDamageProfile == null ? null :
    parseAreaDamageProfile(rawAreaDamageProfile);
  if(parsedAreaDamageProfile?.ok===false)
    ui.notifications?.warn('Профиль урона области в карточке не распознан; расчёт по нему недоступен.');
  // Targets here already exclude hidden tokens before preparing preroll and
  // spatial modifiers. No hidden Actor or Token identifiers reach area flags.
  const publishedTargets=declaredTargets;
  const areaTargets=isArea?publishedTargets.map(token=>selectedTargetSnapshot([token],targetDefense)).map((target,index)=>{
    // Resolve once from the declaration snapshot.  Publishing raw AC or
    // defense thresholds as public ChatMessage flags leaks target statistics.
    // Later intervention recalculations only need the original degree.
    const initial=target.status==='one' ? (CHECK_DEFENSES.includes(targetDefense) ?
      resolveCheckDegree({...rollResult,difficulty:target.difficulty}) :
      resolveAttackDegree({...rollResult,ac:target.ac})) : null;
    return {key:target.uuid??`unresolved-${index}`,name:target.name??`Цель ${index+1}`,
      status:target.status,uuid:target.uuid??null,
      initialDegree:initial?.ok?initial.degree:null};
  }):null;
  const data = {
    ...(isArea?{areaAttack:{version:1,targets:areaTargets,selectionManual:true,
      ...(parsedAreaDamageProfile?.ok?{damageProfile:parsedAreaDamageProfile.profile}:{}),
      ...(parsedAreaDamageProfile?.ok===false?{damageProfileInvalid:true}:{})}}:{}),
    version:1, name, sourceUuid:privateAreaSource?null:sourceUuid, sourceKind,
    ...(publicOrigin?.tokenUuid || publicOrigin?.kind==='projection' ? {spatialOrigin:{kind:publicOrigin.kind,
      tokenUuid:publicOrigin.tokenUuid,sceneId:publicOrigin.sceneId,
      point:publicOrigin.point,tokenName:publicOrigin.tokenName,
      distanceSpaces:privateAreaSource?null:distanceSpaces}} : {}),
    ...(attackAugments.length?{attackAugments:attackAugments.map(augment=>({
      name:privateAreaSource?null:augment.item.name,sourceUuid:hideSource?null:augment.sourceUuid
    })),damageAdditions}:{}),
    profile:profileKind==='magic' ? {failure:profile.failure,partial:profile.partial,
      success:profile.success,great:profile.great} : {A:profile.A,B:profile.B,C:profile.C},
    ...(profileKind==='magic'?{profileKind:'magic'}:{}), damageType, properties,
    ...(execution?.attack?.damageRules && typeof execution.attack.damageRules==='object' ?
      {damageRules:{ignoreResistance:execution.attack.damageRules.ignoreResistance===true,
        ignoreTempHp:execution.attack.damageRules.ignoreTempHp===true}} : {}),
    ...(!isArea && space.formation?{spatialConditions:{distanceSpaces:space.distanceSpaces,
      threats:space.formation.threats,formation:space.formation.formation,
      surrounded:space.formation.surrounded,uncertain:space.formation.uncertain,
      defenseAdjusted:target.defenseAdjusted===true,
      hindrance:context.hindrance?.value??null}}:{}),
    targetStatus:isArea?'multiple':target.status, targetName:isArea?null:target.name,
    suggestedDegree:isArea?null:suggestion, attackDegree:isArea?null:(degree?.ok ? degree.degree : null),
    naturalTwenty:degree?.ok ? degree.naturalTwenty : natural === 20,
    naturalD20:natural, attackTotal:roll.total, attackKind:normalizeAttackKind(attackKind),
    targetDefense, selfDefenseRule, isIntervention:!!isIntervention, gripWarning:!!gripWarning,
    defenseCheckModifier,defenseRemovalOrder,greatSelfDefenseModifier,rerollWeaponLowOnce,
    gameRerollTraits:{sweeping:sweepingAvailable,catalyst:catalystAvailable},autoRerollTraits,
    ...(hasTraitOptions?{weaponTraitIds:selectedTraitIds,
      weaponItemUuid:privateAreaSource || actor && actor.hasPlayerOwner!==true && ['public','ic'].includes(mode)
        ? null : usedWeapon.uuid}:{}),
    ...(execution?.id&&!privateAreaSource?{executionId:execution.id}:{}),
    actorUuid:privateAreaSource?null:(actor?.uuid??null),
    rollInfluences:visibleRollInfluences(context,actor,privateAreaSource?'public':mode),
    originalTargetUuid:isArea?null:(target.uuid ?? null), criticalMultiplier,
    criticalThreshold:Number.isInteger(Number(criticalThreshold)) && Number(criticalThreshold)>=1 && Number(criticalThreshold)<=20
      ? Number(criticalThreshold) : 20, warning, mode
  };
  // Area: one attack and one full-damage roll inside the SAME chat document.
  // This is the main result card. No intermediate attack/damage chat spam.
  let areaDamage=null, areaDamageContext=null;
  if(isArea){
    const full=damageFormulaForDegree(data.profile,'great',{profileKind:data.profileKind??'physical'});
    if(!full.ok)throw Error('Invalid full area damage profile');
    const baseParts=[...full.parts.map(part=>({...part,profilePart:part.id})),...readAttackAugmentDamageParts(data.damageAdditions??[])];
    const formula=baseParts.map(p=>p.formula).join(' + ');
    areaDamageContext=await prepareRoll({actor,kind:'damage',formula,skipDialog:skipPreroll,
      label:`${name} · общий урон`,sourceItem,
      weaponItem:usedWeapon});
    if(areaDamageContext===null)return null;
    if(typeof Roll.validate==='function'&&!Roll.validate(areaDamageContext.expression))
      throw Error('Invalid area damage formula');
    const damageRoll=await new Roll(areaDamageContext.expression,
      areaDamageContext.actor?.getRollData?.()??{}).evaluate();
    const defs=preparedDamageDefinitions(baseParts,areaDamageContext);
    const evaluated=snapshotDamageParts(damageRoll,defs,{damageType,properties});
    const autoHistory=await autoRerollWeaponParts(evaluated,data.autoRerollTraits,profileKind);
    const savedParts=hideSource?evaluated.map(part=>({...part,source:null})):evaluated;
    const penaltyComponents=savedParts.filter(part=>part.value<0);
    const storedParts=savedParts.filter(part=>part.value>=0);
    const areaOutcomeInstructions=captureAreaOutcomeInstructions({sourceItem,weaponItem:usedWeapon,
      executionId:execution?.id??null,weaponTraitIds:selectedTraitIds,redact:hideSource});
    areaDamage={roll:damageRoll,card:{version:2,attackMessageId:null,previousMessageId:null,
      name,degree:null,effectDegree:null,profile:data.profile,gameRerollTraits:data.gameRerollTraits,autoRerollTraits:data.autoRerollTraits,
      ...(areaOutcomeInstructions?{areaOutcomeInstructions}:{}),
      // Private NPC source rules are not copied into a public ChatMessage.
      // The authorized GM may resolve the current source Item at application.
      ...(hideSource?{areaOutcomeRedacted:true}:{}),
      ...(data.profileKind==='magic'?{profileKind:'magic'}:{}),sourceUuid:data.sourceUuid,
      ...(data.executionId?{executionId:data.executionId}:{}),
      ...(data.damageRules?{damageRules:data.damageRules}:{}),
      areaAttack:{...data.areaAttack,attackTotal:roll.total,naturalD20:natural,
        profileKind:data.profileKind??'physical'},
      attackKind:data.attackKind,targetDefense,
      sourceActorUuid:data.actorUuid,originalTargetUuid:null,
      attackTotal:roll.total,originalAttackTotal:roll.total,naturalD20:natural,
      defenseCheckModifier,greatSelfDefenseModifier,defenseRemovalOrder,
      damageType,properties,criticalThreshold:Number(criticalThreshold)||20,
      naturalCritMultiplier:Number(criticalMultiplier)>1?Number(criticalMultiplier):2,
      cancelled:false,adjustments:{penalty:-penaltyComponents.reduce((sum,p)=>sum+p.value,0),
        resistance:0,vulnerability:0},penaltyComponents,parts:storedParts,history:autoHistory,revision:0}};
  }
  const speaker = privateAreaSource ? {alias:'Fast NRI'} :
    (actor ? ChatMessage.getSpeaker({actor}) : ChatMessage.getSpeaker());
  const messageData = {
    ...(audienceMessage ? {whisper:[...(audienceMessage.whisper??[])],blind:!!audienceMessage.blind} : {}),
    speaker, flavor:`<strong>${safe(name)}</strong> — ${safe(local('attack'))}`+
      (racialTraits.length ? ` · ${racialTraits.map(safe).join(', ')}` : '')+
      (attackAugments.length&&!privateAreaSource ? ` · ${attackAugments.map(a=>safe(a.item.name)).join(', ')}` : '')+
      (privateAreaSource?'':cardEffectLinks(sourceItem))+
      (publicOrigin?.kind==='projection'?` · через ${safe(publicOrigin.tokenName)}`:'')+
      autoRerollFlavor(areaDamage?.card.history),
    // Preserve the original weaponAttack flag so old messages keep their buttons.
    flags:{[SYSTEM_ID]:{weaponAttack:data,
      ...(areaDamage?{weaponDamage:areaDamage.card}:{}),
      ...(execution?.id&&!privateAreaSource?{abilityExecution:{executionId:execution.id,sourceItemUuid:sourceItem?.uuid??null,actorUuid:actor?.uuid??null}}:{}),
      ...(sharedActionId?{compositeActionId:sharedActionId}:{}),
      fixedRollComponents:fixedRollComponents(context,{redact:privateAreaSource ||
        actor && !actor.hasPlayerOwner && ['public','ic'].includes(mode)})}}
  };
  let message;
  if(areaDamage){
    const chatData=await roll.toMessage(messageData,{create:false,messageMode:mode});
    chatData.rolls=[roll.toJSON(),areaDamage.roll.toJSON()];
    Object.assign(chatData,areaAudience);
    // The damage preroll can stay open while the GM hides an announced target.
    const newlyHidden=declaredTargets.filter(isHiddenToken);
    if (newlyHidden.length) {
      hiddenAreaTargets.push(...newlyHidden);
      const hiddenIds=new Set(newlyHidden.map(token=>tokenDocument(token).uuid));
      const targets=areaTargets.filter(target=>!hiddenIds.has(target.uuid));
      const flags=chatData.flags[SYSTEM_ID];
      flags.weaponAttack.areaAttack.targets=targets;
      flags.weaponDamage.areaAttack.targets=targets;
    }
    message=privateAreaSource ?
      await createPrivateAreaSourceMessage(chatData,actor,{
        itemUuid:sourceUuid,weaponItemUuid:usedWeapon?.uuid??null,executionId:execution?.id??null,
        weaponTraitIds:selectedTraitIds,
        accountingItemUuid:(accountingItem??sourceItem)?.uuid??null,
        augmentItemUuids:attackAugments.map(augment=>augment.item.uuid)
      }) : await ChatMessage.create(chatData);
  }else{
    message=audienceMessage ? await ChatMessage.create({
      ...await roll.toMessage(messageData,{create:false,messageMode:'public'}),
      whisper:[...(audienceMessage.whisper??[])],blind:!!audienceMessage.blind
    }) : await roll.toMessage(messageData,{messageMode:mode});
  }
  await finalizeRollEffects(context,message);
  if(areaDamage)await finalizeRollEffects(areaDamageContext,message);
  await finishCardAccounting({actor,item:accountingItem??sourceItem,message,isIntervention,actionId:sharedActionId,execution});
  // Charge an enhancement once for this attack, never for each degree, damage
  // calculation or HP application. The message id distinguishes two attacks
  // sharing an optional composite action and the same source Item.
  for(const augment of attackAugments) if(augment.item.uuid!==(accountingItem??sourceItem)?.uuid)
    await finishCardAccounting({actor,item:augment.item,message,actionId:message.id});
  // One separate, private GM whisper. Published messages are never updated.
  if (message && hiddenAreaTargets.length)
    await warnGmHiddenAreaTargets(hiddenAreaTargets);
  return message;
}

export async function sendWeaponAttack(item, actor = item?.parent?.documentName === 'Actor' ? item.parent : null,
  {gripWarning=false,skipPreroll=false,actionId=null,accountingItem=null,isIntervention=false,targetTokens=null}={}) {
  if (!isPhysicalWeaponCard(item)) throw new Error('No standard physical weapon profile');
  const {expression, warning} = attackExpressionForWeapon(item,actor);
  return sendAttackSnapshot({actor, name:item.name, profile:item.system.damageProfile,
    damageType:item.system.damageType || 'физический',
    properties:effectiveWeaponProperties(item.system), sourceUuid:item.uuid ?? null,
    expression, warning, gripWarning,skipPreroll,sourceItem:item,weaponItem:item,actionId,accountingItem,sourceKind:'weapon',attackKind:item.system.attackKind,
    formulaForActor:temp=>attackExpressionForWeapon(item,temp).expression,
    usesCombatDie:!String(item.system.rollFormula??'').trim() && actor?.type!=='npc',
    targetDefense:item.system.mechanics?.attack?.targetDefense || 'ac',
    selfDefenseRule:item.system.mechanics?.attack?.selfDefense ?? null,
    isIntervention:isIntervention || explicitInterventionFromCard(item),targetTokens,
    criticalMultiplier:item.system.mechanics?.attack?.criticalMultiplier ?? null,
    criticalThreshold:item.system.mechanics?.attack?.criticalThreshold ?? 20,
    ...itemAttackRules(item)});
}

/** Other attack-capable equipment explicitly defines its profile and roll on its card. */
export function isPhysicalOtherItemAttack(item,actor=item?.parent?.documentName==='Actor'?item.parent:null) {
  const rule = item?.system?.mechanics?.attack;
  const weapon=resolveAbilityWeapon(item,actor);
  const profile=rule?.damageProfile??(weapon?.system?.damageProfile);
  const expression=rule?.rollFormula??item?.system?.rollFormula??'';
  return item?.type !== 'weapon' && rule?.kind === 'physical' &&
    parseStandardPhysicalProfile(profile).ok &&
    (!!String(expression).trim() || !!weapon);
}

/** Detect Catalyst from actual hand slots; no extra declaration dialog. */
export function heldSpellCatalyst(actor){
  return (actor?.items?.contents??[]).some(item=>itemSlot(item.id,actor.system)?.kind==='hand'&&
    weaponTraitOptions(item).some(option=>option.id==='catalyst'));
}

export async function sendOtherItemAttack(item, actor, {skipPreroll=false,actionId=null,accountingItem=null,execution=null,audienceMessage=null,targetTokens=null,spatialOrigin=null,originTokens=null,isIntervention=false}={}) {
  if (!execution && !isPhysicalOtherItemAttack(item,actor)) throw new Error('No applicable item attack');
  // The execution may specialize a card's attack; never rewrite the Item.
  const rule = {...(item.system.mechanics?.attack??{}),...(execution?.attack??{})};
  if(!['physical','magic'].includes(rule.kind))throw new Error('Unknown attack profile kind');
  const magical=rule.kind==='magic';
  const weapon=magical?null:resolveAbilityWeapon(item,actor);
  const profile=rule.damageProfile??weapon?.system?.damageProfile;
  const valid=magical?parseMagicAttackProfile(profile).ok:parseStandardPhysicalProfile(profile).ok;
  if(!valid)throw new Error('Invalid attack execution profile');
  const explicitFormula=String(execution?.formula??rule.rollFormula??item.system.rollFormula??'').trim();
  const formulaForActor=prepared=>explicitFormula || (magical?
    magicCombatAttackExpression(prepared).expression :
    (weapon ? attackExpressionForWeapon(weapon,prepared).expression : ''));
  const expression=formulaForActor(actor);
  if(!expression.trim())throw new Error('Missing attack roll expression');
  const properties=[rule.properties,!magical&&weapon&&effectiveWeaponProperties(weapon.system)]
    .filter(Boolean).join(', ');
  const allowProjection=String(rule.properties??item.system.tags??'').split(/[,;]+/)
    .some(property=>property.trim().toLowerCase()==='заклинание');
  spatialOrigin ??= actor ? resolveSpellOrigin(actor,{controlled:originTokens,allowProjection}) : null;
  const catalystDeclared=magical&&allowProjection&&heldSpellCatalyst(actor);
  return sendAttackSnapshot({actor,name:item.name,profile,profileKind:magical?'magic':'physical',
    damageType:rule.damageType || weapon?.system?.damageType || (magical?'магический':'физический'),
    properties,sourceUuid:item.uuid??null,expression,formulaForActor,catalystDeclared,
    usesCombatDie:!explicitFormula && actor?.type!=='npc' && (magical || !String(weapon?.system?.rollFormula??'').trim()),
    warning:magical&&!explicitFormula?magicCombatAttackExpression(actor).warning:null,
    skipPreroll,sourceItem:item,weaponItem:weapon,actionId,accountingItem,execution,audienceMessage,targetTokens,spatialOrigin,
    sourceKind:item.type==='ability'?'ability':'other',attackKind:rule.attackKind ?? weapon?.system?.attackKind ?? (magical?'ranged':'melee'),
    targetDefense:rule.targetDefense ?? 'ac',selfDefenseRule:rule.selfDefense ?? null,
    isIntervention:isIntervention || (execution?.isIntervention ?? explicitInterventionFromCard(item)),
    criticalMultiplier:rule.criticalMultiplier ?? weapon?.system?.mechanics?.attack?.criticalMultiplier ?? null,
    criticalThreshold:rule.criticalThreshold ?? weapon?.system?.mechanics?.attack?.criticalThreshold ?? 20,
    ...(!magical?itemAttackRules(item):{})});
}

export function damageFormulaForDegree(profile, degree, {profileKind='physical'}={}) {
  if (!DEGREES.includes(degree)) return {ok:false,reason:'invalid-damage-degree'};
  const parts = profileKind==='magic' ? magicAttackPartsForDegree(profile,degree) :
    standardPhysicalPartsForDegree(profile, degree);
  if (!parts.ok) return parts;
  return {ok:true, parts:parts.parts, formula:parts.parts.map(p=>p.formula).join(' + ')};
}

/** Button choice is intentionally never constrained by suggestedDegree. */
/** Optional opt-in reroll of ORIGINAL weapon dice (A/B), never added dice.
 * Ordinary attacks may opt in via preroll or use the shared post-roll menu.
 * The explicit legacy macro may still pass {rerollLowWeaponDice:true}.
 */
export async function sendWeaponDamage(message, degree, {rerollLowWeaponDice=false,skipPreroll=false}={}) {
  if (!canReadChatContent(message)) return null;
  const data = message?.getFlag?.(SYSTEM_ID, 'weaponAttack') ?? message?.flags?.[SYSTEM_ID]?.weaponAttack;
  if (!data || data.version !== 1) throw new Error('Missing weapon attack snapshot');
  if (!game.user?.isGM && !message.isAuthor) throw new Error('Only message author or GM may roll its damage');
  const area= data.areaAttack?.version===1;
  if (area && message.getFlag?.(SYSTEM_ID,'weaponDamage')?.areaAttack?.version===1) return null;
  // Area dice are rolled ONCE for the full profile, not once per target/degree.
  const selected = damageFormulaForDegree(data.profile, area?'great':degree,{profileKind:data.profileKind??'physical'});
  if (!selected.ok) throw new Error('Invalid saved weapon damage profile');
  // Retain the explicit legacy macro opt-in; use shared per-die history.
  // The normal preroll opt-in uses the shared per-die history below.
  const legacyAutoReroll=data.profileKind!=='magic' && data.rerollWeaponLowOnce===true &&
    rerollLowWeaponDice===true;
  // Legacy macro opts into the same tracked automatic reroll as the UI.
  const augmentParts=readAttackAugmentDamageParts(data.damageAdditions??[]);
  const rolledParts=[...selected.parts,...augmentParts].map(part=>
    part.id.startsWith('augment-') ? {...part} : {...part,profilePart:part.id});
  const rolledFormula=rolledParts.map(part=>part.formula).join(' + ');
  const actor = data.actorUuid ? await fromUuid(data.actorUuid) : null;
  const sourceItem = data.sourceUuid ? await fromUuid(data.sourceUuid) : null;
  const sourceWeapon = data.weaponItemUuid ? await fromUuid(data.weaponItemUuid) :
    (sourceItem?.type==='weapon'?sourceItem:null);
  const damageContext = await prepareRoll({actor:actor?.documentName === 'Actor' ? actor : null,
    sourceItem:sourceItem?.documentName === 'Item' ? sourceItem : null,
    weaponItem:sourceWeapon?.type==='weapon'?sourceWeapon:null,
    kind:'damage',formula:rolledFormula,skipDialog:skipPreroll,label:`${data.name} · урон`});
  if (damageContext === null) return null;
  const definitions=preparedDamageDefinitions(rolledParts,damageContext);
  if (typeof Roll.validate === 'function' && !Roll.validate(damageContext.expression))
    throw Error('Invalid damage formula');
  const roll = await new Roll(damageContext.expression,damageContext.actor?.getRollData?.()??{}).evaluate();
  const severityLabel = local(degree);
  const threshold=Number.isInteger(Number(data.criticalThreshold)) && Number(data.criticalThreshold)>=1 && Number(data.criticalThreshold)<=20
    ? Number(data.criticalThreshold) : 20;
  const triggered=!CHECK_DEFENSES.includes(data.targetDefense) &&
    Number.isInteger(data.naturalD20) && data.naturalD20>=threshold;
  const note = triggered ? ` — ${local('criticalNote')}` : '';
  // A and B are separate evaluated dice; C is a separate fixed component.
  // Fail explicitly rather than fabricate individual values from an aggregate.
  const evaluated=snapshotDamageParts(roll,definitions,{damageType:data.damageType,properties:data.properties});
  const autoHistory=await autoRerollWeaponParts(evaluated,{...data.autoRerollTraits,
    ...(legacyAutoReroll?{sweeping:true}:{})},data.profileKind??'physical');
  // Rulebook: negative contributions are penalties AFTER immunities/defenses.
  // Keep their individual evaluated values, but do not expose them as removable dice.
  // A public/whisper-to-player damage report must not persist UUIDs of
  // GM-controlled NPC effects and hidden Item contributions as plain flags.
  // Part ids, formulas, values and damage types remain unchanged, preserving
  // independent damage calculations and the agreed chat presentation.
  const storedParts=redactActorSourceForAudience(actor,message)
    ? evaluated.map(part=>({...part,source:null})) : evaluated;
  const penaltyComponents=storedParts.filter(part=>part.value<0);
  const parts=storedParts.filter(part=>part.value>=0);
  const damagePenalty=-penaltyComponents.reduce((sum,part)=>sum+part.value,0);
  const correctedTotal=message.getFlag?.(SYSTEM_ID,'rollEdit')?.currentTotal;
  const snapshot={version:2,attackMessageId:message.id,previousMessageId:null,
    ...(area?{areaAttack:{...data.areaAttack,targets:data.areaAttack.targets.map(t=>({...t})),
      attackTotal:Number.isFinite(correctedTotal)?correctedTotal:data.attackTotal,
      naturalD20:data.naturalD20,profileKind:data.profileKind??'physical'}}:{}),
    name:data.name,degree,effectDegree:degree,profile:data.profile,
    ...(Array.isArray(data.attackAugments)?{attackAugments:data.attackAugments.map(a=>a.name)}:{}),
    ...(data.profileKind==='magic'?{profileKind:'magic'}:{}),sourceUuid:data.sourceUuid,
    ...(data.executionId?{executionId:data.executionId}:{}),
    ...(data.damageRules?{damageRules:data.damageRules}:{}),
    attackKind:data.attackKind ?? null,targetDefense:data.targetDefense??'ac',
    defenseCheckModifier:data.defenseCheckModifier??0,defenseRemovalOrder:data.defenseRemovalOrder??'highest',
    greatSelfDefenseModifier:data.greatSelfDefenseModifier??0,
    ...(Array.isArray(data.weaponTraitIds)?{weaponTraitIds:data.weaponTraitIds,
      weaponItemUuid:data.weaponItemUuid??null}:{}),
    weaponLowRerollApplied:false,
    gameRerollTraits:data.gameRerollTraits??{sweeping:data.rerollWeaponLowOnce===true,catalyst:data.profileKind==='magic'&&data.weaponTraitIds?.includes('catalyst')===true},
    selfDefenseRule:data.selfDefenseRule??null,isIntervention:messageIntervention(message),
    attackTotal:Number.isFinite(correctedTotal)?correctedTotal:(data.attackTotal ?? message.rolls?.[0]?.total ?? null),
    originalAttackTotal:data.attackTotal ?? message.rolls?.[0]?.total ?? null,
    naturalD20:data.naturalD20 ?? null,sourceActorUuid:data.actorUuid ?? null,
    originalTargetUuid:data.originalTargetUuid ?? null,
    ...(data.spatialOrigin ? {spatialOrigin:data.spatialOrigin} : {}),
    damageType:data.damageType,properties:data.properties,naturalTwenty:!!data.naturalTwenty,
    naturalCritMultiplier:Number(data.criticalMultiplier) > 1 ? Number(data.criticalMultiplier) : 2,
    criticalThreshold:threshold,criticalTriggered:triggered,
    manualCritical:null,manualCritMultiplier:Number(data.criticalMultiplier)>1?Number(data.criticalMultiplier):2,cancelled:false,
    adjustments:{penalty:damagePenalty,resistance:0,vulnerability:0},
    penaltyComponents,parts,history:autoHistory,revision:0};
  // Use Roll.toMessage to construct the native roll card, but do not allow
  // the current client's message mode to replace the original audience.
  const damageTypes=[...new Set(rolledParts.map(part=>part.damageType||data.damageType))].join(' + ');
  const chatData=await roll.toMessage({
    speaker:message.speaker ?? ChatMessage.getSpeaker(),
    flavor:`<strong>${safe(data.name)}</strong> — ${safe(severityLabel)} (${safe(damageTypes)})`+
      (data.attackAugments?.length?` · ${data.attackAugments.map(a=>safe(a.name)).join(', ')}`:'')+
      safe(note)+autoRerollFlavor(autoHistory),
    flags:{[SYSTEM_ID]:{weaponDamage:snapshot,
      ...(normalizedCardActionId(message.getFlag?.(SYSTEM_ID,'compositeActionId'))
        ? {compositeActionId:message.getFlag(SYSTEM_ID,'compositeActionId')} : {})}}
  },{create:false,messageMode:data.mode});
  chatData.whisper=Array.isArray(message.whisper)?[...message.whisper]:[];
  chatData.blind=message.blind===true;
  const result=await ChatMessage.create(chatData);
  await finalizeRollEffects(damageContext,result);
  return result;
}

/** Foundry v14 public hook: message and HTML element, not a jQuery wrapper. */
export function registerWeaponChatControls() {
  Hooks.on('renderChatMessageHTML', (message, html) => {
    const data = message.getFlag?.(SYSTEM_ID,'weaponAttack') ?? message.flags?.[SYSTEM_ID]?.weaponAttack;
    if (!data || data.version !== 1 || message.getFlag?.(SYSTEM_ID,'weaponDamage')?.areaAttack ||
      !(data.profileKind==='magic'?parseMagicAttackProfile(data.profile).ok:
        parseStandardPhysicalProfile(data.profile).ok)) return;
    if (!html?.querySelector) return;
    if (html.querySelector('[data-fnri-weapon-damage]')) return;
    const container = document.createElement('div');
    container.className='fnri-weapon-chat-controls';
    container.dataset.fnriWeaponDamage='';
    const label=document.createElement('div');
    label.className='fnri-weapon-chat-label';
    label.textContent=(data.profileKind==='magic' ?
      `${data.profile.partial}/${data.profile.success}/${data.profile.great}` :
      `${data.profile.A}/${data.profile.B}/+${data.profile.C}`) +
      (data.targetName ? ` · ${data.targetName}` : '');
    container.append(label);
    if (data.attackAugments?.length) {
      const applied=document.createElement('small');
      applied.className='fnri-weapon-chat-label';
      applied.textContent=data.attackAugments.map(a=>a.name).join(', ');
      container.append(applied);
    }
    const row=document.createElement('div');
    row.className='fnri-weapon-chat-buttons';
    for (const degree of (data.areaAttack?.version===1?['great']:DEGREES)) {
      const button=document.createElement('button');
      button.type='button';
      button.dataset.fnriDegree=degree;
      button.className='fnri-weapon-chat-button';
      if (data.suggestedDegree === degree) button.classList.add('fnri-weapon-suggested');
      button.textContent=data.areaAttack?.version===1?'Бросить общий урон':local(degree);
      // Unrelated buttons remain fully usable; visual highlight is advisory.
      button.addEventListener('click',async event=>{
        if (button.dataset.busy === 'true') return;
        button.dataset.busy='true';
        try { await sendWeaponDamage(message,degree,{skipPreroll:!!event?.shiftKey}); }
        catch (error) { console.error('Fast NRI | weapon damage failed',error);
          ui.notifications?.warn(local('damageError')); }
        finally { delete button.dataset.busy; }
      });
      row.append(button);
    }
    container.append(row);
    if (data.warning || (!data.areaAttack && data.targetStatus === 'multiple') || (!data.areaAttack && data.targetStatus === 'missingAC')) {
      const info=document.createElement('small');
      info.className='fnri-weapon-chat-warning';
      const key=data.warning || (data.targetStatus === 'multiple' ? 'multipleTargets' : 'targetWithoutAC');
      info.textContent=local(key);
      container.append(info);
    }
    // Critical damage is displayed as a fully computed total in the damage card.
    // Do not show a stale ×2 note beside the attack; private card thresholds can differ.

    const anchor=html.querySelector('.message-content') ?? html;
    anchor.append(container);
  });
}
