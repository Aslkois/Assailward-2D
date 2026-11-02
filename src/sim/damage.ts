import { clamp, type Vec2 } from './math';
import type { Falloff } from '../config/weapons';

// ---------------------------------------------------------------------------------------------
// Directional centerline damage scaling (Assailward's top-down hit-location mechanic).
//
//   C = target centre, P = any point on the shot trajectory, D = normalised shot direction,
//   R = effective collision radius, d = |cross(D, C - P)| (perpendicular distance)
//   proximity  = clamp(1 - d / R, 0, 1)
//   multiplier = 1 + 0.5 * proximity            (1.0x at the hitbox edge .. 1.5x dead centre)
//
// Orientation-independent: only the trajectory and the target centre matter, never the target's
// facing or which side of the sprite was struck. There are no headshot multipliers on top.
// ---------------------------------------------------------------------------------------------

export const CENTERLINE_MAX_BONUS = 0.5;
export const CENTERLINE_MAX_MULTIPLIER = 1 + CENTERLINE_MAX_BONUS; // 1.5x hard cap

/** Perpendicular distance between `center` and the infinite line through `pointOnTrajectory` along `dir`. */
export function perpendicularDistance(pointOnTrajectory: Vec2, dir: Vec2, center: Vec2): number {
  const l = Math.hypot(dir.x, dir.y);
  if (l < 1e-12) return Infinity;
  const dx = dir.x / l;
  const dy = dir.y / l;
  const cx = center.x - pointOnTrajectory.x;
  const cy = center.y - pointOnTrajectory.y;
  return Math.abs(dx * cy - dy * cx);
}

/** Multiplier from a perpendicular distance and radius. Never exceeds 1.5 and never drops below 1.0. */
export function centerlineMultiplier(d: number, radius: number): number {
  if (!(radius > 0)) return 1;
  const proximity = clamp(1 - d / radius, 0, 1);
  return Math.min(CENTERLINE_MAX_MULTIPLIER, 1 + CENTERLINE_MAX_BONUS * proximity);
}

export interface CenterlineHit {
  t: number; // distance along the trajectory to the hitbox entry point
  d: number; // perpendicular distance from target centre to trajectory
  proximity: number; // 0 at the edge .. 1 dead centre
  multiplier: number; // 1.0 .. 1.5
}

/**
 * Resolves a shot against a circular hitbox. Returns null for a miss: the trajectory never
 * intersects the hitbox, the target lies behind the muzzle, or it is beyond `maxRange`.
 * Damage scaling is only produced after the intersection is confirmed.
 */
export function evaluateCenterlineHit(origin: Vec2, dir: Vec2, center: Vec2, radius: number, maxRange = Infinity): CenterlineHit | null {
  const l = Math.hypot(dir.x, dir.y);
  if (l < 1e-12 || !(radius > 0)) return null;
  const dx = dir.x / l;
  const dy = dir.y / l;
  const fx = center.x - origin.x;
  const fy = center.y - origin.y;
  const along = fx * dx + fy * dy; // projection of the centre on the trajectory
  const d = Math.abs(dx * fy - dy * fx);
  if (d > radius + 1e-9) return null; // trajectory never touches the hitbox
  const half = Math.sqrt(Math.max(0, radius * radius - d * d));
  let t = along - half;
  if (along + half < 0) return null; // entirely behind the shooter
  if (t < 0) t = 0; // muzzle inside the hitbox (point-blank)
  if (t > maxRange) return null;
  const dd = Math.min(d, radius);
  const proximity = clamp(1 - dd / radius, 0, 1);
  return { t, d: dd, proximity, multiplier: centerlineMultiplier(dd, radius) };
}

// ---------------------------------------------------------------------------------------------
// Damage pipeline — applied in this fixed, documented order (see docs/DAMAGE.md):
//   1. base damage (weapon, per projectile/pellet)
//   2. x range falloff (distance travelled)
//   3. x centerline multiplier (1.0 .. 1.5, firearms only)
//   4. x (1 - armour reduction)
//   5. result is the HP removed (no further multipliers, no headshots)
// ---------------------------------------------------------------------------------------------

export function rangeFalloff(distance: number, f: Falloff): number {
  if (distance <= f.start) return 1;
  if (distance >= f.end) return f.min;
  const t = (distance - f.start) / (f.end - f.start);
  return 1 + (f.min - 1) * t;
}

export interface DamageBreakdown {
  base: number;
  falloff: number;
  centerline: number;
  armor: number;
  final: number;
}

export function computeBulletDamage(base: number, distance: number, falloff: Falloff, centerline: number, armorReduction: number): DamageBreakdown {
  const fo = rangeFalloff(distance, falloff);
  const cl = clamp(centerline, 1, CENTERLINE_MAX_MULTIPLIER);
  const armor = 1 - clamp(armorReduction, 0, 0.9);
  return { base, falloff: fo, centerline: cl, armor, final: base * fo * cl * armor };
}

/** Explosions: linear distance falloff, then armour. No centerline scaling (it is a firearm mechanic). */
export function computeExplosionDamage(maxDamage: number, distance: number, radius: number, armorReduction: number): number {
  if (distance >= radius) return 0;
  const fo = 1 - distance / radius;
  return maxDamage * fo * (1 - clamp(armorReduction, 0, 0.9));
}
