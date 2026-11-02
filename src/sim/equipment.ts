import { CELL, CHAR_RADIUS, DRONE_RADIUS, DRONE_SPEED } from '../config/constants';
import { EQUIPMENT, ELECTRONIC_DEVICES, type EquipId } from '../config/equipment';
import { radialSegmentDamage } from './barricade';
import { BODY_COLLISION, circleBlocked, DRONE_COLLISION, moveCircle } from './collision';
import { computeExplosionDamage } from './damage';
import {
  armorReduction,
  findEquip,
  type Character,
  type DeployKind,
  type Drone,
  type EquipState,
  type HoldAction,
  type Placement,
  type ProjectileKind,
} from './entities';
import { aabbOverlap, angleDiff, angleTo, circleAABBOverlap, fromAngle, type AABB, type Vec2 } from './math';
import { MAT } from './map';
import { castStatic } from './raycast';
import { lineOfSight } from './sight';
import type { Intent, Team } from './types';
import type { World } from './world';

const THROW_FRICTION = 2.2;

// ------------------------------------------------------------------ using the held item

export function useEquipment(world: World, ch: Character, eq: EquipState, it: Intent): void {
  const def = eq.def;
  if (ch.sprinting || ch.sprintRecover > 0 || ch.swapTimer > 0 || ch.action) {
    if (def.use === 'place' && it.secondaryPressed && (def.id === 'soft_breach' || def.id === 'hard_breach')) detonateCharges(world, ch, def.id);
    return;
  }
  switch (def.use) {
    case 'throw': {
      if ((it.firePressed || it.secondaryPressed) && ch.throwCooldown <= 0) {
        if (eq.charges === 0) {
          world.message(ch, `No ${def.name} left`);
          return;
        }
        throwProjectile(world, ch, def.id as ProjectileKind, it.aim, it.secondaryPressed && !it.firePressed);
        eq.charges--;
        ch.throwCooldown = 0.8;
      }
      return;
    }
    case 'place': {
      if (it.secondaryPressed && (def.id === 'soft_breach' || def.id === 'hard_breach')) {
        detonateCharges(world, ch, def.id);
        return;
      }
      if (!it.firePressed) return;
      if (eq.charges === 0) {
        world.message(ch, `No ${def.name} left`);
        return;
      }
      const p = findPlacement(world, ch, def.id);
      if (!p.ok) {
        world.message(ch, p.reason ?? 'Cannot place here');
        return;
      }
      ch.action = {
        kind: 'place', label: `Placing ${def.name}`, elapsed: 0, duration: def.placeTime ?? 1, startPos: { x: ch.pos.x, y: ch.pos.y },
        target: -1, via: 'fire', placement: p, equipId: def.id, tick: 0,
      };
      return;
    }
    case 'tool': {
      if (it.firePressed && ch.meleeCooldown <= 0 && ch.hammerWindup <= 0) ch.hammerWindup = 0.35;
      return;
    }
    case 'scan': {
      if (!it.firePressed) return;
      if (eq.charges === 0) {
        world.message(ch, `No ${def.name} charges left`);
        return;
      }
      ch.action = {
        kind: 'scan', label: 'Scanning...', elapsed: 0, duration: def.placeTime ?? 1.2, startPos: { x: ch.pos.x, y: ch.pos.y },
        target: -1, via: 'fire', equipId: def.id, tick: 0,
      };
    }
  }
}

// ------------------------------------------------------------------ placement

const WIRE_SIZE = 46;
const SHIELD_LONG = 44;
const SHIELD_SHORT = 8;

function rectFree(world: World, r: AABB, allowDoorway = true): boolean {
  const m = world.map;
  for (let cy = m.toCell(r.y0); cy <= m.toCell(r.y1 - 0.01); cy++) {
    for (let cx = m.toCell(r.x0); cx <= m.toCell(r.x1 - 0.01); cx++) {
      if (m.isSolid(cx, cy)) return false;
      if (!allowDoorway && m.doorOf[m.idx(cx, cy)] >= 0) return false;
    }
  }
  return true;
}

