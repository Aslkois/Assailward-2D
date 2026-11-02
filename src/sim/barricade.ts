import { BARRICADE_SEGMENT_HP, BARRICADE_SEGMENT_SIZE, BARRICADE_THICKNESS, CHAR_RADIUS } from '../config/constants';
import type { AABB, Vec2 } from './math';
import type { Barricade, Doorway } from './map';
import type { Team } from './types';

// Barricades are localized structures: a doorway's width is divided into BARRICADE_SEGMENT_SIZE
// sections. Each section has its own HP and, while intact, is a real collision / bullet /
// line-of-sight rectangle. Destroying sections opens holes; once a contiguous gap is wide enough
// for an operator the doorway becomes passable again even though the rest of the barricade stays.

/** Minimum contiguous gap (px) for an operator to pass through a damaged barricade. */
export const PASSABLE_GAP = CHAR_RADIUS * 2 + 4;

export function segmentCount(d: Doorway): number {
  return Math.max(1, Math.round(d.width / BARRICADE_SEGMENT_SIZE));
}

export function segmentSize(d: Doorway): number {
  return d.width / segmentCount(d);
}

/** World-space rectangle of section `i`. */
export function segmentRect(d: Doorway, i: number): AABB {
  const s = segmentSize(d);
  const half = BARRICADE_THICKNESS / 2;
  if (d.orient === 'h') {
    return { x0: d.rect.x0 + i * s, x1: d.rect.x0 + (i + 1) * s, y0: d.center.y - half, y1: d.center.y + half };
  }
  return { x0: d.center.x - half, x1: d.center.x + half, y0: d.rect.y0 + i * s, y1: d.rect.y0 + (i + 1) * s };
}

export function segmentCenter(d: Doorway, i: number): Vec2 {
  const r = segmentRect(d, i);
  return { x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 };
}

/** The full barricade line rectangle (used for "is someone standing in the doorway"). */
export function barricadeLineRect(d: Doorway, pad = 0): AABB {
  const half = BARRICADE_THICKNESS / 2 + pad;
  return d.orient === 'h'
    ? { x0: d.rect.x0, x1: d.rect.x1, y0: d.center.y - half, y1: d.center.y + half }
    : { x0: d.center.x - half, x1: d.center.x + half, y0: d.rect.y0, y1: d.rect.y1 };
}

export function createBarricade(d: Doorway, team: Team, builderId: number): Barricade {
  return {
    segments: new Array(segmentCount(d)).fill(BARRICADE_SEGMENT_HP),
    maxSegHp: BARRICADE_SEGMENT_HP,
    complete: false,
    progress: 0,
    builderId,
    team,
    version: 0,
  };
}

/** True when section `i` is physical geometry (barricade finished and the section not destroyed). */
export function segmentSolid(b: Barricade | null, i: number): boolean {
  return !!b && b.complete && b.segments[i] > 0;
}

export function intactSegments(b: Barricade): number {
  let n = 0;
  for (const hp of b.segments) if (hp > 0) n++;
  return n;
}

export function isDamaged(b: Barricade): boolean {
  return b.segments.some((hp) => hp < b.maxSegHp);
}

/** Widest contiguous run of destroyed sections, in px. */
export function largestGap(d: Doorway, b: Barricade): number {
  let best = 0;
  let run = 0;
  for (const hp of b.segments) {
    if (hp <= 0) {
      run++;
      best = Math.max(best, run);
    } else run = 0;
  }
  return best * segmentSize(d);
}

/** Whether the barricade (if any) still prevents an operator from walking through. */
export function barricadeBlocksPassage(d: Doorway): boolean {
  const b = d.barricade;
  if (!b || !b.complete) return false;
  return largestGap(d, b) < PASSABLE_GAP;
}

export type DoorwayState = 'open' | 'building' | 'barricaded' | 'damaged' | 'breached';

export interface DoorwayStatus {
  state: DoorwayState;
  passable: boolean; // an operator can walk through right now
  obstructed: boolean; // a deployable (e.g. shield) blocks the opening
  breachable: boolean; // there is something here that melee/bullets/explosives can remove
  seeThrough: boolean; // at least one hole (or no barricade) lets vision/bullets through
  intact: number;
  total: number;
}

/** AI/HUD-facing summary of a doorway. `obstructed` is supplied by the world (deployables). */
export function doorwayStatus(d: Doorway, obstructed: boolean): DoorwayStatus {
  const b = d.barricade;
  const total = segmentCount(d);
  if (!b) {
    return { state: 'open', passable: !obstructed, obstructed, breachable: obstructed, seeThrough: true, intact: 0, total };
  }
  if (!b.complete) {
    return { state: 'building', passable: !obstructed, obstructed, breachable: obstructed, seeThrough: true, intact: 0, total };
  }
  const intact = intactSegments(b);
  const blocks = barricadeBlocksPassage(d);
  let state: DoorwayState;
  if (!blocks) state = 'breached';
  else if (intact < total) state = 'damaged';
  else state = 'barricaded';
  return {
    state,
    passable: !blocks && !obstructed,
    obstructed,
    breachable: intact > 0 || obstructed,
    seeThrough: intact < total,
    intact,
    total,
  };
}

export interface SegmentDamageResult {
  destroyed: number; // sections destroyed by this call
  nowPassable: boolean; // passage opened by this call
  fullyDestroyed: boolean;
}

/** Applies damage to the given sections (localized). Returns what changed. */
export function damageSegments(d: Doorway, damages: Map<number, number>): SegmentDamageResult {
  const b = d.barricade;
  const res: SegmentDamageResult = { destroyed: 0, nowPassable: false, fullyDestroyed: false };
  if (!b || !b.complete) return res;
  const wasBlocking = barricadeBlocksPassage(d);
  for (const [i, amount] of damages) {
    if (i < 0 || i >= b.segments.length || b.segments[i] <= 0 || amount <= 0) continue;
    b.segments[i] = Math.max(0, b.segments[i] - amount);
    if (b.segments[i] <= 0) res.destroyed++;
  }
  if (damages.size) b.version++;
  res.nowPassable = wasBlocking && !barricadeBlocksPassage(d);
  res.fullyDestroyed = intactSegments(b) === 0;
  return res;
}

/** Radial damage (explosions): each section takes damage based on its own distance. */
export function radialSegmentDamage(d: Doorway, pos: Vec2, radius: number, maxDamage: number): Map<number, number> {
  const out = new Map<number, number>();
  const b = d.barricade;
  if (!b || !b.complete) return out;
  for (let i = 0; i < b.segments.length; i++) {
    if (b.segments[i] <= 0) continue;
    const c = segmentCenter(d, i);
    const dist = Math.hypot(c.x - pos.x, c.y - pos.y);
    if (dist <= radius) out.set(i, maxDamage * (1 - 0.5 * (dist / radius)));
  }
  return out;
}

/** Melee/arc damage: sections whose centres fall inside the reach arc. */
export function arcSegmentDamage(d: Doorway, origin: Vec2, facing: number, reach: number, arc: number, amount: number): Map<number, number> {
  const out = new Map<number, number>();
  const b = d.barricade;
  if (!b || !b.complete) return out;
  for (let i = 0; i < b.segments.length; i++) {
    if (b.segments[i] <= 0) continue;
    const c = segmentCenter(d, i);
    const dx = c.x - origin.x;
    const dy = c.y - origin.y;
    const dist = Math.hypot(dx, dy);
    if (dist > reach) continue;
    let da = Math.atan2(dy, dx) - facing;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    if (Math.abs(da) <= arc / 2 || dist < 8) out.set(i, amount);
  }
  return out;
}
