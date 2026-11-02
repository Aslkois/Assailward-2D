import { botLoadout, defaultLoadout, type Loadout } from '../config/loadouts';
import { BotDirector, type BotAssignment } from './ai/director';
import { COMPOUND } from './maps/compound';
import type { MapDef } from './map';
import type { Match } from './match';
import { Rng } from './rng';
import type { RoundRules } from './round';
import type { Team } from './types';
import { World, type RosterEntry } from './world';

export const TEAM_NAMES: [string, string] = ['BLUE', 'RED'];
export const BOT_NAMES: [string[], string[]] = [
  ['Kestrel', 'Juniper', 'Ostrava', 'Pike'],
  ['Vanta', 'Moros', 'Halcyon', 'Brandt', 'Sable'],
];

export interface RoundSetup {
  match: Match;
  playerLoadout: Loadout | null; // null = the player's slot is also controlled by a bot (headless/autoplay)
  playerSpawn?: string;
  mapDef?: MapDef;
  rules?: Partial<RoundRules>;
  playerName?: string;
}

export interface RoundInstance {
  world: World;
  director: BotDirector;
}

export function createRound(setup: RoundSetup): RoundInstance {
  const { match } = setup;
  const mapDef = setup.mapDef ?? COMPOUND;
  const sides = match.sides();
  const seed = (match.config.seed * 7919 + match.round * 104729) >>> 0;
  const rng = new Rng(seed);
  const roster: RosterEntry[] = [];
  const assignments = new Map<string, BotAssignment>();
  const approaches = mapDef.approaches;

  for (const team of [0, 1] as Team[]) {
    const side = sides[team];
    const names = team === 0 ? [setup.playerName ?? 'You', ...BOT_NAMES[0]] : BOT_NAMES[1];
    // shuffle approach order per round so attacks vary
    const order = rng.shuffle(approaches.map((_, i) => i));
    names.forEach((name, i) => {
      const isHuman = team === 0 && i === 0 && setup.playerLoadout !== null;
      const loadout = isHuman ? setup.playerLoadout! : team === 0 && i === 0 ? defaultLoadout(side) : botLoadout(side, i, rng);
      const entry: RosterEntry = { name, team, isPlayer: team === 0 && i === 0, loadout };
      if (side === 'attack') {
        if (isHuman && setup.playerSpawn) entry.spawn = setup.playerSpawn;
        else {
          const hardIdx = approaches.findIndex((a) => a.hardBreach);
          const ai = loadout.utilities.includes('hard_breach') && hardIdx >= 0 ? hardIdx : order[i % order.length];
          entry.spawn = approaches[ai].spawn;
          assignments.set(name, { approach: ai });
        }
      }
      roster.push(entry);
    });
  }

  const world = new World({ mapDef, sides, roster, seed, rules: setup.rules });
  const botIds = world.chars.filter((c) => !(c.isPlayer && setup.playerLoadout !== null)).map((c) => c.id);
  const byId = new Map<number, BotAssignment>();
  for (const c of world.chars) {
    const a = assignments.get(c.name);
    if (a) byId.set(c.id, a);
  }
  const director = new BotDirector(world, match.config.difficulty, botIds, byId, seed);
  return { world, director };
}
