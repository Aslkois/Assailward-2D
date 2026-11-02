import type { Side } from '../sim/types';

// Utilities (global + side pools) and special gadgets (side-exclusive pools).
//
// PROVISIONAL: the original Assailward repository (Aslkois/Assailward) contains no gadget or
// utility specifications, so every value below is an original provisional implementation for
// Assailward 2D. Items flagged `provisional: true` are surfaced as such in the loadout UI and docs.

export type EquipCategory = 'utility' | 'gadget';
export type EquipPool = 'global' | 'attack' | 'defend';
export type EquipUse = 'throw' | 'place' | 'tool' | 'scan';
export type EquipId =
  | 'smoke' | 'flash' | 'frag'
  | 'soft_breach' | 'hard_breach'
  | 'barbed_wire' | 'shield'
  | 'pulse_scanner' | 'emp' | 'hammer' | 'claymore'
  | 'jammer' | 'alarm' | 'bp_camera' | 'impact';

export interface EquipDef {
  id: EquipId;
  name: string;
  short: string;
  category: EquipCategory;
  pool: EquipPool;
  charges: number; // -1 = unlimited
  use: EquipUse;
  provisional: boolean;
  description: string;
  secondaryAction: string; // what right-click does with this item selected
  placeTime?: number;
  fuse?: number;
  radius?: number;
  damage?: number;
  hp?: number;
}

const E = (d: EquipDef): EquipDef => d;

