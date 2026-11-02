import { CELL, CHAR_MAX_HP, INTEL_TTL, MARK_TTL, REINFORCEMENTS_PER_TEAM, WALL_BULLET_FACTOR } from '../config/constants';
import type { Loadout } from '../config/loadouts';
import { barricadeLineRect, damageSegments, doorwayStatus, intactSegments, type DoorwayStatus } from './barricade';
import { resolveCircle, type CollisionWorld } from './collision';
import { updateCharacter } from './character';
import { updateDeployables, updateDrones, updateProjectiles, updateSmokes } from './equipment';
import {
  makeCharacter,
  type Character,
  type Deployable,
  type Drone,
  type IntelEntry,
  type IntelSource,
  type Projectile,
  type Smoke,
} from './entities';
import type { GameEvent, SoundEvent, SoundKind } from './events';
import { aabbOverlap, angleTo, circleAABBOverlap, type AABB, type Vec2 } from './math';
import { GameMap, MAT, type MapDef } from './map';
import { countWallsBetween } from './raycast';
import { Rng } from './rng';
import { RoundState, type RoundRules } from './round';
import { updateSightings } from './sight';
import { emptyIntent, otherTeam, type Intent, type Side, type Team } from './types';

export interface RosterEntry {
  name: string;
  team: Team;
  isPlayer: boolean;
  loadout: Loadout;
  spawn?: string; // attacker spawn location name
}

export interface WorldSetup {
  mapDef: MapDef;
  sides: [Side, Side]; // side of team 0, team 1
  roster: RosterEntry[];
  seed: number;
  rules?: Partial<RoundRules>;
}

export class World implements CollisionWorld {
  readonly map: GameMap;
  readonly rng: Rng;
  readonly sides: [Side, Side];
  time = 0;
  chars: Character[] = [];
  drones: Drone[] = [];
  projectiles: Projectile[] = [];
  deployables: Deployable[] = [];
  smokes: Smoke[] = [];
  /** Accumulated events; the presentation layer drains them each frame. */
  events: GameEvent[] = [];
  /** Sounds emitted during the most recent step (bots listen to these). */
  sounds: SoundEvent[] = [];
  intel: [Map<number, IntelEntry>, Map<number, IntelEntry>] = [new Map(), new Map()];
  reinforcements: [number, number] = [REINFORCEMENTS_PER_TEAM, REINFORCEMENTS_PER_TEAM];
  /** Doorways whose damaged barricade was torn down: they stay open for the rest of the round. */
  spentDoorways = new Set<number>();
  round: RoundState;
  playerId = -1;
  private nextId = 1;
  private sightTimer = 0;
  private solidRectCache: AABB[] | null = null;
  private stepSounds: SoundEvent[] = [];

  constructor(setup: WorldSetup) {
    this.map = new GameMap(setup.mapDef);
    this.rng = new Rng(setup.seed);
    this.sides = setup.sides;
    this.round = new RoundState(setup.rules);
    this.spawnRoster(setup.roster);
    this.spawnCameras();
  }

  // ------------------------------------------------------------------ setup

  newId(): number {
    return this.nextId++;
  }

  sideOf(team: Team): Side {
    return this.sides[team];
  }

  get attackTeam(): Team {
    return this.sides[0] === 'attack' ? 0 : 1;
  }

  get defendTeam(): Team {
    return otherTeam(this.attackTeam);
  }

  private spawnRoster(roster: RosterEntry[]): void {
    const def = this.map.def;
    const spawnUse = new Map<string, number>();
    let defIndex = 0;
    let rr = 0;
    for (const r of roster) {
      const side = this.sides[r.team];
      let pos: Vec2;
      let zone: AABB | null = null;
      if (side === 'attack') {
        const sp = def.attackerSpawns.find((s) => s.name === r.spawn) ?? def.attackerSpawns[rr++ % def.attackerSpawns.length];
        const used = spawnUse.get(sp.name) ?? 0;
        spawnUse.set(sp.name, used + 1);
        const pt = sp.points[used % sp.points.length];
        const ring = Math.floor(used / sp.points.length);
        pos = this.map.cellCenter(pt[0] + ring, pt[1]);
        zone = { x0: sp.zone.x0 * CELL, y0: sp.zone.y0 * CELL, x1: (sp.zone.x1 + 1) * CELL, y1: (sp.zone.y1 + 1) * CELL };
      } else {
        const pt = def.defenderSpawns[defIndex++ % def.defenderSpawns.length];
        pos = this.map.cellCenter(pt[0], pt[1]);
      }
      const ch = makeCharacter(this.newId(), r.name, r.team, side, r.isPlayer, r.loadout, pos);
      ch.spawnZone = zone;
      ch.facing = angleTo(pos, this.map.objectiveCenter);
      this.chars.push(ch);
      if (r.isPlayer) this.playerId = ch.id;
    }
  }

