// Headless diagnostics: plays N bot-only rounds and prints outcome statistics.
// Usage: npx vite-node scripts/diag.ts [rounds] [difficulty]
import { SIM_DT } from '../src/config/constants';
import { Match } from '../src/sim/match';
import { createRound } from '../src/sim/setup';
import type { Intent, Difficulty } from '../src/sim/types';

const rounds = Number(process.argv[2] ?? 10);
const difficulty = (process.argv[3] ?? 'normal') as Difficulty;
const reasons = new Map<string, number>();
const counters = new Map<string, number>();
const inc = (k: string, n = 1) => counters.set(k, (counters.get(k) ?? 0) + n);
let atkWins = 0;
let totalTime = 0;
for (let r = 0; r < rounds; r++) {
  const match = new Match({ roundsToWin: 99, swapEvery: 1, team0StartSide: r % 2 ? 'defend' : 'attack', difficulty, seed: 1000 + r });
  const { world, director } = createRound({ match, playerLoadout: null });
  const intents = new Map<number, Intent>();
  const t0 = performance.now();
  let steps = 0;
  while (!world.round.done && world.time < 400) {
    intents.clear();
    director.think(world, SIM_DT, intents);
    world.step(SIM_DT, intents);
    steps++;
    for (const e of world.events) {
      if (e.type === 'barricade') inc(`barricade.${e.action}`);
      else if (e.type === 'wall') inc(`wall.${e.action}`);
      else if (e.type === 'kill') inc('kills');
      else if (e.type === 'explosion') inc(`explosion.${e.kind}`);
      else if (e.type === 'deploy') inc(`deploy.${e.kind}`);
      else if (e.type === 'device') inc(`device.${e.action}`);
      else if (e.type === 'throw') inc(`throw.${e.kind}`);
      else if (e.type === 'flash') inc('flash');
      else if (e.type === 'scan') inc('scan');
      else if (e.type === 'mark') inc('mark');
      else if (e.type === 'drone') inc(`drone.${e.action}`);
      else if (e.type === 'melee') inc(e.heavy ? 'hammer' : 'melee');
    }
    world.events.length = 0;
  }
  const ms = performance.now() - t0;
  const res = world.round.result;
  const reason = res ? res.reason : 'unfinished';
  reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  if (res && res.winner === world.attackTeam) atkWins++;
  totalTime += world.time;
  const states = [...director.brains.values()].map((b) => `${world.charById(b.id)!.name}:${b.debugState}`).join(' ');
  console.log(`round ${r}: ${reason} t=${world.time.toFixed(0)}s (${(ms / steps).toFixed(2)} ms/step) ${res && world.round.phase === 'ended' ? '' : states}`);
}
console.log('\nreasons', Object.fromEntries(reasons));
console.log('attacker win rate', (atkWins / rounds).toFixed(2), 'avg round', (totalTime / rounds).toFixed(0), 's');
console.log(Object.fromEntries([...counters.entries()].sort()));
