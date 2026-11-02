import Phaser from 'phaser';
import { CAMERA_FOV, DRONE_RADIUS } from '../../config/constants';
import { segmentCenter, segmentRect } from '../../sim/barricade';
import type { BotDirector } from '../../sim/ai/director';
import { currentEquip, type Character, type Deployable } from '../../sim/entities';
import { findPlacement } from '../../sim/equipment';
import type { GameEvent, ImpactMaterial } from '../../sim/events';
import { fromAngle, type Vec2 } from '../../sim/math';
import type { Doorway } from '../../sim/map';
import { canSeeCircle, canSeePoint, computeVisibility, type ViewSpec } from '../../sim/sight';
import type { Team } from '../../sim/types';
import type { World } from '../../sim/world';
import type { BarricadeSnap, KnownMap } from '../knowledge';
import { C, MONO, teamColor } from '../theme';
import type { MapRenderer } from './MapRenderer';

export interface Viewer {
  view: ViewSpec;
  team: Team;
  playerId: number;
}

interface Tracer { from: Vec2; to: Vec2; t: number; color: number }
interface Burst { pos: Vec2; t: number; radius: number; color: number; dur: number; ring: boolean }
interface Spark { pos: Vec2; t: number; color: number }

const IMPACT_COLOR: Record<ImpactMaterial, number> = {
  concrete: 0xb9c2cc, soft: 0xd9c49a, wood: 0xc58a4a, metal: 0xe8f0ff, shield: 0x9fd0ff, flesh: 0xff6a5a, none: 0xffffff,
};

const darken = (c: number, f = 0.55): number => {
  const r = ((c >> 16) & 255) * f;
  const g = ((c >> 8) & 255) * f;
  const b = (c & 255) * f;
  return (r << 16) | (g << 8) | b;
};

export class WorldRenderer {
  private gKnown: Phaser.GameObjects.Graphics;
  private gEnemy: Phaser.GameObjects.Graphics;
  private gFx: Phaser.GameObjects.Graphics;
  private gFriendly: Phaser.GameObjects.Graphics;
  private gDebug: Phaser.GameObjects.Graphics;
  private fog: Phaser.GameObjects.Rectangle;
  private maskWallG: Phaser.GameObjects.Graphics;
  private maskEntG: Phaser.GameObjects.Graphics;
  private tracers: Tracer[] = [];
  private bursts: Burst[] = [];
  private sparks: Spark[] = [];
  private names: Phaser.GameObjects.Text[] = [];
  private floaters: { text: Phaser.GameObjects.Text; t: number; pos: Vec2 }[] = [];
  private debugTexts: Phaser.GameObjects.Text[] = [];
  visibleEnemies = new Set<number>();
  lastView: ViewSpec | null = null;

  constructor(private scene: Phaser.Scene, private world: World, private known: KnownMap, private mapR: MapRenderer) {
    const m = world.map;
    this.gKnown = scene.add.graphics().setDepth(5);
    this.gEnemy = scene.add.graphics().setDepth(10);
    this.gFx = scene.add.graphics().setDepth(12);
    // Fog of war: one dark rectangle with the visibility polygon punched out by an inverted stencil mask.
    this.fog = scene.add.rectangle(-400, -400, m.pxWidth + 800, m.pxHeight + 800, C.fog, 0.66).setOrigin(0, 0).setDepth(15);
    this.gFriendly = scene.add.graphics().setDepth(20);
    this.gDebug = scene.add.graphics().setDepth(40);
    this.maskWallG = scene.make.graphics({}, false);
    this.maskEntG = scene.make.graphics({}, false);
    this.gFx.setMask(this.maskWallG.createGeometryMask());
    this.gEnemy.setMask(this.maskEntG.createGeometryMask());
    const fogMask = this.maskWallG.createGeometryMask();
    fogMask.setInvertAlpha(true);
    this.fog.setMask(fogMask);
  }

  // ------------------------------------------------------------------ events