export function findPlacement(world: World, ch: Character, id: EquipId): Placement {
  const dir = fromAngle(ch.facing);
  const reach = ch.radius + 26;
  const fail = (reason: string): Placement => ({ ok: false, reason, pos: ch.pos, facing: ch.facing });
  switch (id) {
    case 'soft_breach':
    case 'hard_breach': {
      const hit = castStatic(world.map, ch.pos.x, ch.pos.y, dir.x, dir.y, reach, true);
      if (hit.kind === 'none') return fail(id === 'soft_breach' ? 'Aim at a barricade or soft wall' : 'Aim at a reinforced wall');
      const pos = { x: ch.pos.x + dir.x * (hit.t - 3), y: ch.pos.y + dir.y * (hit.t - 3) };
      if (hit.kind === 'barricade') {
        if (id === 'hard_breach') return fail('Hard breach is for reinforced walls');
        return { ok: true, pos, facing: ch.facing, attachDoorway: hit.doorwayId };
      }
      const mat = world.map.matAt(hit.cx, hit.cy);
      if (id === 'soft_breach') {
        if (mat === MAT.SOFT) return { ok: true, pos, facing: ch.facing, attachCell: world.map.idx(hit.cx, hit.cy) };
        if (mat === MAT.REINF) return fail('Reinforced: needs a hard-breach charge');
        return fail('This surface is not breachable');
      }
      if (mat === MAT.REINF) return { ok: true, pos, facing: ch.facing, attachCell: world.map.idx(hit.cx, hit.cy) };
      return fail('Hard breach needs a reinforced wall');
    }
    case 'barbed_wire': {
      const c = { x: ch.pos.x + dir.x * 30, y: ch.pos.y + dir.y * 30 };
      const r = { x0: c.x - WIRE_SIZE / 2, y0: c.y - WIRE_SIZE / 2, x1: c.x + WIRE_SIZE / 2, y1: c.y + WIRE_SIZE / 2 };
      if (!rectFree(world, r)) return fail('Not enough floor space');
      if (world.deployables.some((d) => d.alive && d.kind === 'barbed_wire' && d.rect && aabbOverlap(d.rect, r))) return fail('Overlaps other wire');
      return { ok: true, pos: c, facing: ch.facing, rect: r };
    }
    case 'shield': {
      const c = { x: ch.pos.x + dir.x * 24, y: ch.pos.y + dir.y * 24 };
      const vertical = Math.abs(dir.x) >= Math.abs(dir.y);
      const hw = vertical ? SHIELD_SHORT / 2 : SHIELD_LONG / 2;
      const hh = vertical ? SHIELD_LONG / 2 : SHIELD_SHORT / 2;
      const r = { x0: c.x - hw, y0: c.y - hh, x1: c.x + hw, y1: c.y + hh };
      if (!rectFree(world, r)) return fail('Not enough room for a shield');
      if (world.solidDeployableRects().some((o) => aabbOverlap(o, r))) return fail('Overlaps another shield');
      if (world.chars.some((o) => o.alive && circleAABBOverlap(o.pos.x, o.pos.y, o.radius, r))) return fail('Someone is in the way');
      return { ok: true, pos: c, facing: ch.facing, rect: r };
    }
    case 'jammer':
    case 'alarm':
    case 'claymore': {
      const c = { x: ch.pos.x + dir.x * 16, y: ch.pos.y + dir.y * 16 };
      if (circleBlocked(world, c.x, c.y, 4, BODY_COLLISION)) return fail('Blocked');
      return { ok: true, pos: c, facing: ch.facing };
    }
    case 'bp_camera': {
      const hit = castStatic(world.map, ch.pos.x, ch.pos.y, dir.x, dir.y, reach, false);
      if (hit.kind !== 'cell') return fail('Aim at a wall to mount the camera');
      const pos = { x: ch.pos.x + dir.x * (hit.t - 4), y: ch.pos.y + dir.y * (hit.t - 4) };
      return { ok: true, pos, facing: ch.facing + Math.PI };
    }
    default:
      return fail('Cannot place');
  }
}

