/**
 * Fast NRI 7.0: directed physical weapon attacks with optional native target.
 * Does not change HP, effects, time, resources or document ownership.
 * Weapon fields and damage formulas are owned by the Item; rule core is shared.
 */
import {
  resolveAttackDegree, parseStandardPhysicalProfile,
  standardPhysicalPartsForDegree
} from '../rolls/attack-core.mjs';
import {snapshotDamageParts} from '../damage/damage-core.mjs';

export const SYSTEM_ID = 'fast-nri-v14';
const DEGREES = ['partial', 'success', 'great'];
const safe = value => String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
  .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const local = key => game.i18n.localize('FASTNRI.Weapon.' + key);

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
    warning: proficient && !combatDie ? 'missingCombatDie' :
      (mode === 'auto' && !cls ? 'unknownProficiency' : null)
  };
}

export function selectedTargetSnapshot(targets) {
  const list = [...(targets ?? [])];
  if (list.length !== 1) return { status: list.length === 0 ? 'none' : 'multiple', name: null };
  const token = list[0];
  const a = token?.actor?.system?.ac;
  if (!a || ![a.partial,a.success,a.great].every(n=>typeof n==='number' && Number.isFinite(n)))
    return { status: 'missingAC', name: token?.name ?? null, uuid:token?.document?.uuid ?? token?.uuid ?? null };
  return { status: 'one', name: token?.name ?? null, uuid: token?.document?.uuid ?? token?.uuid ?? null, ac: {
    partial: a.partial, success: a.success, great: a.great
  }};
}

export function naturalAttackingD20(roll) {
  const ds = roll?.dice ?? [];
  // Nonstandard/ambiguous formulas are never guessed to avoid wrong highlights.
  const d20s = ds.filter(d => d.faces === 20 && d.number === 1);
  if (d20s.length !== 1) return null;
  const results = (d20s[0].results ?? []).filter(r => r.active !== false);
  const n = results.length === 1 ? results[0].result : null;
  return Number.isInteger(n) && n >= 1 && n <= 20 ? n : null;
}

/** A single chat pipeline for held weapons, other item attacks and unarmed. */
export async function sendAttackSnapshot({actor = null, name, profile, damageType = 'физический',
  properties = '', sourceUuid = null, expression, warning = null, sourceKind = 'weapon',
  attackKind = 'melee', criticalMultiplier = null} = {}) {
  if (!parseStandardPhysicalProfile(profile).ok) throw new Error('No standard physical profile');
  if (typeof Roll.validate === 'function' && !Roll.validate(expression)) throw new Error('Invalid attack formula');
  const target = selectedTargetSnapshot(game.user?.targets);
  const roll = await new Roll(expression, actor?.getRollData?.() ?? {}).evaluate();
  const natural = naturalAttackingD20(roll);
  const degree = target.status === 'one' && natural !== null ?
    resolveAttackDegree({total:roll.total,naturalD20:natural,ac:target.ac}) : null;
  const suggestion = degree?.ok && degree.degree !== 'failure' ? degree.degree : null;
  const mode = game.settings.get('core','messageMode');
  const data = {
    version:1, name, sourceUuid, sourceKind,
    profile:{A:profile.A,B:profile.B,C:profile.C}, damageType, properties,
    targetStatus:target.status, targetName:target.name,
    suggestedDegree:suggestion, attackDegree:degree?.ok ? degree.degree : null,
    naturalTwenty:degree?.ok ? degree.naturalTwenty : natural === 20,
    naturalD20:natural, attackTotal:roll.total, attackKind, actorUuid:actor?.uuid ?? null,
    originalTargetUuid:target.uuid ?? null, criticalMultiplier, warning, mode
  };
  const speaker = actor ? ChatMessage.getSpeaker({actor}) : ChatMessage.getSpeaker();
  return roll.toMessage({
    speaker, flavor:`<strong>${safe(name)}</strong> — ${safe(local('attack'))}`,
    // Preserve the original weaponAttack flag so old messages keep their buttons.
    flags:{[SYSTEM_ID]:{weaponAttack:data}}
  },{messageMode:mode});
}

export async function sendWeaponAttack(item, actor = item?.parent?.documentName === 'Actor' ? item.parent : null) {
  if (!isPhysicalWeaponCard(item)) throw new Error('No standard physical weapon profile');
  const {expression, warning} = attackExpressionForWeapon(item,actor);
  return sendAttackSnapshot({actor, name:item.name, profile:item.system.damageProfile,
    damageType:item.system.damageType || 'физический',
    properties:String(item.system.properties ?? ''), sourceUuid:item.uuid ?? null,
    expression, warning, sourceKind:'weapon',attackKind:item.system.attackKind ?? 'melee',
    criticalMultiplier:item.system.mechanics?.attack?.criticalMultiplier ?? null});
}

/** Other attack-capable equipment explicitly defines its profile and roll on its card. */
export function isPhysicalOtherItemAttack(item) {
  const rule = item?.system?.mechanics?.attack;
  return item?.type !== 'weapon' && item?.type !== 'ability' && rule?.kind === 'physical' &&
    parseStandardPhysicalProfile(rule.damageProfile).ok &&
    !!String(rule.rollFormula ?? item.system.rollFormula ?? '').trim();
}

export async function sendOtherItemAttack(item, actor) {
  if (!isPhysicalOtherItemAttack(item)) throw new Error('No physical item attack');
  const rule = item.system.mechanics.attack;
  return sendAttackSnapshot({actor,name:item.name,profile:rule.damageProfile,
    damageType:rule.damageType || 'физический',properties:rule.properties || '',
    sourceUuid:item.uuid ?? null,expression:rule.rollFormula || item.system.rollFormula,
    sourceKind:'other',attackKind:rule.attackKind ?? 'melee',
    criticalMultiplier:rule.criticalMultiplier ?? null});
}

