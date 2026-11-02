import { CHAR_RADIUS, DRONE_RADIUS, MELEE_ARC, MELEE_COOLDOWN, MELEE_DAMAGE, MELEE_MATERIAL_DAMAGE, MELEE_REACH, BARRICADE_BULLET_FACTOR } from '../config/constants';
import { EQUIPMENT } from '../config/equipment';
import type { WeaponDef } from '../config/weapons';
import { arcSegmentDamage, segmentRect } from './barricade';
import { computeBulletDamage, evaluateCenterlineHit, type CenterlineHit } from './damage';
import { armorReduction, type Character, type WeaponState } from './entities';
import type { ImpactMaterial } from './events';
import { angleDiff, angleTo, rayAABB, rayCircle, type Vec2 } from './math';
import { MAT } from './map';
import { castStatic } from './raycast';
import { lineOfSight } from './sight';
import type { World } from './world';

export interface BulletHit {
  kind: 'none' | 'cell' | 'barricade' | 'char' | 'deployable' | 'drone';
  t: number;
  cx: number;
  cy: number;
  doorwayId: number;
  segment: number;
  id: number;
  cl: CenterlineHit | null;
}

/**
 * Traces one bullet: nearest of walls, intact barricade sections, shields/devices, drones and
 * enemy operators. Teammates and friendly devices are passed through (no friendly fire), but
 * shields stop every bullet. Operators are resolved with the centerline hit test, which both
 * confirms the intersection and yields the damage multiplier.
 */
export function traceBullet(world: World, shooter: Character, ox: number, oy: number, dx: number, dy: number, range: number): BulletHit {
  const st = castStatic(world.map, ox, oy, dx, dy, range, true);
  const best: BulletHit = { kind: st.kind === 'none' ? 'none' : st.kind, t: st.t, cx: st.cx, cy: st.cy, doorwayId: st.doorwayId, segment: st.segment, id: -1, cl: null };
  for (const d of world.deployables) {
    if (!d.alive) continue;
    let t = -1;
    if (d.kind === 'shield' && d.rect) t = rayAABB(ox, oy, dx, dy, d.rect, best.t);
    else if (d.team !== shooter.team && d.kind !== 'barbed_wire') t = rayCircle(ox, oy, dx, dy, d.pos.x, d.pos.y, 5, best.t);
    if (t >= 0 && t < best.t) {
      best.kind = 'deployable';
      best.t = t;
      best.id = d.id;
    }
  }
  for (const dr of world.drones) {
    if (!dr.alive || dr.team === shooter.team) continue;
    const t = rayCircle(ox, oy, dx, dy, dr.pos.x, dr.pos.y, DRONE_RADIUS, best.t);
    if (t >= 0 && t < best.t) {
      best.kind = 'drone';
      best.t = t;
      best.id = dr.id;
    }
  }
  const origin = { x: ox, y: oy };
  const dir = { x: dx, y: dy };
  for (const c of world.chars) {
    if (!c.alive || c.team === shooter.team) continue;
    const hit = evaluateCenterlineHit(origin, dir, c.pos, c.radius, best.t);
    if (hit && hit.t < best.t) {
      best.kind = 'char';
      best.t = hit.t;
      best.id = c.id;
      best.cl = hit;
    }
  }
  return best;
}

function applyBullet(world: World, shooter: Character, def: WeaponDef, hit: BulletHit, end: Vec2): ImpactMaterial {
  switch (hit.kind) {
    case 'char': {
      const target = world.charById(hit.id)!;
      const dmg = computeBulletDamage(def.damage, hit.t, def.falloff, hit.cl!.multiplier, armorReduction(target));
      world.damageCharacter(target, dmg.final, shooter.id, def.name, { mult: hit.cl!.multiplier, pos: end });
      return 'flesh';
    }
    case 'cell': {
      const m = world.map.matAt(hit.cx, hit.cy);
      if (m === MAT.SOFT) {
        world.bulletDamageCell(hit.cx, hit.cy, def.damage, def.materialMult, shooter.team);
        return 'soft';
      }
      if (m === MAT.REINF) return 'metal';
      return 'concrete';
    }
    case 'barricade': {
      world.damageBarricade(hit.doorwayId, new Map([[hit.segment, def.damage * def.materialMult * BARRICADE_BULLET_FACTOR]]), shooter.team, end);
      return 'wood';
    }
    case 'deployable': {
      const d = world.deployableById(hit.id)!;
      world.damageDeployable(d, def.damage, shooter.team, 'bullet');
      return d.kind === 'shield' ? 'shield' : 'metal';
    }
    case 'drone': {
      const dr = world.droneById(hit.id);
      if (dr) world.destroyDrone(dr);
      return 'metal';
    }
    default:
      return 'none';
  }
}

