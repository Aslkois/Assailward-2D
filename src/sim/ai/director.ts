import { Rng } from '../rng';
import type { Difficulty, Intent, Team } from '../types';
import type { World } from '../world';
import { BotBrain, DIFFICULTY } from './brain';
import { TeamPlanner } from './planner';

export interface BotAssignment {
  approach?: number;
}

/** Owns every bot brain plus one tactical planner per team. Produces intents each sim step. */
export class BotDirector {
  readonly brains = new Map<number, BotBrain>();
  private planners: [TeamPlanner, TeamPlanner] = [new TeamPlanner(0), new TeamPlanner(1)];

  constructor(world: World, difficulty: Difficulty, botIds: number[], assignments: Map<number, BotAssignment>, seed: number) {
    const rng = new Rng(seed ^ 0x5bd1e995);
    const diff = DIFFICULTY[difficulty];
    const counters: [number, number] = [0, 0];
    for (const id of botIds) {
      const ch = world.charById(id)!;
      const brain = new BotBrain(id, diff, new Rng(Math.floor(rng.next() * 2 ** 31)));
      const idx = counters[ch.team]++;
      if (ch.side === 'defend') {
        brain.role = idx < 3 ? 'anchor' : 'roamer';
        brain.anchorIndex = idx;
      } else {
        brain.role = 'attacker';
        brain.approach = assignments.get(id)?.approach ?? idx;
      }
      brain.aimAngle = ch.facing;
      this.brains.set(id, brain);
    }
  }

  brainsOf(world: World, team: Team): BotBrain[] {
    return [...this.brains.values()].filter((b) => world.charById(b.id)?.team === team);
  }

  think(world: World, dt: number, out: Map<number, Intent>): void {
    this.planners[0].update(world, this.brainsOf(world, 0));
    this.planners[1].update(world, this.brainsOf(world, 1));
    for (const b of this.brains.values()) out.set(b.id, b.think(world, dt));
  }
}