  handle(e: GameEvent, viewer: Viewer): void {
    const now = this.world.time;
    this.known.onEvent(e);
    switch (e.type) {
      case 'shot': {
        const own = e.team === viewer.team;
        for (const end of e.ends) {
          this.tracers.push({ from: e.from, to: end.to, t: now, color: own ? 0xfff2b0 : 0xffa060 });
          if (end.material !== 'none') this.sparks.push({ pos: end.to, t: now, color: IMPACT_COLOR[end.material] });
        }
        const f = e.ends[0] ? Math.atan2(e.ends[0].to.y - e.from.y, e.ends[0].to.x - e.from.x) : 0;
        const mz = { x: e.from.x + Math.cos(f) * 17, y: e.from.y + Math.sin(f) * 17 };
        this.bursts.push({ pos: mz, t: now, radius: 6, color: 0xffd27a, dur: 0.05, ring: false });
        break;
      }
      case 'explosion': {
        const color = e.kind === 'hard_breach' ? 0xff7a2a : e.kind === 'device' ? 0xffd04a : 0xff9a3a;
        this.bursts.push({ pos: e.pos, t: now, radius: e.radius, color, dur: 0.45, ring: true });
        this.bursts.push({ pos: e.pos, t: now, radius: e.radius * 0.45, color: 0xfff0c0, dur: 0.18, ring: false });
        break;
      }
      case 'flash':
        this.bursts.push({ pos: e.pos, t: now, radius: 90, color: 0xffffff, dur: 0.3, ring: false });
        break;
      case 'emp':
        this.bursts.push({ pos: e.pos, t: now, radius: e.radius, color: 0x7fb8ff, dur: 0.5, ring: true });
        break;
      case 'smoke':
        this.bursts.push({ pos: e.pos, t: now, radius: 20, color: 0xcfd3d8, dur: 0.3, ring: false });
        break;
      case 'scan':
        if (e.team === viewer.team) this.bursts.push({ pos: e.pos, t: now, radius: 260, color: 0x6fe3ff, dur: 0.8, ring: true });
        break;
      case 'wall':
        if (e.action === 'hit' && (e.team === viewer.team || Math.hypot(e.pos.x - viewer.view.origin.x, e.pos.y - viewer.view.origin.y) < 500)) {
          this.mapR.repaint(e.cells);
        }
        break;
      case 'hit':
        if (e.sourceId === viewer.playerId && e.targetId !== viewer.playerId) this.spawnFloater(e.pos, e.amount, e.mult, e.killed);
        break;
      default:
        break;
    }
  }

  private spawnFloater(pos: Vec2, amount: number, mult: number, killed: boolean): void {
    const t = mult - 1;
    const col = Phaser.Display.Color.Interpolate.ColorWithColor(
      Phaser.Display.Color.ValueToColor(0xffffff),
      Phaser.Display.Color.ValueToColor(0xff8a1f),
      100,
      Math.round(t * 200),
    );
    const css = Phaser.Display.Color.RGBToString(col.r, col.g, col.b);
    const label = mult > 1.001 ? `${Math.round(amount)} ×${mult.toFixed(2)}` : `${Math.round(amount)}`;
    let text = this.floaters.length > 24 ? this.floaters.shift()!.text : null;
    if (!text) text = this.scene.add.text(0, 0, '', { fontFamily: MONO, fontSize: '11px', color: css, fontStyle: 'bold' }).setDepth(50).setOrigin(0.5);
    text.setText(killed ? `${label} ✖` : label).setColor(css).setStroke('#000000', 3).setVisible(true);
    this.floaters.push({ text, t: this.world.time, pos: { x: pos.x + (Math.random() - 0.5) * 8, y: pos.y - 10 } });
  }

  // ------------------------------------------------------------------ frame