export const EQUIPMENT: Record<EquipId, EquipDef> = {
  // ---------------- Global utility pool ----------------
  smoke: E({
    id: 'smoke', name: 'Smoke Grenade', short: 'SMOKE', category: 'utility', pool: 'global', charges: 2,
    use: 'throw', provisional: true, fuse: 1.3, radius: 68,
    description: 'Bursts into a dense cloud that blocks line of sight for ~12 s.',
    secondaryAction: 'Short underhand roll',
  }),
  flash: E({
    id: 'flash', name: 'Flashbang', short: 'FLASH', category: 'utility', pool: 'global', charges: 2,
    use: 'throw', provisional: true, fuse: 1.4, radius: 230,
    description: 'Blinds anyone with line of sight to the burst. Facing it is worse.',
    secondaryAction: 'Short underhand roll',
  }),
  frag: E({
    id: 'frag', name: 'Frag Grenade', short: 'FRAG', category: 'utility', pool: 'global', charges: 2,
    use: 'throw', provisional: true, fuse: 2.4, radius: 105, damage: 140,
    description: 'Timed fragmentation grenade. Damages operators, barricades and soft walls.',
    secondaryAction: 'Short underhand roll',
  }),
  // ---------------- Attacker utility pool ----------------
  soft_breach: E({
    id: 'soft_breach', name: 'Soft-Breach Charge', short: 'S-BREACH', category: 'utility', pool: 'attack', charges: 2,
    use: 'place', provisional: true, placeTime: 1.0, radius: 34, damage: 80,
    description: 'Place on a barricade or soft wall, then detonate remotely to blow it open.',
    secondaryAction: 'Detonate placed charges',
  }),
  hard_breach: E({
    id: 'hard_breach', name: 'Hard-Breach Charge', short: 'H-BREACH', category: 'utility', pool: 'attack', charges: 1,
    use: 'place', provisional: true, placeTime: 3.0, radius: 30, damage: 100,
    description: 'Thermal charge for reinforced walls only. Long setup, opens a passable hole.',
    secondaryAction: 'Detonate placed charge',
  }),
  // ---------------- Defender utility pool ----------------
  barbed_wire: E({
    id: 'barbed_wire', name: 'Barbed Wire', short: 'WIRE', category: 'utility', pool: 'defend', charges: 2,
    use: 'place', provisional: true, placeTime: 1.0, hp: 80,
    description: 'Floor trap that heavily slows anyone crossing and makes noise.',
    secondaryAction: '-',
  }),
  shield: E({
    id: 'shield', name: 'Deployable Shield', short: 'SHIELD', category: 'utility', pool: 'defend', charges: 1,
    use: 'place', provisional: true, placeTime: 1.0, hp: 500,
    description: 'Waist-high bulletproof cover that blocks movement and bullets (not vision).',
    secondaryAction: '-',
  }),
  // ---------------- Attacker special gadgets ----------------
  pulse_scanner: E({
    id: 'pulse_scanner', name: 'Pulse Scanner', short: 'PULSE', category: 'gadget', pool: 'attack', charges: 3,
    use: 'scan', provisional: true, placeTime: 1.2, radius: 260,
    description: 'Hold fire to scan. Pings defenders within range through walls for your team.',
    secondaryAction: '-',
  }),
  emp: E({
    id: 'emp', name: 'EMP Grenade', short: 'EMP', category: 'gadget', pool: 'attack', charges: 2,
    use: 'throw', provisional: true, fuse: 1.2, radius: 95,
    description: 'Disables defender cameras, jammers, alarms and other electronics for 10 s.',
    secondaryAction: 'Short underhand roll',
  }),
  hammer: E({
    id: 'hammer', name: 'Breaching Hammer', short: 'HAMMER', category: 'gadget', pool: 'attack', charges: -1,
    use: 'tool', provisional: true, damage: 220,
    description: 'Heavy swing that smashes barricades, soft walls, wire and shields.',
    secondaryAction: '-',
  }),
  claymore: E({
    id: 'claymore', name: 'Claymore', short: 'CLAYMORE', category: 'gadget', pool: 'attack', charges: 1,
    use: 'place', provisional: true, placeTime: 0.8, radius: 90, damage: 130, hp: 10,
    description: 'Directional mine. Triggers when a defender walks into its cone.',
    secondaryAction: '-',
  }),
  // ---------------- Defender special gadgets ----------------
  jammer: E({
    id: 'jammer', name: 'Signal Jammer', short: 'JAMMER', category: 'gadget', pool: 'defend', charges: 2,
    use: 'place', provisional: true, placeTime: 0.8, radius: 82, hp: 30,
    description: 'Jams drones, breach-charge detonators and claymores within its radius.',
    secondaryAction: '-',
  }),
  alarm: E({
    id: 'alarm', name: 'Proximity Alarm', short: 'ALARM', category: 'gadget', pool: 'defend', charges: 2,
    use: 'place', provisional: true, placeTime: 0.6, radius: 72, hp: 20,
    description: 'Screams and pings attackers to your team when they come close.',
    secondaryAction: '-',
  }),
  bp_camera: E({
    id: 'bp_camera', name: 'Bulletproof Camera', short: 'BP-CAM', category: 'gadget', pool: 'defend', charges: 1,
    use: 'place', provisional: true, placeTime: 1.0, hp: 60,
    description: 'Wall-mounted camera immune to bullets. Joins the defender camera network.',
    secondaryAction: '-',
  }),
  impact: E({
    id: 'impact', name: 'Impact Grenade', short: 'IMPACT', category: 'gadget', pool: 'defend', charges: 2,
    use: 'throw', provisional: true, fuse: 3.0, radius: 62, damage: 90,
    description: 'Explodes on contact. Great for opening rotation holes in soft walls.',
    secondaryAction: 'Short underhand roll',
  }),
};

export function utilityPoolFor(side: Side): EquipDef[] {
  return Object.values(EQUIPMENT).filter((e) => e.category === 'utility' && (e.pool === 'global' || e.pool === side));
}

export function gadgetPoolFor(side: Side): EquipDef[] {
  return Object.values(EQUIPMENT).filter((e) => e.category === 'gadget' && e.pool === side);
}

export const ELECTRONIC_DEVICES = new Set<string>(['camera', 'bp_camera', 'jammer', 'alarm', 'claymore']);
