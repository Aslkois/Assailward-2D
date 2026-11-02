import { CELL, SMOKE_SIGHT_DEPTH } from '../config/constants';
import { segmentRect, segmentSolid } from './barricade';
import { rayAABB, rayCircleInterval, type Vec2 } from './math';
import type { GameMap } from './map';

// Grid traversal (Amanatides & Woo DDA) plus barricade sections. Used for bullets, line of sight,
// the visibility polygon and sound occlusion. `dx, dy` must be normalised so t is in pixels.

export type StaticHitKind = 'none' | 'cell' | 'barricade';

export interface StaticHit {
  kind: StaticHitKind;
  t: number;
  cx: number;
  cy: number;
  doorwayId: number;
  segment: number;
}

export function traverseGrid(
  map: GameMap,
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  maxT: number,
  visit: (cx: number, cy: number, tEnter: number) => boolean,
): void {
  let cx = Math.floor(ox / CELL);
  let cy = Math.floor(oy / CELL);
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  const tDeltaX = Math.abs(dx) > 1e-12 ? CELL / Math.abs(dx) : Infinity;
  const tDeltaY = Math.abs(dy) > 1e-12 ? CELL / Math.abs(dy) : Infinity;
  let tMaxX = dx > 1e-12 ? ((cx + 1) * CELL - ox) / dx : dx < -1e-12 ? (cx * CELL - ox) / dx : Infinity;
  let tMaxY = dy > 1e-12 ? ((cy + 1) * CELL - oy) / dy : dy < -1e-12 ? (cy * CELL - oy) / dy : Infinity;
  let t = 0;
  let guard = 0;
  while (t <= maxT && guard++ < 4096) {
    if (!map.inBounds(cx, cy)) {
      visit(cx, cy, t);
      return;
    }
    if (visit(cx, cy, t)) return;
    if (tMaxX < tMaxY) {
      t = tMaxX;
      tMaxX += tDeltaX;
      cx += stepX;
    } else {
      t = tMaxY;
      tMaxY += tDeltaY;
      cy += stepY;
    }
  }
}

/**
 * First static obstruction along a ray: solid cells and (optionally) intact barricade sections.
 * `onCell` (optional) is called for each cell the ray visits before stopping — used to build the
 * player's knowledge of the map from what they can actually see.
 */
export function castStatic(
  map: GameMap,
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  maxT: number,
  barricades = true,
  onCell?: (index: number) => void,
): StaticHit {
  const hit: StaticHit = { kind: 'none', t: maxT, cx: -1, cy: -1, doorwayId: -1, segment: -1 };
  let lastDoor = -1;
  traverseGrid(map, ox, oy, dx, dy, maxT, (cx, cy, tEnter) => {
    if (tEnter > hit.t) return true;
    if (!map.inBounds(cx, cy)) {
      hit.kind = 'cell';
      hit.t = Math.min(hit.t, tEnter);
      hit.cx = cx;
      hit.cy = cy;
      return true;
    }
    const i = map.idx(cx, cy);
    if (onCell) onCell(i);
    if (map.mat[i] !== 0) {
      if (tEnter < hit.t) {
        hit.kind = 'cell';
        hit.t = tEnter;
        hit.cx = cx;
        hit.cy = cy;
        hit.doorwayId = -1;
        hit.segment = -1;
      }
      return true;
    }
    if (barricades) {
      const di = map.doorOf[i];
      if (di >= 0 && di !== lastDoor) {
        lastDoor = di;
        const d = map.doorways[di];
        const b = d.barricade;
        if (b && b.complete) {
          for (let s = 0; s < b.segments.length; s++) {
            if (!segmentSolid(b, s)) continue;
            const t = rayAABB(ox, oy, dx, dy, segmentRect(d, s), hit.t);
            if (t >= 0 && t < hit.t) {
              hit.kind = 'barricade';
              hit.t = t;
              hit.cx = cx;
              hit.cy = cy;
              hit.doorwayId = di;
              hit.segment = s;
            }
          }
        }
      }
    }
    return false;
  });
  return hit;
}

export interface SmokeLike {
  pos: Vec2;
  radius: number;
}

/**
 * Distance along a ray after which accumulated smoke depth exceeds SMOKE_SIGHT_DEPTH.
 * Returns Infinity if the ray never gets that deep into smoke within maxT.
 */
export function smokeStop(smokes: readonly SmokeLike[], ox: number, oy: number, dx: number, dy: number, maxT: number): number {
  if (!smokes.length) return Infinity;
  const intervals: [number, number][] = [];
  for (const s of smokes) {
    if (s.radius <= 1) continue;
    const iv = rayCircleInterval(ox, oy, dx, dy, s.pos.x, s.pos.y, s.radius, maxT);
    if (iv) intervals.push(iv);
  }
  if (!intervals.length) return Infinity;
  intervals.sort((a, b) => a[0] - b[0]);
  let acc = 0;
  let curA = intervals[0][0];
  let curB = intervals[0][1];
  const flush = (a: number, b: number): number => {
    const len = b - a;
    if (acc + len >= SMOKE_SIGHT_DEPTH) return a + (SMOKE_SIGHT_DEPTH - acc);
    acc += len;
    return Infinity;
  };
  for (let k = 1; k < intervals.length; k++) {
    const [a, b] = intervals[k];
    if (a <= curB) {
      curB = Math.max(curB, b);
    } else {
      const r = flush(curA, curB);
      if (r !== Infinity) return r;
      curA = a;
      curB = b;
    }
  }
  return flush(curA, curB);
}

/** Number of solid cells crossed between two points (sound occlusion). */
export function countWallsBetween(map: GameMap, a: Vec2, b: Vec2, cap = 6): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l = Math.hypot(dx, dy);
  if (l < 1) return 0;
  let n = 0;
  traverseGrid(map, a.x, a.y, dx / l, dy / l, l, (cx, cy) => {
    if (map.isSolid(cx, cy)) n++;
    return n >= cap;
  });
  return n;
}
