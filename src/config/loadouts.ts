import type { ArmorTier } from './constants';
import { EQUIPMENT, gadgetPoolFor, utilityPoolFor, type EquipId } from './equipment';
import { WEAPONS, weaponsFor } from './weapons';
import type { Rng } from '../sim/rng';
import type { Side } from '../sim/types';

export interface Loadout {
  primary: string;
  secondary: string;
  utilities: [EquipId, EquipId];
  gadgets: [EquipId, EquipId];
  armor: ArmorTier;
}

export function validateLoadout(side: Side, l: Loadout): string[] {
  const errors: string[] = [];
  const p = WEAPONS[l.primary];
  const s = WEAPONS[l.secondary];
  if (!p || p.slot !== 'primary' || !p.sides.includes(side)) errors.push(`Primary ${l.primary} not allowed for ${side}`);
  if (!s || s.slot !== 'secondary' || !s.sides.includes(side)) errors.push(`Secondary ${l.secondary} not allowed for ${side}`);
  const uPool = new Set(utilityPoolFor(side).map((e) => e.id));
  const gPool = new Set(gadgetPoolFor(side).map((e) => e.id));
  if (l.utilities.length !== 2 || l.utilities[0] === l.utilities[1]) errors.push('Pick two different utilities');
  for (const u of l.utilities) if (!uPool.has(u)) errors.push(`Utility ${u} not in ${side} pool`);
  if (l.gadgets.length !== 2 || l.gadgets[0] === l.gadgets[1]) errors.push('Pick two different gadgets');
  for (const g of l.gadgets) if (!gPool.has(g)) errors.push(`Gadget ${g} not in ${side} pool`);
  if (!['light', 'medium', 'heavy'].includes(l.armor)) errors.push('Invalid armor');
  return errors;
}

export function defaultLoadout(side: Side): Loadout {
  return side === 'attack'
    ? { primary: 'ar31', secondary: 'p10', utilities: ['soft_breach', 'flash'], gadgets: ['pulse_scanner', 'hammer'], armor: 'medium' }
    : { primary: 'mastiff', secondary: 'p10', utilities: ['barbed_wire', 'shield'], gadgets: ['jammer', 'alarm'], armor: 'medium' };
}

/** Bot loadouts: random but valid, with a role hint so a team carries enough breaching tools. */
export function botLoadout(side: Side, slotIndex: number, rng: Rng): Loadout {
  const primaries = weaponsFor(side, 'primary');
  const secondaries = weaponsFor(side, 'secondary');
  const armor: ArmorTier = rng.pick(['light', 'medium', 'medium', 'heavy'] as ArmorTier[]);
  if (side === 'attack') {
    // Slot 0: hard breacher; slots 1-2: soft breachers; others: free choice.
    let utilities: [EquipId, EquipId];
    if (slotIndex === 0) utilities = ['hard_breach', rng.pick(['flash', 'smoke'] as EquipId[])];
    else if (slotIndex <= 2) utilities = ['soft_breach', rng.pick(['flash', 'frag', 'smoke'] as EquipId[])];
    else utilities = pickTwo(['frag', 'flash', 'smoke', 'soft_breach'] as EquipId[], rng);
    const gadgets = pickTwo(gadgetPoolFor(side).map((g) => g.id), rng);
    if (slotIndex === 1 && !gadgets.includes('hammer')) gadgets[1] = 'hammer';
    if (gadgets[0] === gadgets[1]) gadgets[1] = gadgetPoolFor(side).map((g) => g.id).find((g) => g !== gadgets[0])!;
    return { primary: rng.pick(primaries).id, secondary: rng.pick(secondaries).id, utilities, gadgets, armor };
  }
  let utilities: [EquipId, EquipId];
  if (slotIndex === 0) utilities = ['shield', 'barbed_wire'];
  else if (slotIndex === 1) utilities = ['barbed_wire', rng.pick(['frag', 'smoke'] as EquipId[])];
  else utilities = pickTwo(utilityPoolFor(side).map((u) => u.id), rng);
  const gadgets = pickTwo(gadgetPoolFor(side).map((g) => g.id), rng);
  return { primary: rng.pick(primaries).id, secondary: rng.pick(secondaries).id, utilities, gadgets, armor };
}

function pickTwo(ids: EquipId[], rng: Rng): [EquipId, EquipId] {
  const pool = rng.shuffle([...ids]);
  return [pool[0], pool[1]];
}

export function describeLoadout(l: Loadout): string {
  return [WEAPONS[l.primary].name, WEAPONS[l.secondary].name, ...l.utilities.map((u) => EQUIPMENT[u].short), ...l.gadgets.map((g) => EQUIPMENT[g].short)].join(' / ');
}
