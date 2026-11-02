import type { WeaponAudio } from '../config/weapons';
import type { DeployKind, ProjectileKind } from './entities';
import type { Vec2 } from './math';
import type { Team } from './types';

export type SoundKind =
  | 'footstep' | 'gunshot' | 'explosion' | 'barricade_build' | 'barricade_hit' | 'barricade_break'
  | 'wall_break' | 'wall_hit' | 'wire' | 'alarm' | 'melee' | 'reload' | 'plant' | 'disable' | 'drone'
  | 'deploy' | 'reinforce' | 'device';

/** Something audible in the world. Bots hear these (with wall occlusion); the audio layer plays them. */
export interface SoundEvent {
  pos: Vec2;
  radius: number;
  kind: SoundKind;
  sourceId: number;
  team: Team | -1;
  time: number;
}

export type ImpactMaterial = 'concrete' | 'soft' | 'wood' | 'metal' | 'shield' | 'flesh' | 'none';

export type GameEvent =
  | { type: 'shot'; shooterId: number; team: Team; from: Vec2; ends: { to: Vec2; material: ImpactMaterial }[]; audio: WeaponAudio; suppressed: boolean }
  | { type: 'hit'; targetId: number; sourceId: number; amount: number; mult: number; pos: Vec2; killed: boolean; cause: string }
  | { type: 'kill'; killerId: number; victimId: number; cause: string; assistIds: number[] }
  | { type: 'explosion'; pos: Vec2; radius: number; kind: string; team: Team }
  | { type: 'flash'; pos: Vec2; team: Team }
  | { type: 'emp'; pos: Vec2; radius: number; team: Team }
  | { type: 'smoke'; pos: Vec2 }
  | { type: 'barricade'; doorwayId: number; action: 'build_start' | 'build_tick' | 'built' | 'hit' | 'section_break' | 'breached' | 'destroyed' | 'removed' | 'build_cancel'; team: Team; pos: Vec2 }
  | { type: 'wall'; cells: number[]; action: 'hit' | 'destroyed' | 'reinforced' | 'reinforce_tick'; team: Team; pos: Vec2 }
  | { type: 'deploy'; id: number; kind: DeployKind; team: Team; pos: Vec2 }
  | { type: 'deployable_destroyed'; id: number; kind: DeployKind; team: Team; pos: Vec2 }
  | { type: 'device'; action: 'planted' | 'disabled' | 'detonated' | 'plant_tick' | 'disable_tick'; pos: Vec2 }
  | { type: 'melee'; charId: number; pos: Vec2; facing: number; heavy: boolean }
  | { type: 'reload'; charId: number; pos: Vec2 }
  | { type: 'dry'; charId: number; pos: Vec2 }
  | { type: 'throw'; charId: number; kind: ProjectileKind; pos: Vec2 }
  | { type: 'bounce'; pos: Vec2 }
  | { type: 'footstep'; charId: number; pos: Vec2; loud: number }
  | { type: 'drone'; action: 'deploy' | 'destroyed'; id: number; pos: Vec2; team: Team }
  | { type: 'alarm'; pos: Vec2; team: Team }
  | { type: 'jammed'; pos: Vec2; team: Team }
  | { type: 'scan'; charId: number; pos: Vec2; team: Team; found: number }
  | { type: 'mark'; team: Team; pos: Vec2; enemyId: number }
  | { type: 'phase'; phase: string }
  | { type: 'round_end'; winner: Team; reason: string };
