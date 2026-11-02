import type { GameEvent } from '../../sim/events';
import type { Vec2 } from '../../sim/math';
import { countWallsBetween } from '../../sim/raycast';
import type { Team } from '../../sim/types';
import type { World } from '../../sim/world';
import { synth } from './Synth';

/** Maps simulation events to positional procedural sounds for the listening player. */
export class AudioDirector {
  listener: Vec2 = { x: 0, y: 0 };
  team: Team = 0;
  playerId = -1;

  constructor(private world: World) {}

  private spatial(pos: Vec2, radius: number): { vol: number; pan: number; walls: number } {
    const d = Math.hypot(pos.x - this.listener.x, pos.y - this.listener.y);
    if (d > radius) return { vol: 0, pan: 0, walls: 0 };
    const walls = countWallsBetween(this.world.map, pos, this.listener, 4);
    const vol = Math.pow(1 - d / radius, 1.25) * Math.pow(0.6, walls);
    return { vol, pan: Math.max(-1, Math.min(1, (pos.x - this.listener.x) / 360)), walls };
  }

  play(e: GameEvent): void {
    if (!synth.ready) return;
    switch (e.type) {
      case 'shot': {
        const own = e.shooterId === this.playerId;
        const s = this.spatial(e.from, 1100);
        synth.gunshot(e.audio, own ? 0.5 : 0.75 * s.vol, own ? 0 : s.pan, !own && s.walls > 0);
        break;
      }
      case 'explosion': {
        const s = this.spatial(e.pos, 1500);
        synth.explosion(Math.min(1, s.vol * 1.1), s.pan, e.kind !== 'claymore');
        break;
      }
      case 'flash': {
        const s = this.spatial(e.pos, 1000);
        const me = this.world.charById(this.playerId);
        const ring = me && me.alive && me.blindUntil > this.world.time ? me.blindStrength : 0;
        synth.flashbang(s.vol, s.pan, ring);
        break;
      }
      case 'barricade': {
        const s = this.spatial(e.pos, e.action === 'section_break' || e.action === 'destroyed' || e.action === 'breached' ? 650 : 420);
        if (e.action === 'build_tick' || e.action === 'build_start') synth.knock(0.55 * s.vol, s.pan);
        else if (e.action === 'built') {
          synth.knock(0.7 * s.vol, s.pan);
          setTimeout(() => synth.knock(0.6 * s.vol, s.pan), 90);
        } else if (e.action === 'hit' || e.action === 'removed') synth.woodHit(0.6 * s.vol, s.pan);
        else if (e.action === 'section_break' || e.action === 'destroyed' || e.action === 'breached') synth.woodBreak(0.8 * s.vol, s.pan);
        break;
      }
      case 'wall': {
        if (e.action === 'hit') {
          const s = this.spatial(e.pos, 380);
          synth.plaster(0.5 * s.vol, s.pan);
        } else if (e.action === 'destroyed') {
          const s = this.spatial(e.pos, 800);
          synth.crumble(0.8 * s.vol, s.pan);
        } else if (e.action === 'reinforce_tick') {
          const s = this.spatial(e.pos, 420);
          synth.metal(0.35 * s.vol, s.pan);
        } else if (e.action === 'reinforced') {
          const s = this.spatial(e.pos, 520);
          synth.metal(0.6 * s.vol, s.pan, true);
        }
        break;
      }
      case 'footstep': {
        const own = e.charId === this.playerId;
        const s = this.spatial(e.pos, e.loud * 1.15 + 20);
        synth.footstep(own ? 0.12 : 0.55 * s.vol, own ? 0 : s.pan);
        break;
      }
      case 'reload':
      case 'dry': {
        const s = this.spatial(e.pos, 160);
        if (e.type === 'reload') synth.reload(0.5 * s.vol, s.pan);
        else synth.click(0.5 * s.vol, s.pan, 0.6);
        break;
      }
      case 'melee': {
        const s = this.spatial(e.pos, 300);
        synth.whoosh((e.heavy ? 0.7 : 0.45) * s.vol, s.pan);
        break;
      }
      case 'throw': {
        const s = this.spatial(e.pos, 240);
        synth.whoosh(0.4 * s.vol, s.pan);
        break;
      }
      case 'bounce': {
        const s = this.spatial(e.pos, 260);
        synth.click(0.35 * s.vol, s.pan, 0.5);
        break;
      }
      case 'drone': {
        const s = this.spatial(e.pos, 300);
        if (e.action === 'deploy') synth.sweep(0.3 * s.vol, s.pan);
        else synth.buzz(0.4 * s.vol, s.pan);
        break;
      }
      case 'deploy': {
        const s = this.spatial(e.pos, 220);
        synth.click(0.45 * s.vol, s.pan, 0.8);
        break;
      }
      case 'deployable_destroyed': {
        const s = this.spatial(e.pos, 320);
        synth.buzz(0.35 * s.vol, s.pan);
        break;
      }
      case 'alarm': {
        const s = this.spatial(e.pos, 650);
        synth.beep(0.6 * s.vol, s.pan, 1750, 0.07);
        setTimeout(() => synth.beep(0.6 * s.vol, s.pan, 1750, 0.07), 120);
        break;
      }
      case 'jammed': {
        const s = this.spatial(e.pos, 320);
        synth.buzz(0.5 * s.vol, s.pan);
        break;
      }
      case 'scan':
        if (e.team === this.team) synth.sweep(0.4, 0);
        break;
      case 'mark':
        if (e.team === this.team) synth.beep(0.25, 0, 2200, 0.05);
        break;
      case 'device': {
        const s = this.spatial(e.pos, 700);
        if (e.action === 'planted') {
          synth.beep(0.5, s.pan, 900, 0.15);
          setTimeout(() => synth.beep(0.5, s.pan, 1300, 0.15), 180);
        } else if (e.action === 'plant_tick' || e.action === 'disable_tick') synth.beep(0.4 * s.vol, s.pan, 1100, 0.04);
        break;
      }
      case 'hit':
        if (e.targetId === this.playerId) synth.hurt(0.6);
        else if (e.sourceId === this.playerId) synth.hitConfirm(e.killed || e.mult > 1.3);
        break;
      case 'round_end':
        synth.sting(e.winner === this.team);
        break;
      case 'phase':
        if (e.phase === 'action') synth.beep(0.4, 0, 660, 0.25);
        break;
      default:
        break;
    }
  }
}
