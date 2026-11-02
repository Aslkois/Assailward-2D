import { BARRICADE_BUILD_TIME, BARRICADE_REMOVE_TIME, INTERACT_REACH, REINFORCE_TIME } from '../config/constants';
import { EQUIPMENT, type EquipId } from '../config/equipment';
import { createBarricade, isDamaged } from './barricade';
import { doMelee } from './combat';
import { findEquip, type ActionKind, type Character, type HoldAction } from './entities';
import { completePlacement, completeScan, isPickupable } from './equipment';
import { pointSegmentDistance, type Vec2 } from './math';
import type { Doorway, Panel } from './map';
import type { Intent } from './types';
import type { World } from './world';

// Contextual action (F). There are no doors: doorways are open passages that defenders may
// barricade. F builds/removes barricades, reinforces walls, plants/disables the objective device,
// picks up your own deployables, or (for attackers) bashes a barricade.

export interface ContextOption {
  kind: ActionKind | 'bash';
  label: string;
  duration: number;
  target: number;
}

export function barricadeLine(d: Doorway): [Vec2, Vec2] {
  return d.orient === 'h'
    ? [{ x: d.rect.x0, y: d.center.y }, { x: d.rect.x1, y: d.center.y }]
    : [{ x: d.center.x, y: d.rect.y0 }, { x: d.center.x, y: d.rect.y1 }];
}

export function doorwayDistance(d: Doorway, p: Vec2): number {
  const [a, b] = barricadeLine(d);
  return pointSegmentDistance(p, a, b);
}

export function nearestDoorway(world: World, p: Vec2, maxDist: number): Doorway | null {
  let best: Doorway | null = null;
  let bd = maxDist;
  for (const d of world.map.doorways) {
    const dist = doorwayDistance(d, p);
    if (dist <= bd) {
      bd = dist;
      best = d;
    }
  }
  return best;
}

export function panelDistance(world: World, panel: Panel, p: Vec2): number {
  const m = world.map;
  let best = Infinity;
  for (const i of panel.cells) {
    const c = m.cellCenter(i % m.w, Math.floor(i / m.w));
    best = Math.min(best, Math.max(Math.abs(c.x - p.x), Math.abs(c.y - p.y)) - 8);
  }
  return best;
}

export function findContextAction(world: World, ch: Character): ContextOption | null {
  if (!ch.alive) return null;
  const round = world.round;
  if (round.phase === 'ended') return null;
  if (ch.side === 'defend' && round.phase === 'planted' && round.device) {
    if (Math.hypot(ch.pos.x - round.device.pos.x, ch.pos.y - round.device.pos.y) <= 36) {
      return { kind: 'disable', label: 'Disable disruptor', duration: round.rules.disableTime, target: 0 };
    }
  }
  if (ch.side === 'attack' && round.phase === 'action' && world.map.isObjectiveAt(ch.pos)) {
    return { kind: 'plant', label: 'Plant disruptor', duration: round.rules.plantTime, target: 0 };
  }
  for (const d of world.deployables) {
    if (!d.alive || d.ownerId !== ch.id || !isPickupable(d.kind)) continue;
    const p = d.rect ? { x: Math.max(d.rect.x0, Math.min(ch.pos.x, d.rect.x1)), y: Math.max(d.rect.y0, Math.min(ch.pos.y, d.rect.y1)) } : d.pos;
    if (Math.hypot(p.x - ch.pos.x, p.y - ch.pos.y) <= ch.radius + 16) {
      return { kind: 'pickup', label: `Pick up ${EQUIPMENT[d.kind as EquipId]?.name ?? d.kind}`, duration: 0.8, target: d.id };
    }
  }
  const door = nearestDoorway(world, ch.pos, INTERACT_REACH);
  let doorOpt: ContextOption | null = null;
  if (door) {
    const b = door.barricade;
    if (ch.side === 'defend') {
      if (!b && !world.spentDoorways.has(door.id)) doorOpt = { kind: 'build_barricade', label: 'Barricade doorway', duration: BARRICADE_BUILD_TIME, target: door.id };
      else if (b && b.complete && b.team === ch.team) {
        doorOpt = { kind: 'remove_barricade', label: isDamaged(b) ? 'Tear down damaged barricade' : 'Remove barricade', duration: BARRICADE_REMOVE_TIME, target: door.id };
      }
    } else if (b && b.complete && b.segments.some((hp) => hp > 0)) {
      doorOpt = { kind: 'bash', label: 'Bash barricade', duration: 0, target: door.id };
    }
  }
  let panelOpt: ContextOption | null = null;
  let panelDist = Infinity;
  if (ch.side === 'defend' && world.reinforcements[ch.team] > 0) {
    for (const p of world.map.panels) {
      if (p.reinforced || !world.map.panelIntact(p)) continue;
      const d = panelDistance(world, p, ch.pos);
      if (d <= ch.radius + 12 && d < panelDist) {
        panelDist = d;
        panelOpt = { kind: 'reinforce', label: `Reinforce wall (${world.reinforcements[ch.team]} left)`, duration: REINFORCE_TIME, target: p.id };
      }
    }
  }
  if (doorOpt && panelOpt) return doorwayDistance(world.map.doorways[doorOpt.target], ch.pos) <= panelDist + 6 ? doorOpt : panelOpt;
  return doorOpt ?? panelOpt;
}