  render(viewer: Viewer, opts: { debug: boolean; director?: BotDirector; showSpawn?: boolean; aim?: Vec2 }): void {
    const w = this.world;
    const now = w.time;
    const view = viewer.view;
    this.lastView = view;
    this.known.beginFrame();
    const vis = computeVisibility(w, view, 0.011, this.known.see);
    this.known.syncOwn();
    this.mapR.flush();

    // masks & fog
    this.maskWallG.clear().fillStyle(0xffffff, 1);
    this.maskEntG.clear().fillStyle(0xffffff, 1);
    this.fillPoly(this.maskWallG, vis.cone);
    this.fillPoly(this.maskEntG, vis.coneSmoke);
    if (vis.near.length) {
      this.fillPoly(this.maskWallG, vis.near);
      this.fillPoly(this.maskEntG, vis.nearSmoke);
    }

    // who is visible right now
    this.visibleEnemies.clear();
    for (const c of w.chars) {
      if (c.alive && c.team !== viewer.team && canSeeCircle(w, view, c.pos, c.radius)) this.visibleEnemies.add(c.id);
    }

    this.drawKnown(viewer, now, !!opts.showSpawn);
    this.drawEnemies(viewer, now);
    this.drawFx(now);
    this.drawFriendly(viewer, now);
    this.drawEquipPreview(viewer, opts.aim);
    this.drawFloaters(now);
    this.gDebug.clear();
    for (const t of this.debugTexts) t.setVisible(false);
    if (opts.debug) this.drawDebug(opts.director);
  }

  private fillPoly(g: Phaser.GameObjects.Graphics, flat: number[]): void {
    if (flat.length < 6) return;
    g.beginPath();
    g.moveTo(flat[0], flat[1]);
    for (let i = 2; i < flat.length; i += 2) g.lineTo(flat[i], flat[i + 1]);
    g.closePath();
    g.fillPath();
  }

  // ------------------------------------------------------------------ known layer

  private drawKnown(viewer: Viewer, now: number, showSpawn: boolean): void {
    const w = this.world;
    const g = this.gKnown;
    g.clear();
    const o = w.map.objectiveRect;
    g.lineStyle(2, C.amber, 0.55 + 0.2 * Math.sin(now * 3));
    g.strokeRect(o.x0, o.y0, o.x1 - o.x0, o.y1 - o.y0);
    w.map.doorways.forEach((d, i) => {
      const snap = this.known.barricades[i];
      this.drawDoorwayFrame(g, d);
      if (snap) this.drawBarricade(g, d, snap);
    });
    for (const d of w.deployables) {
      if (!d.alive || d.team !== viewer.team) continue;
      this.drawDeployable(g, d, now, true);
    }
    if (showSpawn) {
      const me = w.charById(viewer.playerId);
      if (me?.spawnZone) {
        const z = me.spawnZone;
        g.lineStyle(1, C.blue, 0.5);
        g.strokeRect(z.x0, z.y0, z.x1 - z.x0, z.y1 - z.y0);
      }
    }
    const dev = w.round.device;
    if (dev) {
      const pulse = 0.5 + 0.5 * Math.sin(now * (6 + 10 * (1 - dev.fuseLeft / w.round.rules.fuseTime)));
      g.fillStyle(0x000000, 0.5);
      g.fillCircle(dev.pos.x + 1, dev.pos.y + 2, 8);
      g.fillStyle(0x3a3020, 1);
      g.fillRect(dev.pos.x - 7, dev.pos.y - 5, 14, 10);
      g.fillStyle(C.amber, 0.6 + 0.4 * pulse);
      g.fillCircle(dev.pos.x, dev.pos.y, 3);
      g.lineStyle(2, C.amber, 0.4 * pulse);
      g.strokeCircle(dev.pos.x, dev.pos.y, 14 + 8 * pulse);
    }
  }

  private drawDoorwayFrame(g: Phaser.GameObjects.Graphics, d: Doorway): void {
    // jamb markers at both ends of the opening (architectural, not a door)
    g.fillStyle(0x50575f, 1);
    if (d.orient === 'h') {
      g.fillRect(d.rect.x0 - 1, d.center.y - 5, 2, 10);
      g.fillRect(d.rect.x1 - 1, d.center.y - 5, 2, 10);
    } else {
      g.fillRect(d.center.x - 5, d.rect.y0 - 1, 10, 2);
      g.fillRect(d.center.x - 5, d.rect.y1 - 1, 10, 2);
    }
  }

