import type { Vec2 } from './math';
import type { Team } from './types';
import type { World } from './world';

// Objective mode: "Disruptor". Attackers must plant a disruptor device inside the Server Room
// objective zone and keep it alive until it detonates. Defenders win by running out the clock,
// eliminating the attackers before a plant, or disabling a planted device.

export type Phase = 'prep' | 'action' | 'planted' | 'ended';

export interface RoundRules {
  prepTime: number;
  actionTime: number;
  fuseTime: number;
  plantTime: number;
  disableTime: number;
  endDelay: number;
}

export const DEFAULT_RULES: RoundRules = {
  prepTime: 40,
  actionTime: 170,
  fuseTime: 35,
  plantTime: 6,
  disableTime: 8,
  endDelay: 5,
};

export interface RoundResult {
  winner: Team;
  reason: string;
}

export interface Device {
  pos: Vec2;
  planterId: number;
  fuseLeft: number;
}

export class RoundState {
  readonly rules: RoundRules;
  phase: Phase = 'prep';
  timeLeft: number;
  device: Device | null = null;
  result: RoundResult | null = null;
  endTimer = 0;
  done = false;

  constructor(rules?: Partial<RoundRules>) {
    this.rules = { ...DEFAULT_RULES, ...rules };
    this.timeLeft = this.rules.prepTime;
  }

  plant(world: World, planterId: number, pos: Vec2): void {
    if (this.phase !== 'action') return;
    this.device = { pos: { x: pos.x, y: pos.y }, planterId, fuseLeft: this.rules.fuseTime };
    this.phase = 'planted';
    world.emit({ type: 'device', action: 'planted', pos });
    world.emit({ type: 'phase', phase: 'planted' });
    world.sound(pos, 600, 'device', planterId, world.attackTeam);
  }

  disable(world: World): void {
    if (this.phase !== 'planted' || !this.device) return;
    world.emit({ type: 'device', action: 'disabled', pos: this.device.pos });
    this.end(world, world.defendTeam, 'Disruptor disabled');
  }

  end(world: World, winner: Team, reason: string): void {
    if (this.phase === 'ended') return;
    this.phase = 'ended';
    this.result = { winner, reason };
    this.endTimer = this.rules.endDelay;
    world.emit({ type: 'round_end', winner, reason });
  }

  update(world: World, dt: number): void {
    if (this.phase === 'ended') {
      this.endTimer -= dt;
      if (this.endTimer <= 0) this.done = true;
      return;
    }
    const atk = world.attackTeam;
    const def = world.defendTeam;
    const atkAlive = world.aliveOf(atk).length;
    const defAlive = world.aliveOf(def).length;

    if (this.phase === 'planted' && this.device) {
      this.device.fuseLeft -= dt;
      this.timeLeft = this.device.fuseLeft;
      if (defAlive === 0) return this.end(world, atk, 'Defenders eliminated');
      if (this.device.fuseLeft <= 0) {
        world.emit({ type: 'device', action: 'detonated', pos: this.device.pos });
        world.emit({ type: 'explosion', pos: this.device.pos, radius: 140, kind: 'device', team: atk });
        return this.end(world, atk, 'Disruptor detonated');
      }
      return; // attackers being wiped after a plant does not end the round: defenders must disable
    }

    if (atkAlive === 0) return this.end(world, def, 'Attackers eliminated');
    if (defAlive === 0) return this.end(world, atk, 'Defenders eliminated');

    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      if (this.phase === 'prep') {
        this.phase = 'action';
        this.timeLeft = this.rules.actionTime;
        world.emit({ type: 'phase', phase: 'action' });
        for (const c of world.chars) c.spawnZone = null;
      } else if (this.phase === 'action') {
        // A plant already in progress when the clock hits zero does not count.
        this.end(world, def, 'Time expired');
      }
    }
  }
}
