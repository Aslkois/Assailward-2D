import { describe, expect, it } from 'vitest';
import { findPath } from '../src/sim/ai/nav';
import { GameMap, MAT } from '../src/sim/map';
import { COMPOUND } from '../src/sim/maps/compound';
import { makeWorld } from './helpers';

describe('Meridian Relay Station map', () => {
  const m = new GameMap(COMPOUND);
  const walkable = (cx: number, cy: number) => m.inBounds(cx, cy) && m.matAt(cx, cy) === MAT.EMPTY;

  it('parses into a multi-room building', () => {
    expect(m.w).toBe(100);
    expect(m.h).toBe(70);
    expect(m.rooms.filter((r) => r.interior).length).toBeGreaterThanOrEqual(9);
    expect(m.rooms.filter((r) => r.objective).length).toBe(1);
    expect(m.objectiveCells.length).toBeGreaterThan(20);
  });

  it('has only permanent 3-cell doorways (48px openings, 1 cell deep)', () => {
    expect(m.doorways.length).toBe(19);
    for (const d of m.doorways) {
      expect(d.cells.length).toBe(3);
      expect(d.width).toBe(48);
    }
  });

  it('offers multiple kinds of approach into the objective room', () => {
    const obj = m.rooms.find((r) => r.objective)!;
    const doors = m.doorways.filter((d) => d.rooms.includes(obj.id));
    expect(doors.length).toBeGreaterThanOrEqual(3);
    const r = obj.rect;
    const ring = m.panels.filter((p) =>
      p.cells.some((i) => {
        const cx = i % m.w;
        const cy = Math.floor(i / m.w);
        return cx >= r.x0 - 1 && cx <= r.x1 + 1 && cy >= r.y0 - 1 && cy <= r.y1 + 1;
      }),
    );
    expect(ring.filter((p) => !p.reinforced).length).toBeGreaterThanOrEqual(4); // breachable soft walls
    expect(ring.filter((p) => p.preReinforced).length).toBeGreaterThanOrEqual(1); // hard-breach-only wall
  });

  it('places every spawn, anchor, camera and waypoint on open floor', () => {
    for (const s of COMPOUND.attackerSpawns) for (const [x, y] of s.points) expect(walkable(x, y), `${s.name} ${x},${y}`).toBe(true);
    for (const [x, y] of COMPOUND.defenderSpawns) expect(walkable(x, y)).toBe(true);
    for (const a of COMPOUND.anchors) expect(walkable(a.cx, a.cy)).toBe(true);
    for (const [x, y] of [...COMPOUND.roamPoints, ...COMPOUND.defenderPrepSpots]) expect(walkable(x, y), `${x},${y}`).toBe(true);
    for (const c of COMPOUND.cameras) expect(walkable(c.cx, c.cy), c.name).toBe(true);
    for (const ap of COMPOUND.approaches) for (const [x, y] of ap.waypoints) expect(walkable(x, y), `${ap.name} ${x},${y}`).toBe(true);
  });

  it('every attacker spawn can reach the objective through open doorways', () => {
    const w = makeWorld();
    for (const s of COMPOUND.attackerSpawns) {
      const [x, y] = s.points[0];
      const p = findPath(w, w.map.cellCenter(x, y), w.map.objectiveCenter, { barricades: 'avoid', softWalls: false, hardWalls: false, radius: 9 });
      expect(p, s.name).not.toBeNull();
    }
  });
});
