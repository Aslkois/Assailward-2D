import Phaser from 'phaser';
import { ARMOR } from '../../config/constants';
import { findContextAction } from '../../sim/actions';
import { currentSpread } from '../../sim/combat';
import { currentEquip, currentWeapon, type Character } from '../../sim/entities';
import type { GameEvent } from '../../sim/events';
import { TEAM_NAMES } from '../../sim/setup';
import type { Team } from '../../sim/types';
import { synth } from '../audio/Synth';
import { session } from '../session';
import { C, CSS, FONT, MONO, fmtTime, teamColor, teamCss, textStyle } from '../theme';
import type { GameScene } from './GameScene';
import { CONTROLS } from '../controls';

const W = 1280;
const H = 720;

interface FeedLine { text: Phaser.GameObjects.Text; t: number }

export class HudScene extends Phaser.Scene {
  private game_!: GameScene;
  private g!: Phaser.GameObjects.Graphics;
  private overlay!: Phaser.GameObjects.Graphics;
  private t: Record<string, Phaser.GameObjects.Text> = {};
  private feed: FeedLine[] = [];
  private banner: { title: string; sub: string; color: string; until: number } | null = null;
  private hitMarker = { until: 0, color: 0xffffff, kill: false };
  private hurt = { until: 0, from: 0 };
  private msgUntil = 0;
  private lastMsgTime = -1;
  private pauseUi!: Phaser.GameObjects.Container;
  private controlsUi!: Phaser.GameObjects.Container;
  private board!: Phaser.GameObjects.Container;
  private boardRows: Phaser.GameObjects.Text[] = [];
  private volText!: Phaser.GameObjects.Text;

  constructor() {
    super('Hud');
  }

  create(): void {
    this.game_ = this.scene.get('Game') as GameScene;
    this.feed = [];
    this.banner = null;
    this.overlay = this.add.graphics().setDepth(0);
    this.g = this.add.graphics().setDepth(1);
    const mk = (key: string, x: number, y: number, style: Phaser.Types.GameObjects.Text.TextStyle, ox = 0, oy = 0) => {
      this.t[key] = this.add.text(x, y, '', style).setOrigin(ox, oy).setDepth(2);
      return this.t[key];
    };
    mk('timer', W / 2, 10, textStyle(26, CSS.white, true, true), 0.5, 0);
    mk('phase', W / 2, 42, textStyle(11, CSS.amber, true, true), 0.5, 0).setLetterSpacing(2);
    mk('teamL', W / 2 - 150, 14, textStyle(13, CSS.blue, false, true), 1, 0);
    mk('teamR', W / 2 + 150, 14, textStyle(13, CSS.red, false, true), 0, 0);
    mk('scoreL', W / 2 - 92, 8, textStyle(30, CSS.blue, true, true), 0.5, 0);
    mk('scoreR', W / 2 + 92, 8, textStyle(30, CSS.red, true, true), 0.5, 0);
    mk('objective', W / 2, 72, textStyle(12, CSS.text), 0.5, 0);
    mk('roster', 16, 14, { ...textStyle(12, CSS.text, true), lineSpacing: 5 });
    mk('hp', 28, H - 78, textStyle(38, CSS.white, true, true));
    mk('hpLabel', 30, H - 92, textStyle(10, CSS.dim, false, true)).setLetterSpacing(2);
    mk('status', 112, H - 88, { ...textStyle(11, CSS.dim, true), lineSpacing: 3 });
    mk('prompt', W / 2, H - 150, textStyle(15, CSS.white, false, true), 0.5, 0.5);
    mk('message', W / 2, H - 186, textStyle(13, CSS.amber, false, true), 0.5, 0.5);
    mk('camLabel', W / 2, 104, textStyle(14, CSS.white, true, true), 0.5, 0);
    mk('camHint', W / 2, H - 112, textStyle(12, CSS.text), 0.5, 0);
    mk('bannerTitle', W / 2, H / 2 - 110, textStyle(40, CSS.white, false, true), 0.5, 0.5).setStroke('#000000', 6);
    mk('bannerSub', W / 2, H / 2 - 70, textStyle(16, CSS.text), 0.5, 0.5).setStroke('#000000', 4);
    for (let i = 0; i < 5; i++) {
      mk(`slotN${i}`, 0, 0, textStyle(10, CSS.dim, true, true));
      mk(`slotA${i}`, 0, 0, textStyle(12, CSS.white, false, true));
      mk(`slotB${i}`, 0, 0, textStyle(11, CSS.text, true));
    }
    this.buildPauseMenu();
    this.buildScoreboard();
  }