let bpCamCount = 0;

export function completePlacement(world: World, ch: Character, a: HoldAction): void {
  const p = a.placement!;
  const id = a.equipId!;
  const eq = findEquip(ch, id);
  if (!eq || eq.state.charges === 0) return;
  // Re-validate (the world may have changed while placing).
  const again = findPlacement(world, ch, id);
  if (!again.ok) {
    world.message(ch, again.reason ?? 'Placement blocked');
    return;
  }
  const def = EQUIPMENT[id];
  const kind = id as DeployKind;
  const hp = def.hp ?? 40;
  const d = world.makeDeployable(kind, ch.team, ch.id, again.pos, again.facing, hp, id === 'bp_camera' ? `BP-Cam ${++bpCamCount}` : undefined);
  d.rect = again.rect ?? p.rect;
  d.attachDoorway = again.attachDoorway;
  d.attachCell = again.attachCell;
  d.armedAt = world.time + (id === 'claymore' ? 1.2 : 0);
  world.deployables.push(d);
  if (kind === 'shield') world.invalidateSolids();
  if (eq.state.charges > 0) eq.state.charges--;
  world.emit({ type: 'deploy', id: d.id, kind, team: ch.team, pos: d.pos });
  world.sound(d.pos, 160, 'deploy', ch.id, ch.team);
}

export function completeScan(world: World, ch: Character): void {
  const eq = findEquip(ch, 'pulse_scanner');
  if (!eq || eq.state.charges === 0) return;
  eq.state.charges--;
  const r = EQUIPMENT.pulse_scanner.radius ?? 260;
  let found = 0;
  for (const e of world.chars) {
    if (!e.alive || e.team === ch.team) continue;
    if (Math.hypot(e.pos.x - ch.pos.x, e.pos.y - ch.pos.y) <= r) {
      world.addIntel(ch.team, e, 'scan');
      found++;
    }
  }
  world.emit({ type: 'scan', charId: ch.id, pos: { x: ch.pos.x, y: ch.pos.y }, team: ch.team, found });
}

// ------------------------------------------------------------------ breach charges

export function detonateCharges(world: World, ch: Character, kind: 'soft_breach' | 'hard_breach'): void {
  const charges = world.deployables.filter((d) => d.alive && d.kind === kind && d.ownerId === ch.id);
  if (!charges.length) {
    world.message(ch, 'No charge placed');
    return;
  }
  for (const c of charges) {
    if (world.jammedAt(c.pos, ch.team)) {
      world.emit({ type: 'jammed', pos: c.pos, team: ch.team });
      world.message(ch, 'Charge jammed by a signal jammer!');
      continue;
    }
    c.alive = false;
    if (kind === 'soft_breach') {
      if (c.attachDoorway !== undefined) {
        const d = world.map.doorways[c.attachDoorway];
        if (d.barricade?.complete) {
          const all = new Map<number, number>();
          d.barricade.segments.forEach((hp, i) => hp > 0 && all.set(i, 9999));
          world.damageBarricade(d.id, all, ch.team, c.pos);
        }
      }
      explode(world, {
        pos: c.pos, radius: 64, damage: EQUIPMENT.soft_breach.damage ?? 80, ownerId: ch.id, team: ch.team, cause: 'Soft-Breach Charge',
        wallRadius: EQUIPMENT.soft_breach.radius ?? 34, wallDamage: 9999, barricadeRadius: 30, barricadeDamage: 9999, kind: 'soft_breach',
      });
    } else {
      explode(world, {
        pos: c.pos, radius: 72, damage: EQUIPMENT.hard_breach.damage ?? 100, ownerId: ch.id, team: ch.team, cause: 'Hard-Breach Charge',
        wallRadius: EQUIPMENT.hard_breach.radius ?? 30, wallDamage: 9999, hardBreach: true, barricadeRadius: 30, barricadeDamage: 9999, kind: 'hard_breach',
      });
    }
  }
}

// ------------------------------------------------------------------ explosions & effects