function stillValid(world: World, ch: Character, a: HoldAction): boolean {
  const round = world.round;
  switch (a.kind) {
    case 'plant':
      return round.phase === 'action' && world.map.isObjectiveAt(ch.pos);
    case 'disable':
      return round.phase === 'planted';
    case 'build_barricade': {
      const b = world.map.doorways[a.target].barricade;
      return !!b && !b.complete && b.builderId === ch.id;
    }
    case 'remove_barricade':
      return !!world.map.doorways[a.target].barricade?.complete;
    case 'reinforce': {
      const p = world.map.panels[a.target];
      return !p.reinforced && world.map.panelIntact(p) && world.reinforcements[ch.team] > 0;
    }
    case 'pickup':
      return !!world.deployableById(a.target)?.alive;
    case 'place':
    case 'scan': {
      const eq = a.equipId ? findEquip(ch, a.equipId) : null;
      return !!eq && eq.state.charges !== 0;
    }
  }
}

export function cancelAction(world: World, ch: Character): void {
  const a = ch.action;
  if (!a) return;
  if (a.kind === 'build_barricade') {
    const d = world.map.doorways[a.target];
    if (d.barricade && !d.barricade.complete && d.barricade.builderId === ch.id) {
      d.barricade = null;
      world.emit({ type: 'barricade', doorwayId: d.id, action: 'build_cancel', team: ch.team, pos: d.center });
    }
  }
  ch.action = null;
}

export function updateInteraction(world: World, ch: Character, it: Intent, dt: number): void {
  const a = ch.action;
  if (a) {
    const held = a.via === 'interact' ? it.interact : it.fire;
    const drift = Math.hypot(ch.pos.x - a.startPos.x, ch.pos.y - a.startPos.y);
    if (!held || drift > 12 || !stillValid(world, ch, a)) {
      cancelAction(world, ch);
      return;
    }
    a.elapsed += dt;
    tickAction(world, ch, a);
    if (a.elapsed >= a.duration) {
      ch.action = null;
      ch.interactReady = false;
      completeAction(world, ch, a);
    }
    return;
  }
  if (!it.interact || !ch.interactReady || ch.sprinting) return;
  const opt = findContextAction(world, ch);
  if (!opt) return;
  if (opt.kind === 'bash') {
    if (ch.meleeCooldown <= 0) doMelee(world, ch, false);
    return;
  }
  ch.action = {
    kind: opt.kind, label: opt.label, elapsed: 0, duration: opt.duration, startPos: { x: ch.pos.x, y: ch.pos.y },
    target: opt.target, via: 'interact', tick: 0,
  };
  if (opt.kind === 'build_barricade') {
    const d = world.map.doorways[opt.target];
    d.barricade = createBarricade(d, ch.team, ch.id);
    world.emit({ type: 'barricade', doorwayId: d.id, action: 'build_start', team: ch.team, pos: d.center });
  }
}