  private spawnCameras(): void {
    for (const c of this.map.def.cameras) {
      this.deployables.push(this.makeDeployable('camera', this.defendTeam, -1, this.map.cellCenter(c.cx, c.cy), c.angle, 1, c.name));
    }
  }

  makeDeployable(kind: Deployable['kind'], team: Team, ownerId: number, pos: Vec2, facing: number, hp: number, name?: string): Deployable {
    return {
      id: this.newId(), kind, team, ownerId, pos: { x: pos.x, y: pos.y }, facing, hp, maxHp: hp, alive: true,
      disabledUntil: 0, name, baseFacing: facing, armedAt: this.time + 1, triggerAt: -1, lastAlarm: -100,
    };
  }

  // ------------------------------------------------------------------ queries

  charById(id: number): Character | undefined {
    return this.chars.find((c) => c.id === id);
  }

  get player(): Character | undefined {
    return this.charById(this.playerId);
  }

  aliveOf(team: Team): Character[] {
    return this.chars.filter((c) => c.alive && c.team === team);
  }

  enemiesOf(team: Team): Character[] {
    return this.chars.filter((c) => c.alive && c.team !== team);
  }

  droneById(id: number): Drone | undefined {
    return this.drones.find((d) => d.id === id);
  }

  deployableById(id: number): Deployable | undefined {
    return this.deployables.find((d) => d.id === id);
  }

  solidDeployableRects(): AABB[] {
    if (!this.solidRectCache) {
      this.solidRectCache = this.deployables.filter((d) => d.alive && d.kind === 'shield' && d.rect).map((d) => d.rect!);
    }
    return this.solidRectCache;
  }

  invalidateSolids(): void {
    this.solidRectCache = null;
  }

  /** Doorway summary used by the AI, HUD and debug overlay. */
  doorwayStatus(doorwayId: number): DoorwayStatus {
    const d = this.map.doorways[doorwayId];
    const line = barricadeLineRect(d, 4);
    const obstructed = this.solidDeployableRects().some((r) => aabbOverlap(r, line));
    return doorwayStatus(d, obstructed);
  }

  isElectronicDisabled(d: Deployable): boolean {
    return d.disabledUntil > this.time;
  }