export function damageFormulaForDegree(profile, degree) {
  if (!DEGREES.includes(degree)) return {ok:false,reason:'invalid-damage-degree'};
  const parts = standardPhysicalPartsForDegree(profile, degree);
  if (!parts.ok) return parts;
  return {ok:true, parts:parts.parts, formula:parts.parts.map(p=>p.formula).join(' + ')};
}

/** Button choice is intentionally never constrained by suggestedDegree. */
export async function sendWeaponDamage(message, degree) {
  const data = message?.getFlag?.(SYSTEM_ID, 'weaponAttack') ?? message?.flags?.[SYSTEM_ID]?.weaponAttack;
  if (!data || data.version !== 1) throw new Error('Missing weapon attack snapshot');
  if (!game.user?.isGM && !message.isAuthor) throw new Error('Only message author or GM may roll its damage');
  const selected = damageFormulaForDegree(data.profile, degree);
  if (!selected.ok) throw new Error('Invalid saved weapon damage profile');
  if (typeof Roll.validate === 'function' && !Roll.validate(selected.formula)) throw new Error('Invalid damage formula');
  const roll = await new Roll(selected.formula).evaluate();
  const severityLabel = local(degree);
  const note = data.naturalTwenty ? ` — ${local('criticalNote')}` : '';
  // A and B are separate evaluated dice; C is a separate fixed component.
  // Fail explicitly rather than fabricate individual values from an aggregate.
  const parts=snapshotDamageParts(roll,selected.parts,{damageType:data.damageType,properties:data.properties});
  const correctedTotal=message.getFlag?.(SYSTEM_ID,'rollEdit')?.currentTotal;
  const snapshot={version:2,attackMessageId:message.id,previousMessageId:null,
    name:data.name,degree,effectDegree:degree,sourceUuid:data.sourceUuid,
    attackKind:data.attackKind ?? 'melee',
    attackTotal:Number.isFinite(correctedTotal)?correctedTotal:(data.attackTotal ?? message.rolls?.[0]?.total ?? null),
    originalAttackTotal:data.attackTotal ?? message.rolls?.[0]?.total ?? null,
    naturalD20:data.naturalD20 ?? null,sourceActorUuid:data.actorUuid ?? null,
    originalTargetUuid:data.originalTargetUuid ?? null,
    damageType:data.damageType,properties:data.properties,naturalTwenty:!!data.naturalTwenty,
    naturalCritMultiplier:Number(data.criticalMultiplier) > 0 ? Number(data.criticalMultiplier) : 2,
    manualCritical:null,manualCritMultiplier:2,cancelled:false,
    adjustments:{penalty:0,resistance:0,vulnerability:0},parts,history:[],revision:0};
  return roll.toMessage({
    speaker:message.speaker ?? ChatMessage.getSpeaker(),
    flavor:`<strong>${safe(data.name)}</strong> — ${safe(severityLabel)} (${safe(data.damageType)})${safe(note)}`,
    ...(message.whisper?.length ? {whisper:[...message.whisper]} : {}),
    ...(message.blind ? {blind:true} : {}),
    flags:{[SYSTEM_ID]:{weaponDamage:snapshot}}
  },{messageMode:data.mode});
}

/** Foundry v14 public hook: message and HTML element, not a jQuery wrapper. */
export function registerWeaponChatControls() {
  Hooks.on('renderChatMessageHTML', (message, html) => {
    const data = message.getFlag?.(SYSTEM_ID,'weaponAttack') ?? message.flags?.[SYSTEM_ID]?.weaponAttack;
    if (!data || data.version !== 1 || !parseStandardPhysicalProfile(data.profile).ok) return;
    if (!html?.querySelector) return;
    if (html.querySelector('[data-fnri-weapon-damage]')) return;
    const container = document.createElement('div');
    container.className='fnri-weapon-chat-controls';
    container.dataset.fnriWeaponDamage='';
    const label=document.createElement('div');
    label.className='fnri-weapon-chat-label';
    label.textContent=`${data.profile.A}/${data.profile.B}/+${data.profile.C}` + (data.targetName ? ` · ${data.targetName}` : '');
    container.append(label);
    const row=document.createElement('div');
    row.className='fnri-weapon-chat-buttons';
    for (const degree of DEGREES) {
      const button=document.createElement('button');
      button.type='button';
      button.dataset.fnriDegree=degree;
      button.className='fnri-weapon-chat-button';
      if (data.suggestedDegree === degree) button.classList.add('fnri-weapon-suggested');
      button.textContent=local(degree);
      // Unrelated buttons remain fully usable; visual highlight is advisory.
      button.addEventListener('click',async()=>{
        if (button.dataset.busy === 'true') return;
        button.dataset.busy='true';
        try { await sendWeaponDamage(message,degree); }
        catch (error) { console.error('Fast NRI | weapon damage failed',error);
          ui.notifications?.warn(local('damageError')); }
        finally { delete button.dataset.busy; }
      });
      row.append(button);
    }
    container.append(row);
    if (data.warning || data.targetStatus === 'multiple' || data.targetStatus === 'missingAC') {
      const info=document.createElement('small');
      info.className='fnri-weapon-chat-warning';
      const key=data.warning || (data.targetStatus === 'multiple' ? 'multipleTargets' : 'targetWithoutAC');
      info.textContent=local(key);
      container.append(info);
    }
    if (data.naturalTwenty) {
      const info=document.createElement('small');
      info.className='fnri-weapon-chat-warning'; info.textContent=local('criticalNote'); container.append(info);
    }
    const anchor=html.querySelector('.message-content') ?? html;
    anchor.append(container);
  });
}
