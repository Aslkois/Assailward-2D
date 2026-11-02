import { CELL } from '../config/constants';
import { segmentRect, segmentSolid } from './barricade';
import type { AABB } from './math';
import type { GameMap } from './map';

// Circle-vs-world collision. Static geometry is the cell grid (walls, soft/reinforced walls,
// props), intact barricade sections and deployed shields. Everything is axis-aligned boxes.

export interface CollisionWorld {
  map: GameMap;
  /** Axis-aligned rectangles of solid deployables (shields). */
  solidDeployableRects(): AABB[];
}

export interface CollideOpts {
  barricades: boolean; // intact barricade sections block (false for drones that slip underneath)
  deployables: boolean; // shields block
}

export const BODY_COLLISION: CollideOpts = { barricades: true, deployables: true };
export const DRONE_COLLISION: CollideOpts = { barricades: false, deployables: true };

/** Calls cb for every blocking rectangle overlapping `box`. Stops early if cb returns true. */
export function forEachBlocker(w: CollisionWorld, box: AABB, opts: CollideOpts, cb: (r: AABB) => boolean | void): boolean {
  const { map } = w;
  const cx0 = Math.floor(box.x0 / CELL);
  const cy0 = Math.floor(box.y0 / CELL);
  const cx1 = Math.floor(box.x1 / CELL);
  const cy1 = Math.floor(box.y1 / CELL);
  let seenDoor = -1;
  let seenDoor2 = -1;
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      if (map.isSolid(cx, cy)) {
        if (cb({ x0: cx * CELL, y0: cy * CELL, x1: (cx + 1) * CELL, y1: (cy + 1) * CELL })) return true;
        continue;
      }
      if (!opts.barricades) continue;
      const di = map.doorOf[map.idx(cx, cy)];
      if (di < 0 || di === seenDoor || di === seenDoor2) continue;
      if (seenDoor < 0) seenDoor = di;
      else seenDoor2 = di;
      const d = map.doorways[di];
      const b = d.barricade;
      if (!b || !b.complete) continue;
      for (let i = 0; i < b.segments.length; i++) {
        if (!segmentSolid(b, i)) continue;
        if (cb(segmentRect(d, i))) return true;
      }
    }
  }
  if (opts.deployables) {
    for (const r of w.solidDeployableRects()) {
      if (r.x1 < box.x0 || r.x0 > box.x1 || r.y1 < box.y0 || r.y0 > box.y1) continue;
      if (cb(r)) return true;
    }
  }
  return false;
}

export function circleBlocked(w: CollisionWorld, x: number, y: number, r: number, opts: CollideOpts = BODY_COLLISION): boolean {
  const box = { x0: x - r, y0: y - r, x1: x + r, y1: y + r };
  return forEachBlocker(w, box, opts, (rect) => {
    const px = Math.max(rect.x0, Math.min(x, rect.x1));
    const py = Math.max(rect.y0, Math.min(y, rect.y1));
    const dx = x - px;
    const dy = y - py;
    return dx * dx + dy * dy < r * r - 1e-6;
  });
}

/** Pushes a circle out of every overlapping blocker. Returns true if any correction happened. */
export function resolveCircle(w: CollisionWorld, p: { x: number; y: number }, r: number, opts: CollideOpts): boolean {
  let any = false;
  for (let iter = 0; iter < 4; iter++) {
    let pushed = false;
    const box = { x0: p.x - r, y0: p.y - r, x1: p.x + r, y1: p.y + r };
    forEachBlocker(w, box, opts, (rect) => {
      const px = Math.max(rect.x0, Math.min(p.x, rect.x1));
      const py = Math.max(rect.y0, Math.min(p.y, rect.y1));
      let dx = p.x - px;
      let dy = p.y - py;
      const d2 = dx * dx + dy * dy;
      if (d2 >= r * r) return;
      if (d2 > 1e-9) {
        const d = Math.sqrt(d2);
        const push = r - d;
        p.x += (dx / d) * push;
        p.y += (dy / d) * push;
      } else {
        // centre inside the rectangle: exit along the shallowest axis
        const left = p.x - rect.x0;
        const right = rect.x1 - p.x;
        const up = p.y - rect.y0;
        const down = rect.y1 - p.y;
        const m = Math.min(left, right, up, down);
        if (m === left) p.x = rect.x0 - r;
        else if (m === right) p.x = rect.x1 + r;
        else if (m === up) p.y = rect.y0 - r;
        else p.y = rect.y1 + r;
        dx = dy = 0;
      }
      pushed = true;
    });
    if (!pushed) break;
    any = true;
  }
  return any;
}

/** Moves a circle by (dx, dy) with sub-stepping so fast movers cannot tunnel through thin geometry. */
export function moveCircle(
  w: CollisionWorld,
  pos: { x: number; y: number },
  r: number,
  dx: number,
  dy: number,
  opts: CollideOpts = BODY_COLLISION,
): boolean {
  const maxStep = Math.max(1, r * 0.5);
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / maxStep));
  let hit = false;
  for (let s = 0; s < steps; s++) {
    pos.x += dx / steps;
    pos.y += dy / steps;
    if (resolveCircle(w, pos, r, opts)) hit = true;
  }
  return hit;
}
