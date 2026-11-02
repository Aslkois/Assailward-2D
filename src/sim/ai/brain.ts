import { CHAR_RADIUS, DRONE_RADIUS } from '../../config/constants';
import type { EquipId } from '../../config/equipment';
import { segmentCenter } from '../barricade';
import { currentEquip, currentWeapon, findEquip, hasCharges, type Character } from '../entities';
import { angleDiff, angleTo, dist, fromAngle, norm, rotateToward, sub, type Vec2 } from '../math';
import type { Rng } from '../rng';
import { lineOfSight } from '../sight';
import { emptyIntent, type Difficulty, type Intent } from '../types';
import type { World } from '../world';
import { findPath, obstacleBlocking, segmentClear, type NavOpts, type NavPath, type Obstacle } from './nav';

export interface DiffParams {
  reaction: number;
  aimErr: number;
  aimErrMin: number;
  turnRate: number;
  burstMin: number;
  burstMax: number;
  strafe: boolean;
  utilityChance: number;
}

export const DIFFICULTY: Record<Difficulty, DiffParams> = {
  easy: { reaction: 0.6, aimErr: 0.17, aimErrMin: 0.06, turnRate: 4.5, burstMin: 3, burstMax: 5, strafe: false, utilityChance: 0.35 },
  normal: { reaction: 0.38, aimErr: 0.11, aimErrMin: 0.035, turnRate: 7, burstMin: 4, burstMax: 7, strafe: true, utilityChance: 0.6 },
  hard: { reaction: 0.24, aimErr: 0.075, aimErrMin: 0.018, turnRate: 10, burstMin: 5, burstMax: 9, strafe: true, utilityChance: 0.85 },
};

export type Task =
  | { type: 'goto'; pos: Vec2; run: boolean }
  | { type: 'barricade'; doorwayId: number; stand: Vec2; started: number }
  | { type: 'reinforce'; panelId: number; stand: Vec2; started: number }
  | { type: 'place'; equip: EquipId; stand: Vec2; aim: Vec2; started: number }
  | { type: 'hold'; pos: Vec2; facing: number }
  | { type: 'roam'; points: Vec2[]; idx: number; waitUntil: number }
  | { type: 'investigate'; pos: Vec2; until: number }
  | { type: 'drone' }
  | { type: 'attack'; waypoints: Vec2[]; idx: number; goTime: number; final: Vec2 }
  | { type: 'plant' }
  | { type: 'guard'; pos: Vec2; facing: number; claymoreTried: boolean }
  | { type: 'retake' }
  | { type: 'cams'; until: number; nextCycle: number };

type Routine =
  | { kind: 'throw'; equip: EquipId; target: Vec2; short: boolean; stage: number; t: number }
  | { kind: 'charge'; equip: 'soft_breach' | 'hard_breach'; target: Vec2; retreat: Vec2; stage: number; t: number; before: number }
  | { kind: 'hammer'; target: Vec2; t: number; obstacle: Obstacle }
  | { kind: 'bash'; target: Vec2; t: number; obstacle: Obstacle }
  | { kind: 'shoot'; target: Vec2; t: number; obstacle: Obstacle }
  | { kind: 'unbar'; target: Vec2; t: number; obstacle: Obstacle }
  | { kind: 'scan'; stage: number; t: number }
  | { kind: 'place'; equip: EquipId; aim: Vec2; stage: number; t: number; before: number };

export interface Contact {
  id: number;
  pos: Vec2;
  time: number;
  visible: boolean;
}

export type Role = 'anchor' | 'roamer' | 'attacker';

export class BotBrain {
  task: Task | null = null;
  routine: Routine | null = null;
  role: Role = 'attacker';
  approach = 0;
  anchorIndex = 0;
  phaseSeen = '';
  contacts = new Map<number, Contact>();
  lastHeard: { pos: Vec2; time: number } | null = null;
  lastContactTime = -100;
  lastCombat = -100;
  // navigation
  path: NavPath | null = null;
  pathIdx = 0;
  pathGoal: Vec2 | null = null;
  repathAt = 0;
  lastPathAt = -10;
  stuckCheckAt = 0;
  stuckPos: Vec2 = { x: 0, y: 0 };
  stuckCount = 0;
  jitterUntil = 0;
  jitterDir: Vec2 = { x: 0, y: 0 };
  noSoft = false;
  noHard = false;
  failedTasks = 0;
  // aim & combat
  aimAngle = 0;
  lookAt: Vec2 | null = null;
  targetId = -1;
  reactAt = 0;
  aimErr = 0;
  errPhase = 0;
  burstShots = 0;
  burstLen = 5;
  burstPauseUntil = 0;
  lastMag = -1;
  nextSemiAt = 0;
  strafeDir = 1;
  strafeUntil = 0;
  utilReadyAt = 0;
  flashReadyAt = 0;
  crouch = false;
  dronePath: NavPath | null = null;
  droneRepathAt = 0;
  debugState = '';

  constructor(readonly id: number, readonly diff: DiffParams, readonly rng: Rng) {}

  // ================================================================== main entry

