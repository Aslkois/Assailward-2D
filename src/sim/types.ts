import type { Vec2 } from './math';

/** Team index: 0 is the human player's team, 1 is the opposing team. Sides swap between rounds. */
export type Team = 0 | 1;
export type Side = 'attack' | 'defend';

export const otherTeam = (t: Team): Team => (t === 0 ? 1 : 0);
export const otherSide = (s: Side): Side => (s === 'attack' ? 'defend' : 'attack');

/**
 * Per-tick control intent. Produced by the keyboard/mouse layer for the player and by the
 * bot brain for AI characters, so both go through identical game rules.
 */
export interface Intent {
  move: Vec2; // desired movement direction (length <= 1)
  aim: Vec2; // world-space aim point
  fire: boolean; // left mouse held
  firePressed: boolean; // left mouse pressed this tick
  secondary: boolean; // right mouse held (precision aim)
  secondaryPressed: boolean; // right mouse pressed this tick (secondary equipment action)
  reload: boolean;
  sprint: boolean;
  crouch: boolean;
  quiet: boolean;
  interact: boolean; // F held
  interactPressed: boolean;
  melee: boolean;
  selectSlot: number | null; // 1..5 pressed this tick
}

export function emptyIntent(aim: Vec2 = { x: 0, y: 0 }): Intent {
  return {
    move: { x: 0, y: 0 },
    aim: { x: aim.x, y: aim.y },
    fire: false,
    firePressed: false,
    secondary: false,
    secondaryPressed: false,
    reload: false,
    sprint: false,
    crouch: false,
    quiet: false,
    interact: false,
    interactPressed: false,
    melee: false,
    selectSlot: null,
  };
}

export type Difficulty = 'easy' | 'normal' | 'hard';
