import { describe, expect, it } from 'vitest';
import {
  CENTERLINE_MAX_MULTIPLIER,
  centerlineMultiplier,
  computeBulletDamage,
  evaluateCenterlineHit,
  perpendicularDistance,
} from '../src/sim/damage';
import { fromAngle } from '../src/sim/math';

const R = 9;
const C = { x: 100, y: 50 };

/** Fires from 200px away along `angle`, offset perpendicular to the trajectory by `offset`. */
function shotAt(angle: number, offset: number) {
  const dir = fromAngle(angle);
  const perp = { x: -dir.y, y: dir.x };
  const origin = { x: C.x - dir.x * 200 + perp.x * offset, y: C.y - dir.y * 200 + perp.y * offset };
  return { origin, dir };
}

describe('centerline damage scaling', () => {
  it('gives the full 1.5x through the exact centre', () => {
    const { origin, dir } = shotAt(0, 0);
    const hit = evaluateCenterlineHit(origin, dir, C, R)!;
    expect(hit).not.toBeNull();
    expect(hit.multiplier).toBeCloseTo(1.5, 10);
    expect(hit.proximity).toBeCloseTo(1, 10);
  });

  it.each([
    [0.25, 1.375],
    [0.5, 1.25],
    [0.75, 1.125],
  ])('scales off-centre hits at %s of the radius to %s', (frac, expected) => {
    const { origin, dir } = shotAt(0, frac * R);
    const hit = evaluateCenterlineHit(origin, dir, C, R)!;
    expect(hit).not.toBeNull();
    expect(hit.multiplier).toBeCloseTo(expected, 10);
  });

  it('gives exactly 1.0x at the collision edge (tangent shot)', () => {
    const { origin, dir } = shotAt(0, R);
    const hit = evaluateCenterlineHit(origin, dir, C, R)!;
    expect(hit).not.toBeNull();
    expect(hit.multiplier).toBeCloseTo(1.0, 10);
  });

  it('returns null (no damage) for a miss just outside the hitbox', () => {
    const { origin, dir } = shotAt(0, R + 0.01);
    expect(evaluateCenterlineHit(origin, dir, C, R)).toBeNull();
    const far = shotAt(1.1, 40);
    expect(evaluateCenterlineHit(far.origin, far.dir, C, R)).toBeNull();
  });

  it('returns null when the target is behind the shooter', () => {
    const dir = { x: 1, y: 0 };
    const origin = { x: C.x + 50, y: C.y }; // shooting away from the target
    expect(evaluateCenterlineHit(origin, dir, C, R)).toBeNull();
  });

  it('returns null when beyond max range', () => {
    const { origin, dir } = shotAt(0, 0);
    expect(evaluateCenterlineHit(origin, dir, C, R, 150)).toBeNull();
    expect(evaluateCenterlineHit(origin, dir, C, R, 250)).not.toBeNull();
  });

  it('is identical from every firing direction (rotation invariant)', () => {
    for (let i = 0; i < 64; i++) {
      const angle = (i / 64) * Math.PI * 2 + 0.013;
      for (const [frac, expected] of [[0, 1.5], [0.25, 1.375], [0.5, 1.25], [0.75, 1.125], [1, 1.0]] as const) {
        for (const sign of [-1, 1]) {
          const { origin, dir } = shotAt(angle, sign * frac * R);
          const hit = evaluateCenterlineHit(origin, dir, C, R);
          expect(hit, `angle ${angle} frac ${frac}`).not.toBeNull();
          expect(hit!.multiplier).toBeCloseTo(expected, 9);
        }
      }
    }
  });

  it('does not depend on target orientation: only trajectory and centre are inputs', () => {
    // The API has no facing parameter; a centred shot from the "back" equals one from the "front".
    const front = shotAt(0, 0);
    const back = shotAt(Math.PI, 0);
    expect(evaluateCenterlineHit(front.origin, front.dir, C, R)!.multiplier).toBeCloseTo(
      evaluateCenterlineHit(back.origin, back.dir, C, R)!.multiplier,
      12,
    );
  });

  it('uses any point on the trajectory for d = |cross(D, C - P)|', () => {
    const dir = fromAngle(0.7);
    const p0 = { x: 10, y: 20 };
    const p1 = { x: p0.x + dir.x * 333, y: p0.y + dir.y * 333 };
    expect(perpendicularDistance(p0, dir, C)).toBeCloseTo(perpendicularDistance(p1, dir, C), 9);
  });

  it('never exceeds 1.5x and never drops below 1.0x', () => {
    for (let d = -5; d <= 20; d += 0.25) {
      const m = centerlineMultiplier(Math.abs(d), R);
      expect(m).toBeLessThanOrEqual(CENTERLINE_MAX_MULTIPLIER);
      expect(m).toBeGreaterThanOrEqual(1);
    }
    const bd = computeBulletDamage(30, 0, { start: 100, end: 200, min: 0.5 }, 9.99, 0);
    expect(bd.centerline).toBe(1.5);
  });

  it('applies the documented pipeline order: base x falloff x centerline x armour', () => {
    const bd = computeBulletDamage(40, 150, { start: 100, end: 200, min: 0.5 }, 1.25, 0.2);
    expect(bd.falloff).toBeCloseTo(0.75, 10);
    expect(bd.final).toBeCloseTo(40 * 0.75 * 1.25 * 0.8, 10);
  });
});