  private drawBarricade(g: Phaser.GameObjects.Graphics, d: Doorway, s: BarricadeSnap): void {
    const n = s.segments.length;
    if (!s.complete) {
      const built = Math.floor(s.progress * n + 1e-6);
      for (let i = 0; i < n; i++) {
        const r = segmentRect(d, i);
        if (i < built) {
          g.fillStyle(0x9a6a35, 0.85);
          g.fillRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
        } else {
          g.lineStyle(1, 0xc89a5a, 0.35);
          g.strokeRect(r.x0 + 0.5, r.y0 + 0.5, r.x1 - r.x0 - 1, r.y1 - r.y0 - 1);
        }
      }
      return;
    }
    for (let i = 0; i < n; i++) {
      const r = segmentRect(d, i);
      const hp = s.segments[i];
      if (hp > 0) {
        const f = hp / s.maxSegHp;
        const col = Phaser.Display.Color.GetColor(70 + 84 * f, 44 + 56 * f, 22 + 28 * f);
        g.fillStyle(col, 1);
        g.fillRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
        g.lineStyle(1, 0x3a2412, 1);
        g.strokeRect(r.x0 + 0.5, r.y0 + 0.5, r.x1 - r.x0 - 1, r.y1 - r.y0 - 1);
        if (f < 0.6) {
          g.lineStyle(1, 0x1e1209, 1);
          g.lineBetween(r.x0 + 1, r.y0 + 1, r.x1 - 2, r.y1 - 2);
        }
      } else {
        const c = segmentCenter(d, i);
        g.fillStyle(0x7a5530, 0.9);
        g.fillRect(c.x - 3, c.y + 2, 2, 2);
        g.fillRect(c.x + 1, c.y - 3, 2, 1);
      }
    }
  }

  private drawDeployable(g: Phaser.GameObjects.Graphics, d: Deployable, now: number, friendly: boolean): void {
    const disabled = d.disabledUntil > now;
    const tc = teamColor(d.team);
    switch (d.kind) {
      case 'barbed_wire': {
        const r = d.rect!;
        g.lineStyle(1, 0xa9b0b8, 0.85);
        for (let k = 0; k <= 6; k++) {
          const t = k / 6;
          g.lineBetween(r.x0 + (r.x1 - r.x0) * t, r.y0, r.x0, r.y0 + (r.y1 - r.y0) * t);
          g.lineBetween(r.x1 - (r.x1 - r.x0) * t, r.y1, r.x1, r.y1 - (r.y1 - r.y0) * t);
        }
        g.lineStyle(1, 0x6b7178, 0.8);
        g.strokeRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
        break;
      }
      case 'shield': {
        const r = d.rect!;
        g.fillStyle(0x3a4652, 1);
        g.fillRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
        g.lineStyle(1, 0x8fa3b5, 1);
        g.strokeRect(r.x0 + 0.5, r.y0 + 0.5, r.x1 - r.x0 - 1, r.y1 - r.y0 - 1);
        break;
      }
      case 'soft_breach':
      case 'hard_breach': {
        const s = d.kind === 'hard_breach' ? 6 : 4;
        g.fillStyle(d.kind === 'hard_breach' ? 0x8a8f96 : 0x5a6a3a, 1);
        g.fillRect(d.pos.x - s, d.pos.y - s, s * 2, s * 2);
        if (Math.sin(now * 10) > 0) {
          g.fillStyle(0xff3a2a, 1);
          g.fillCircle(d.pos.x, d.pos.y, 1.6);
        }
        break;
      }
      case 'camera':
      case 'bp_camera': {
        if (friendly) {
          g.lineStyle(1, disabled ? 0x7fb8ff : tc, 0.18);
          const a0 = d.facing - CAMERA_FOV / 2;
          const a1 = d.facing + CAMERA_FOV / 2;
          g.lineBetween(d.pos.x, d.pos.y, d.pos.x + Math.cos(a0) * 60, d.pos.y + Math.sin(a0) * 60);
          g.lineBetween(d.pos.x, d.pos.y, d.pos.x + Math.cos(a1) * 60, d.pos.y + Math.sin(a1) * 60);
        }
        g.fillStyle(d.kind === 'bp_camera' ? 0x2d3a46 : 0x23272d, 1);
        g.fillCircle(d.pos.x, d.pos.y, 4.5);
        const f = fromAngle(d.facing);
        g.fillStyle(disabled ? 0x7fb8ff : 0xff3a3a, 1);
        g.fillCircle(d.pos.x + f.x * 2.5, d.pos.y + f.y * 2.5, 1.6);
        break;
      }
      case 'jammer': {
        g.fillStyle(0x2a3038, 1);
        g.fillCircle(d.pos.x, d.pos.y, 5);
        g.lineStyle(1, disabled ? 0x7fb8ff : tc, 1);
        g.lineBetween(d.pos.x, d.pos.y, d.pos.x + 4, d.pos.y - 7);
        if (friendly && !disabled) {
          g.lineStyle(1, tc, 0.18);
          g.strokeCircle(d.pos.x, d.pos.y, 82);
        }
        break;
      }
      case 'alarm': {
        g.fillStyle(0x2f2a24, 1);
        g.fillTriangle(d.pos.x, d.pos.y - 5, d.pos.x - 5, d.pos.y + 4, d.pos.x + 5, d.pos.y + 4);
        g.fillStyle(disabled ? 0x7fb8ff : now - d.lastAlarm < 0.4 ? 0xffe14a : 0x9a7a2a, 1);
        g.fillCircle(d.pos.x, d.pos.y + 1, 1.8);
        break;
      }
      case 'claymore': {
        const f = fromAngle(d.facing);
        const p = { x: -f.y, y: f.x };
        g.lineStyle(3, 0x4d5a3a, 1);
        g.lineBetween(d.pos.x - p.x * 5, d.pos.y - p.y * 5, d.pos.x + p.x * 5, d.pos.y + p.y * 5);
        if (friendly) {
          g.lineStyle(1, 0xff4a3a, 0.35);
          const a = d.facing;
          g.lineBetween(d.pos.x, d.pos.y, d.pos.x + Math.cos(a - 0.7) * 70, d.pos.y + Math.sin(a - 0.7) * 70);
          g.lineBetween(d.pos.x, d.pos.y, d.pos.x + Math.cos(a + 0.7) * 70, d.pos.y + Math.sin(a + 0.7) * 70);
        }
        break;
      }
    }
  }

