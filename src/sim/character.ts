import { ARMOR, BASE_MOVE_SPEED, CAMERA_YAW_LIMIT, CROUCH_MULT, QUIET_MULT, SPRINT_MULT, SPRINT_TO_FIRE_DELAY } from '../config/constants';
import { updateInteraction } from './actions';
import { BODY_COLLISION, moveCircle } from './collision';
import { doMelee, startReload, tickWeapon, useWeapon } from './combat';
import { currentEquip, currentWeapon, selectSlot, type Character, type Slot } from './entities';
import { deployDrone, useEquipment } from './equipment';
import { angleDiff, angleTo, clamp, pointInAABB, type Vec2 } from './math';
import { canSeeCircle, viewOf } from './sight';
import type { Intent } from './types';
import type { World } from './world';

/** Applies one tick of intent to a character: slots, camera system, movement, actions, weapons. */
export function updateCharacter(world: World, ch: Character, it: Intent, dt: number): void {
  if (!ch.alive) return;
  ch.swapTimer = Math.max(0, ch.swapTimer - dt);
  ch.sprintRecover = Math.max(0, ch.sprintRecover - dt);
  ch.meleeCooldown = Math.max(0, ch.meleeCooldown - dt);
  ch.meleeAnim = Math.max(0, ch.meleeAnim - dt);
  ch.throwCooldown = Math.max(0, ch.throwCooldown - dt);
  ch.recoil *= Math.exp(-7 * dt);
  tickWeapon(world, ch, ch.inv.primary, dt);
  tickWeapon(world, ch, ch.inv.secondary, dt);
  if (!it.interact) ch.interactReady = true;

  // ---- slot selection & camera system (slot 5)
  if (it.selectSlot !== null) {
    if (it.selectSlot === 5) toggleCameraSystem(world, ch);
    else if (it.selectSlot >= 1 && it.selectSlot <= 4) {
      if (ch.camView) ch.camView = null;
      if (selectSlot(ch.inv, it.selectSlot as Slot)) {
        const w = currentWeapon(ch);
        ch.swapTimer = w ? w.def.equipTime : 0.3;
        ch.inv.primary.reloading = false;
        ch.inv.secondary.reloading = false;
        ch.hammerWindup = 0;
        if (ch.action && ch.action.via === 'fire') ch.action = null;
      }
    }
  }

  if (ch.camView) {
    ch.vel.x = ch.vel.y = 0;
    ch.moveFrac = 0;
    ch.sprinting = false;
    ch.ads = false;
    ch.action = null;
    updateCameraControl(world, ch, it, dt);
    return;
  }

  // ---- aim & stance
  if (Math.hypot(it.aim.x - ch.pos.x, it.aim.y - ch.pos.y) > 2) ch.facing = angleTo(ch.pos, it.aim);
  ch.stance = it.crouch ? 'crouch' : 'stand';
  ch.quiet = it.quiet;
  const mlen = Math.hypot(it.move.x, it.move.y);
  const moving = mlen > 0.1;
  const mx = mlen > 1 ? it.move.x / mlen : it.move.x;
  const my = mlen > 1 ? it.move.y / mlen : it.move.y;
  const weapon = currentWeapon(ch);
  const wantSprint = it.sprint && moving && !ch.action && ch.hammerWindup <= 0;
  if (wantSprint) {
    ch.sprinting = true;
    ch.stance = 'stand';
  } else if (ch.sprinting) {
    ch.sprinting = false;
    ch.sprintRecover = SPRINT_TO_FIRE_DELAY;
  }
  ch.ads = it.secondary && !ch.sprinting && !!weapon && ch.swapTimer <= 0;

  // ---- movement
  const inWire = world.deployables.some((d) => d.alive && d.kind === 'barbed_wire' && d.rect && pointInAABB(ch.pos.x, ch.pos.y, d.rect));
  let speed = BASE_MOVE_SPEED * ARMOR[ch.armor].speed * (weapon ? weapon.def.moveMult : 1);
  if (ch.sprinting && !inWire) speed *= SPRINT_MULT;
  else if (ch.stance === 'crouch') speed *= CROUCH_MULT;
  else if (ch.quiet) speed *= QUIET_MULT;
  if (ch.ads && weapon) speed *= weapon.def.adsMoveMult;
  if (inWire) speed *= 0.35;
  if (ch.action || ch.hammerWindup > 0) speed = 0;
  const k = 1 - Math.exp(-16 * dt);
  ch.vel.x += (mx * speed - ch.vel.x) * k;
  ch.vel.y += (my * speed - ch.vel.y) * k;
  const before = { x: ch.pos.x, y: ch.pos.y };
  moveCircle(world, ch.pos, ch.radius, ch.vel.x * dt, ch.vel.y * dt, BODY_COLLISION);
  if (world.round.phase === 'prep' && ch.spawnZone) {
    ch.pos.x = clamp(ch.pos.x, ch.spawnZone.x0 + ch.radius, ch.spawnZone.x1 - ch.radius);
    ch.pos.y = clamp(ch.pos.y, ch.spawnZone.y0 + ch.radius, ch.spawnZone.y1 - ch.radius);
  }
  const moved = Math.hypot(ch.pos.x - before.x, ch.pos.y - before.y);
  ch.moveFrac = moved / dt / BASE_MOVE_SPEED;
  footsteps(world, ch, moved, inWire);

  // ---- melee (V)
  if (it.melee && ch.meleeCooldown <= 0 && !ch.action && !ch.sprinting && ch.hammerWindup <= 0) doMelee(world, ch, false);

  // ---- contextual (F) and hold actions
  updateInteraction(world, ch, it, dt);

  // ---- hammer swing resolution
  if (ch.hammerWindup > 0) {
    ch.hammerWindup -= dt;
    if (ch.hammerWindup <= 0) {
      ch.hammerWindup = 0;
      doMelee(world, ch, true);
    }
  }

  // ---- held item (attackers are weapons-locked while staging; they scout with drones)
  if (world.round.phase === 'prep' && ch.side === 'attack') {
    if (it.firePressed || it.reload) world.message(ch, 'Weapons locked during preparation — scout with drones (5)');
    return;
  }
  if (weapon) {
    if (it.reload) startReload(world, ch, weapon);
    useWeapon(world, ch, weapon, it.fire, it.firePressed);
  } else {
    const eq = currentEquip(ch);
    if (eq) useEquipment(world, ch, eq, it);
  }
}