  think(world: World, dt: number): Intent {
    const ch = world.charById(this.id)!;
    const it = emptyIntent(ch.pos);
    if (!ch.alive || world.round.phase === 'ended') return it;
    const now = world.time;
    if (!this.phaseSeen) this.aimAngle = ch.facing;
    this.perceive(world, ch);
    this.crouch = false;

    if (ch.camView) {
      this.camModeThink(world, ch, it, dt);
      return it;
    }

    const target = this.pickTarget(world, ch);
    if (target) {
      if (this.routine && this.routine.kind !== 'throw') this.routine = null;
      this.combat(world, ch, target, it, dt);
      this.debugState = `combat:${target.name}`;
    } else {
      this.targetId = -1;
      const handled = this.routine ? this.runRoutine(world, ch, it) : false;
      if (!handled) {
        const dev = this.pickDevice(world, ch);
        if (dev && !ch.action) this.shootPoint(world, ch, it, dev, dt);
        else {
          this.doTask(world, ch, it, dt);
          if (!this.routine && !ch.action) this.maybeUseUtility(world, ch);
        }
      }
      this.applyLook(world, ch, it, dt);
    }
    this.weaponUpkeep(world, ch, it, !!target);
    it.crouch = this.crouch && !it.sprint;
    void now;
    return it;
  }

  resetForPhase(phase: string): void {
    this.phaseSeen = phase;
    this.task = null;
    this.routine = null;
    this.path = null;
    this.failedTasks = 0;
  }

  // ================================================================== perception

  private perceive(world: World, ch: Character): void {
    const now = world.time;
    for (const c of this.contacts.values()) c.visible = false;
    for (const id of ch.visibleEnemies) {
      const e = world.charById(id);
      if (!e) continue;
      this.contacts.set(id, { id, pos: { x: e.pos.x, y: e.pos.y }, time: now, visible: true });
      this.lastContactTime = now;
    }
    for (const entry of world.intel[ch.team].values()) {
      const c = this.contacts.get(entry.enemyId);
      if (!c || entry.time > c.time) {
        this.contacts.set(entry.enemyId, { id: entry.enemyId, pos: { ...entry.pos }, time: entry.time, visible: false });
        if (now - entry.time < 1) this.lastContactTime = Math.max(this.lastContactTime, entry.time);
      }
    }
    for (const s of world.sounds) {
      if (s.team === -1 || s.team === ch.team) continue;
      if (!world.audibleAt(s, ch.pos)) continue;
      const d = Math.hypot(s.pos.x - ch.pos.x, s.pos.y - ch.pos.y);
      const err = 40 * (d / s.radius);
      const pos = { x: s.pos.x + this.rng.range(-err, err), y: s.pos.y + this.rng.range(-err, err) };
      this.lastHeard = { pos, time: now };
      const src = world.charById(s.sourceId);
      if (src && src.team !== ch.team) {
        const c = this.contacts.get(src.id);
        if (!c || !c.visible) this.contacts.set(src.id, { id: src.id, pos, time: now, visible: false });
      }
      this.lastContactTime = now;
    }
    for (const [id, c] of this.contacts) {
      const e = world.charById(id);
      if (!e || !e.alive || now - c.time > 15) this.contacts.delete(id);
    }
  }

  freshestContact(maxAge: number, now: number): Contact | null {
    let best: Contact | null = null;
    for (const c of this.contacts.values()) {
      if (now - c.time > maxAge) continue;
      if (!best || c.time > best.time) best = c;
    }
    return best;
  }