  // ------------------------------------------------------------------ enemies (masked by sight)

  private drawEnemies(viewer: Viewer, now: number): void {
    const w = this.world;
    const g = this.gEnemy;
    g.clear();
    const view = viewer.view;
    for (const c of w.chars) {
      if (c.team === viewer.team) continue;
      if (!c.alive) {
        this.drawCorpse(g, c);
        continue;
      }
      if (this.visibleEnemies.has(c.id)) this.drawOperator(g, c, teamColor(c.team), false, now);
    }
    for (const d of w.deployables) {
      if (!d.alive || d.team === viewer.team) continue;
      const p = d.rect ? { x: (d.rect.x0 + d.rect.x1) / 2, y: (d.rect.y0 + d.rect.y1) / 2 } : d.pos;
      if (d.kind === 'barbed_wire' || d.kind === 'shield' || canSeePoint(w, view, p, 6)) this.drawDeployable(g, d, now, false);
    }
    for (const dr of w.drones) {
      if (dr.alive && dr.team !== viewer.team && canSeePoint(w, view, dr.pos, DRONE_RADIUS)) this.drawDrone(g, dr.pos, dr.facing, teamColor(dr.team), false);
    }
    for (const p of w.projectiles) if (p.team !== viewer.team) this.drawProjectile(g, p.kind, p.pos);
  }

  // ------------------------------------------------------------------ effects (masked by walls)