  private set(key: string, s: string): Phaser.GameObjects.Text {
    const t = this.t[key];
    if (t.text !== s) t.setText(s);
    return t;
  }

  // ------------------------------------------------------------------ frame

  override update(): void {
    const gs = this.game_;
    if (!gs || !gs.world) return;
    const w = gs.world;
    const me = w.player!;
    const now = w.time;
    for (const e of gs.hudEvents) this.onEvent(e, me);
    this.g.clear();
    this.overlay.clear();
    this.drawTopBar(me);
    this.drawRoster(me);
    this.drawFeed(now);
    this.drawPlayerPanel(me);
    this.drawSlots(me);
    this.drawPrompt(me, now);
    this.drawCameraOverlay();
    this.drawCrosshair(me);
    this.drawEffects(me, now);
    this.drawBanner(now);
    this.updateScoreboard(gs.input2.scoreboardHeld && !gs.paused);
    this.pauseUi.setVisible(gs.paused);
    if (!gs.paused) this.controlsUi.setVisible(false);
  }

  private onEvent(e: GameEvent, me: Character): void {
    const w = this.game_.world;
    const now = w.time;
    switch (e.type) {
      case 'kill': {
        const k = w.charById(e.killerId);
        const v = w.charById(e.victimId)!;
        const kn = k ? k.name : '?';
        const line = k && k.id !== v.id ? `${kn}  [${e.cause}]  ${v.name}` : `${v.name}  [${e.cause}]`;
        const text = this.add.text(W - 16, 0, line, textStyle(12, k ? teamCss(k.team) : CSS.text, true, true)).setOrigin(1, 0).setDepth(2);
        if (k && k.team !== v.team) text.setColor(teamCss(k.team));
        this.feed.unshift({ text, t: now });
        if (this.feed.length > 6) this.feed.pop()!.text.destroy();
        if (e.victimId === me.id) this.banner = { title: 'YOU WERE ELIMINATED', sub: `by ${kn} — click to cycle teammates, 5 for cameras`, color: CSS.red, until: now + 3 };
        break;
      }
      case 'hit':
        if (e.sourceId === me.id && e.targetId !== me.id) {
          const c = Phaser.Display.Color.Interpolate.ColorWithColor(Phaser.Display.Color.ValueToColor(0xffffff), Phaser.Display.Color.ValueToColor(0xff8a1f), 100, Math.round((e.mult - 1) * 200));
          this.hitMarker = { until: now + (e.killed ? 0.35 : 0.15), color: Phaser.Display.Color.GetColor(c.r, c.g, c.b), kill: e.killed };
        }
        if (e.targetId === me.id) {
          const src = w.charById(e.sourceId);
          this.hurt = { until: now + 0.6, from: src && src.id !== me.id ? Math.atan2(src.pos.y - me.pos.y, src.pos.x - me.pos.x) : NaN };
        }
        break;
      case 'phase':
        if (e.phase === 'action') this.banner = { title: 'ACTION PHASE', sub: me.side === 'attack' ? 'Breach the building and plant the disruptor' : 'Hold the Server Room', color: CSS.amber, until: now + 2.2 };
        if (e.phase === 'planted') this.banner = { title: 'DISRUPTOR PLANTED', sub: me.side === 'attack' ? 'Defend the device until it detonates' : 'Find it and disable it (hold F)', color: CSS.amber, until: now + 2.5 };
        break;
      case 'round_end': {
        const won = e.winner === me.team;
        this.banner = { title: won ? 'ROUND WON' : 'ROUND LOST', sub: e.reason, color: won ? CSS.good : CSS.red, until: now + 99 };
        break;
      }
      default:
        break;
    }
  }

  // ------------------------------------------------------------------ panels

  private panel(x: number, y: number, w: number, h: number, alpha = 0.78, edge: number = C.edge): void {
    this.g.fillStyle(C.panel, alpha);
    this.g.fillRect(x, y, w, h);
    this.g.lineStyle(1, edge, 0.9);
    this.g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }

  private drawTopBar(me: Character): void {
    const gs = this.game_;
    const w = gs.world;
    const match = session.match!;
    const r = w.round;
    this.panel(W / 2 - 250, 4, 500, 62);
    const sides = match.sides();
    const label = (t: Team) => `${TEAM_NAMES[t]} · ${sides[t] === 'attack' ? 'ATTACK' : 'DEFEND'}`;
    this.set('teamL', label(0));
    this.set('teamR', label(1));
    this.set('scoreL', String(match.scores[0]));
    this.set('scoreR', String(match.scores[1]));
    const phaseName = r.phase === 'prep' ? 'PREPARATION' : r.phase === 'action' ? 'ACTION' : r.phase === 'planted' ? 'DISRUPTOR ARMED' : 'ROUND OVER';
    this.set('timer', fmtTime(r.timeLeft)).setColor(r.phase === 'planted' ? CSS.amber : r.timeLeft < 20 && r.phase === 'action' ? CSS.red : CSS.white);
    this.set('phase', `ROUND ${match.round}  ·  ${phaseName}`);
    for (const t of [0, 1] as Team[]) {
      const alive = w.aliveOf(t).length;
      const n = w.chars.filter((c) => c.team === t).length;
      for (let i = 0; i < n; i++) {
        const x = t === 0 ? W / 2 - 236 + i * 12 : W / 2 + 180 + i * 12;
        this.g.fillStyle(i < alive ? teamColor(t) : 0x333a44, 1);
        this.g.fillRect(x, 40, 9, 9);
      }
    }
    let obj: string;
    if (r.phase === 'prep') obj = me.side === 'attack' ? 'PREP: scout with drones (5). You cannot leave the spawn zone yet.' : 'PREP: barricade doorways & reinforce walls (F), deploy gear (3/4).';
    else if (r.phase === 'planted') obj = me.side === 'attack' ? 'Protect the disruptor until it detonates' : 'Disable the disruptor (hold F at the device)';
    else if (r.phase === 'action') obj = me.side === 'attack' ? 'Plant the disruptor in the SERVER ROOM (hold F in the marked zone)' : 'Defend the SERVER ROOM — eliminate attackers or run the clock';
    else obj = '';
    this.set('objective', obj);
  }

  private drawRoster(me: Character): void {
    const w = this.game_.world;
    const lines: string[] = [];
    for (const c of w.chars.filter((x) => x.team === me.team)) {
      const hp = c.alive ? `${String(Math.ceil(c.hp)).padStart(3)}` : ' ✖ ';
      const tag = c.isPlayer ? '▶' : ' ';
      lines.push(`${tag} ${c.name.padEnd(9)} ${hp}`);
    }
    this.set('roster', lines.join('\n'));
    this.panel(8, 8, 170, lines.length * 19 + 14, 0.6);
  }

  private drawFeed(now: number): void {
    this.feed = this.feed.filter((f) => {
      if (now - f.t > 7) {
        f.text.destroy();
        return false;
      }
      return true;
    });
    this.feed.forEach((f, i) => f.text.setY(12 + i * 20).setAlpha(Math.min(1, 7 - (now - f.t))));
  }

  private drawPlayerPanel(me: Character): void {
    const w = this.game_.world;
    this.panel(12, H - 100, 300, 88);
    this.set('hpLabel', 'HEALTH');
    this.set('hp', me.alive ? String(Math.ceil(me.hp)) : '0').setColor(me.hp > 50 ? CSS.white : me.hp > 25 ? CSS.amber : CSS.red);
    this.g.fillStyle(0x222a33, 1);
    this.g.fillRect(28, H - 30, 270, 6);
    this.g.fillStyle(me.hp > 50 ? C.good : me.hp > 25 ? C.amber : C.bad, 1);
    this.g.fillRect(28, H - 30, 270 * Math.max(0, me.hp / 100), 6);
    const flags: string[] = [];
    flags.push(`ARMOR ${ARMOR[me.armor].label.toUpperCase()}`);
    const stance = [me.sprinting ? 'SPRINT' : '', me.stance === 'crouch' ? 'CROUCH' : '', me.quiet ? 'QUIET' : ''].filter(Boolean).join(' · ');
    flags.push(stance || 'STANDING');
    if (me.side === 'defend') flags.push(`REINFORCEMENTS ${w.reinforcements[me.team]}`);
    else flags.push(`DRONES ${me.inv.drones}`);
    this.set('status', flags.join('\n'));
  }