export function currentSpread(ch: Character, ws: WeaponState): number {
  const def = ws.def;
  let s = (ch.ads ? def.spreadAds : def.spreadHip) + def.spreadMove * Math.min(1, ch.moveFrac) + ws.bloom;
  if (ch.stance === 'crouch') s *= 0.8;
  return s;
}

export function fireWeapon(world: World, ch: Character, ws: WeaponState): void {
  const def = ws.def;
  ws.mag--;
  ws.cooldown = 60 / def.rpm;
  ch.lastShotTime = world.time;
  const spread = currentSpread(ch, ws);
  const base = ch.facing + ch.recoil;
  const ends: { to: Vec2; material: ImpactMaterial }[] = [];
  for (let p = 0; p < def.pellets; p++) {
    let a = base + world.rng.gaussian() * spread * 0.5;
    if (def.pellets > 1) a += world.rng.range(-1, 1) * def.pelletSpread;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const hit = traceBullet(world, ch, ch.pos.x, ch.pos.y, dx, dy, def.range);
    const end = { x: ch.pos.x + dx * hit.t, y: ch.pos.y + dy * hit.t };
    ends.push({ to: end, material: applyBullet(world, ch, def, hit, end) });
  }
  ws.bloom = Math.min(def.bloomMax, ws.bloom + def.bloomPerShot);
  ch.recoil += world.rng.sign() * def.kick * world.rng.range(0.5, 1);
  world.emit({ type: 'shot', shooterId: ch.id, team: ch.team, from: { x: ch.pos.x, y: ch.pos.y }, ends, audio: def.audio, suppressed: false });
  world.sound(ch.pos, def.soundRadius, 'gunshot', ch.id, ch.team);
}

export function tickWeapon(world: World, ch: Character, ws: WeaponState, dt: number): void {
  ws.cooldown = Math.max(0, ws.cooldown - dt);
  ws.bloom = Math.max(0, ws.bloom - ws.def.bloomRecovery * dt);
  if (ws.reloading) {
    ws.reloadTimer -= dt;
    if (ws.reloadTimer <= 0) {
      const take = Math.min(ws.def.magSize - ws.mag, ws.reserve);
      ws.mag += take;
      ws.reserve -= take;
      ws.reloading = false;
      world.emit({ type: 'reload', charId: ch.id, pos: ch.pos });
    }
  }
}

export function startReload(world: World, ch: Character, ws: WeaponState): boolean {
  if (ws.reloading || ws.mag >= ws.def.magSize || ws.reserve <= 0) return false;
  ws.reloading = true;
  ws.reloadTimer = ws.mag > 0 ? ws.def.reloadTime : ws.def.emptyReloadTime;
  world.sound(ch.pos, 90, 'reload', ch.id, ch.team);
  return true;
}

export function canFire(ch: Character): boolean {
  return !ch.sprinting && ch.sprintRecover <= 0 && ch.swapTimer <= 0 && !ch.action && ch.hammerWindup <= 0;
}

/** Trigger handling for the held firearm. */
export function useWeapon(world: World, ch: Character, ws: WeaponState, fire: boolean, firePressed: boolean): void {
  const wants = ws.def.mode === 'auto' ? fire : firePressed;
  if (!wants || !canFire(ch) || ws.reloading || ws.cooldown > 0) return;
  if (ws.mag <= 0) {
    if (firePressed) world.emit({ type: 'dry', charId: ch.id, pos: ch.pos });
    startReload(world, ch, ws);
    return;
  }
  fireWeapon(world, ch, ws);
}

