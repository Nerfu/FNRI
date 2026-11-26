/**
 * Fast NRI — predictable automatic equipment slots.
 * Pure, side-effect-free update planning; the sheet performs one Actor.update.
 * Existing embedded Items are never deleted or modified by equipping.
 */
export const HANDS = Object.freeze(['leftHand', 'rightHand']);
const validId = id => /^[A-Za-z0-9_-]{1,64}$/.test(String(id ?? ''));
const sequenceValue = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const slotIdFor = itemId => `auto_${itemId}`;

export function itemGrip(item) {
  if (item?.type !== 'weapon') return '1';
  const written = String(item?.system?.grip ?? '').trim();
  if (['1','1+','2'].includes(written)) return written;
  return Number(item?.system?.hands) === 2 ? '2' : '1';
}

/** Card-owned slot overrides take precedence; default gear does not occupy hands. */
export function equipmentKind(item) {
  if (!item || item.type === 'ability') return null;
  const specified = item.system?.mechanics?.equipment?.slot;
  if (['hand', 'armor', 'other'].includes(specified)) return specified;
  if (item.type === 'weapon') return 'hand';
  if (item.type === 'armor') return 'armor';
  if (item.type === 'gear' && /^(щит|shield)$/i.test(String(item.system?.category ?? '').trim())) return 'hand';
  return 'other';
}

export function itemSlot(itemId, system = {}) {
  const gear = system.equipment ?? {};
  const lh = gear.leftHand === itemId, rh = gear.rightHand === itemId;
  if (lh || rh) return { kind: 'hand', positions: lh && rh ? ['leftHand','rightHand'] : [lh ? 'leftHand' : 'rightHand'] };
  if (gear.armor === itemId) return { kind: 'armor', positions: ['armor'] };
  for (const [id, slot] of Object.entries(system.equipmentSlots ?? {})) {
    if (slot?.itemId === itemId) return { kind: 'other', positions: [id], label: slot.name ?? '' };
  }
  return null;
}

/** A persistent monotonic wear order disambiguates the older occupied hand. */
export function planEquipmentChange(system, item, equip = true) {
  if (!item?.id || !validId(item.id)) return { ok: false, reason: 'invalid-item' };
  const kind = equipmentKind(item);
  if (!kind) return { ok: false, reason: 'not-equippable' };
  const equipment = { leftHand: '', rightHand: '', armor: '', ...(system?.equipment ?? {}) };
  const wear = { sequence: 0, leftHand: 0, rightHand: 0, ...(system?.equipmentWear ?? {}) };
  const slots = system?.equipmentSlots ?? {};
  const updates = {};
  const setHand = (hand, id, age = 0) => {
    if (equipment[hand] !== id) {
      equipment[hand] = id;
      updates[`system.equipment.${hand}`] = id;
    }
    if (wear[hand] !== age) {
      wear[hand] = age;
      updates[`system.equipmentWear.${hand}`] = age;
    }
  };
  const setArmor = id => {
    if (equipment.armor !== id) {
      equipment.armor = id;
      updates['system.equipment.armor'] = id;
    }
  };
  // Clear every existing reference first; moving an item never duplicates it.
  for (const hand of HANDS) if (equipment[hand] === item.id) setHand(hand, '', 0);
  if (equipment.armor === item.id) setArmor('');
  for (const [id, slot] of Object.entries(slots)) {
    if (slot?.itemId === item.id && validId(id)) updates[`system.equipmentSlots.${id}.itemId`] = '';
  }
  if (!equip) return { ok: true, updates };
  if (kind === 'armor') {
    setArmor(item.id);
    return { ok: true, updates };
  }
  if (kind === 'other') {
    const id = Object.entries(slots).find(([id, row]) => validId(id) && row?.itemId === item.id)?.[0] ?? slotIdFor(item.id);
    if (!validId(id)) return { ok: false, reason: 'invalid-extra-slot-id' };
    const existing = slots[id];
    if (existing && existing.itemId && existing.itemId !== item.id) return { ok: false, reason: 'extra-slot-conflict' };
    if (existing) updates[`system.equipmentSlots.${id}.itemId`] = item.id;
    else updates[`system.equipmentSlots.${id}`] = {
      name: String(item.system?.mechanics?.equipment?.slotName ?? item.system?.category ?? ''), itemId: item.id
    };
    return { ok: true, updates };
  }
  const next = Math.max(sequenceValue(wear.sequence), sequenceValue(wear.leftHand), sequenceValue(wear.rightHand)) + 1;
  updates['system.equipmentWear.sequence'] = next;
  if (item.type === 'weapon' && itemGrip(item) === '2') {
    setHand('leftHand', item.id, next);
    setHand('rightHand', item.id, next);
    return { ok: true, updates };
  }
  // A two-handed occupant must be removed from BOTH hands as one Item.
  const twoHandedOccupant = equipment.leftHand && equipment.leftHand === equipment.rightHand;
  if (twoHandedOccupant) {
    setHand('leftHand', '', 0);
    setHand('rightHand', '', 0);
  }
  const chosen = !equipment.leftHand ? 'leftHand' : !equipment.rightHand ? 'rightHand' :
    sequenceValue(wear.leftHand) <= sequenceValue(wear.rightHand) ? 'leftHand' : 'rightHand';
  setHand(chosen, item.id, next);
  return { ok: true, updates };
}

export function hasFreeSecondHand(system, slot) {
  const e = system?.equipment ?? {};
  return slot === 'leftHand' ? !e.rightHand : slot === 'rightHand' ? !e.leftHand : false;
}

/** Advisory only: a 1+ weapon needs its other hand free for an ordinary attack.
 * The sheet must show the warning, not suppress an otherwise valid roll. */
export function needsSecondHandWarning(system, item, slot = itemSlot(item?.id, system)) {
  return itemGrip(item) === '1+' && item?.type === 'weapon' &&
    slot?.kind === 'hand' && !hasFreeSecondHand(system, slot.positions[0]);
}

/** Shared ordinary weapon proficiency, independent of roll-formula overrides. */
export function weaponProficiency(item,actor){
  const mode=String(item?.system?.proficiencyMode??'auto');
  const owners=String(item?.system?.proficiencyClasses??'').split(',').map(s=>s.trim()).filter(Boolean);
  const cls=String(actor?.system?.className??'').trim();
  const id=item?.flags?.['fast-nri-v14']?.contentId??item?.getFlag?.('fast-nri-v14','contentId');
  const granted=!!id&&(actor?.items?.contents??[]).some(card=>card.type==='ability'&&
    Array.isArray(card.system?.mechanics?.weaponProficiency?.weaponContentIds)&&card.system.mechanics.weaponProficiency.weaponContentIds.includes(id));
  return {proficient:mode==='yes'||(mode!=='no'&&(granted||!!cls&&owners.includes(cls))),unknown:mode==='auto'&&!cls&&!granted};
}
