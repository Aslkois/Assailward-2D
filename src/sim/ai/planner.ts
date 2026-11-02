import { CELL, CHAR_RADIUS } from '../../config/constants';
import type { EquipId } from '../../config/equipment';
import { circleBlocked } from '../collision';
import { findEquip, type Character } from '../entities';
import { angleTo, dist, fromAngle, type Vec2 } from '../math';
import type { Doorway, Panel } from '../map';
import type { Team } from '../types';
import type { World } from '../world';
import type { BotBrain } from './brain';

// Team-level tactics. Defenders: preparation jobs (barricades, reinforcements, deployables), then
// anchors hold the objective while roamers patrol and investigate call-outs; everyone retakes a
// planted device. Attackers: drone during preparation, push along assigned approaches, plant,
// then guard the device.

interface SharedJob {
  key: string;
  kind: 'barricade' | 'reinforce';
  id: number;
  stand: Vec2;
  claimedBy: number;
  done: boolean;
}

function standPoint(world: World, center: Vec2, normal: Vec2, towards: Vec2, offset: number): Vec2 | null {
  const a = { x: center.x + normal.x * offset, y: center.y + normal.y * offset };
  const b = { x: center.x - normal.x * offset, y: center.y - normal.y * offset };
  const [first, second] = dist(a, towards) <= dist(b, towards) ? [a, b] : [b, a];
  if (!circleBlocked(world, first.x, first.y, CHAR_RADIUS)) return first;
  if (!circleBlocked(world, second.x, second.y, CHAR_RADIUS)) return second;
  return null;
}

export class TeamPlanner {
  private jobs: SharedJob[] = [];
  private personal = new Map<number, { equip: EquipId; stand: Vec2; aim: Vec2 }[]>();
  private initForPhase = '';
  private plantClaim = -1;
  private camWatcher = -1;
  private nextUpdate = 0;
  private actionStart = 0;

  constructor(readonly team: Team) {}

  update(world: World, brains: BotBrain[]): void {
    const now = world.time;
    const phase = world.round.phase;
    if (phase !== this.initForPhase) {
      this.initForPhase = phase;
      for (const b of brains) b.resetForPhase(phase);
      if (phase === 'prep' && world.sideOf(this.team) === 'defend') this.buildDefenseJobs(world, brains);
      if (phase === 'action') this.actionStart = now;
      this.plantClaim = -1;
      this.nextUpdate = 0;
    }
    if (now < this.nextUpdate || phase === 'ended') return;
    this.nextUpdate = now + 0.25;
    const side = world.sideOf(this.team);
    for (const b of brains) {
      const ch = world.charById(b.id);
      if (!ch || !ch.alive) {
        this.releaseJobs(b.id);
        continue;
      }
      if (side === 'defend') this.planDefender(world, b, ch);
      else this.planAttacker(world, b, ch, brains);
    }
  }

  private releaseJobs(id: number): void {
    for (const j of this.jobs) if (j.claimedBy === id && !j.done) j.claimedBy = -1;
    if (this.camWatcher === id) this.camWatcher = -1;
    if (this.plantClaim === id) this.plantClaim = -1;
  }

  // ------------------------------------------------------------------ defense

