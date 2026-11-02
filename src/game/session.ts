import { defaultLoadout, validateLoadout, type Loadout } from '../config/loadouts';
import { Match, DEFAULT_MATCH } from '../sim/match';
import type { Difficulty, Side } from '../sim/types';

// Cross-scene state: current match, chosen loadouts per side, spawn choice and settings.
// Loadouts/settings persist in localStorage when available (wrapped: storage may be blocked).

export interface Settings {
  difficulty: Difficulty;
  volume: number; // 0..1
  startSide: Side;
}

const STORE_KEY = 'assailward2d.v1';

function load(): { loadouts?: Record<Side, Loadout>; settings?: Partial<Settings>; spawn?: string } {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

class Session {
  match: Match | null = null;
  loadouts: Record<Side, Loadout> = { attack: defaultLoadout('attack'), defend: defaultLoadout('defend') };
  spawn = 'North Gate';
  settings: Settings = { difficulty: 'normal', volume: 0.7, startSide: 'attack' };
  debug = false;

  constructor() {
    const saved = load();
    if (saved.settings) this.settings = { ...this.settings, ...saved.settings };
    if (saved.spawn) this.spawn = saved.spawn;
    for (const side of ['attack', 'defend'] as Side[]) {
      const l = saved.loadouts?.[side];
      if (l && validateLoadout(side, l).length === 0) this.loadouts[side] = l;
    }
  }

  save(): void {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ loadouts: this.loadouts, settings: this.settings, spawn: this.spawn }));
    } catch {
      /* storage unavailable: settings simply are not remembered */
    }
  }

  newMatch(startSide: Side, difficulty: Difficulty): Match {
    this.settings.startSide = startSide;
    this.settings.difficulty = difficulty;
    this.save();
    this.match = new Match({ ...DEFAULT_MATCH, team0StartSide: startSide, difficulty, seed: (Date.now() & 0x7fffffff) >>> 0 });
    return this.match;
  }
}

export const session = new Session();