  private drawFx(now: number): void {
    const g = this.gFx;
    g.clear();
    for (const s of this.world.smokes) {
      const age = now - s.born;
      const a = Math.min(1, age * 2) * Math.min(1, (s.life - age) / 1.5);
      for (let k = 0; k < 7; k++) {
        const ang = k * 0.9 + s.id;
        const off = s.radius * 0.35;
        g.fillStyle(k % 2 ? 0xb9bec5 : 0xa3a9b1, 0.55 * a);
        g.fillCircle(s.pos.x + Math.cos(ang + age * 0.15) * off, s.pos.y + Math.sin(ang + age * 0.15) * off, s.radius * 0.72);
      }
      g.fillStyle(0xc8ccd2, 0.75 * a);
      g.fillCircle(s.pos.x, s.pos.y, s.radius * 0.8);
    }
    this.tracers = this.tracers.filter((t) => now - t.t < 0.09);
    for (const t of this.tracers) {
      const a = 1 - (now - t.t) / 0.09;
      g.lineStyle(1.4, t.color, 0.85 * a);
      g.lineBetween(t.from.x, t.from.y, t.to.x, t.to.y);
    }
    this.sparks = this.sparks.filter((s) => now - s.t < 0.25);
    for (const s of this.sparks) {
      const k = (now - s.t) / 0.25;
      g.fillStyle(s.color, 1 - k);
      g.fillCircle(s.pos.x, s.pos.y, 1.5 + k * 2.5);
    }
    this.bursts = this.bursts.filter((b) => now - b.t < b.dur);
    for (const b of this.bursts) {
      const k = (now - b.t) / b.dur;
      if (b.ring) {
        g.lineStyle(3, b.color, 1 - k);
        g.strokeCircle(b.pos.x, b.pos.y, b.radius * (0.3 + 0.7 * k));
        g.fillStyle(b.color, 0.25 * (1 - k));
        g.fillCircle(b.pos.x, b.pos.y, b.radius * (0.3 + 0.7 * k));
      } else {
        g.fillStyle(b.color, 0.9 * (1 - k));
        g.fillCircle(b.pos.x, b.pos.y, b.radius * (0.6 + 0.4 * k));
      }
    }
  }

  // ------------------------------------------------------------------ friendly layer (above fog)

  private drawFriendly(viewer: Viewer, now: number): void {
    const w = this.world;
    const g = this.gFriendly;
    g.clear();
    let ni = 0;
    for (const c of w.chars) {
      if (c.team !== viewer.team) continue;
      if (!c.alive) {
        this.drawCorpse(g, c);
        continue;
      }
      this.drawOperator(g, c, teamColor(c.team), c.id === viewer.playerId, now);
      if (c.id !== viewer.playerId) {
        const t = this.nameText(ni++);
        t.setText(c.name).setPosition(c.pos.x, c.pos.y - 22).setVisible(true);
        g.fillStyle(0x000000, 0.6);
        g.fillRect(c.pos.x - 10, c.pos.y - 16, 20, 3);
        g.fillStyle(c.hp > 50 ? C.good : c.hp > 25 ? C.amber : C.bad, 1);
        g.fillRect(c.pos.x - 10, c.pos.y - 16, 20 * (c.hp / 100), 3);
      }
    }
    for (let k = ni; k < this.names.length; k++) this.names[k].setVisible(false);
    for (const dr of w.drones) if (dr.alive && dr.team === viewer.team) this.drawDrone(g, dr.pos, dr.facing, teamColor(dr.team), dr.jammed);
    for (const p of w.projectiles) if (p.team === viewer.team) this.drawProjectile(g, p.kind, p.pos);
    // team call-outs: last known enemy positions (never live positions unless marked)
    for (const e of w.intel[viewer.team].values()) {
      if (this.visibleEnemies.has(e.enemyId)) continue;
      const life = Math.max(0, Math.min(1, (e.expires - now) / 2));
      const s = e.source === 'mark' ? 7 : 5;
      g.lineStyle(2, C.red, 0.9 * life);
      g.strokeTriangle(e.pos.x, e.pos.y - s, e.pos.x + s, e.pos.y, e.pos.x, e.pos.y + s);
      g.strokeTriangle(e.pos.x, e.pos.y - s, e.pos.x - s, e.pos.y, e.pos.x, e.pos.y + s);
      if (e.source === 'mark' || e.source === 'alarm') {
        g.lineStyle(1, C.red, 0.5 * life);
        g.strokeCircle(e.pos.x, e.pos.y, s + 5 + 2 * Math.sin(now * 8));
      }
    }
  }