  /** Is `pos` inside the radius of an active enemy (of `team`) jammer? */
  jammedAt(pos: Vec2, team: Team): boolean {
    for (const d of this.deployables) {
      if (!d.alive || d.kind !== 'jammer' || d.team === team || this.isElectronicDisabled(d)) continue;
      if (Math.hypot(d.pos.x - pos.x, d.pos.y - pos.y) <= 82) return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ events & sound

  emit(e: GameEvent): void {
    this.events.push(e);
    if (this.events.length > 4000) this.events.splice(0, this.events.length - 4000);
  }

  sound(pos: Vec2, radius: number, kind: SoundKind, sourceId: number, team: Team | -1): void {
    this.stepSounds.push({ pos: { x: pos.x, y: pos.y }, radius, kind, sourceId, team, time: this.time });
  }

  /** Effective audible radius at `listener` after wall occlusion. */
  audibleAt(s: SoundEvent, listener: Vec2): boolean {
    const d = Math.hypot(s.pos.x - listener.x, s.pos.y - listener.y);
    if (d > s.radius) return false;
    const walls = countWallsBetween(this.map, s.pos, listener, 5);
    const eff = s.radius * Math.max(0.3, Math.pow(0.78, walls));
    return d <= eff;
  }

  message(ch: Character, text: string): void {
    ch.message = { text, time: this.time };
  }

  // ------------------------------------------------------------------ intel (team call-outs)

  addIntel(team: Team, enemy: Character, source: IntelSource, pos: Vec2 = enemy.pos): void {
    const map = this.intel[team];
    const cur = map.get(enemy.id);
    const ttl = source === 'mark' ? MARK_TTL : source === 'scan' ? 2.5 : INTEL_TTL;
    if (cur && source === 'sight' && cur.source !== 'sight' && cur.expires > this.time + 0.5) {
      cur.pos = { x: pos.x, y: pos.y };
      cur.time = this.time;
      return;
    }
    map.set(enemy.id, { enemyId: enemy.id, pos: { x: pos.x, y: pos.y }, time: this.time, expires: this.time + ttl, source });
  }

  private expireIntel(): void {
    for (const team of [0, 1] as Team[]) {
      for (const [id, e] of this.intel[team]) {
        const ch = this.charById(id);
        if (e.expires < this.time || !ch || !ch.alive) this.intel[team].delete(id);
        else if (e.source === 'mark' || e.source === 'alarm') e.pos = { x: ch.pos.x, y: ch.pos.y }; // marks track live
      }
    }
  }

  // ------------------------------------------------------------------ damage

  damageCharacter(target: Character, amount: number, sourceId: number, cause: string, info: { mult?: number; pos?: Vec2 } = {}): void {
    if (!target.alive || amount <= 0) return;
    // Preparation phase: attackers are still staging, nobody can be hurt (drones/devices still can).
    if (this.round.phase === 'prep') return;
    const dealt = Math.min(target.hp, amount);
    target.hp -= amount;
    target.lastHurtTime = this.time;
    const src = this.charById(sourceId);
    if (src && src.id !== target.id) {
      src.stats.damage += dealt;
      const log = target.damageLog.get(src.id);
      target.damageLog.set(src.id, { amount: (log?.amount ?? 0) + dealt, time: this.time });
    }
    if (target.camView) target.camView = null; // getting hurt snaps you out of the camera system
    if (target.action && target.action.kind !== 'plant' && target.action.kind !== 'disable') target.action = null;
    const killed = target.hp <= 0;
    this.emit({ type: 'hit', targetId: target.id, sourceId, amount: dealt, mult: info.mult ?? 1, pos: info.pos ?? target.pos, killed, cause });
    if (killed) this.kill(target, sourceId, cause);
  }

  private kill(target: Character, killerId: number, cause: string): void {
    target.alive = false;
    target.hp = 0;
    target.action = null;
    target.camView = null;
    target.stats.deaths++;
    const killer = this.charById(killerId);
    if (killer && killer.id !== target.id && killer.team !== target.team) killer.stats.kills++;
    const assistIds: number[] = [];
    for (const [id, log] of target.damageLog) {
      if (id === killerId || this.time - log.time > 12 || log.amount < 20) continue;
      const a = this.charById(id);
      if (a && a.team !== target.team) {
        a.stats.assists++;
        assistIds.push(id);
      }
    }
    // Abandon in-flight drone control; placed charges remain.
    this.emit({ type: 'kill', killerId, victimId: target.id, cause, assistIds });
  }

  /** Applies material damage to a soft wall cell. Returns true if destroyed. */
  damageCell(cx: number, cy: number, amount: number, team: Team): boolean {
    const m = this.map;
    if (!m.inBounds(cx, cy)) return false;
    const i = m.idx(cx, cy);
    if (m.mat[i] !== MAT.SOFT || amount <= 0) return false;
    m.hp[i] -= amount;
    const pos = m.cellCenter(cx, cy);
    if (m.hp[i] <= 0) {
      m.destroyCell(cx, cy);
      this.emit({ type: 'wall', cells: [i], action: 'destroyed', team, pos });
      this.sound(pos, 480, 'wall_break', -1, team);
      return true;
    }
    this.emit({ type: 'wall', cells: [i], action: 'hit', team, pos });
    return false;
  }

  bulletDamageCell(cx: number, cy: number, damage: number, materialMult: number, team: Team): void {
    this.damageCell(cx, cy, damage * materialMult * WALL_BULLET_FACTOR, team);
  }

  /** Localized barricade damage; emits break/breach events and sounds. */
  damageBarricade(doorwayId: number, damages: Map<number, number>, team: Team, pos: Vec2): void {
    const d = this.map.doorways[doorwayId];
    if (!d.barricade || !d.barricade.complete || !damages.size) return;
    const res = damageSegments(d, damages);
    this.emit({ type: 'barricade', doorwayId, action: 'hit', team, pos });
    this.sound(pos, 320, 'barricade_hit', -1, team);
    if (res.destroyed > 0) {
      this.emit({ type: 'barricade', doorwayId, action: 'section_break', team, pos });
      this.sound(pos, 480, 'barricade_break', -1, team);
    }
    if (res.nowPassable) this.emit({ type: 'barricade', doorwayId, action: 'breached', team, pos });
    if (res.fullyDestroyed) this.emit({ type: 'barricade', doorwayId, action: 'destroyed', team, pos });
  }

  damageDeployable(d: Deployable, amount: number, sourceTeam: Team | -1, cause: 'bullet' | 'melee' | 'explosion'): void {
    if (!d.alive || amount <= 0) return;
    if (d.kind === 'bp_camera' && cause === 'bullet') return; // bulletproof
    d.hp -= amount;
    if (d.hp <= 0) this.destroyDeployable(d, sourceTeam);
  }

  destroyDeployable(d: Deployable, _sourceTeam: Team | -1): void {
    if (!d.alive) return;
    d.alive = false;
    if (d.kind === 'shield') this.invalidateSolids();
    this.emit({ type: 'deployable_destroyed', id: d.id, kind: d.kind, team: d.team, pos: d.pos });
  }

  destroyDrone(dr: Drone): void {
    if (!dr.alive) return;
    dr.alive = false;
    for (const c of this.chars) if (c.camView?.kind === 'drone' && c.camView.id === dr.id) c.camView = null;
    this.emit({ type: 'drone', action: 'destroyed', id: dr.id, pos: dr.pos, team: dr.team });
  }

  // ------------------------------------------------------------------ step

  step(dt: number, intents: Map<number, Intent>): void {
    this.time += dt;
    this.stepSounds = [];
    this.solidRectCache = null;
    const roundOver = this.round.phase === 'ended';
    for (const ch of this.chars) {
      const it = roundOver ? emptyIntent(ch.pos) : intents.get(ch.id) ?? emptyIntent(ch.pos);
      updateCharacter(this, ch, it, dt);
    }
    this.separateCharacters();
    updateDrones(this, intents, dt);
    updateProjectiles(this, dt);
    updateDeployables(this, dt);
    updateSmokes(this, dt);
    this.sightTimer -= dt;
    if (this.sightTimer <= 0) {
      this.sightTimer = 0.1;
      updateSightings(this);
    }
    this.expireIntel();
    this.round.update(this, dt);
    this.sounds = this.stepSounds;
  }

  private separateCharacters(): void {
    const cs = this.chars;
    for (let i = 0; i < cs.length; i++) {
      const a = cs[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < cs.length; j++) {
        const b = cs[j];
        if (!b.alive) continue;
        const dx = b.pos.x - a.pos.x;
        const dy = b.pos.y - a.pos.y;
        const min = a.radius + b.radius;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min) continue;
        const d = Math.sqrt(d2) || 0.01;
        const push = (min - d) / 2;
        const nx = d2 > 0 ? dx / d : 1;
        const ny = d2 > 0 ? dy / d : 0;
        a.pos.x -= nx * push;
        a.pos.y -= ny * push;
        b.pos.x += nx * push;
        b.pos.y += ny * push;
        resolveCircle(this, a.pos, a.radius, { barricades: true, deployables: true });
        resolveCircle(this, b.pos, b.radius, { barricades: true, deployables: true });
      }
    }
  }

  /** Pushes anyone standing inside a freshly completed barricade out to the nearest side. */
  clearDoorwayOccupants(doorwayId: number): void {
    const d = this.map.doorways[doorwayId];
    const line = barricadeLineRect(d, 0);
    for (const c of this.chars) {
      if (!c.alive || !circleAABBOverlap(c.pos.x, c.pos.y, c.radius, line)) continue;
      if (d.orient === 'h') c.pos.y = c.pos.y < d.center.y ? line.y0 - c.radius - 0.5 : line.y1 + c.radius + 0.5;
      else c.pos.x = c.pos.x < d.center.x ? line.x0 - c.radius - 0.5 : line.x1 + c.radius + 0.5;
    }
  }

  barricadeIntact(doorwayId: number): number {
    const b = this.map.doorways[doorwayId].barricade;
    return b ? intactSegments(b) : 0;
  }

  /** Revives nobody; used by tests to reset HP. */
  healAll(): void {
    for (const c of this.chars) if (c.alive) c.hp = CHAR_MAX_HP;
  }
}
