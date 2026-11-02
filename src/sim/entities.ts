import { ARMOR, CHAR_MAX_HP, CHAR_RADIUS, DRONES_PER_ATTACKER, type ArmorTier } from '../config/constants';
import { EQUIPMENT, type EquipDef, type EquipId } from '../config/equipment';
import type { Loadout } from '../config/loadouts';
import { WEAPONS, type WeaponDef } from '../config/weapons';
import type { AABB, Vec2 } from './math';
import type { Side, Team } from './types';

export interface WeaponState {
  def: WeaponDef;
  mag: number;
  reserve: number;
  cooldown: number;
  reloadTimer: number;
  reloading: boolean;
  bloom: number;
}

export interface EquipState {
  def: EquipDef;
  charges: number; // -1 = unlimited
}

export type Slot = 1 | 2 | 3 | 4;

export interface Inventory {
  primary: WeaponState;
  secondary: WeaponState;
  utilities: EquipState[];
  gadgets: EquipState[];
  slot: Slot;
  utilIndex: number;
  gadgetIndex: number;
  drones: number; // undeployed drones remaining (attackers)
}

export type CamView = { kind: 'drone'; id: number } | { kind: 'cam'; id: number } | null;

export type ActionKind = 'build_barricade' | 'remove_barricade' | 'reinforce' | 'plant' | 'disable' | 'pickup' | 'place' | 'scan';

export interface HoldAction {
  kind: ActionKind;
  label: string;
  elapsed: number;
  duration: number;
  startPos: Vec2;
  target: number; // doorway / panel / deployable id depending on kind
  via: 'interact' | 'fire';
  placement?: Placement;
  equipId?: EquipId;
  tick: number;
}

export interface Placement {
  ok: boolean;
  reason?: string;
  pos: Vec2;
  facing: number;
  rect?: AABB;
  attachDoorway?: number;
  attachCell?: number;
}

export interface CharStats {
  kills: number;
  deaths: number;
  assists: number;
  damage: number;
  plants: number;
  disables: number;
}

export interface Character {
  id: number;
  name: string;
  team: Team;
  side: Side;
  isPlayer: boolean;
  pos: Vec2;
  vel: Vec2;
  facing: number;
  radius: number;
  hp: number;
  alive: boolean;
  armor: ArmorTier;
  loadout: Loadout;
  inv: Inventory;
  stance: 'stand' | 'crouch';
  quiet: boolean;
  sprinting: boolean;
  ads: boolean;
  moveFrac: number; // current speed / base speed
  recoil: number; // angular aim offset from recoil kick
  swapTimer: number;
  sprintRecover: number;
  meleeCooldown: number;
  meleeAnim: number;
  hammerWindup: number;
  throwCooldown: number;
  action: HoldAction | null;
  interactReady: boolean;
  camView: CamView;
  blindUntil: number;
  blindStrength: number;
  stepAccum: number;
  spawnZone: AABB | null;
  stats: CharStats;
  damageLog: Map<number, { amount: number; time: number }>;
  lastHurtTime: number;
  lastShotTime: number;
  visibleEnemies: number[]; // enemy character ids seen at the last sighting update
  visibleDevices: number[]; // enemy deployable ids (bots use this to clear gadgets)
  visibleDrones: number[];
  message: { text: string; time: number } | null;
}

export interface Drone {
  id: number;
  ownerId: number;
  team: Team;
  pos: Vec2;
  vel: Vec2;
  facing: number;
  alive: boolean;
  jammed: boolean;
}

export type ProjectileKind = 'frag' | 'smoke' | 'flash' | 'emp' | 'impact';

export interface Projectile {
  id: number;
  kind: ProjectileKind;
  ownerId: number;
  team: Team;
  pos: Vec2;
  vel: Vec2;
  fuse: number;
  radius: number;
  alive: boolean;
}

export type DeployKind = 'barbed_wire' | 'shield' | 'soft_breach' | 'hard_breach' | 'jammer' | 'alarm' | 'claymore' | 'camera' | 'bp_camera';

export interface Deployable {
  id: number;
  kind: DeployKind;
  team: Team;
  ownerId: number; // -1 for map-placed cameras
  pos: Vec2;
  facing: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  rect?: AABB;
  disabledUntil: number;
  // cameras
  name?: string;
  baseFacing?: number;
  // breach charges
  attachDoorway?: number;
  attachCell?: number;
  // claymore / alarm
  armedAt: number;
  triggerAt: number;
  lastAlarm: number;
}

export interface Smoke {
  id: number;
  pos: Vec2;
  radius: number;
  maxRadius: number;
  born: number;
  life: number;
}