  private buildDefenseJobs(world: World, brains: BotBrain[]): void {
    const m = world.map;
    const obj = m.objectiveCenter;
    this.jobs = [];
    const objRoom = m.rooms.find((r) => r.objective)!;
    const near = (d: Doorway) => d.rooms.includes(objRoom.id) || dist(d.center, obj) < 480;
    const doors = m.doorways.filter((d) => !d.exterior && near(d)).sort((a, b) => dist(a.center, obj) - dist(b.center, obj)).slice(0, 9);
    for (const d of doors) {
      const stand = standPoint(world, d.center, d.normal, obj, 20);
      if (stand) this.jobs.push({ key: `b${d.id}`, kind: 'barricade', id: d.id, stand, claimedBy: -1, done: false });
    }
    const panels = m.panels.filter((p) => !p.reinforced).sort((a, b) => dist(a.center, obj) - dist(b.center, obj)).slice(0, world.reinforcements[this.team]);
    for (const p of panels) {
      const stand = standPoint(world, p.center, p.normal, obj, 20);
      if (stand) this.jobs.push({ key: `r${p.id}`, kind: 'reinforce', id: p.id, stand, claimedBy: -1, done: false });
    }
    // Personal deployables, placed around the objective room's entrances
    const objDoors = m.doorways.filter((d) => d.rooms.includes(objRoom.id));
    brains.forEach((b, i) => {
      const ch = world.charById(b.id);
      if (!ch) return;
      const list: { equip: EquipId; stand: Vec2; aim: Vec2 }[] = [];
      const door = objDoors[i % Math.max(1, objDoors.length)];
      const inward = door ? (dist({ x: door.center.x + door.normal.x * 30, y: door.center.y + door.normal.y * 30 }, obj) < dist(door.center, obj) ? door.normal : { x: -door.normal.x, y: -door.normal.y }) : { x: 0, y: 1 };
      const anchor = m.def.anchors[i % m.def.anchors.length];
      const anchorPos = m.cellCenter(anchor.cx, anchor.cy);
      for (const eq of [...ch.loadout.utilities, ...ch.loadout.gadgets]) {
        if (eq === 'barbed_wire' && door) {
          const stand = { x: door.center.x + inward.x * 22, y: door.center.y + inward.y * 22 };
          list.push({ equip: eq, stand, aim: { x: stand.x + inward.x * 60, y: stand.y + inward.y * 60 } });
        } else if (eq === 'shield') {
          const f = fromAngle(anchor.facing);
          list.push({ equip: eq, stand: anchorPos, aim: { x: anchorPos.x + f.x * 60, y: anchorPos.y + f.y * 60 } });
        } else if (eq === 'jammer' || eq === 'alarm') {
          const tgt = eq === 'alarm' && door ? { x: door.center.x + inward.x * 40, y: door.center.y + inward.y * 40 } : { x: obj.x + (i - 2) * 40, y: obj.y - 40 };
          if (!circleBlocked(world, tgt.x, tgt.y, CHAR_RADIUS)) list.push({ equip: eq, stand: tgt, aim: { x: tgt.x + 40, y: tgt.y } });
        } else if (eq === 'bp_camera') {
          const back = fromAngle(anchor.facing + Math.PI);
          list.push({ equip: eq, stand: anchorPos, aim: { x: anchorPos.x + back.x * 60, y: anchorPos.y + back.y * 60 } });
        }
      }
      this.personal.set(b.id, list);
    });
  }

  private planDefender(world: World, b: BotBrain, ch: Character): void {
    const phase = world.round.phase;
    const m = world.map;
    const now = world.time;
    if (phase === 'planted') {
      if (b.task?.type !== 'retake') {
        b.task = { type: 'retake' };
        b.routine = null;
      }
      return;
    }
    if (b.task || b.routine || ch.action) {
      // roamers drop patrols to investigate fresh call-outs
      if (phase === 'action' && b.role === 'roamer' && b.task?.type === 'roam') {
        const c = b.freshestContact(2, now);
        if (c && !c.visible && dist(c.pos, ch.pos) < 650) b.task = { type: 'investigate', pos: c.pos, until: now + 12 };
      }
      return;
    }
    if (phase === 'prep') {
      const list = this.personal.get(b.id) ?? [];
      while (list.length) {
        const job = list.shift()!;
        const eq = findEquip(ch, job.equip);
        if (eq && eq.state.charges !== 0) {
          b.task = { type: 'place', equip: job.equip, stand: job.stand, aim: job.aim, started: now };
          return;
        }
      }
      let best: SharedJob | null = null;
      let bd = Infinity;
      for (const j of this.jobs) {
        if (j.done || (j.claimedBy >= 0 && j.claimedBy !== b.id)) continue;
        if (j.kind === 'barricade') {
          const d = m.doorways[j.id];
          if (d.barricade || world.spentDoorways.has(d.id)) {
            j.done = true;
            continue;
          }
        } else {
          const p: Panel = m.panels[j.id];
          if (p.reinforced || !m.panelIntact(p) || world.reinforcements[this.team] <= 0) {
            j.done = true;
            continue;
          }
        }
        const dd = dist(ch.pos, j.stand);
        if (dd < bd) {
          bd = dd;
          best = j;
        }
      }
      if (best) {
        best.claimedBy = b.id;
        b.task = best.kind === 'barricade'
          ? { type: 'barricade', doorwayId: best.id, stand: best.stand, started: now }
          : { type: 'reinforce', panelId: best.id, stand: best.stand, started: now };
        return;
      }
    }
    // role positions
    if (b.role === 'anchor') {
      const anchors = m.def.anchors;
      const a = anchors[b.anchorIndex % anchors.length];
      // occasionally watch the camera network when nothing is happening
      if (phase === 'action' && this.camWatcher < 0 && now - b.lastContactTime > 12 && now - this.actionStart > 15 && b.rng.next() < 0.15) {
        const cams = world.deployables.filter((d) => d.alive && d.team === this.team && (d.kind === 'camera' || d.kind === 'bp_camera'));
        if (cams.length) {
          this.camWatcher = b.id;
          b.task = { type: 'cams', until: now + 5, nextCycle: now + 1 };
          return;
        }
      }
      if (this.camWatcher === b.id) this.camWatcher = -1;
      b.task = { type: 'hold', pos: m.cellCenter(a.cx, a.cy), facing: a.facing };
      return;
    }
    if (phase === 'prep') {
      const rp = m.def.roamPoints[(b.anchorIndex * 3) % m.def.roamPoints.length];
      const pos = m.cellCenter(rp[0], rp[1]);
      b.task = { type: 'hold', pos, facing: angleTo(m.objectiveCenter, pos) };
      return;
    }
    const pts = b.rng.shuffle(m.def.roamPoints.map(([x, y]) => m.cellCenter(x, y)));
    b.task = { type: 'roam', points: pts, idx: 0, waitUntil: 0 };
  }