export interface ExplosionSpec {
  pos: Vec2;
  radius: number;
  damage: number;
  ownerId: number;
  team: Team;
  cause: string;
  wallRadius: number;
  wallDamage: number;
  hardBreach?: boolean;
  barricadeRadius: number;
  barricadeDamage: number;
  kind: string;
}

export function explode(world: World, e: ExplosionSpec): void {
  const m = world.map;
  // 1) structure first, so the blast reaches whoever stood behind a wall it just destroyed
  const destroyed: number[] = [];
  const r = Math.ceil(e.wallRadius / CELL) + 1;
  const ccx = m.toCell(e.pos.x);
  const ccy = m.toCell(e.pos.y);
  for (let cy = ccy - r; cy <= ccy + r; cy++) {
    for (let cx = ccx - r; cx <= ccx + r; cx++) {
      if (!m.inBounds(cx, cy)) continue;
      const c = m.cellCenter(cx, cy);
      const d = Math.hypot(c.x - e.pos.x, c.y - e.pos.y);
      if (d > e.wallRadius) continue;
      const mat = m.matAt(cx, cy);
      if (mat === MAT.SOFT) {
        if (world.damageCell(cx, cy, e.wallDamage * (1 - 0.5 * (d / e.wallRadius)), e.team)) destroyed.push(m.idx(cx, cy));
      } else if (mat === MAT.REINF && e.hardBreach) {
        if (m.destroyCell(cx, cy)) destroyed.push(m.idx(cx, cy));
      }
    }
  }
  if (destroyed.length) {
    world.emit({ type: 'wall', cells: destroyed, action: 'destroyed', team: e.team, pos: e.pos });
  }
  for (const d of m.doorways) {
    if (!d.barricade?.complete) continue;
    if (Math.hypot(d.center.x - e.pos.x, d.center.y - e.pos.y) > e.barricadeRadius + d.width) continue;
    const dmg = radialSegmentDamage(d, e.pos, e.barricadeRadius, e.barricadeDamage);
    if (dmg.size) world.damageBarricade(d.id, dmg, e.team, e.pos);
  }
  // 2) operators (no friendly damage; your own explosives do hurt you)
  for (const c of world.chars) {
    if (!c.alive) continue;
    if (c.team === e.team && c.id !== e.ownerId) continue;
    const dist = Math.hypot(c.pos.x - e.pos.x, c.pos.y - e.pos.y);
    if (dist > e.radius + c.radius) continue;
    if (!explosionReaches(world, e.pos, c.pos)) continue;
    const dmg = computeExplosionDamage(e.damage, Math.max(0, dist - c.radius * 0.5), e.radius, armorReduction(c));
    world.damageCharacter(c, dmg, e.ownerId, e.cause, { pos: c.pos });
  }
  // 3) enemy devices & drones
  for (const d of world.deployables) {
    if (!d.alive || d.team === e.team || d.kind === 'soft_breach' || d.kind === 'hard_breach') continue;
    const p = d.rect ? { x: Math.max(d.rect.x0, Math.min(e.pos.x, d.rect.x1)), y: Math.max(d.rect.y0, Math.min(e.pos.y, d.rect.y1)) } : d.pos;
    const dist = Math.hypot(p.x - e.pos.x, p.y - e.pos.y);
    if (dist > e.radius) continue;
    world.damageDeployable(d, e.damage * 3 * (1 - dist / e.radius) + 20, e.team, 'explosion');
  }
  for (const dr of world.drones) {
    if (dr.alive && dr.team !== e.team && Math.hypot(dr.pos.x - e.pos.x, dr.pos.y - e.pos.y) <= e.radius) world.destroyDrone(dr);
  }
  world.emit({ type: 'explosion', pos: { x: e.pos.x, y: e.pos.y }, radius: e.radius, kind: e.kind, team: e.team });
  world.sound(e.pos, 1000, 'explosion', e.ownerId, e.team);
}

function explosionReaches(world: World, from: Vec2, to: Vec2): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const l = Math.hypot(dx, dy);
  if (l < 1) return true;
  const hit = castStatic(world.map, from.x, from.y, dx / l, dy / l, l, false);
  return hit.kind === 'none' || hit.t >= l - CHAR_RADIUS;
}

