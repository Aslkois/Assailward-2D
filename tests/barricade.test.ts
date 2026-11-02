import { describe, expect, it } from 'vitest';
import { BARRICADE_BUILD_TIME, BARRICADE_SEGMENT_HP } from '../src/config/constants';
import { barricadeBlocksPassage, createBarricade, largestGap, segmentCenter, segmentCount } from '../src/sim/barricade';
import { circleBlocked } from '../src/sim/collision';
import { castStatic } from '../src/sim/raycast';
import { lineOfSight } from '../src/sim/sight';
import { traceBullet } from '../src/sim/combat';
import { findContextAction } from '../src/sim/actions';
import { byTeam, doorAtCell, makeWorld, place, run, toAction } from './helpers';

// Lobby <-> Main Hall doorway: vertical opening at x=35, y=16..18 (Lobby west, Main Hall east).
const DOOR = [35, 17] as const;

function completeBarricade(w: ReturnType<typeof makeWorld>, d: ReturnType<typeof doorAtCell>) {
  d.barricade = createBarricade(d, w.defendTeam, -1);
  d.barricade.complete = true;
  d.barricade.progress = 1;
}

describe('doorways and barricades', () => {
  it('doorways start open, with no hinged doors anywhere in the map model', () => {
    const w = makeWorld();
    expect(w.map.doorways.length).toBeGreaterThanOrEqual(15);
    for (const d of w.map.doorways) {
      expect(d.barricade).toBeNull();
      expect(d.width).toBe(48);
      expect(w.doorwayStatus(d.id).state).toBe('open');
      expect(w.doorwayStatus(d.id).passable).toBe(true);
      expect(Object.keys(d)).not.toContain('hinge');
    }
  });

  it('defender builds a barricade with F over time; it only obstructs once completed', () => {
    const w = makeWorld({ sides: ['attack', 'defend'] });
    const def = byTeam(w, 1);
    const d = doorAtCell(w, ...DOOR);
    place(def, 36, 17); // Main Hall side, right next to the doorway
    const ctx = findContextAction(w, def);
    expect(ctx?.kind).toBe('build_barricade');
    run(w, BARRICADE_BUILD_TIME * 0.5, { [def.id]: () => ({ interact: true }) });
    expect(d.barricade).not.toBeNull();
    expect(d.barricade!.complete).toBe(false);
    expect(d.barricade!.progress).toBeGreaterThan(0.2);
    expect(w.doorwayStatus(d.id).state).toBe('building');
    expect(circleBlocked(w, d.center.x, d.center.y, 9)).toBe(false); // still passable while building
    run(w, BARRICADE_BUILD_TIME * 0.6, { [def.id]: () => ({ interact: true }) });
    expect(d.barricade!.complete).toBe(true);
    expect(w.doorwayStatus(d.id).state).toBe('barricaded');
    expect(w.events.some((e) => e.type === 'barricade' && e.action === 'built')).toBe(true);
    expect(circleBlocked(w, d.center.x, d.center.y, 9)).toBe(true);
  });

  it('releasing F cancels construction and leaves the doorway open', () => {
    const w = makeWorld();
    const def = byTeam(w, 1);
    const d = doorAtCell(w, ...DOOR);
    place(def, 36, 17);
    run(w, 1, { [def.id]: () => ({ interact: true }) });
    run(w, 0.1);
    expect(d.barricade).toBeNull();
  });

  it('a completed barricade physically blocks an operator walking through', () => {
    const w = makeWorld();
    const atk = byTeam(w, 0);
    const d = doorAtCell(w, ...DOOR);
    completeBarricade(w, d);
    toAction(w);
    place(atk, 32, 17); // Lobby side
    run(w, 2, { [atk.id]: () => ({ move: { x: 1, y: 0 } }) });
    expect(atk.pos.x).toBeLessThan(d.center.x);
    // Same walk with an open doorway succeeds
    const w2 = makeWorld();
    const atk2 = byTeam(w2, 0);
    toAction(w2);
    place(atk2, 32, 17);
    run(w2, 2, { [atk2.id]: () => ({ move: { x: 1, y: 0 } }) });
    expect(atk2.pos.x).toBeGreaterThan(d.center.x + 20);
  });

  it('bullets damage only the section they hit (localized destruction)', () => {
    const w = makeWorld();
    const atk = byTeam(w, 0);
    const d = doorAtCell(w, ...DOOR);
    completeBarricade(w, d);
    const n = segmentCount(d);
    expect(n).toBe(6);
    const target = segmentCenter(d, 1);
    place(atk, 30, 17);
    atk.pos.y = target.y;
    const hit = traceBullet(w, atk, atk.pos.x, atk.pos.y, 1, 0, 1000);
    expect(hit.kind).toBe('barricade');
    expect(hit.segment).toBe(1);
    w.damageBarricade(d.id, new Map([[1, 25]]), 0, target);
    expect(d.barricade!.segments[1]).toBe(BARRICADE_SEGMENT_HP - 25);
    for (let i = 0; i < n; i++) if (i !== 1) expect(d.barricade!.segments[i]).toBe(BARRICADE_SEGMENT_HP);
  });

  it('holes let sight and bullets through only where sections are destroyed', () => {
    const w = makeWorld();
    const d = doorAtCell(w, ...DOOR);
    completeBarricade(w, d);
    const s0 = segmentCenter(d, 0);
    const s4 = segmentCenter(d, 4);
    const from0 = { x: s0.x - 60, y: s0.y };
    const to0 = { x: s0.x + 60, y: s0.y };
    expect(lineOfSight(w, from0, to0)).toBe(false);
    w.damageBarricade(d.id, new Map([[0, 999]]), 0, s0);
    expect(lineOfSight(w, from0, to0)).toBe(true);
    expect(lineOfSight(w, { x: s4.x - 60, y: s4.y }, { x: s4.x + 60, y: s4.y })).toBe(false);
    const hit = castStatic(w.map, from0.x, from0.y, 1, 0, 120, true);
    expect(hit.kind).toBe('none');
  });

  it('only a wide enough contiguous gap restores passage', () => {
    const w = makeWorld();
    const d = doorAtCell(w, ...DOOR);
    completeBarricade(w, d);
    const kill = (i: number) => w.damageBarricade(d.id, new Map([[i, 999]]), 0, d.center);
    kill(0);
    kill(2);
    kill(4); // three holes, but none adjacent
    expect(barricadeBlocksPassage(d)).toBe(true);
    expect(w.doorwayStatus(d.id).state).toBe('damaged');
    expect(w.doorwayStatus(d.id).seeThrough).toBe(true);
    kill(3); // 2,3,4 contiguous = 24px gap
    expect(largestGap(d, d.barricade!)).toBe(24);
    expect(barricadeBlocksPassage(d)).toBe(false);
    expect(w.doorwayStatus(d.id).state).toBe('breached');
    expect(w.doorwayStatus(d.id).passable).toBe(true);
    // An operator can now physically walk through the gap
    const atk = byTeam(w, 0);
    toAction(w);
    place(atk, 32, 17);
    atk.pos.y = segmentCenter(d, 3).y;
    run(w, 2, { [atk.id]: () => ({ move: { x: 1, y: 0 } }) });
    expect(atk.pos.x).toBeGreaterThan(d.center.x + 20);
    // Remaining sections keep their damage state (persistence)
    expect(d.barricade!.segments[1]).toBe(BARRICADE_SEGMENT_HP);
  });

  it('attackers bash barricades with F (melee) and wear sections down', () => {
    const w = makeWorld();
    const atk = byTeam(w, 0);
    const d = doorAtCell(w, ...DOOR);
    completeBarricade(w, d);
    toAction(w);
    place(atk, 34, 17);
    atk.pos.x = d.rect.x0 - 10;
    atk.facing = 0;
    expect(findContextAction(w, atk)?.kind).toBe('bash');
    run(w, 3, { [atk.id]: () => ({ interact: true, aim: { x: d.center.x + 50, y: d.center.y } }) });
    expect(d.barricade!.segments.filter((hp) => hp <= 0).length).toBeGreaterThanOrEqual(3);
    expect(w.doorwayStatus(d.id).passable).toBe(true);
  });

  it('defenders can remove a barricade; a damaged one cannot be rebuilt this round', () => {
    const w = makeWorld();
    const def = byTeam(w, 1);
    const d = doorAtCell(w, ...DOOR);
    completeBarricade(w, d);
    d.barricade!.team = def.team;
    place(def, 36, 17);
    expect(findContextAction(w, def)?.kind).toBe('remove_barricade');
    run(w, 1.5, { [def.id]: () => ({ interact: true }) });
    expect(d.barricade).toBeNull();
    run(w, 0.1);
    expect(findContextAction(w, def)?.kind).toBe('build_barricade');
    // damaged -> torn down -> spent
    completeBarricade(w, d);
    d.barricade!.team = def.team;
    w.damageBarricade(d.id, new Map([[0, 10]]), 0, d.center);
    run(w, 1.5, { [def.id]: () => ({ interact: true }) });
    expect(d.barricade).toBeNull();
    run(w, 0.1);
    expect(findContextAction(w, def)?.kind).not.toBe('build_barricade');
  });

  it('a completed barricade pushes anyone standing in the opening out of it', () => {
    const w = makeWorld();
    const def = byTeam(w, 1);
    const atk = byTeam(w, 0);
    const d = doorAtCell(w, ...DOOR);
    place(def, 36, 17);
    atk.pos.x = d.center.x;
    atk.pos.y = d.center.y;
    run(w, BARRICADE_BUILD_TIME + 0.2, { [def.id]: () => ({ interact: true }) });
    expect(d.barricade?.complete).toBe(true);
    expect(circleBlocked(w, atk.pos.x, atk.pos.y, atk.radius - 0.5)).toBe(false);
  });
});