  /** Placement ghost (valid = green, invalid = red) and throw landing marker for the held item. */
  private drawEquipPreview(viewer: Viewer, aim?: Vec2): void {
    const p = this.world.charById(viewer.playerId);
    if (!p || !p.alive || p.camView || p.action) return;
    const eq = currentEquip(p);
    if (!eq || eq.charges === 0) return;
    const g = this.gFriendly;
    if (eq.def.use === 'place') {
      const pl = findPlacement(this.world, p, eq.def.id);
      const col = pl.ok ? C.good : C.bad;
      if (pl.rect) {
        g.lineStyle(1.5, col, 0.8);
        g.strokeRect(pl.rect.x0, pl.rect.y0, pl.rect.x1 - pl.rect.x0, pl.rect.y1 - pl.rect.y0);
      } else if (pl.ok) {
        g.lineStyle(1.5, col, 0.9);
        g.strokeCircle(pl.pos.x, pl.pos.y, 6);
      } else {
        const f = fromAngle(p.facing);
        const q = { x: p.pos.x + f.x * 30, y: p.pos.y + f.y * 30 };
        g.lineStyle(2, col, 0.8);
        g.lineBetween(q.x - 4, q.y - 4, q.x + 4, q.y + 4);
        g.lineBetween(q.x + 4, q.y - 4, q.x - 4, q.y + 4);
      }
    } else if (eq.def.use === 'throw' && aim) {
      const f = fromAngle(p.facing);
      const d = Math.max(30, Math.min(Math.hypot(aim.x - p.pos.x, aim.y - p.pos.y), 340));
      const land = { x: p.pos.x + f.x * d, y: p.pos.y + f.y * d };
      g.lineStyle(1, C.amber, 0.35);
      for (let k = 0; k < d; k += 14) g.lineBetween(p.pos.x + f.x * k, p.pos.y + f.y * k, p.pos.x + f.x * Math.min(d, k + 7), p.pos.y + f.y * Math.min(d, k + 7));
      g.strokeCircle(land.x, land.y, eq.def.radius ? Math.min(eq.def.radius, 60) * 0.5 : 10);
    }
  }

  private nameText(i: number): Phaser.GameObjects.Text {
    if (!this.names[i]) {
      this.names[i] = this.scene.add
        .text(0, 0, '', { fontFamily: MONO, fontSize: '9px', color: '#cfe8f5' })
        .setOrigin(0.5, 1)
        .setDepth(25)
        .setAlpha(0.85);
    }
    return this.names[i];
  }

  private drawOperator(g: Phaser.GameObjects.Graphics, c: Character, color: number, isPlayer: boolean, now: number): void {
    const r = c.stance === 'crouch' ? 7.5 : 9;
    const { x, y } = c.pos;
    const f = fromAngle(c.facing);
    g.fillStyle(0x000000, 0.35);
    g.fillCircle(x + 1.5, y + 2, r);
    const holdingGun = c.inv.slot <= 2;
    const barrel = holdingGun ? r + (c.ads ? 10 : 8) : r + 3;
    g.lineStyle(holdingGun ? 3 : 4, 0x15181c, 1);
    g.lineBetween(x + f.x * 2, y + f.y * 2, x + f.x * barrel, y + f.y * barrel);
    g.fillStyle(darken(color), 1);
    g.fillCircle(x, y, r);
    g.fillStyle(color, 1);
    g.fillCircle(x, y, r - 2.2);
    g.fillStyle(0x0d1014, 0.85);
    g.fillCircle(x + f.x * 2.5, y + f.y * 2.5, 3.2);
    if (c.sprinting) {
      g.lineStyle(1, color, 0.4);
      g.lineBetween(x - f.x * (r + 3), y - f.y * (r + 3), x - f.x * (r + 9), y - f.y * (r + 9));
    }
    if (isPlayer) {
      g.lineStyle(1.5, 0xffffff, 0.85);
      g.strokeCircle(x, y, r + 3);
    }
    if (c.action) {
      const k = Math.min(1, c.action.elapsed / c.action.duration);
      g.lineStyle(2, C.amber, 0.95);
      g.beginPath();
      g.arc(x, y, r + 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k);
      g.strokePath();
    }
    if (c.meleeAnim > 0 || c.hammerWindup > 0) {
      const a = c.facing;
      g.lineStyle(2, 0xffffff, 0.6);
      g.beginPath();
      g.arc(x, y, r + 14, a - 0.9, a + 0.9);
      g.strokePath();
    }
    if (c.camView) {
      g.fillStyle(0x0d1014, 0.9);
      g.fillRect(x - 6, y - r - 12, 12, 7);
      g.fillStyle(C.amber, 1);
      g.fillCircle(x, y - r - 8.5, 1.8);
    }
    if (c.blindUntil > now && c.blindStrength > 0.25) {
      g.lineStyle(1, 0xffffff, 0.7);
      g.strokeCircle(x, y, r + 5 + Math.sin(now * 20));
    }
  }