function flash(world: World, pos: Vec2, team: Team): void {
  const radius = EQUIPMENT.flash.radius ?? 230;
  for (const c of world.chars) {
    if (!c.alive || c.team === team) continue;
    const d = Math.hypot(c.pos.x - pos.x, c.pos.y - pos.y);
    if (d > radius || !lineOfSight(world, pos, c.pos, false)) continue;
    const facingToward = Math.abs(angleDiff(c.facing, angleTo(c.pos, pos))) < Math.PI / 3;
    const strength = (1 - d / radius) * (facingToward ? 1 : 0.45) + (d < 60 ? 0.3 : 0);
    if (strength < 0.12) continue;
    const s = Math.min(1, strength);
    c.blindStrength = Math.max(c.blindStrength * (c.blindUntil > world.time ? 1 : 0), s);
    c.blindUntil = Math.max(c.blindUntil, world.time + 0.5 + 3.4 * s);
    if (c.action && c.action.kind !== 'plant' && c.action.kind !== 'disable') c.action = null;
  }
  world.emit({ type: 'flash', pos: { x: pos.x, y: pos.y }, team });
  world.sound(pos, 800, 'explosion', -1, team);
}

function emp(world: World, pos: Vec2, team: Team): void {
  const radius = EQUIPMENT.emp.radius ?? 95;
  for (const d of world.deployables) {
    if (!d.alive || d.team === team || !ELECTRONIC_DEVICES.has(d.kind)) continue;
    if (Math.hypot(d.pos.x - pos.x, d.pos.y - pos.y) <= radius) d.disabledUntil = world.time + 10;
  }
  world.emit({ type: 'emp', pos: { x: pos.x, y: pos.y }, radius, team });
  world.sound(pos, 300, 'deploy', -1, team);
}

// ------------------------------------------------------------------ throwables

export function throwProjectile(world: World, ch: Character, kind: ProjectileKind, aim: Vec2, short: boolean): void {
  const dir = fromAngle(ch.facing);
  const want = Math.hypot(aim.x - ch.pos.x, aim.y - ch.pos.y);
  const distance = Math.max(30, Math.min(want, short ? 110 : 340));
  const start = { x: ch.pos.x + dir.x * (ch.radius + 4), y: ch.pos.y + dir.y * (ch.radius + 4) };
  const pos = circleBlocked(world, start.x, start.y, 3, BODY_COLLISION) ? { x: ch.pos.x, y: ch.pos.y } : start;
  const v0 = distance * THROW_FRICTION;
  world.projectiles.push({
    id: world.newId(), kind, ownerId: ch.id, team: ch.team, pos, vel: { x: dir.x * v0, y: dir.y * v0 },
    fuse: EQUIPMENT[kind].fuse ?? 2, radius: 3, alive: true,
  });
  world.emit({ type: 'throw', charId: ch.id, kind, pos });
}

export function updateProjectiles(world: World, dt: number): void {
  for (const p of world.projectiles) {
    if (!p.alive) continue;
    p.fuse -= dt;
    const f = Math.exp(-THROW_FRICTION * dt);
    p.vel.x *= f;
    p.vel.y *= f;
    const speed = Math.hypot(p.vel.x, p.vel.y);
    let bounced = false;
    const steps = Math.max(1, Math.ceil((speed * dt) / 2));
    for (let s = 0; s < steps; s++) {
      const nx = p.pos.x + (p.vel.x * dt) / steps;
      if (circleBlocked(world, nx, p.pos.y, p.radius, BODY_COLLISION)) {
        p.vel.x = -p.vel.x * 0.45;
        bounced = true;
      } else p.pos.x = nx;
      const ny = p.pos.y + (p.vel.y * dt) / steps;
      if (circleBlocked(world, p.pos.x, ny, p.radius, BODY_COLLISION)) {
        p.vel.y = -p.vel.y * 0.45;
        bounced = true;
      } else p.pos.y = ny;
    }
    if (bounced && speed > 40) world.emit({ type: 'bounce', pos: { x: p.pos.x, y: p.pos.y } });
    let detonate = p.fuse <= 0;
    if (p.kind === 'impact') {
      if (bounced) detonate = true;
      for (const c of world.chars) {
        if (c.alive && c.team !== p.team && Math.hypot(c.pos.x - p.pos.x, c.pos.y - p.pos.y) < c.radius + p.radius) detonate = true;
      }
      if (speed < 15) detonate = true;
    }
    if (detonate) detonateProjectile(world, p.kind, p.pos, p.ownerId, p.team, p);
  }
  world.projectiles = world.projectiles.filter((p) => p.alive);
}