  private drawSlots(me: Character): void {
    const inv = me.inv;
    const bw = 158;
    const bh = 54;
    const x0 = W - 12 - bw * 5 - 4 * 6;
    const y0 = H - 12 - bh;
    const entries: { n: string; a: string; b: string; active: boolean; progress?: number }[] = [];
    const wpn = (ws: typeof inv.primary) => (ws.reloading ? 'RELOADING' : `${ws.mag} / ${ws.reserve}`);
    entries.push({ n: '1 PRIMARY', a: inv.primary.def.name, b: wpn(inv.primary), active: inv.slot === 1 && !me.camView, progress: inv.primary.reloading ? 1 - inv.primary.reloadTimer / (inv.primary.mag > 0 ? inv.primary.def.reloadTime : inv.primary.def.emptyReloadTime) : undefined });
    entries.push({ n: '2 SECONDARY', a: inv.secondary.def.name, b: wpn(inv.secondary), active: inv.slot === 2 && !me.camView, progress: inv.secondary.reloading ? 1 - inv.secondary.reloadTimer / (inv.secondary.mag > 0 ? inv.secondary.def.reloadTime : inv.secondary.def.emptyReloadTime) : undefined });
    const cat = (list: typeof inv.utilities, idx: number) => {
      const cur = list[idx];
      const other = list[(idx + 1) % list.length];
      const ch = (e: typeof cur) => (e.charges < 0 ? '∞' : `×${e.charges}`);
      return { a: `${cur.def.name} ${ch(cur)}`, b: other ? `next: ${other.def.short} ${ch(other)}` : '' };
    };
    const u = cat(inv.utilities, inv.utilIndex);
    entries.push({ n: '3 UTILITY', a: u.a, b: u.b, active: inv.slot === 3 && !me.camView });
    const gd = cat(inv.gadgets, inv.gadgetIndex);
    entries.push({ n: '4 GADGET', a: gd.a, b: gd.b, active: inv.slot === 4 && !me.camView });
    const camsLeft = me.side === 'attack'
      ? `${this.game_.world.drones.filter((d) => d.alive && d.ownerId === me.id).length} out · ${me.inv.drones} left`
      : `${this.game_.world.deployables.filter((d) => d.alive && d.team === me.team && (d.kind === 'camera' || d.kind === 'bp_camera')).length} online`;
    entries.push({ n: me.side === 'attack' ? '5 DRONES' : '5 CAMERAS', a: me.camView ? 'ACTIVE' : 'Camera system', b: camsLeft, active: !!me.camView });
    entries.forEach((e, i) => {
      const x = x0 + i * (bw + 6);
      this.panel(x, y0, bw, bh, 0.82, e.active ? C.amber : C.edge);
      if (e.active) {
        this.g.fillStyle(C.amber, 1);
        this.g.fillRect(x, y0, bw, 2);
      }
      this.set(`slotN${i}`, e.n).setPosition(x + 8, y0 + 6).setColor(e.active ? CSS.amber : CSS.dim);
      this.set(`slotA${i}`, e.a).setPosition(x + 8, y0 + 19).setColor(e.active ? CSS.white : CSS.text);
      this.set(`slotB${i}`, e.b).setPosition(x + 8, y0 + 35);
      if (e.progress !== undefined) {
        this.g.fillStyle(C.amber, 0.8);
        this.g.fillRect(x + 1, y0 + bh - 4, (bw - 2) * Math.max(0, Math.min(1, e.progress)), 3);
      }
    });
  }

  private drawPrompt(me: Character, now: number): void {
    const w = this.game_.world;
    let prompt = '';
    if (me.alive && !me.camView) {
      if (me.action) {
        const k = me.action.elapsed / me.action.duration;
        prompt = me.action.label;
        const bw = 260;
        this.panel(W / 2 - bw / 2 - 2, H - 132, bw + 4, 12, 0.85);
        this.g.fillStyle(C.amber, 1);
        this.g.fillRect(W / 2 - bw / 2, H - 130, bw * Math.min(1, k), 8);
      } else {
        const ctx = findContextAction(w, me);
        if (ctx) prompt = `[F]  ${ctx.label}`;
      }
    }
    this.set('prompt', prompt).setStroke('#000000', 4);
    if (me.message && me.message.time !== this.lastMsgTime) {
      this.lastMsgTime = me.message.time;
      this.msgUntil = now + 2.2;
      this.set('message', me.message.text);
    }
    this.t.message.setVisible(now < this.msgUntil).setStroke('#000000', 4);
  }