  // ------------------------------------------------------------------ attack

  private planAttacker(world: World, b: BotBrain, ch: Character, brains: BotBrain[]): void {
    const phase = world.round.phase;
    const m = world.map;
    const now = world.time;
    if (phase === 'prep') {
      if (!b.task && ch.inv.drones > 0) b.task = { type: 'drone' };
      return;
    }
    if (phase === 'planted') {
      const dev = world.round.device!;
      if (b.task?.type !== 'guard') {
        const i = brains.indexOf(b);
        const ang = (i / Math.max(1, brains.length)) * Math.PI * 2;
        let pos = { x: dev.pos.x + Math.cos(ang) * 70, y: dev.pos.y + Math.sin(ang) * 50 };
        if (circleBlocked(world, pos.x, pos.y, CHAR_RADIUS)) pos = { x: dev.pos.x + Math.cos(ang) * 30, y: dev.pos.y + Math.sin(ang) * 20 };
        b.task = { type: 'guard', pos, facing: angleTo(dev.pos, pos), claymoreTried: false };
      }
      return;
    }
    // action phase
    if (this.plantClaim >= 0) {
      const planter = world.charById(this.plantClaim);
      const pb = brains.find((x) => x.id === this.plantClaim);
      if (!planter || !planter.alive || pb?.task?.type !== 'plant') this.plantClaim = -1;
    }
    const inObjective = m.isObjectiveAt(ch.pos) || (m.roomAt(ch.pos)?.objective ?? false);
    const timeLeft = world.round.timeLeft;
    if (this.plantClaim < 0 && inObjective && (now - b.lastContactTime > 1.5 || timeLeft < 25) && ch.visibleEnemies.length === 0) {
      this.plantClaim = b.id;
      b.task = { type: 'plant' };
      b.routine = null;
      return;
    }
    if (b.task || b.routine || ch.action) return;
    if (inObjective) {
      const anchors = m.def.anchors;
      const a = anchors[(brains.indexOf(b) + 1) % anchors.length];
      b.task = { type: 'guard', pos: m.cellCenter(a.cx, a.cy), facing: a.facing, claymoreTried: true };
      return;
    }
    const approach = m.def.approaches[b.approach % m.def.approaches.length];
    const waypoints = approach.waypoints.map(([x, y]) => m.cellCenter(x, y));
    // resume from the closest remaining waypoint instead of walking back
    let start = 0;
    let bd = Infinity;
    waypoints.forEach((w, i) => {
      const d = dist(w, ch.pos);
      if (d < bd) {
        bd = d;
        start = i;
      }
    });
    if (b.failedTasks > 2) start = waypoints.length; // give up on the scripted route: go straight in
    const final = { x: m.objectiveCenter.x + b.rng.range(-50, 50), y: m.objectiveCenter.y + b.rng.range(-16, 16) };
    const goTime = now < this.actionStart + 1 ? now + b.rng.range(0, 6) : now;
    b.task = { type: 'attack', waypoints, idx: start, goTime, final };
    void CELL;
  }
}
