import { CELL } from '../../config/constants';
import { barricadeBlocksPassage } from '../barricade';
import { BODY_COLLISION, circleBlocked, DRONE_COLLISION } from '../collision';
import { MAT } from '../map';
import type { Vec2 } from '../math';
import type { World } from '../world';

// Grid A* over the map cells with doorway awareness:
//   - open / breached doorways are normal floor
//   - barricaded doorways are blocked ('avoid'), traversable at a cost with a breach obstacle
//     marker ('breach'), or ignored entirely (drones slip underneath)
//   - soft / reinforced walls are traversable only for agents carrying a suitable breaching tool
//   - shields block; barbed wire is expensive

export type BarricadePolicy = 'avoid' | 'breach' | 'ignore';

export interface NavOpts {
  barricades: BarricadePolicy;
  softWalls: boolean;
  hardWalls: boolean;
  radius: number;
  softCost?: number; // extra cost of breaching a soft wall cell (lower = prefers making holes)
  hardCost?: number;
  barricadeCost?: number;
}

export type Obstacle =
  | { kind: 'barricade'; doorwayId: number }
  | { kind: 'soft'; cell: number }
  | { kind: 'reinf'; cell: number };

export interface NavPath {
  points: Vec2[];
  obstacles: (Obstacle | null)[];
  cost: number;
}

let gScore = new Float64Array(0);
let fScore = new Float64Array(0);
let came = new Int32Array(0);
let closed = new Uint8Array(0);
let heapArr = new Int32Array(0);

function ensure(n: number): void {
  if (gScore.length >= n) return;
  gScore = new Float64Array(n);
  fScore = new Float64Array(n);
  came = new Int32Array(n);
  closed = new Uint8Array(n);
  heapArr = new Int32Array(n * 8);
}

/** Per-cell traversal cost; Infinity = blocked. */
export function buildCostField(world: World, opts: NavOpts): { cost: Float32Array; obstacle: Int32Array } {
  const m = world.map;
  const n = m.w * m.h;
  const cost = new Float32Array(n);
  const obstacle = new Int32Array(n).fill(-1); // encodes: doorway id (>=0) or -(cell+2) for walls
  for (let i = 0; i < n; i++) {
    const mat = m.mat[i];
    if (mat === MAT.WALL || mat === MAT.PROP) {
      cost[i] = Infinity;
      continue;
    }
    if (mat === MAT.SOFT) {
      cost[i] = opts.softWalls ? opts.softCost ?? 30 : Infinity;
      obstacle[i] = -(i + 2);
      continue;
    }
    if (mat === MAT.REINF) {
      cost[i] = opts.hardWalls ? opts.hardCost ?? 45 : Infinity;
      obstacle[i] = -(i + 2);
      continue;
    }
    let c = 1;
    const di = m.doorOf[i];
    if (di >= 0 && barricadeBlocksPassage(m.doorways[di])) {
      if (opts.barricades === 'avoid') {
        cost[i] = Infinity;
        continue;
      }
      if (opts.barricades === 'breach') {
        c = opts.barricadeCost ?? 14;
        obstacle[i] = di;
      }
    }
    if (opts.radius > 6) {
      const cx = i % m.w;
      const cy = (i / m.w) | 0;
      if (m.isSolid(cx + 1, cy) || m.isSolid(cx - 1, cy) || m.isSolid(cx, cy + 1) || m.isSolid(cx, cy - 1)) c += 2;
    }
    cost[i] = c;
  }
  for (const d of world.deployables) {
    if (!d.alive || !d.rect) continue;
    const solid = d.kind === 'shield';
    const wire = d.kind === 'barbed_wire';
    if (!solid && !wire) continue;
    for (let cy = m.toCell(d.rect.y0); cy <= m.toCell(d.rect.y1 - 0.01); cy++) {
      for (let cx = m.toCell(d.rect.x0); cx <= m.toCell(d.rect.x1 - 0.01); cx++) {
        if (!m.inBounds(cx, cy)) continue;
        const i = m.idx(cx, cy);
        if (solid) cost[i] = Infinity;
        else if (opts.radius > 6 && cost[i] < Infinity) cost[i] += 5;
      }
    }
  }
  return { cost, obstacle };
}

function heapPush(size: number, node: number): number {
  let i = size;
  heapArr[i] = node;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (fScore[heapArr[p]] <= fScore[heapArr[i]]) break;
    const t = heapArr[p];
    heapArr[p] = heapArr[i];
    heapArr[i] = t;
    i = p;
  }
  return size + 1;
}

function heapPop(size: number): number {
  const top = heapArr[0];
  const last = heapArr[size - 1];
  size--;
  if (size > 0) {
    heapArr[0] = last;
    let i = 0;
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let s = i;
      if (l < size && fScore[heapArr[l]] < fScore[heapArr[s]]) s = l;
      if (r < size && fScore[heapArr[r]] < fScore[heapArr[s]]) s = r;
      if (s === i) break;
      const t = heapArr[s];
      heapArr[s] = heapArr[i];
      heapArr[i] = t;
      i = s;
    }
  }
  return top;
}

