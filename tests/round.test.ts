import { describe, expect, it } from 'vitest';
import { Match } from '../src/sim/match';
import { byTeam, makeWorld, place, run, toAction } from './helpers';

describe('round phases and objective', () => {
  it('starts in preparation and moves to the action phase', () => {
    const w = makeWorld({ rules: { prepTime: 1 } });
    expect(w.round.phase).toBe('prep');
    run(w, 1.1);
    expect(w.round.phase).toBe('action');
  });

  it('attackers are confined to their spawn zone during preparation', () => {
    const w = makeWorld();
    const atk = byTeam(w, 0);
    const zone = atk.spawnZone!;
    run(w, 3, { [atk.id]: () => ({ move: { x: 0, y: 1 }, sprint: true }) });
    expect(atk.pos.y).toBeLessThanOrEqual(zone.y1);
  });

  it('plant -> detonation wins the round for attackers', () => {
    const w = makeWorld({ rules: { fuseTime: 2, plantTime: 1 } });
    const atk = byTeam(w, 0);
    toAction(w);
    place(atk, 49, 34);
    run(w, 1.2, { [atk.id]: () => ({ interact: true }) });
    expect(w.round.phase).toBe('planted');
    expect(w.round.device).not.toBeNull();
    run(w, 2.2);
    expect(w.round.result?.winner).toBe(w.attackTeam);
    expect(w.round.result?.reason).toMatch(/detonated/i);
  });

  it('defenders disabling a planted device win the round', () => {
    const w = makeWorld({ rules: { fuseTime: 30, plantTime: 1, disableTime: 1 } });
    const atk = byTeam(w, 0);
    const def = byTeam(w, 1);
    toAction(w);
    place(atk, 49, 34);
    run(w, 1.2, { [atk.id]: () => ({ interact: true }) });
    place(atk, 20, 20);
    place(def, 50, 34);
    run(w, 1.2, { [def.id]: () => ({ interact: true }) });
    expect(w.round.result?.winner).toBe(w.defendTeam);
    expect(w.round.result?.reason).toMatch(/disabled/i);
  });

  it('time expiring without a plant is a defender win; eliminations end rounds', () => {
    const w = makeWorld({ rules: { actionTime: 1 } });
    toAction(w);
    run(w, 1.2);
    expect(w.round.result?.winner).toBe(w.defendTeam);

    const w2 = makeWorld();
    toAction(w2);
    w2.damageCharacter(byTeam(w2, 1), 500, byTeam(w2, 0).id, 'test');
    run(w2, 0.05);
    expect(w2.round.result?.winner).toBe(w2.attackTeam);
    expect(byTeam(w2, 0).stats.kills).toBe(1);
  });

  it('round end waits for the end delay before reporting done', () => {
    const w = makeWorld({ rules: { actionTime: 0.5, endDelay: 1 } });
    toAction(w);
    run(w, 0.6);
    expect(w.round.phase).toBe('ended');
    expect(w.round.done).toBe(false);
    run(w, 1.1);
    expect(w.round.done).toBe(true);
  });
});

describe('match flow and side switching', () => {
  it('switches sides every N rounds and ends at the win target', () => {
    const m = new Match({ roundsToWin: 4, swapEvery: 2, team0StartSide: 'attack', difficulty: 'normal', seed: 1 });
    expect(m.sides()).toEqual(['attack', 'defend']);
    expect(m.swapsAfterThisRound()).toBe(false);
    m.record({ winner: 0, reason: 'x' });
    expect(m.round).toBe(2);
    expect(m.sides()).toEqual(['attack', 'defend']);
    expect(m.swapsAfterThisRound()).toBe(true);
    m.record({ winner: 1, reason: 'x' });
    expect(m.sides()).toEqual(['defend', 'attack']);
    m.record({ winner: 0, reason: 'x' });
    m.record({ winner: 0, reason: 'x' });
    expect(m.sides()).toEqual(['attack', 'defend']);
    expect(m.isOver()).toBe(false);
    m.record({ winner: 0, reason: 'x' });
    expect(m.isOver()).toBe(true);
    expect(m.winner()).toBe(0);
    expect(m.scores).toEqual([4, 1]);
  });
});