function tickAction(world: World, ch: Character, a: HoldAction): void {
  const period = a.kind === 'build_barricade' ? 0.32 : a.kind === 'reinforce' ? 0.45 : 1.0;
  const n = Math.floor(a.elapsed / period);
  if (n <= a.tick) return;
  a.tick = n;
  switch (a.kind) {
    case 'build_barricade': {
      const d = world.map.doorways[a.target];
      if (d.barricade) {
        d.barricade.progress = Math.min(1, a.elapsed / a.duration);
        d.barricade.version++;
      }
      world.emit({ type: 'barricade', doorwayId: d.id, action: 'build_tick', team: ch.team, pos: d.center });
      world.sound(d.center, 260, 'barricade_build', ch.id, ch.team);
      break;
    }
    case 'reinforce': {
      const p = world.map.panels[a.target];
      world.emit({ type: 'wall', cells: p.cells, action: 'reinforce_tick', team: ch.team, pos: p.center });
      world.sound(p.center, 300, 'reinforce', ch.id, ch.team);
      break;
    }
    case 'plant':
    case 'disable':
      world.emit({ type: 'device', action: a.kind === 'plant' ? 'plant_tick' : 'disable_tick', pos: { x: ch.pos.x, y: ch.pos.y } });
      world.sound(ch.pos, 220, a.kind, ch.id, ch.team);
      break;
    default:
      break;
  }
}

function completeAction(world: World, ch: Character, a: HoldAction): void {
  switch (a.kind) {
    case 'build_barricade': {
      const d = world.map.doorways[a.target];
      if (!d.barricade) return;
      d.barricade.complete = true;
      d.barricade.progress = 1;
      d.barricade.version++;
      world.clearDoorwayOccupants(d.id);
      world.emit({ type: 'barricade', doorwayId: d.id, action: 'built', team: ch.team, pos: d.center });
      world.sound(d.center, 300, 'barricade_build', ch.id, ch.team);
      return;
    }
    case 'remove_barricade': {
      const d = world.map.doorways[a.target];
      if (!d.barricade) return;
      if (isDamaged(d.barricade)) world.spentDoorways.add(d.id); // damage persists: no rebuilding here this round
      d.barricade = null;
      world.emit({ type: 'barricade', doorwayId: d.id, action: 'removed', team: ch.team, pos: d.center });
      world.sound(d.center, 300, 'barricade_hit', ch.id, ch.team);
      return;
    }
    case 'reinforce': {
      const p = world.map.panels[a.target];
      if (world.map.reinforcePanel(p)) {
        world.reinforcements[ch.team]--;
        world.emit({ type: 'wall', cells: p.cells, action: 'reinforced', team: ch.team, pos: p.center });
        world.sound(p.center, 360, 'reinforce', ch.id, ch.team);
      }
      return;
    }
    case 'plant':
      ch.stats.plants++;
      world.round.plant(world, ch.id, ch.pos);
      return;
    case 'disable':
      ch.stats.disables++;
      world.round.disable(world);
      return;
    case 'pickup': {
      const d = world.deployableById(a.target);
      if (!d || !d.alive) return;
      d.alive = false;
      if (d.kind === 'shield') world.invalidateSolids();
      const eq = findEquip(ch, d.kind as EquipId);
      if (eq && eq.state.charges >= 0) eq.state.charges++;
      world.sound(d.pos, 120, 'deploy', ch.id, ch.team);
      return;
    }
    case 'place':
      completePlacement(world, ch, a);
      return;
    case 'scan':
      completeScan(world, ch);
      return;
  }
}