  private drawCameraOverlay(): void {
    const vs = this.game_.viewState;
    const me = this.game_.world.player!;
    const camMode = vs.mode === 'cam' || vs.mode === 'drone' || vs.mode === 'deadcam';
    if (camMode) {
      const g = this.overlay;
      g.lineStyle(2, vs.mode === 'drone' ? 0x7ddc6f : 0xffffff, 0.5);
      const m = 26;
      for (const [x, y, dx, dy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]] as const) {
        g.lineBetween(x, y, x + dx * 40, y);
        g.lineBetween(x, y, x, y + dy * 40);
      }
      g.fillStyle(0x000000, 0.12);
      for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 1);
      if (vs.signalLost) {
        g.fillStyle(0x0a0d11, 0.6);
        g.fillRect(0, 0, W, H);
        for (let i = 0; i < 400; i++) {
          g.fillStyle(0xffffff, Math.random() * 0.25);
          g.fillRect(Math.random() * W, Math.random() * H, 3, 2);
        }
      }
      const kind = vs.mode === 'drone' ? 'DRONE FEED' : 'CAM';
      this.set('camLabel', `${kind} · ${vs.label}${vs.signalLost ? ' · SIGNAL LOST' : ''}`).setVisible(true);
      const hint = vs.mode === 'deadcam'
        ? 'Right click: next feed · 5: back to spectating'
        : vs.mode === 'drone'
          ? 'WASD drive · Mouse look · Left click: mark enemy · Right click: next drone · F: deploy another · 5: exit'
          : 'Mouse: pan camera · Left click: mark enemy · Right click: next camera · 5: exit';
      this.set('camHint', hint).setVisible(true);
    } else if (vs.mode === 'spectate' || vs.mode === 'none') {
      this.set('camLabel', vs.mode === 'spectate' ? `SPECTATING · ${vs.label}` : 'NO TEAMMATES ALIVE').setVisible(true);
      this.set('camHint', 'Left/right click: cycle teammates · 5: team cameras/drones').setVisible(true);
    } else {
      this.t.camLabel.setVisible(false);
      this.t.camHint.setVisible(false);
    }
    void me;
  }

  private drawCrosshair(me: Character): void {
    const gs = this.game_;
    if (gs.paused) return;
    const ptr = this.input.activePointer;
    const g = this.g;
    const x = ptr.x;
    const y = ptr.y;
    const now = gs.world.time;
    const vs = gs.viewState;
    if (!me.alive || vs.mode !== 'body') {
      g.lineStyle(1, 0xffffff, 0.8);
      g.strokeCircle(x, y, 6);
      g.fillStyle(0xffffff, 1);
      g.fillCircle(x, y, 1.2);
      return;
    }
    const ws = currentWeapon(me);
    const col = me.sprinting || me.swapTimer > 0 || me.sprintRecover > 0 ? 0x7f8e9e : 0xffffff;
    if (ws) {
      const wp = gs.aimPoint();
      const d = Math.hypot(wp.x - me.pos.x, wp.y - me.pos.y);
      const r = Math.max(4, Math.tan(currentSpread(me, ws)) * d * gs.cameras.main.zoom);
      g.lineStyle(1.5, col, 0.9);
      const gap = Math.min(r, 60);
      g.lineBetween(x - gap - 7, y, x - gap, y);
      g.lineBetween(x + gap, y, x + gap + 7, y);
      g.lineBetween(x, y - gap - 7, x, y - gap);
      g.lineBetween(x, y + gap, x, y + gap + 7);
      g.lineStyle(1, col, 0.25);
      g.strokeCircle(x, y, r);
      g.fillStyle(col, 1);
      g.fillCircle(x, y, 1.3);
    } else {
      const eq = currentEquip(me);
      g.lineStyle(1.5, C.amber, 0.9);
      g.strokeRect(x - 5, y - 5, 10, 10);
      if (eq && eq.def.use === 'throw') {
        g.lineStyle(1, C.amber, 0.3);
        g.strokeCircle(x, y, 14);
      }
    }
    if (now < this.hitMarker.until) {
      const s = this.hitMarker.kill ? 11 : 8;
      g.lineStyle(this.hitMarker.kill ? 3 : 2, this.hitMarker.color, 1);
      g.lineBetween(x - s, y - s, x - s / 2, y - s / 2);
      g.lineBetween(x + s, y - s, x + s / 2, y - s / 2);
      g.lineBetween(x - s, y + s, x - s / 2, y + s / 2);
      g.lineBetween(x + s, y + s, x + s / 2, y + s / 2);
    }
  }

  private drawEffects(me: Character, now: number): void {
    const g = this.overlay;
    if (me.alive && me.blindUntil > now) {
      const rem = me.blindUntil - now;
      const a = Math.min(1, rem / 1.2) * Math.min(1, me.blindStrength * 1.3);
      g.fillStyle(0xffffff, a);
      g.fillRect(0, 0, W, H);
    }
    if (now < this.hurt.until) {
      const a = (this.hurt.until - now) / 0.6;
      g.lineStyle(40, 0xff2a2a, 0.22 * a);
      g.strokeRect(0, 0, W, H);
      if (!Number.isNaN(this.hurt.from)) {
        const cx = W / 2 + Math.cos(this.hurt.from) * 120;
        const cy = H / 2 + Math.sin(this.hurt.from) * 120;
        g.fillStyle(0xff3a3a, 0.8 * a);
        g.fillCircle(cx, cy, 6);
      }
    }
    if (!me.alive) {
      g.fillStyle(0x000000, 0.15);
      g.fillRect(0, 0, W, H);
    }
  }

  private drawBanner(now: number): void {
    const b = this.banner;
    const show = !!b && now < b.until;
    this.t.bannerTitle.setVisible(show);
    this.t.bannerSub.setVisible(show);
    if (!b || !show) return;
    this.set('bannerTitle', b.title).setColor(b.color);
    this.set('bannerSub', b.sub);
  }

  // ------------------------------------------------------------------ scoreboard (Tab)

  private buildScoreboard(): void {
    this.board = this.add.container(0, 0).setDepth(10).setVisible(false);
    const bg = this.add.rectangle(W / 2, H / 2, 760, 420, C.panel, 0.95).setStrokeStyle(1, C.edgeHi);
    this.board.add(bg);
    this.board.add(this.add.text(W / 2, H / 2 - 190, 'SCOREBOARD', textStyle(16, CSS.white, false, true)).setOrigin(0.5).setLetterSpacing(3));
    this.board.add(this.add.text(W / 2 - 340, H / 2 - 160, 'OPERATOR              K    D    A   PLANT DISABLE  STATUS', textStyle(11, CSS.dim, true, true)));
    for (let i = 0; i < 12; i++) {
      const t = this.add.text(W / 2 - 340, H / 2 - 135 + i * 26, '', textStyle(13, CSS.text, true));
      this.boardRows.push(t);
      this.board.add(t);
    }
  }

  private updateScoreboard(show: boolean): void {
    this.board.setVisible(show);
    if (!show) return;
    const w = this.game_.world;
    const match = session.match!;
    let row = 0;
    for (const team of [0, 1] as Team[]) {
      const header = this.boardRows[row++];
      header.setText(`${TEAM_NAMES[team]} — ${match.sideOf(team) === 'attack' ? 'ATTACKERS' : 'DEFENDERS'} — ${match.scores[team]} rounds`).setColor(teamCss(team));
      for (const c of w.chars.filter((x) => x.team === team)) {
        const tally = match.tallies.get(c.name);
        const k = (tally?.kills ?? 0) + c.stats.kills;
        const d = (tally?.deaths ?? 0) + c.stats.deaths;
        const a = (tally?.assists ?? 0) + c.stats.assists;
        const p = (tally?.plants ?? 0) + c.stats.plants;
        const ds = (tally?.disables ?? 0) + c.stats.disables;
        const status = c.alive ? (c.team === w.player!.team || this.game_.worldR.visibleEnemies.has(c.id) ? 'ALIVE' : 'ALIVE') : 'DEAD';
        const line = `${(c.isPlayer ? '▶ ' : '  ') + c.name.padEnd(18)}${String(k).padStart(3)}  ${String(d).padStart(3)}  ${String(a).padStart(3)}  ${String(p).padStart(5)}  ${String(ds).padStart(6)}   ${status}`;
        this.boardRows[row++].setText(line).setColor(c.alive ? CSS.text : CSS.faint);
      }
    }
    for (; row < this.boardRows.length; row++) this.boardRows[row].setText('');
  }

  // ------------------------------------------------------------------ pause menu (Esc)

  private button(x: number, y: number, label: string, onClick: () => void, width = 260): Phaser.GameObjects.Container {
    const c = this.add.container(x, y);
    const bg = this.add.rectangle(0, 0, width, 40, C.panelHi, 1).setStrokeStyle(1, C.edgeHi);
    const t = this.add.text(0, 0, label, textStyle(15, CSS.white, false, true)).setOrigin(0.5);
    c.add([bg, t]);
    bg.setInteractive({ useHandCursor: true })
      .on('pointerover', () => bg.setStrokeStyle(1, C.amber))
      .on('pointerout', () => bg.setStrokeStyle(1, C.edgeHi))
      .on('pointerdown', () => {
        synth.unlock();
        synth.click(0.4, 0, 1.2);
        onClick();
      });
    return c;
  }

  private buildPauseMenu(): void {
    const gs = () => this.game_;
    this.pauseUi = this.add.container(0, 0).setDepth(20).setVisible(false);
    this.pauseUi.add(this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.6));
    this.pauseUi.add(this.add.rectangle(W / 2, H / 2, 340, 380, C.panel, 0.97).setStrokeStyle(1, C.edgeHi));
    this.pauseUi.add(this.add.text(W / 2, H / 2 - 160, 'PAUSED', textStyle(24, CSS.white, false, true)).setOrigin(0.5).setLetterSpacing(4));
    this.pauseUi.add(this.button(W / 2, H / 2 - 105, 'Resume', () => gs().togglePause()));
    this.pauseUi.add(this.button(W / 2, H / 2 - 57, 'Controls', () => this.controlsUi.setVisible(!this.controlsUi.visible)));
    this.pauseUi.add(this.button(W / 2, H / 2 - 9, 'Toggle fullscreen', () => this.toggleFullscreen()));
    this.volText = this.add.text(W / 2, H / 2 + 39, '', textStyle(14, CSS.text, true)).setOrigin(0.5);
    this.pauseUi.add(this.button(W / 2 - 100, H / 2 + 39, '–', () => this.changeVolume(-0.1), 50));
    this.pauseUi.add(this.button(W / 2 + 100, H / 2 + 39, '+', () => this.changeVolume(0.1), 50));
    this.pauseUi.add(this.volText);
    this.pauseUi.add(this.button(W / 2, H / 2 + 87, `Debug overlay (F3)`, () => gs().toggleDebug()));
    this.pauseUi.add(this.button(W / 2, H / 2 + 140, 'Forfeit — main menu', () => gs().quitToMenu()));
    this.changeVolume(0);

    this.controlsUi = this.add.container(0, 0).setDepth(21).setVisible(false);
    const panelW = 520;
    this.controlsUi.add(this.add.rectangle(W / 2 + 430 - panelW / 2 + 20, H / 2, panelW - 80, 520, C.panel, 0.98).setStrokeStyle(1, C.edgeHi));
    const lines = CONTROLS.map(([k, v]) => `${k.padEnd(13)} ${v}`).join('\n');
    this.controlsUi.add(this.add.text(W / 2 + 210, H / 2 - 240, lines, { fontFamily: MONO, fontSize: '12px', color: CSS.text, lineSpacing: 5 }));
    void FONT;
  }

  private changeVolume(d: number): void {
    session.settings.volume = Math.round(Math.max(0, Math.min(1, session.settings.volume + d)) * 10) / 10;
    synth.setVolume(session.settings.volume);
    session.save();
    this.volText.setText(`Volume ${Math.round(session.settings.volume * 100)}%`);
  }

  private toggleFullscreen(): void {
    if (this.scale.isFullscreen) {
      this.scale.stopFullscreen();
      return;
    }
    this.scale.startFullscreen();
    // In fullscreen, Chromium lets pages capture shortcuts such as Ctrl+W.
    const kb = (navigator as unknown as { keyboard?: { lock?: (codes?: string[]) => Promise<void> } }).keyboard;
    kb?.lock?.(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyR', 'KeyC', 'KeyV', 'Tab', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5']).catch(() => undefined);
  }
}
