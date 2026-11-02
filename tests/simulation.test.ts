import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../src/config/constants';
import { Match } from '../src/sim/match';
import { createRound } from '../src/sim/setup';
import type { Intent } from '../src/sim/types';
import type { GameEvent } from '../src/sim/events';

/** Plays one round with every operator (including the player slot) driven by the AI. */
function playRound(match: Match, maxSeconds = 330) {
  const { world, director } = createRound({ match, playerLoadout: null });
  const events: GameEvent[] = [];
  const intents = new Map<number, Intent>();
  const steps = Math.round(maxSeconds / SIM_DT);
  let nanSeen = false;
  for (let s = 0; s < steps && !world.round.done; s++) {
    intents.clear();
    director.think(world, SIM_DT, intents);
    world.step(SIM_DT, intents);
    events.push(...world.events);
    world.events.length = 0;
    if (s % 60 === 0) for (const c of world.chars) if (!Number.isFinite(c.pos.x) || !Number.isFinite(c.pos.y)) nanSeen = true;
  }
  return { world, events, nanSeen };
}

describe('headless bot-vs-bot rounds', () => {
  it('plays complete rounds with real fights, preparation work and valid outcomes', () => {
    const match = new Match({ roundsToWin: 2, swapEvery: 1, team0StartSide: 'attack', difficulty: 'normal', seed: 42 });
    const summary: string[] = [];
    let totalKills = 0;
    let built = 0;
    let reinforced = 0;
    let drones = 0;
    let shots = 0;
    for (let r = 0; r < 3 && !match.isOver(); r++) {
      const { world, events, nanSeen } = playRound(match);
      expect(nanSeen).toBe(false);
      expect(world.round.result, `round ${match.round} must finish`).not.toBeNull();
      const kills = events.filter((e) => e.type === 'kill').length;
      totalKills += kills;
      built += events.filter((e) => e.type === 'barricade' && e.action === 'built').length;
      reinforced += events.filter((e) => e.type === 'wall' && e.action === 'reinforced').length;
      drones += events.filter((e) => e.type === 'drone' && e.action === 'deploy').length;
      shots += events.filter((e) => e.type === 'shot').length;
      summary.push(`R${match.round}: ${world.round.result!.reason} -> team ${world.round.result!.winner} (kills ${kills}, t=${world.time.toFixed(0)}s)`);
      match.record(world.round.result!);
    }
    console.log(summary.join('\n'), `\nbarricades built ${built}, walls reinforced ${reinforced}, drones ${drones}, shots ${shots}`);
    expect(totalKills).toBeGreaterThan(0);
    expect(built).toBeGreaterThan(0);
    expect(reinforced).toBeGreaterThan(0);
    expect(drones).toBeGreaterThan(0);
    expect(shots).toBeGreaterThan(20);
  });
});