  private pickTarget(world: World, ch: Character): Character | null {
    let best: Character | null = null;
    let bd = Infinity;
    for (const id of ch.visibleEnemies) {
      const e = world.charById(id);
      if (!e || !e.alive) continue;
      const d = dist(e.pos, ch.pos);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  private pickDevice(world: World, ch: Character): Vec2 | null {
    if (world.time - this.lastContactTime < 1.5) return null;
    for (const id of ch.visibleDrones) {
      const dr = world.droneById(id);
      if (dr && dr.alive && dist(dr.pos, ch.pos) < 420) return dr.pos;
    }
    for (const id of ch.visibleDevices) {
      const d = world.deployableById(id);
      if (!d || !d.alive || d.kind === 'bp_camera' || d.kind === 'soft_breach' || d.kind === 'hard_breach') continue;
      if (dist(d.pos, ch.pos) < 460) return d.pos;
    }
    return null;
  }

  // ================================================================== combat

  private combat(world: World, ch: Character, e: Character, it: Intent, dt: number): void {
    const now = world.time;
    if (this.targetId !== e.id) {
      this.targetId = e.id;
      const alerted = now - this.lastCombat < 3 || now - this.lastContactTime < 2;
      this.reactAt = now + this.diff.reaction * this.rng.range(0.8, 1.3) * (alerted ? 0.6 : 1);
      this.aimErr = this.diff.aimErr;
      this.errPhase = this.rng.range(0, Math.PI * 2);
      this.burstShots = 0;
      this.burstLen = this.rng.int(this.diff.burstMin, this.diff.burstMax);
    }
    this.lastCombat = now;
    if (ch.action && ch.action.kind !== 'plant' && ch.action.kind !== 'disable') it.interact = false;
    this.aimErr = Math.max(this.diff.aimErrMin, this.aimErr - dt * 0.08);
    this.errPhase += dt * 2.3;
    const lead = { x: e.pos.x + e.vel.x * 0.06, y: e.pos.y + e.vel.y * 0.06 };
    const d = dist(ch.pos, e.pos);
    const trueAngle = angleTo(ch.pos, lead);
    const desired = trueAngle + this.aimErr * Math.sin(this.errPhase);
    this.aimAngle = rotateToward(this.aimAngle, desired, this.diff.turnRate * dt);
    const aimDir = fromAngle(this.aimAngle);
    it.aim = { x: ch.pos.x + aimDir.x * Math.max(60, d), y: ch.pos.y + aimDir.y * Math.max(60, d) };

    if (ch.inv.slot > 2 && this.routine?.kind !== 'throw') it.selectSlot = 1;
    const ws = currentWeapon(ch);
    if (ws && ch.swapTimer <= 0) {
      if (ws.mag === 0) {
        const other = ch.inv.slot === 1 ? ch.inv.secondary : ch.inv.primary;
        if (other.mag > 0 && d < 320) it.selectSlot = ch.inv.slot === 1 ? 2 : 1;
        else it.reload = true;
      } else {
        const tol = Math.atan2(e.radius * 0.9, d) + 0.02 + this.aimErr;
        const onTarget = Math.abs(angleDiff(this.aimAngle, trueAngle)) < tol;
        if (this.lastMag >= 0 && ws.mag < this.lastMag) this.burstShots += this.lastMag - ws.mag;
        this.lastMag = ws.mag;
        if (now >= this.reactAt && onTarget && !ch.action) {
          if (ws.def.mode === 'auto') {
            if (now >= this.burstPauseUntil) {
              it.fire = true;
              if (this.burstShots >= this.burstLen && d > 170) {
                this.burstShots = 0;
                this.burstLen = this.rng.int(this.diff.burstMin, this.diff.burstMax);
                this.burstPauseUntil = now + this.rng.range(0.15, 0.32);
              }
            }
          } else if (now >= this.nextSemiAt) {
            it.fire = true;
            it.firePressed = true;
            this.nextSemiAt = now + 60 / ws.def.rpm + this.rng.range(0.06, 0.22);
          }
        }
      }
    }
    // movement
    const away = norm(sub(ch.pos, e.pos));
    if (ch.hp < 35 && d < 380 && this.role !== 'anchor') {
      it.move = away;
    } else if (this.diff.strafe && !ch.action) {
      if (now > this.strafeUntil) {
        this.strafeDir = this.rng.sign();
        this.strafeUntil = now + this.rng.range(0.45, 1.1);
      }
      it.move = { x: -away.y * this.strafeDir * 0.7, y: away.x * this.strafeDir * 0.7 };
    }
    it.secondary = d > 190 && ws !== null;
    this.crouch = d > 260 && (this.role === 'anchor' || this.task?.type === 'guard');
  }

  private shootPoint(world: World, ch: Character, it: Intent, p: Vec2, dt: number): void {
    const desired = angleTo(ch.pos, p);
    this.aimAngle = rotateToward(this.aimAngle, desired, this.diff.turnRate * dt);
    const d = fromAngle(this.aimAngle);
    it.aim = { x: ch.pos.x + d.x * 80, y: ch.pos.y + d.y * 80 };
    if (ch.inv.slot > 2) {
      it.selectSlot = 1;
      return;
    }
    const ws = currentWeapon(ch);
    if (!ws || ws.mag === 0) return;
    if (Math.abs(angleDiff(this.aimAngle, desired)) < 0.05) {
      if (ws.def.mode === 'auto') it.fire = true;
      else if (world.time >= this.nextSemiAt) {
        it.fire = it.firePressed = true;
        this.nextSemiAt = world.time + 60 / ws.def.rpm + 0.1;
      }
    }
    this.lookAt = null;
    this.debugState = 'shooting device';
  }

  private weaponUpkeep(world: World, ch: Character, it: Intent, inCombat: boolean): void {
    const ws = currentWeapon(ch);
    if (!ws || inCombat || this.routine || ch.action) return;
    const quiet = world.time - this.lastCombat > 2.5 && world.time - this.lastContactTime > 1.5;
    if (quiet && ws.mag < ws.def.magSize * 0.5 && ws.reserve > 0 && !ws.reloading) it.reload = true;
    if (quiet && ch.inv.slot === 2 && ch.inv.primary.mag + ch.inv.primary.reserve > 0) it.selectSlot = 1;
  }

  // ================================================================== looking

  private applyLook(world: World, ch: Character, it: Intent, dt: number): void {
    if (this.targetId >= 0) return;
    if (it.aim.x !== ch.pos.x || it.aim.y !== ch.pos.y) {
      // a routine/task already set an explicit aim
      this.aimAngle = angleTo(ch.pos, it.aim);
      return;
    }
    const now = world.time;
    let look = this.lookAt;
    const c = this.freshestContact(4, now);
    if (c && !this.routine && this.task?.type !== 'barricade' && this.task?.type !== 'reinforce') look = c.pos;
    let desired = this.aimAngle;
    if (look) desired = angleTo(ch.pos, look);
    this.aimAngle = rotateToward(this.aimAngle, desired, this.diff.turnRate * 0.8 * dt);
    const d = fromAngle(this.aimAngle);
    it.aim = { x: ch.pos.x + d.x * 100, y: ch.pos.y + d.y * 100 };
  }

  // ================================================================== navigation

  navOpts(ch: Character): NavOpts {
    if (ch.side === 'attack') {
      const charges = hasCharges(ch, 'soft_breach');
      return {
        barricades: 'breach',
        softWalls: !this.noSoft && (charges || !!findEquip(ch, 'hammer')),
        hardWalls: !this.noHard && hasCharges(ch, 'hard_breach'),
        radius: CHAR_RADIUS,
        softCost: charges ? 10 : 22,
        hardCost: 8,
        barricadeCost: 16,
      };
    }
    return { barricades: 'avoid', softWalls: false, hardWalls: false, radius: CHAR_RADIUS };
  }

  private computePath(world: World, ch: Character, goal: Vec2): void {
    const now = world.time;
    if (now - this.lastPathAt < 0.35 && this.path) return;
    this.lastPathAt = now;
    let p = findPath(world, ch.pos, goal, this.navOpts(ch));
    if (!p && ch.side === 'defend') p = findPath(world, ch.pos, goal, { ...this.navOpts(ch), barricades: 'breach' });
    this.path = p;
    this.pathIdx = 0;
    this.pathGoal = { x: goal.x, y: goal.y };
    this.repathAt = now + this.rng.range(4, 6);
  }

  /** Returns 'arrived', 'moving' or 'blocked'. */
  moveTo(world: World, ch: Character, it: Intent, goal: Vec2, arrive = 12, run = false): 'arrived' | 'moving' | 'blocked' {
    const now = world.time;
    if (dist(ch.pos, goal) <= arrive) {
      this.path = null;
      return 'arrived';
    }
    if (!this.path || !this.pathGoal || dist(this.pathGoal, goal) > 24 || now > this.repathAt) this.computePath(world, ch, goal);
    if (!this.path) {
      this.lookAt = goal;
      return 'blocked';
    }
    if (now < this.jitterUntil) {
      it.move = this.jitterDir;
      return 'moving';
    }
    const pts = this.path.points;
    const obs = this.path.obstacles;
    while (this.pathIdx < pts.length - 1 && dist(ch.pos, pts[this.pathIdx]) < 12 && !(obs[this.pathIdx] && obstacleBlocking(world, obs[this.pathIdx]!))) this.pathIdx++;
    // obstacles just ahead -> breach routine
    for (let k = this.pathIdx; k < Math.min(pts.length, this.pathIdx + 5); k++) {
      const o = obs[k];
      if (!o || !obstacleBlocking(world, o)) continue;
      if (dist(ch.pos, pts[k]) < 42) {
        this.startObstacleRoutine(world, ch, o, pts[k]);
        return 'moving';
      }
      break;
    }
    // path smoothing (never skip past an unresolved obstacle)
    let tgt = this.pathIdx;
    let limit = Math.min(pts.length - 1, this.pathIdx + 8);
    for (let k = this.pathIdx; k <= limit; k++) {
      if (obs[k] && obstacleBlocking(world, obs[k]!)) {
        limit = k;
        break;
      }
    }
    for (let j = limit; j > this.pathIdx; j--) {
      if (segmentClear(world, ch.pos, pts[j], CHAR_RADIUS - 0.5)) {
        tgt = j;
        break;
      }
    }
    const tp = pts[tgt];
    const dir = norm(sub(tp, ch.pos));
    it.move = dir;
    it.sprint = run;
    this.lookAt = { x: ch.pos.x + dir.x * 100, y: ch.pos.y + dir.y * 100 };
    // stuck detection
    if (now >= this.stuckCheckAt) {
      if (dist(ch.pos, this.stuckPos) < 6 && !ch.action) {
        this.stuckCount++;
        if (this.stuckCount >= 2) {
          this.path = null;
          this.jitterUntil = now + 0.4;
          const a = this.rng.range(0, Math.PI * 2);
          this.jitterDir = fromAngle(a);
        }
      } else this.stuckCount = 0;
      this.stuckPos = { x: ch.pos.x, y: ch.pos.y };
      this.stuckCheckAt = now + 0.8;
    }
    if (this.stuckCount >= 7) {
      this.stuckCount = 0;
      return 'blocked';
    }
    return 'moving';
  }

  private startObstacleRoutine(world: World, ch: Character, o: Obstacle, point: Vec2): void {
    const now = world.time;
    if (o.kind === 'barricade') {
      const d = world.map.doorways[o.doorwayId];
      const b = d.barricade!;
      let target = d.center;
      let bd = Infinity;
      for (let i = 0; i < b.segments.length; i++) {
        if (b.segments[i] <= 0) continue;
        const c = segmentCenter(d, i);
        const dd = dist(c, ch.pos);
        if (dd < bd) {
          bd = dd;
          target = c;
        }
      }
      if (ch.side === 'defend') this.routine = { kind: 'unbar', target: d.center, t: now, obstacle: o };
      else if (findEquip(ch, 'hammer')) this.routine = { kind: 'hammer', target, t: now, obstacle: o };
      else this.routine = { kind: 'bash', target, t: now, obstacle: o };
      return;
    }
    const target = point;
    if (o.kind === 'soft') {
      if (findEquip(ch, 'hammer')) this.routine = { kind: 'hammer', target, t: now, obstacle: o };
      else if (hasCharges(ch, 'soft_breach')) this.routine = this.chargeRoutine(world, ch, 'soft_breach', target);
      else this.routine = { kind: 'shoot', target, t: now, obstacle: o };
      return;
    }
    if (hasCharges(ch, 'hard_breach')) this.routine = this.chargeRoutine(world, ch, 'hard_breach', target);
    else {
      this.noHard = true;
      this.path = null;
    }
  }

  private chargeRoutine(world: World, ch: Character, equip: 'soft_breach' | 'hard_breach', target: Vec2): Routine {
    const away = norm(sub(ch.pos, target));
    const retreat = { x: ch.pos.x + away.x * 70, y: ch.pos.y + away.y * 70 };
    const before = world.deployables.filter((d) => d.alive && d.kind === equip && d.ownerId === ch.id).length;
    return { kind: 'charge', equip, target, retreat, stage: 0, t: world.time, before };
  }

  // ================================================================== routines

  private selectEquip(ch: Character, it: Intent, id: EquipId): boolean {
    const f = findEquip(ch, id);
    if (!f) return false;
    const cur = currentEquip(ch);
    if (cur && cur.def.id === id) return ch.swapTimer <= 0;
    it.selectSlot = f.cat;
    return false;
  }

  private aimAt(ch: Character, it: Intent, p: Vec2): boolean {
    it.aim = { x: p.x, y: p.y };
    return Math.abs(angleDiff(ch.facing, angleTo(ch.pos, p))) < 0.12;
  }

  /** Executes the active equipment routine. Returns true while it is in control. */
  private runRoutine(world: World, ch: Character, it: Intent): boolean {
    const r = this.routine!;
    const now = world.time;
    const age = now - r.t;
    const done = (): boolean => {
      this.routine = null;
      if (ch.inv.slot > 2) it.selectSlot = 1;
      return true;
    };
    this.debugState = `routine:${r.kind}`;
    switch (r.kind) {
      case 'throw': {
        if (r.stage === 0) {
          if (age > 2.5) return done();
          if (this.selectEquip(ch, it, r.equip)) {
            r.stage = 1;
            r.t = now;
          }
          return true;
        }
        if (r.stage === 1) {
          this.aimAt(ch, it, r.target);
          if (age > 0.25) {
            if (r.short) it.secondaryPressed = true;
            else {
              it.firePressed = true;
              it.fire = true;
            }
            r.stage = 2;
            r.t = now;
          }
          return true;
        }
        this.aimAt(ch, it, r.target);
        if (age > 0.35) return done();
        return true;
      }
      case 'charge': {
        if (age > 9) {
          this.path = null;
          return done();
        }
        if (r.stage === 0) {
          if (this.selectEquip(ch, it, r.equip)) {
            r.stage = 1;
            r.t = now;
          }
          return true;
        }
        if (r.stage === 1 || r.stage === 2) {
          const aligned = this.aimAt(ch, it, r.target);
          if (r.stage === 1) {
            if (dist(ch.pos, r.target) > 26) {
              it.move = norm(sub(r.target, ch.pos));
              return true;
            }
            if (aligned) {
              it.fire = true;
              it.firePressed = true;
              r.stage = 2;
              r.t = now;
            }
            return true;
          }
          it.fire = true;
          const placed = world.deployables.filter((d) => d.alive && d.kind === r.equip && d.ownerId === ch.id).length;
          if (placed > r.before) {
            r.stage = 3;
            r.t = now;
          } else if (!ch.action && age > 0.4) {
            // placement refused (wrong surface / changed state)
            if (r.equip === 'soft_breach') this.noSoft = true;
            else this.noHard = true;
            this.path = null;
            return done();
          }
          return true;
        }
        if (r.stage === 3) {
          it.aim = { x: r.target.x, y: r.target.y };
          if (dist(ch.pos, r.target) < 62 && age < 1.6) {
            it.move = norm(sub(r.retreat, ch.pos));
            return true;
          }
          it.secondaryPressed = true;
          r.stage = 4;
          r.t = now;
          return true;
        }
        if (age > 0.6) {
          this.path = null;
          return done();
        }
        return true;
      }
      case 'hammer': {
        if (!obstacleBlocking(world, r.obstacle) || age > 9) {
          this.path = null;
          return done();
        }
        if (!this.selectEquip(ch, it, 'hammer')) return true;
        if (dist(ch.pos, r.target) > 30) it.move = norm(sub(r.target, ch.pos));
        if (this.aimAt(ch, it, r.target) && ch.meleeCooldown <= 0 && ch.hammerWindup <= 0) {
          it.fire = true;
          it.firePressed = true;
        }
        return true;
      }
      case 'bash': {
        if (!obstacleBlocking(world, r.obstacle) || age > 12) {
          this.path = null;
          this.routine = null;
          return true;
        }
        if (dist(ch.pos, r.target) > 26) it.move = norm(sub(r.target, ch.pos));
        this.aimAt(ch, it, r.target);
        it.interact = true;
        return true;
      }
      case 'unbar': {
        if (!obstacleBlocking(world, r.obstacle) || age > 4) {
          this.path = null;
          this.routine = null;
          return true;
        }
        if (dist(ch.pos, r.target) > 28) it.move = norm(sub(r.target, ch.pos));
        this.aimAt(ch, it, r.target);
        it.interact = true;
        return true;
      }
      case 'shoot': {
        if (!obstacleBlocking(world, r.obstacle) || age > 10) {
          this.path = null;
          this.routine = null;
          return true;
        }
        if (ch.inv.slot > 2) {
          it.selectSlot = 1;
          return true;
        }
        const ws = currentWeapon(ch);
        if (this.aimAt(ch, it, r.target) && ws && ws.mag > 0) {
          if (ws.def.mode === 'auto') it.fire = true;
          else if (now >= this.nextSemiAt) {
            it.fire = it.firePressed = true;
            this.nextSemiAt = now + 60 / ws.def.rpm + 0.05;
          }
        } else if (ws && ws.mag === 0) it.reload = true;
        return true;
      }
      case 'scan': {
        if (age > 3) return done();
        if (r.stage === 0) {
          if (this.selectEquip(ch, it, 'pulse_scanner')) {
            r.stage = 1;
            r.t = now;
            it.fire = it.firePressed = true;
          }
          return true;
        }
        it.fire = true;
        if (!ch.action && age > 0.3) return done();
        return true;
      }
      case 'place': {
        if (age > 6) return done();
        if (r.stage === 0) {
          if (this.selectEquip(ch, it, r.equip)) {
            r.stage = 1;
            r.t = now;
          }
          return true;
        }
        const aligned = this.aimAt(ch, it, r.aim);
        const charges = findEquip(ch, r.equip)?.state.charges ?? 0;
        if (charges < r.before) return done();
        if (r.stage === 1 && aligned) {
          it.fire = it.firePressed = true;
          r.stage = 2;
          r.t = now;
          return true;
        }
        if (r.stage === 2) {
          it.fire = true;
          if (!ch.action && age > 0.3) return done(); // refused
        }
        return true;
      }
    }
  }

  startThrow(world: World, equip: EquipId, target: Vec2, short = false): void {
    this.routine = { kind: 'throw', equip, target: { ...target }, short, stage: 0, t: world.time };
  }

  // ================================================================== utility decisions

  private maybeUseUtility(world: World, ch: Character): void {
    const now = world.time;
    if (now < this.utilReadyAt || world.round.phase === 'prep') return;
    const t = this.task;
    // Attackers: flash the objective entry they are about to push through
    if (ch.side === 'attack' && t?.type === 'attack' && hasCharges(ch, 'flash') && now >= this.flashReadyAt && this.path) {
      const pts = this.path.points;
      const curRoom = world.map.roomAt(ch.pos);
      for (let k = this.pathIdx; k < Math.min(pts.length, this.pathIdx + 10); k++) {
        const room = world.map.roomAt(pts[k]);
        if (room && room.objective && (!curRoom || !curRoom.objective)) {
          if (dist(ch.pos, pts[k]) < 110) {
            const dir = norm(sub(pts[k], ch.pos));
            const tgt = { x: pts[k].x + dir.x * 70, y: pts[k].y + dir.y * 70 };
            this.flashReadyAt = now + 25;
            if (this.rng.next() < this.diff.utilityChance) {
              this.startThrow(world, 'flash', tgt);
              this.utilReadyAt = now + 4;
              return;
            }
          }
          break;
        }
      }
    }
    // Grenade on a known (not visible) enemy position
    const c = this.freshestContact(2.5, now);
    const nade: EquipId | null = hasCharges(ch, 'frag') ? 'frag' : hasCharges(ch, 'impact') ? 'impact' : null;
    if (c && !c.visible && nade) {
      const d = dist(c.pos, ch.pos);
      if (d > 110 && d < 300 && lineOfSight(world, ch.pos, c.pos, false)) {
        this.utilReadyAt = now + 9;
        if (this.rng.next() < this.diff.utilityChance) {
          this.startThrow(world, nade, c.pos);
          return;
        }
      }
    }
    // EMP visible defender electronics
    if (ch.side === 'attack' && hasCharges(ch, 'emp')) {
      for (const id of ch.visibleDevices) {
        const d = world.deployableById(id);
        if (d && (d.kind === 'jammer' || d.kind === 'bp_camera' || d.kind === 'alarm') && dist(d.pos, ch.pos) < 300 && !world.isElectronicDisabled(d)) {
          this.startThrow(world, 'emp', d.pos);
          this.utilReadyAt = now + 6;
          return;
        }
      }
    }
    // Smoke cover while planting
    if (t?.type === 'plant' && hasCharges(ch, 'smoke') && c) {
      const dir = norm(sub(c.pos, ch.pos));
      this.startThrow(world, 'smoke', { x: ch.pos.x + dir.x * 60, y: ch.pos.y + dir.y * 60 }, true);
      this.utilReadyAt = now + 12;
      return;
    }
    // Pulse scan when approaching/inside the building with no information
    if (ch.side === 'attack' && hasCharges(ch, 'pulse_scanner') && now - this.lastContactTime > 8 && t?.type === 'attack') {
      const room = world.map.roomAt(ch.pos);
      if (room?.interior && this.rng.next() < 0.02) {
        this.routine = { kind: 'scan', stage: 0, t: now };
        this.utilReadyAt = now + 15;
      }
    }
  }

  // ================================================================== tasks

  private doTask(world: World, ch: Character, it: Intent, dt: number): void {
    void dt;
    const t = this.task;
    const now = world.time;
    this.lookAt = null;
    if (!t) {
      this.debugState = 'idle';
      return;
    }
    this.debugState = t.type;
    switch (t.type) {
      case 'goto': {
        if (this.moveTo(world, ch, it, t.pos, 14, t.run) !== 'moving') this.task = null;
        return;
      }
      case 'barricade': {
        const d = world.map.doorways[t.doorwayId];
        const b = d.barricade;
        if ((b && (b.complete || b.builderId !== ch.id)) || world.spentDoorways.has(d.id) || now - t.started > 25) {
          this.task = null;
          return;
        }
        const r = this.moveTo(world, ch, it, t.stand, 7);
        if (r === 'blocked') {
          this.task = null;
          return;
        }
        if (r === 'arrived' || dist(ch.pos, t.stand) < 9) {
          it.move = { x: 0, y: 0 };
          it.aim = { x: d.center.x, y: d.center.y };
          it.interact = true;
          if (ch.inv.slot > 2) it.selectSlot = 1;
        }
        return;
      }
      case 'reinforce': {
        const p = world.map.panels[t.panelId];
        if (p.reinforced || world.reinforcements[ch.team] <= 0 || !world.map.panelIntact(p) || now - t.started > 25) {
          this.task = null;
          return;
        }
        const r = this.moveTo(world, ch, it, t.stand, 7);
        if (r === 'blocked') {
          this.task = null;
          return;
        }
        if (r === 'arrived' || dist(ch.pos, t.stand) < 9) {
          it.move = { x: 0, y: 0 };
          it.aim = { x: p.center.x, y: p.center.y };
          it.interact = true;
        }
        return;
      }
      case 'place': {
        const eq = findEquip(ch, t.equip);
        if (!eq || eq.state.charges === 0 || now - t.started > 25) {
          this.task = null;
          return;
        }
        const r = this.moveTo(world, ch, it, t.stand, 8);
        if (r === 'blocked') {
          this.task = null;
          return;
        }
        if (r === 'arrived' || dist(ch.pos, t.stand) < 10) {
          this.routine = { kind: 'place', equip: t.equip, aim: t.aim, stage: 0, t: now, before: eq.state.charges };
          this.task = null;
        }
        return;
      }
      case 'hold':
      case 'guard': {
        const r = this.moveTo(world, ch, it, t.pos, 10, false);
        if (r === 'arrived' || dist(ch.pos, t.pos) < 14) {
          it.move = { x: 0, y: 0 };
          this.crouch = true;
          const sweep = Math.sin(now * 0.6 + this.id) * 0.5;
          const d = fromAngle(t.facing + sweep);
          this.lookAt = { x: ch.pos.x + d.x * 100, y: ch.pos.y + d.y * 100 };
          if (t.type === 'guard' && !t.claymoreTried && hasCharges(ch, 'claymore')) {
            t.claymoreTried = true;
            const fd = fromAngle(t.facing);
            this.routine = { kind: 'place', equip: 'claymore', aim: { x: ch.pos.x + fd.x * 60, y: ch.pos.y + fd.y * 60 }, stage: 0, t: now, before: findEquip(ch, 'claymore')!.state.charges };
          }
        } else if (r === 'blocked') {
          this.task = null;
        }
        return;
      }
      case 'roam': {
        const p = t.points[t.idx % t.points.length];
        if (now < t.waitUntil) {
          const d = fromAngle(now * 0.9 + this.id);
          this.lookAt = { x: ch.pos.x + d.x * 100, y: ch.pos.y + d.y * 100 };
          return;
        }
        const r = this.moveTo(world, ch, it, p, 16);
        if (r !== 'moving') {
          t.idx++;
          t.waitUntil = now + this.rng.range(3, 7);
        }
        return;
      }
      case 'investigate': {
        if (now > t.until) {
          this.task = null;
          return;
        }
        const r = this.moveTo(world, ch, it, t.pos, 30);
        if (r !== 'moving') this.task = null;
        return;
      }
      case 'drone': {
        if (world.round.phase !== 'prep' || ch.inv.drones <= 0) {
          this.task = { type: 'hold', pos: { ...ch.pos }, facing: ch.facing };
          return;
        }
        it.selectSlot = 5;
        return;
      }
      case 'attack': {
        if (now < t.goTime) {
          this.lookAt = world.map.objectiveCenter;
          return;
        }
        const target = t.idx < t.waypoints.length ? t.waypoints[t.idx] : t.final;
        const outside = !world.map.isInterior(ch.pos);
        const run = outside && now - this.lastContactTime > 6 && t.idx < t.waypoints.length;
        const r = this.moveTo(world, ch, it, target, t.idx < t.waypoints.length ? 26 : 12, run);
        if (r === 'arrived') {
          if (t.idx < t.waypoints.length) t.idx++;
          else this.task = null;
        } else if (r === 'blocked') {
          this.failedTasks++;
          if (t.idx < t.waypoints.length) t.idx++;
          else this.task = null;
        }
        return;
      }
      case 'plant': {
        const round = world.round;
        if (round.phase !== 'action') {
          this.task = null;
          return;
        }
        if (!world.map.isObjectiveAt(ch.pos)) {
          const r = this.moveTo(world, ch, it, world.map.objectiveCenter, 8);
          if (r === 'blocked') this.task = null;
          return;
        }
        it.move = { x: 0, y: 0 };
        it.interact = true;
        this.crouch = true;
        return;
      }
      case 'retake': {
        const dev = world.round.device;
        if (!dev || world.round.phase !== 'planted') {
          this.task = null;
          return;
        }
        if (dist(ch.pos, dev.pos) > 28) {
          const r = this.moveTo(world, ch, it, dev.pos, 20, now - this.lastContactTime > 4);
          if (r === 'blocked') this.path = null;
          return;
        }
        it.move = { x: 0, y: 0 };
        it.interact = true;
        this.crouch = true;
        return;
      }
      case 'cams': {
        if (now > t.until) {
          this.task = null;
          return;
        }
        it.selectSlot = 5;
        return;
      }
    }
  }

  // ================================================================== camera system (drones/cams)

  private camModeThink(world: World, ch: Character, it: Intent, dt: number): void {
    const now = world.time;
    const t = this.task;
    const view = ch.camView!;
    if (view.kind === 'drone' && t?.type === 'drone' && world.round.phase === 'prep') {
      const dr = world.droneById(view.id);
      if (!dr || !dr.alive || dr.ownerId !== ch.id) {
        it.selectSlot = 1;
        this.task = null;
        return;
      }
      this.debugState = 'droning';
      const goal = world.map.objectiveCenter;
      if (!this.dronePath || now > this.droneRepathAt) {
        this.dronePath = findPath(world, dr.pos, { x: goal.x + this.rng.range(-60, 60), y: goal.y + this.rng.range(-30, 30) }, { barricades: 'ignore', softWalls: false, hardWalls: false, radius: DRONE_RADIUS });
        this.droneRepathAt = now + 4;
        this.pathIdx = 0;
      }
      const p = this.dronePath;
      if (!p) return;
      while (this.pathIdx < p.points.length - 1 && dist(dr.pos, p.points[this.pathIdx]) < 8) this.pathIdx++;
      let tgt = this.pathIdx;
      for (let j = Math.min(p.points.length - 1, this.pathIdx + 8); j > this.pathIdx; j--) {
        if (segmentClear(world, dr.pos, p.points[j], DRONE_RADIUS, true)) {
          tgt = j;
          break;
        }
      }
      const tp = p.points[tgt];
      if (dist(dr.pos, p.points[p.points.length - 1]) > 14) {
        const dir = norm(sub(tp, dr.pos));
        it.move = dir;
        it.aim = { x: dr.pos.x + dir.x * 100, y: dr.pos.y + dir.y * 100 };
      } else {
        const a = now * 1.2 + this.id;
        it.aim = { x: dr.pos.x + Math.cos(a) * 100, y: dr.pos.y + Math.sin(a) * 100 };
      }
      return;
    }
    if (view.kind === 'cam' && t?.type === 'cams' && now < t.until && now - ch.lastHurtTime > 1) {
      this.debugState = 'on cams';
      const cam = world.deployableById(view.id);
      if (now >= t.nextCycle) {
        it.secondaryPressed = true;
        t.nextCycle = now + 1.3;
      }
      if (cam) {
        const a = (cam.baseFacing ?? cam.facing) + Math.sin(now * 1.5) * 0.9;
        it.aim = { x: cam.pos.x + Math.cos(a) * 100, y: cam.pos.y + Math.sin(a) * 100 };
      }
      // react to nearby gunfire: get off the cams
      if (this.lastHeard && now - this.lastHeard.time < 0.2 && dist(this.lastHeard.pos, ch.pos) < 260) t.until = now;
      return;
    }
    void dt;
    it.selectSlot = 1; // leave the camera system
    if (t?.type === 'cams') this.task = null;
  }
}
