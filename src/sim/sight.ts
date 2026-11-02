import {
  BOT_FOV,
  CAMERA_FOV,
  CAMERA_RANGE,
  DRONE_FOV,
  DRONE_RANGE,
  NEAR_AWARENESS_RADIUS,
  VIEW_FOV,
  VIEW_FOV_ADS,
  VIEW_RANGE,
} from '../config/constants';
import type { Character, IntelSource } from './entities';
import { angleDiff, type Vec2 } from './math';
import { castStatic, smokeStop } from './raycast';
import type { World } from './world';

// Line of sight and perception. Walls, intact barricade sections and smoke block sight; shields,
// barbed wire and other low deployables do not. The same rules drive the player's fog of war and
// what bots (and cameras/drones) can perceive — nobody gets omniscient position data.

export interface ViewSpec {
  origin: Vec2;
  facing: number;
  fov: number;
  range: number;
  near: number; // 360-degree close awareness radius
  source: IntelSource;
}

export function lineOfSight(world: World, a: Vec2, b: Vec2, smoke = true): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l = Math.hypot(dx, dy);
  if (l < 1) return true;
  const ux = dx / l;
  const uy = dy / l;
  const hit = castStatic(world.map, a.x, a.y, ux, uy, l, true);
  if (hit.kind !== 'none' && hit.t < l - 0.5) return false;
  if (smoke && smokeStop(world.smokes, a.x, a.y, ux, uy, l) < l) return false;
  return true;
}

export function canSeePoint(world: World, v: ViewSpec, p: Vec2, slack = 0): boolean {
  const dx = p.x - v.origin.x;
  const dy = p.y - v.origin.y;
  const d = Math.hypot(dx, dy);
  if (d > v.range + slack) return false;
  if (d > v.near + slack) {
    const da = Math.abs(angleDiff(v.facing, Math.atan2(dy, dx)));
    if (da > v.fov / 2 + (d > 1 ? Math.atan2(slack, d) : 0)) return false;
  }
  return lineOfSight(world, v.origin, p, true);
}

/** Samples the target's centre and two edge points perpendicular to the line of sight. */
export function canSeeCircle(world: World, v: ViewSpec, c: Vec2, r: number): boolean {
  if (canSeePoint(world, v, c, r)) return true;
  const dx = c.x - v.origin.x;
  const dy = c.y - v.origin.y;
  const l = Math.hypot(dx, dy) || 1;
  const px = (-dy / l) * r * 0.8;
  const py = (dx / l) * r * 0.8;
  return canSeePoint(world, v, { x: c.x + px, y: c.y + py }, r) || canSeePoint(world, v, { x: c.x - px, y: c.y - py }, r);
}

/** What a character is currently looking through: own eyes, a camera, or a drone. */
export function viewOf(world: World, ch: Character): ViewSpec | null {
  if (!ch.alive) return null;
  if (ch.camView?.kind === 'cam') {
    const cam = world.deployableById(ch.camView.id);
    if (cam && cam.alive && !world.isElectronicDisabled(cam)) {
      return { origin: cam.pos, facing: cam.facing, fov: CAMERA_FOV, range: CAMERA_RANGE, near: 0, source: 'cam' };
    }
    return null;
  }
  if (ch.camView?.kind === 'drone') {
    const dr = world.droneById(ch.camView.id);
    if (dr && dr.alive && !dr.jammed) {
      return { origin: dr.pos, facing: dr.facing, fov: DRONE_FOV, range: DRONE_RANGE, near: 24, source: 'drone' };
    }
    return null;
  }
  if (world.time < ch.blindUntil && ch.blindStrength > 0.25) return null;
  const fov = ch.ads ? VIEW_FOV_ADS : ch.isPlayer ? VIEW_FOV : BOT_FOV;
  return { origin: ch.pos, facing: ch.facing, fov, range: VIEW_RANGE, near: NEAR_AWARENESS_RADIUS, source: 'sight' };
}

/** Eye view regardless of camera mode (bots keep some awareness of their body's surroundings). */
export function eyeView(ch: Character): ViewSpec {
  return { origin: ch.pos, facing: ch.facing, fov: ch.isPlayer ? VIEW_FOV : BOT_FOV, range: VIEW_RANGE, near: NEAR_AWARENESS_RADIUS, source: 'sight' };
}

/** 10 Hz perception pass: who sees whom, plus team call-outs (intel). */
export function updateSightings(world: World): void {
  for (const ch of world.chars) {
    ch.visibleEnemies = [];
    ch.visibleDevices = [];
    ch.visibleDrones = [];
    if (!ch.alive) continue;
    const v = viewOf(world, ch);
    if (!v) continue;
    for (const e of world.chars) {
      if (!e.alive || e.team === ch.team) continue;
      if (canSeeCircle(world, v, e.pos, e.radius)) {
        ch.visibleEnemies.push(e.id);
        world.addIntel(ch.team, e, v.source);
      }
    }
    if (ch.isPlayer) continue;
    for (const d of world.deployables) {
      if (!d.alive || d.team === ch.team) continue;
      if (d.kind === 'barbed_wire' || d.kind === 'shield') continue;
      if (canSeePoint(world, v, d.pos, 4)) ch.visibleDevices.push(d.id);
    }
    for (const dr of world.drones) {
      if (!dr.alive || dr.team === ch.team) continue;
      if (Math.hypot(dr.pos.x - v.origin.x, dr.pos.y - v.origin.y) > 520) continue;
      if (canSeePoint(world, v, dr.pos, 4)) ch.visibleDrones.push(dr.id);
    }
  }
}

export interface VisibilityPolygons {
  cone: number[]; // flat [x0,y0,x1,y1,...] starting at the origin; truncated by walls/barricades
  coneSmoke: number[]; // same but also truncated by smoke (used for entity masking)
  near: number[];
  nearSmoke: number[];
}

/**
 * Builds the visibility polygon for rendering. `onCell` receives every cell index a sight ray
 * reaches (the viewer's map knowledge is refreshed from these).
 */
export function computeVisibility(world: World, v: ViewSpec, stepRad = 0.011, onCell?: (i: number) => void): VisibilityPolygons {
  const out: VisibilityPolygons = { cone: [v.origin.x, v.origin.y], coneSmoke: [v.origin.x, v.origin.y], near: [], nearSmoke: [] };
  const n = Math.max(2, Math.ceil(v.fov / stepRad));
  const start = v.facing - v.fov / 2;
  for (let i = 0; i <= n; i++) {
    const a = start + (v.fov * i) / n;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const hit = castStatic(world.map, v.origin.x, v.origin.y, dx, dy, v.range, true, onCell);
    const tw = hit.t;
    const ts = Math.min(tw, smokeStop(world.smokes, v.origin.x, v.origin.y, dx, dy, tw));
    out.cone.push(v.origin.x + dx * tw, v.origin.y + dy * tw);
    out.coneSmoke.push(v.origin.x + dx * ts, v.origin.y + dy * ts);
  }
  if (v.near > 0) {
    const m = 40;
    for (let i = 0; i < m; i++) {
      const a = (i / m) * Math.PI * 2;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      const hit = castStatic(world.map, v.origin.x, v.origin.y, dx, dy, v.near, true, onCell);
      const ts = Math.min(hit.t, smokeStop(world.smokes, v.origin.x, v.origin.y, dx, dy, hit.t));
      out.near.push(v.origin.x + dx * hit.t, v.origin.y + dy * hit.t);
      out.nearSmoke.push(v.origin.x + dx * ts, v.origin.y + dy * ts);
    }
  }
  return out;
}
