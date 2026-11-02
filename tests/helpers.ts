import { defaultLoadout, type Loadout } from '../src/config/loadouts';
import { SIM_DT } from '../src/config/constants';
import { COMPOUND } from '../src/sim/maps/compound';
import type { Character } from '../src/sim/entities';
import { emptyIntent, type Intent, type Side, type Team } from '../src/sim/types';
import { World, type RosterEntry } from '../src/sim/world';
import type { RoundRules } from '../src/sim/round';

export function makeWorld(opts: { sides?: [Side, Side]; roster?: RosterEntry[]; rules?: Partial<RoundRules>; seed?: number } = {}): World {
  const sides = opts.sides ?? ['attack', 'defend'];
  const roster: RosterEntry[] = opts.roster ?? [
    { name: 'Atk', team: 0, isPlayer: true, loadout: defaultLoadout(sides[0]) },
    { name: 'Def', team: 1, isPlayer: false, loadout: defaultLoadout(sides[1]) },
  ];
  return new World({ mapDef: COMPOUND, sides, roster, seed: opts.seed ?? 1234, rules: opts.rules });
}

export function loadoutWith(side: Side, patch: Partial<Loadout>): Loadout {
  return { ...defaultLoadout(side), ...patch };
}

export function doorAtCell(w: World, cx: number, cy: number) {
  const id = w.map.doorOf[w.map.idx(cx, cy)];
  if (id < 0) throw new Error(`No doorway at ${cx},${cy}`);
  return w.map.doorways[id];
}

export function place(ch: Character, cx: number, cy: number): void {
  ch.pos.x = (cx + 0.5) * 16;
  ch.pos.y = (cy + 0.5) * 16;
  ch.vel.x = ch.vel.y = 0;
}

/** Runs the world with per-character intent factories for `seconds`. */
export function run(w: World, seconds: number, intents: Record<number, (w: World) => Partial<Intent>> = {}): void {
  const steps = Math.round(seconds / SIM_DT);
  for (let s = 0; s < steps; s++) {
    const map = new Map<number, Intent>();
    for (const c of w.chars) {
      const base = emptyIntent(c.pos);
      base.aim = { x: c.pos.x + Math.cos(c.facing) * 50, y: c.pos.y + Math.sin(c.facing) * 50 };
      const f = intents[c.id];
      map.set(c.id, f ? { ...base, ...f(w) } : base);
    }
    w.step(SIM_DT, map);
  }
}

export function byTeam(w: World, team: Team): Character {
  return w.chars.find((c) => c.team === team)!;
}

/** Skips the preparation phase. */
export function toAction(w: World): void {
  w.round.timeLeft = 0.001;
  run(w, SIM_DT * 2);
}
