// Small, allocation-light 2D math helpers used throughout the simulation.
// Angles are radians, 0 = +x (east); positive angles rotate clockwise on screen (y grows downward).

export interface Vec2 {
  x: number;
  y: number;
}

export interface AABB {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export const vec = (x = 0, y = 0): Vec2 => ({ x, y });
export const copy = (a: Vec2): Vec2 => ({ x: a.x, y: a.y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
/** 2D cross product (z component of a x b). */
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
export const len = (a: Vec2): number => Math.hypot(a.x, a.y);
export const len2 = (a: Vec2): number => a.x * a.x + a.y * a.y;
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const dist2 = (a: Vec2, b: Vec2): number => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
};

export function norm(a: Vec2): Vec2 {
  const l = Math.hypot(a.x, a.y);
  return l > 1e-9 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
}

export const angleOf = (a: Vec2): number => Math.atan2(a.y, a.x);
export const angleTo = (from: Vec2, to: Vec2): number => Math.atan2(to.y - from.y, to.x - from.x);
export const fromAngle = (a: number, l = 1): Vec2 => ({ x: Math.cos(a) * l, y: Math.sin(a) * l });
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Signed smallest difference b - a wrapped to [-PI, PI]. */
export function angleDiff(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function rotateToward(current: number, target: number, maxStep: number): number {
  const d = angleDiff(current, target);
  if (Math.abs(d) <= maxStep) return target;
  return current + Math.sign(d) * maxStep;
}

/**
 * Ray vs AABB (slab method). Direction need not be normalised; t is in units of the direction.
 * Returns the entry parameter t in [0, tMax] or -1 when there is no hit. Origin inside -> 0.
 */
export function rayAABB(ox: number, oy: number, dx: number, dy: number, b: AABB, tMax: number): number {
  let tmin = 0;
  let tmax = tMax;
  if (Math.abs(dx) < 1e-12) {
    if (ox < b.x0 || ox > b.x1) return -1;
  } else {
    const inv = 1 / dx;
    let t1 = (b.x0 - ox) * inv;
    let t2 = (b.x1 - ox) * inv;
    if (t1 > t2) {
      const t = t1;
      t1 = t2;
      t2 = t;
    }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  if (Math.abs(dy) < 1e-12) {
    if (oy < b.y0 || oy > b.y1) return -1;
  } else {
    const inv = 1 / dy;
    let t1 = (b.y0 - oy) * inv;
    let t2 = (b.y1 - oy) * inv;
    if (t1 > t2) {
      const t = t1;
      t1 = t2;
      t2 = t;
    }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  return tmin;
}

/**
 * Ray vs circle. Direction must be normalised. Returns entry t in [0, tMax] or -1.
 * Tangent rays (perpendicular distance exactly equal to r) count as hits.
 */
export function rayCircle(ox: number, oy: number, dx: number, dy: number, cx: number, cy: number, r: number, tMax: number): number {
  const fx = cx - ox;
  const fy = cy - oy;
  const tc = fx * dx + fy * dy; // projection of centre on the ray
  const d2 = fx * fx + fy * fy - tc * tc; // squared perpendicular distance
  const r2 = r * r;
  if (d2 > r2 + 1e-9) return -1;
  const half = Math.sqrt(Math.max(0, r2 - d2));
  let t = tc - half;
  if (t < 0) {
    // origin inside or circle behind
    if (tc + half < 0) return -1;
    t = 0;
  }
  return t <= tMax ? t : -1;
}

/** Interval [tEnter, tExit] where a normalised ray is inside a circle, clipped to [0, tMax]; null if none. */
export function rayCircleInterval(
  ox: number, oy: number, dx: number, dy: number, cx: number, cy: number, r: number, tMax: number,
): [number, number] | null {
  const fx = cx - ox;
  const fy = cy - oy;
  const tc = fx * dx + fy * dy;
  const d2 = fx * fx + fy * fy - tc * tc;
  if (d2 >= r * r) return null;
  const half = Math.sqrt(r * r - d2);
  const a = Math.max(0, tc - half);
  const b = Math.min(tMax, tc + half);
  return b > a ? [a, b] : null;
}

export function pointInAABB(x: number, y: number, b: AABB): boolean {
  return x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;
}

export function aabbOverlap(a: AABB, b: AABB): boolean {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
}

export function circleAABBOverlap(cx: number, cy: number, r: number, b: AABB): boolean {
  const px = clamp(cx, b.x0, b.x1);
  const py = clamp(cy, b.y0, b.y1);
  const dx = cx - px;
  const dy = cy - py;
  return dx * dx + dy * dy < r * r;
}

/** Distance from point p to segment ab. */
export function pointSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const l2 = abx * abx + aby * aby;
  let t = l2 > 0 ? ((p.x - a.x) * abx + (p.y - a.y) * aby) / l2 : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t));
}