function detonateProjectile(world: World, kind: ProjectileKind, pos: Vec2, ownerId: number, team: Team, p: { alive: boolean }): void {
  p.alive = false;
  switch (kind) {
    case 'frag':
      explode(world, { pos, radius: EQUIPMENT.frag.radius ?? 105, damage: EQUIPMENT.frag.damage ?? 140, ownerId, team, cause: 'Frag Grenade', wallRadius: 22, wallDamage: 160, barricadeRadius: 44, barricadeDamage: 130, kind: 'frag' });
      break;
    case 'impact':
      explode(world, { pos, radius: EQUIPMENT.impact.radius ?? 62, damage: EQUIPMENT.impact.damage ?? 90, ownerId, team, cause: 'Impact Grenade', wallRadius: 30, wallDamage: 260, barricadeRadius: 46, barricadeDamage: 220, kind: 'impact' });
      break;
    case 'smoke':
      world.smokes.push({ id: world.newId(), pos: { x: pos.x, y: pos.y }, radius: 6, maxRadius: EQUIPMENT.smoke.radius ?? 68, born: world.time, life: 12 });
      world.emit({ type: 'smoke', pos: { x: pos.x, y: pos.y } });
      world.sound(pos, 220, 'deploy', ownerId, team);
      break;
    case 'flash':
      flash(world, pos, team);
      break;
    case 'emp':
      emp(world, pos, team);
      break;
  }
}

export function updateSmokes(world: World, dt: number): void {
  void dt;
  for (const s of world.smokes) {
    const age = world.time - s.born;
    const grow = Math.min(1, age / 1.0);
    const fade = age > s.life - 2 ? Math.max(0, (s.life - age) / 2) : 1;
    s.radius = s.maxRadius * grow * (0.35 + 0.65 * fade);
  }
  world.smokes = world.smokes.filter((s) => world.time - s.born < s.life);
}

// ------------------------------------------------------------------ drones

export function deployDrone(world: World, ch: Character): Drone | null {
  if (ch.inv.drones <= 0) return null;
  const dir = fromAngle(ch.facing);
  let pos = { x: ch.pos.x + dir.x * (ch.radius + DRONE_RADIUS + 2), y: ch.pos.y + dir.y * (ch.radius + DRONE_RADIUS + 2) };
  if (circleBlocked(world, pos.x, pos.y, DRONE_RADIUS, DRONE_COLLISION)) pos = { x: ch.pos.x, y: ch.pos.y };
  const dr: Drone = { id: world.newId(), ownerId: ch.id, team: ch.team, pos, vel: { x: dir.x * 240, y: dir.y * 240 }, facing: ch.facing, alive: true, jammed: false };
  world.drones.push(dr);
  ch.inv.drones--;
  world.emit({ type: 'drone', action: 'deploy', id: dr.id, pos, team: ch.team });
  world.sound(pos, 120, 'drone', -1, ch.team);
  return dr;
}

const droneNoise = new Map<number, number>();