export type IntelSource = 'sight' | 'cam' | 'drone' | 'mark' | 'scan' | 'alarm';

export interface IntelEntry {
  enemyId: number;
  pos: Vec2;
  time: number;
  expires: number;
  source: IntelSource;
}

export function makeWeaponState(id: string): WeaponState {
  const def = WEAPONS[id];
  return { def, mag: def.magSize, reserve: def.reserve, cooldown: 0, reloadTimer: 0, reloading: false, bloom: 0 };
}

export function makeEquipState(id: EquipId): EquipState {
  const def = EQUIPMENT[id];
  return { def, charges: def.charges };
}

export function makeInventory(l: Loadout, side: Side): Inventory {
  return {
    primary: makeWeaponState(l.primary),
    secondary: makeWeaponState(l.secondary),
    utilities: l.utilities.map(makeEquipState),
    gadgets: l.gadgets.map(makeEquipState),
    slot: 1,
    utilIndex: 0,
    gadgetIndex: 0,
    drones: side === 'attack' ? DRONES_PER_ATTACKER : 0,
  };
}

export function makeCharacter(id: number, name: string, team: Team, side: Side, isPlayer: boolean, loadout: Loadout, pos: Vec2): Character {
  return {
    id, name, team, side, isPlayer,
    pos: { x: pos.x, y: pos.y },
    vel: { x: 0, y: 0 },
    facing: 0,
    radius: CHAR_RADIUS,
    hp: CHAR_MAX_HP,
    alive: true,
    armor: loadout.armor,
    loadout,
    inv: makeInventory(loadout, side),
    stance: 'stand',
    quiet: false,
    sprinting: false,
    ads: false,
    moveFrac: 0,
    recoil: 0,
    swapTimer: 0,
    sprintRecover: 0,
    meleeCooldown: 0,
    meleeAnim: 0,
    hammerWindup: 0,
    throwCooldown: 0,
    action: null,
    interactReady: true,
    camView: null,
    blindUntil: 0,
    blindStrength: 0,
    stepAccum: 0,
    spawnZone: null,
    stats: { kills: 0, deaths: 0, assists: 0, damage: 0, plants: 0, disables: 0 },
    damageLog: new Map(),
    lastHurtTime: -100,
    lastShotTime: -100,
    visibleEnemies: [],
    visibleDevices: [],
    visibleDrones: [],
    message: null,
  };
}

export const armorReduction = (c: Character): number => ARMOR[c.armor].reduction;

// ---------------- Inventory helpers ----------------

export function currentWeapon(c: Character): WeaponState | null {
  if (c.inv.slot === 1) return c.inv.primary;
  if (c.inv.slot === 2) return c.inv.secondary;
  return null;
}

export function currentEquip(c: Character): EquipState | null {
  if (c.inv.slot === 3) return c.inv.utilities[c.inv.utilIndex] ?? null;
  if (c.inv.slot === 4) return c.inv.gadgets[c.inv.gadgetIndex] ?? null;
  return null;
}

/**
 * Slot selection. Pressing 3 or 4 while that category is already selected cycles to the next
 * equipped item in the category. Each item keeps its own charges.
 * Returns true if the held item changed (triggers an equip delay).
 */
export function selectSlot(inv: Inventory, slot: Slot): boolean {
  if (slot === 3) {
    if (inv.slot === 3) {
      if (inv.utilities.length < 2) return false;
      inv.utilIndex = (inv.utilIndex + 1) % inv.utilities.length;
      return true;
    }
    inv.slot = 3;
    return true;
  }
  if (slot === 4) {
    if (inv.slot === 4) {
      if (inv.gadgets.length < 2) return false;
      inv.gadgetIndex = (inv.gadgetIndex + 1) % inv.gadgets.length;
      return true;
    }
    inv.slot = 4;
    return true;
  }
  if (inv.slot === slot) return false;
  inv.slot = slot;
  return true;
}

export function findEquip(c: Character, id: EquipId): { cat: 3 | 4; index: number; state: EquipState } | null {
  const u = c.inv.utilities.findIndex((e) => e.def.id === id);
  if (u >= 0) return { cat: 3, index: u, state: c.inv.utilities[u] };
  const g = c.inv.gadgets.findIndex((e) => e.def.id === id);
  if (g >= 0) return { cat: 4, index: g, state: c.inv.gadgets[g] };
  return null;
}

export function hasCharges(c: Character, id: EquipId): boolean {
  const f = findEquip(c, id);
  return !!f && (f.state.charges > 0 || f.state.charges < 0);
}