function footsteps(world: World, ch: Character, moved: number, inWire: boolean): void {
  if (moved < 0.05) return;
  ch.stepAccum += moved;
  const stride = ch.sprinting ? 34 : 28;
  if (ch.stepAccum < stride) return;
  ch.stepAccum = 0;
  let radius: number;
  if (ch.sprinting) radius = 300;
  else if (ch.stance === 'crouch' && ch.quiet) radius = 22;
  else if (ch.stance === 'crouch') radius = 60;
  else if (ch.quiet) radius = 45;
  else radius = 150;
  if (inWire) {
    world.sound(ch.pos, 230, 'wire', ch.id, ch.team);
    radius = Math.max(radius, 120);
  }
  world.sound(ch.pos, radius, 'footstep', ch.id, ch.team);
  world.emit({ type: 'footstep', charId: ch.id, pos: { x: ch.pos.x, y: ch.pos.y }, loud: radius });
}

// ------------------------------------------------------------------ camera system (slot 5)

export function teamCameras(world: World, ch: Character) {
  return world.deployables.filter((d) => d.alive && d.team === ch.team && (d.kind === 'camera' || d.kind === 'bp_camera'));
}

export function teamDrones(world: World, ch: Character) {
  return world.drones.filter((d) => d.alive && d.team === ch.team);
}

export function toggleCameraSystem(world: World, ch: Character): void {
  if (ch.camView) {
    ch.camView = null;
    return;
  }
  if (ch.side === 'attack') {
    const own = world.drones.find((d) => d.alive && d.ownerId === ch.id);
    if (own) {
      ch.camView = { kind: 'drone', id: own.id };
      return;
    }
    if (ch.inv.drones > 0) {
      const dr = deployDrone(world, ch);
      if (dr) ch.camView = { kind: 'drone', id: dr.id };
      return;
    }
    const team = teamDrones(world, ch);
    if (team.length) {
      ch.camView = { kind: 'drone', id: team[0].id };
      return;
    }
    world.message(ch, 'No drones available');
    return;
  }
  const cams = teamCameras(world, ch);
  if (!cams.length) {
    world.message(ch, 'All cameras destroyed');
    return;
  }
  ch.camView = { kind: 'cam', id: cams[0].id };
}

function cycleView(world: World, ch: Character): void {
  if (!ch.camView) return;
  const list = ch.camView.kind === 'cam' ? teamCameras(world, ch) : teamDrones(world, ch);
  if (!list.length) {
    ch.camView = null;
    return;
  }
  const idx = list.findIndex((x) => x.id === ch.camView!.id);
  const next = list[(idx + 1) % list.length];
  ch.camView = { kind: ch.camView.kind, id: next.id };
}

/** Marks the visible enemy nearest the cursor for the whole team (tracks live for a few seconds). */
function markAt(world: World, ch: Character, aim: Vec2): void {
  const v = viewOf(world, ch);
  if (!v) return;
  let best: Character | null = null;
  let bestD = 48;
  for (const e of world.chars) {
    if (!e.alive || e.team === ch.team) continue;
    const d = Math.hypot(e.pos.x - aim.x, e.pos.y - aim.y);
    if (d < bestD && canSeeCircle(world, v, e.pos, e.radius)) {
      best = e;
      bestD = d;
    }
  }
  if (best) {
    world.addIntel(ch.team, best, 'mark');
    world.emit({ type: 'mark', team: ch.team, pos: { x: best.pos.x, y: best.pos.y }, enemyId: best.id });
  }
}

function updateCameraControl(world: World, ch: Character, it: Intent, dt: number): void {
  const view = ch.camView!;
  if (view.kind === 'cam') {
    const cam = world.deployableById(view.id);
    if (!cam || !cam.alive) {
      cycleView(world, ch);
      return;
    }
    const base = cam.baseFacing ?? cam.facing;
    const desired = angleTo(cam.pos, it.aim);
    const off = clamp(angleDiff(base, desired), -CAMERA_YAW_LIMIT, CAMERA_YAW_LIMIT);
    const target = base + off;
    const step = 3.5 * dt;
    const d = angleDiff(cam.facing, target);
    cam.facing += Math.abs(d) <= step ? d : Math.sign(d) * step;
  } else {
    const dr = world.droneById(view.id);
    if (!dr || !dr.alive) {
      cycleView(world, ch);
      return;
    }
    if (dr.ownerId === ch.id && !dr.jammed) dr.facing = angleTo(dr.pos, it.aim);
    if (it.interactPressed && ch.inv.drones > 0) {
      const nd = deployDrone(world, ch);
      if (nd) {
        ch.camView = { kind: 'drone', id: nd.id };
        return;
      }
    }
  }
  if (it.secondaryPressed) cycleView(world, ch);
  if (it.firePressed) markAt(world, ch, it.aim);
}
