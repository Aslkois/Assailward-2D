import type { RoundResult } from './round';
import { otherSide, type Difficulty, type Side, type Team } from './types';

export interface MatchConfig {
  roundsToWin: number;
  swapEvery: number; // sides switch after this many rounds
  team0StartSide: Side;
  difficulty: Difficulty;
  seed: number;
}

export const DEFAULT_MATCH: Omit<MatchConfig, 'team0StartSide' | 'difficulty' | 'seed'> = {
  roundsToWin: 4,
  swapEvery: 2,
};

export interface PlayerTally {
  name: string;
  team: Team;
  kills: number;
  deaths: number;
  assists: number;
  plants: number;
  disables: number;
}

export interface RoundRecord extends RoundResult {
  round: number;
  attackers: Team;
}

/** Match flow: round counting, scores and side switching. Pure and independent of rendering. */
export class Match {
  readonly config: MatchConfig;
  scores: [number, number] = [0, 0];
  round = 1;
  history: RoundRecord[] = [];
  tallies = new Map<string, PlayerTally>();

  constructor(config: MatchConfig) {
    this.config = config;
  }

  /** Side of `team` in the current round. */
  sideOf(team: Team, round = this.round): Side {
    const swaps = Math.floor((round - 1) / this.config.swapEvery);
    const t0 = swaps % 2 === 0 ? this.config.team0StartSide : otherSide(this.config.team0StartSide);
    return team === 0 ? t0 : otherSide(t0);
  }

  sides(round = this.round): [Side, Side] {
    return [this.sideOf(0, round), this.sideOf(1, round)];
  }

  /** True if the next round has the teams on swapped sides. */
  swapsAfterThisRound(): boolean {
    return this.sideOf(0, this.round) !== this.sideOf(0, this.round + 1);
  }

  record(result: RoundResult): void {
    this.history.push({ ...result, round: this.round, attackers: this.sideOf(0) === 'attack' ? 0 : 1 });
    this.scores[result.winner]++;
    if (!this.isOver()) this.round++;
  }

  addTallies(rows: { name: string; team: Team; kills: number; deaths: number; assists: number; plants: number; disables: number }[]): void {
    for (const r of rows) {
      const t = this.tallies.get(r.name) ?? { name: r.name, team: r.team, kills: 0, deaths: 0, assists: 0, plants: 0, disables: 0 };
      t.kills += r.kills;
      t.deaths += r.deaths;
      t.assists += r.assists;
      t.plants += r.plants;
      t.disables += r.disables;
      this.tallies.set(r.name, t);
    }
  }

  isOver(): boolean {
    return this.scores[0] >= this.config.roundsToWin || this.scores[1] >= this.config.roundsToWin;
  }

  winner(): Team | null {
    if (this.scores[0] >= this.config.roundsToWin) return 0;
    if (this.scores[1] >= this.config.roundsToWin) return 1;
    return null;
  }
}