  private drawCorpse(g: Phaser.GameObjects.Graphics, c: Character): void {
    const { x, y } = c.pos;
    g.fillStyle(darken(teamColor(c.team), 0.35), 0.9);
    g.fillCircle(x, y, 8);
    g.lineStyle(2, 0x0b0d10, 0.9);
    g.lineBetween(x - 4, y - 4, x + 4, y + 4);
    g.lineBetween(x + 4, y - 4, x - 4, y + 4);
  }

  private drawDrone(g: Phaser.GameObjects.Graphics, p: Vec2, facing: number, color: number, jammed: boolean): void {
    g.fillStyle(0x000000, 0.35);
    g.fillCircle(p.x + 1, p.y + 1.5, 5);
    g.fillStyle(0x22262c, 1);
    g.fillRect(p.x - 4, p.y - 4, 8, 8);
    g.fillStyle(jammed ? 0x7fb8ff : color, 1);
    for (const [dx, dy] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) g.fillCircle(p.x + dx, p.y + dy, 2);
    const f = fromAngle(facing);
    g.fillStyle(0xffffff, 0.9);
    g.fillCircle(p.x + f.x * 3, p.y + f.y * 3, 1.3);
  }

  private drawProjectile(g: Phaser.GameObjects.Graphics, kind: string, p: Vec2): void {
    const col = kind === 'frag' ? 0x5f7a3a : kind === 'smoke' ? 0x9aa0a8 : kind === 'flash' ? 0xf0f0e0 : kind === 'emp' ? 0x5aa0ff : 0xff8a3a;
    g.fillStyle(0x000000, 0.4);
    g.fillCircle(p.x + 1, p.y + 1, 3);
    g.fillStyle(col, 1);
    g.fillCircle(p.x, p.y, 2.8);
  }

  private drawFloaters(now: number): void {
    this.floaters = this.floaters.filter((f) => {
      const k = (now - f.t) / 0.9;
      if (k >= 1) {
        f.text.setVisible(false).destroy();
        return false;
      }
      f.text.setPosition(f.pos.x, f.pos.y - k * 16).setAlpha(1 - k * k);
      return true;
    });
  }

  // ------------------------------------------------------------------ debug overlay (F3)

  private drawDebug(director?: BotDirector): void {
    const w = this.world;
    const g = this.gDebug;
    let ti = 0;
    const label = (x: number, y: number, s: string, color: string) => {
      let t = this.debugTexts[ti];
      if (!t) {
        t = this.scene.add.text(0, 0, '', { fontFamily: MONO, fontSize: '9px', color: '#ffffff', backgroundColor: '#000000aa' }).setDepth(41).setOrigin(0.5);
        this.debugTexts[ti] = t;
      }
      ti++;
      t.setText(s).setColor(color).setPosition(x, y).setVisible(true);
    };
    for (const d of w.map.doorways) {
      const st = w.doorwayStatus(d.id);
      const col = st.passable ? '#7ddc6f' : st.breachable ? '#ffb547' : '#ff5a4e';
      label(d.center.x, d.center.y - 12, `${st.state}${st.obstructed ? '+obs' : ''}`, col);
    }
    if (director) {
      for (const b of director.brains.values()) {
        const ch = w.charById(b.id);
        if (!ch || !ch.alive) continue;
        if (b.path) {
          g.lineStyle(1, teamColor(ch.team), 0.6);
          const pts = b.path.points;
          for (let i = Math.max(1, b.pathIdx); i < pts.length; i++) g.lineBetween(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
          b.path.obstacles.forEach((o, i) => {
            if (o) {
              g.lineStyle(2, 0xff00ff, 0.9);
              g.strokeRect(pts[i].x - 7, pts[i].y - 7, 14, 14);
            }
          });
        }
        label(ch.pos.x, ch.pos.y + 18, b.debugState, '#ffffff');
      }
    }
  }

  destroy(): void {
    for (const t of this.names) t.destroy();
    for (const f of this.floaters) f.text.destroy();
    for (const t of this.debugTexts) t.destroy();
  }
}