function nearestOpenCell(world: World, cost: Float32Array, p: Vec2, maxR = 4): number {
  const m = world.map;
  const cx = m.toCell(p.x);
  const cy = m.toCell(p.y);
  let best = -1;
  let bd = Infinity;
  for (let dy = -maxR; dy <= maxR; dy++) {
    for (let dx = -maxR; dx <= maxR; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (!m.inBounds(x, y)) continue;
      const i = m.idx(x, y);
      if (cost[i] === Infinity || m.mat[i] !== MAT.EMPTY) continue;
      const c = m.cellCenter(x, y);
      const d = (c.x - p.x) ** 2 + (c.y - p.y) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
  }
  return best;
}

export function findPath(world: World, from: Vec2, to: Vec2, opts: NavOpts, field?: { cost: Float32Array; obstacle: Int32Array }): NavPath | null {
  const m = world.map;
  const n = m.w * m.h;
  ensure(n);
  const { cost, obstacle } = field ?? buildCostField(world, opts);
  const start = nearestOpenCell(world, cost, from);
  const goal = nearestOpenCell(world, cost, to, 6);
  if (start < 0 || goal < 0) return null;
  gScore.fill(Infinity, 0, n);
  closed.fill(0, 0, n);
  const gx = goal % m.w;
  const gy = (goal / m.w) | 0;
  const h = (i: number): number => {
    const dx = Math.abs((i % m.w) - gx);
    const dy = Math.abs(((i / m.w) | 0) - gy);
    return Math.max(dx, dy) + 0.414 * Math.min(dx, dy);
  };
  gScore[start] = 0;
  fScore[start] = h(start);
  came[start] = -1;
  let size = heapPush(0, start);
  let found = false;
  let expanded = 0;
  while (size > 0) {
    const cur = heapPop(size);
    size--;
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === goal) {
      found = true;
      break;
    }
    if (++expanded > 40000) break;
    const cx = cur % m.w;
    const cy = (cur / m.w) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h) continue;
        const ni = ny * m.w + nx;
        if (closed[ni]) continue;
        const c = cost[ni];
        if (c === Infinity) continue;
        let step = c;
        if (dx && dy) {
          // no diagonal corner-cutting past blocked cells or obstacles
          const a = cy * m.w + nx;
          const b = ny * m.w + cx;
          if (cost[a] === Infinity || cost[b] === Infinity || obstacle[a] !== -1 || obstacle[b] !== -1 || obstacle[ni] !== -1) continue;
          step *= 1.4142;
        }
        const g = gScore[cur] + step;
        if (g < gScore[ni]) {
          gScore[ni] = g;
          fScore[ni] = g + h(ni);
          came[ni] = cur;
          if (size < heapArr.length) size = heapPush(size, ni);
        }
      }
    }
  }
  if (!found) return null;
  const cells: number[] = [];
  for (let c = goal; c !== -1; c = came[c]) cells.push(c);
  cells.reverse();
  const points: Vec2[] = [];
  const obstacles: (Obstacle | null)[] = [];
  for (const c of cells) {
    points.push(m.cellCenter(c % m.w, (c / m.w) | 0));
    const o = obstacle[c];
    if (o === -1) obstacles.push(null);
    else if (o >= 0) obstacles.push({ kind: 'barricade', doorwayId: o });
    else {
      const cell = -o - 2;
      obstacles.push({ kind: m.mat[cell] === MAT.REINF ? 'reinf' : 'soft', cell });
    }
  }
  // final point: the exact target if it is reachable from the last cell
  if (!circleBlocked(world, to.x, to.y, opts.radius, opts.barricades === 'ignore' ? DRONE_COLLISION : BODY_COLLISION)) {
    points.push({ x: to.x, y: to.y });
    obstacles.push(null);
  }
  return { points, obstacles, cost: gScore[goal] };
}

/** Is the obstacle still physically blocking? */
export function obstacleBlocking(world: World, o: Obstacle): boolean {
  if (o.kind === 'barricade') return barricadeBlocksPassage(world.map.doorways[o.doorwayId]);
  return world.map.mat[o.cell] !== MAT.EMPTY;
}

/** Straight-line clearance check for a circle (used for path smoothing). */
export function segmentClear(world: World, a: Vec2, b: Vec2, r: number, drone = false): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(l / 5));
  const opts = drone ? DRONE_COLLISION : BODY_COLLISION;
  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    if (circleBlocked(world, a.x + dx * t, a.y + dy * t, r, opts)) return false;
  }
  return true;
}

export function cellCenterOf(world: World, cell: number): Vec2 {
  return { x: ((cell % world.map.w) + 0.5) * CELL, y: (((cell / world.map.w) | 0) + 0.5) * CELL };
}