export function updateDrones(world: World, intents: Map<number, Intent>, dt: number): void {
  for (const dr of world.drones) {
    if (!dr.alive) continue;
    dr.jammed = world.jammedAt(dr.pos, dr.team);
    let tx = 0;
    let ty = 0;
    const driver = world.chars.find((c) => c.alive && c.id === dr.ownerId && c.camView?.kind === 'drone' && c.camView.id === dr.id);
    if (driver && !dr.jammed) {
      const it = intents.get(driver.id);
      if (it) {
        const l = Math.hypot(it.move.x, it.move.y);
        if (l > 0.05) {
          tx = (it.move.x / Math.max(1, l)) * DRONE_SPEED;
          ty = (it.move.y / Math.max(1, l)) * DRONE_SPEED;
        }
      }
    }
    const k = 1 - Math.exp(-(tx || ty ? 9 : 4) * dt);
    dr.vel.x += (tx - dr.vel.x) * k;
    dr.vel.y += (ty - dr.vel.y) * k;
    moveCircle(world, dr.pos, DRONE_RADIUS, dr.vel.x * dt, dr.vel.y * dt, DRONE_COLLISION);
    const sp = Math.hypot(dr.vel.x, dr.vel.y);
    if (sp > 25) {
      const t = (droneNoise.get(dr.id) ?? 0) + dt;
      if (t > 0.4) {
        world.sound(dr.pos, 85, 'drone', -1, dr.team);
        droneNoise.set(dr.id, 0);
      } else droneNoise.set(dr.id, t);
    }
  }
}

// ------------------------------------------------------------------ deployables

export function updateDeployables(world: World, dt: number): void {
  void dt;
  const m = world.map;
  for (const d of world.deployables) {
    if (!d.alive) continue;
    const disabled = world.isElectronicDisabled(d);
    switch (d.kind) {
      case 'soft_breach':
      case 'hard_breach': {
        if (d.attachCell !== undefined && m.mat[d.attachCell] === MAT.EMPTY) world.destroyDeployable(d, -1);
        if (d.attachDoorway !== undefined) {
          const b = m.doorways[d.attachDoorway].barricade;
          if (!b || !b.segments.some((hp) => hp > 0)) world.destroyDeployable(d, -1);
        }
        break;
      }
      case 'claymore': {
        if (disabled || world.time < d.armedAt || world.jammedAt(d.pos, d.team)) break;
        if (d.triggerAt < 0) {
          for (const c of world.chars) {
            if (!c.alive || c.team === d.team) continue;
            const dist = Math.hypot(c.pos.x - d.pos.x, c.pos.y - d.pos.y);
            if (dist > 70) continue;
            if (Math.abs(angleDiff(d.facing, angleTo(d.pos, c.pos))) > (40 * Math.PI) / 180) continue;
            if (!lineOfSight(world, d.pos, c.pos, false)) continue;
            d.triggerAt = world.time + 0.3;
            world.sound(d.pos, 160, 'deploy', d.ownerId, d.team);
            break;
          }
        } else if (world.time >= d.triggerAt) {
          d.alive = false;
          explode(world, { pos: d.pos, radius: EQUIPMENT.claymore.radius ?? 90, damage: EQUIPMENT.claymore.damage ?? 130, ownerId: d.ownerId, team: d.team, cause: 'Claymore', wallRadius: 12, wallDamage: 80, barricadeRadius: 30, barricadeDamage: 80, kind: 'claymore' });
        }
        break;
      }
      case 'alarm': {
        if (disabled) break;
        const r = EQUIPMENT.alarm.radius ?? 72;
        let any = false;
        for (const c of world.chars) {
          if (!c.alive || c.team === d.team) continue;
          if (Math.hypot(c.pos.x - d.pos.x, c.pos.y - d.pos.y) > r) continue;
          any = true;
          world.addIntel(d.team, c, 'alarm');
        }
        if (any && world.time - d.lastAlarm > 0.7) {
          d.lastAlarm = world.time;
          world.emit({ type: 'alarm', pos: d.pos, team: d.team });
          world.sound(d.pos, 520, 'alarm', -1, d.team);
        }
        break;
      }
      default:
        break;
    }
  }
  world.deployables = world.deployables.filter((d) => d.alive || d.kind === 'camera');
}

export function isPickupable(kind: DeployKind): boolean {
  return kind === 'barbed_wire' || kind === 'shield' || kind === 'jammer' || kind === 'alarm' || kind === 'claymore' || kind === 'bp_camera';
}