/**
 * Melee strike (V, F-bash on barricades, or the Breaching Hammer when `heavy`). Damages the
 * first things in the reach arc: enemy operators, barricade sections, soft wall cells, devices.
 */
export function doMelee(world: World, ch: Character, heavy: boolean): void {
  const charDamage = heavy ? 70 : MELEE_DAMAGE;
  const matDamage = heavy ? (EQUIPMENT.hammer.damage ?? 220) : MELEE_MATERIAL_DAMAGE;
  const reach = MELEE_REACH + (heavy ? 6 : 0);
  ch.meleeCooldown = heavy ? 1.0 : MELEE_COOLDOWN;
  ch.meleeAnim = 0.25;
  const origin = ch.pos;
  const facing = ch.facing;
  const inArc = (p: Vec2, extra: number): boolean => {
    const d = Math.hypot(p.x - origin.x, p.y - origin.y);
    if (d > ch.radius + reach + extra) return false;
    return d < 6 || Math.abs(angleDiff(facing, angleTo(origin, p))) <= MELEE_ARC / 2;
  };
  for (const c of world.chars) {
    if (!c.alive || c.team === ch.team) continue;
    if (inArc(c.pos, c.radius * 0.5) && lineOfSight(world, origin, c.pos, false)) {
      world.damageCharacter(c, charDamage, ch.id, heavy ? 'Breaching Hammer' : 'Melee', { pos: c.pos });
    }
  }
  // Barricades within reach
  const map = world.map;
  for (const d of map.doorways) {
    if (!d.barricade || !d.barricade.complete) continue;
    if (Math.hypot(d.center.x - origin.x, d.center.y - origin.y) > d.width / 2 + reach + ch.radius + 8) continue;
    const dmg = arcSegmentDamage(d, origin, facing, ch.radius + reach, MELEE_ARC, matDamage);
    if (dmg.size) world.damageBarricade(d.id, dmg, ch.team, segmentCenterOf(d.id, dmg, world));
  }
  // Soft wall cells within reach
  const cx0 = map.toCell(origin.x - reach - ch.radius);
  const cy0 = map.toCell(origin.y - reach - ch.radius);
  const cx1 = map.toCell(origin.x + reach + ch.radius);
  const cy1 = map.toCell(origin.y + reach + ch.radius);
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      if (map.matAt(cx, cy) !== MAT.SOFT) continue;
      const c = map.cellCenter(cx, cy);
      if (inArc(c, 4)) world.damageCell(cx, cy, matDamage * (heavy ? 1 : 0.6), ch.team);
    }
  }
  for (const dep of world.deployables) {
    if (!dep.alive || dep.kind === 'camera') continue;
    if (dep.team === ch.team && dep.kind !== 'shield' && dep.kind !== 'barbed_wire') continue;
    if (dep.team === ch.team) continue;
    const p = dep.rect ? { x: Math.max(dep.rect.x0, Math.min(origin.x, dep.rect.x1)), y: Math.max(dep.rect.y0, Math.min(origin.y, dep.rect.y1)) } : dep.pos;
    if (inArc(p, 6)) world.damageDeployable(dep, matDamage, ch.team, 'melee');
  }
  for (const dr of world.drones) {
    if (dr.alive && dr.team !== ch.team && inArc(dr.pos, 4)) world.destroyDrone(dr);
  }
  world.emit({ type: 'melee', charId: ch.id, pos: { x: origin.x, y: origin.y }, facing, heavy });
  world.sound(origin, heavy ? 300 : 200, 'melee', ch.id, ch.team);
}

function segmentCenterOf(doorwayId: number, dmg: Map<number, number>, world: World): Vec2 {
  const d = world.map.doorways[doorwayId];
  const first = dmg.keys().next().value as number;
  const r = segmentRect(d, first);
  return { x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 };
}

export const BODY_RADIUS = CHAR_RADIUS;
