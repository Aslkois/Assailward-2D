import Phaser from 'phaser';
import { SIM_DT } from '../../config/constants';
import type { BotDirector } from '../../sim/ai/director';
import type { GameEvent } from '../../sim/events';
import { createRound } from '../../sim/setup';
import { eyeView, viewOf, type ViewSpec } from '../../sim/sight';
import type { CamView, Character } from '../../sim/entities';
import type { Intent } from '../../sim/types';
import type { World } from '../../sim/world';
import { AudioDirector } from '../audio/AudioDirector';
import { synth } from '../audio/Synth';
import { KnownMap } from '../knowledge';
import { PlayerInput } from '../PlayerInput';
import { MapRenderer } from '../render/MapRenderer';
import { WorldRenderer } from '../render/WorldRenderer';
import { session } from '../session';
import { C } from '../theme';

const ZOOM = 1.5;

export interface ViewState {
  view: ViewSpec;
  focus: { x: number; y: number };
  mode: 'body' | 'cam' | 'drone' | 'spectate' | 'deadcam' | 'none';
  label: string;
  camId: number;
  signalLost: boolean;
}

/** Runs one round: fixed-step simulation, AI, input, rendering, audio. */
export class GameScene extends Phaser.Scene {
  world!: World;
  director!: BotDirector;
  input2!: PlayerInput;
  known!: KnownMap;
  mapR!: MapRenderer;
  worldR!: WorldRenderer;
  audioDir!: AudioDirector;
  paused = false;
  debug = false;
  viewState!: ViewState;
  /** Events from this frame for the HUD (kill feed, banners, hit markers). */
  hudEvents: GameEvent[] = [];
  private acc = 0;
  private intents = new Map<number, Intent>();
  private spectateIdx = 0;
  private deadCam: CamView = null;
  private camFocus = { x: 0, y: 0 };
  private lastBeep = 0;
  private finishing = false;

  constructor() {
    super('Game');
  }

  create(): void {
    const match = session.match!;
    const side = match.sideOf(0);
    const { world, director } = createRound({
      match,
      playerLoadout: session.loadouts[side],
      playerSpawn: side === 'attack' ? session.spawn : undefined,
    });
    this.world = world;
    this.director = director;
    this.paused = false;
    this.finishing = false;
    this.acc = 0;
    this.spectateIdx = 0;
    this.deadCam = null;
    this.debug = session.debug;
    this.cameras.main.setBackgroundColor(C.bg);
    this.cameras.main.setZoom(ZOOM);
    this.cameras.main.setBounds(-48, -48, world.map.pxWidth + 96, world.map.pxHeight + 96);
    const p = world.player!;
    this.camFocus = { x: p.pos.x, y: p.pos.y };
    this.cameras.main.centerOn(p.pos.x, p.pos.y);
    this.known = new KnownMap(world, 0);
    this.mapR = new MapRenderer(this, world, this.known);
    this.worldR = new WorldRenderer(this, world, this.known, this.mapR);
    this.audioDir = new AudioDirector(world);
    this.audioDir.playerId = p.id;
    this.audioDir.team = p.team;
    this.input2 = new PlayerInput(this);
    const kb = this.input.keyboard!;
    kb.addCapture([Phaser.Input.Keyboard.KeyCodes.F3, Phaser.Input.Keyboard.KeyCodes.ESC]);
    kb.on('keydown-ESC', this.togglePause, this);
    kb.on('keydown-F3', this.toggleDebug, this);
    this.input.on('pointerdown', () => synth.unlock());
    kb.on('keydown', () => synth.unlock());
    this.events.once('shutdown', this.cleanup, this);
    this.viewState = this.computeView();
    this.scene.launch('Hud');
    this.scene.bringToTop('Hud');
    this.game.canvas.style.cursor = 'none';
  }

  private cleanup(): void {
    const kb = this.input.keyboard!;
    kb.off('keydown-ESC', this.togglePause, this);
    kb.off('keydown-F3', this.toggleDebug, this);
    kb.removeAllListeners('keydown');
    this.input2.destroy();
    this.worldR.destroy();
    this.mapR.destroy();
    this.game.canvas.style.cursor = 'default';
  }

  togglePause(): void {
    if (this.finishing) return;
    this.paused = !this.paused;
    this.input2.clearPending();
    this.game.canvas.style.cursor = this.paused ? 'default' : 'none';
  }

  toggleDebug(): void {
    this.debug = !this.debug;
    session.debug = this.debug;
  }

  quitToMenu(): void {
    session.match = null;
    this.scene.stop('Hud');
    this.scene.start('Menu');
  }

  // ------------------------------------------------------------------ frame

  override update(_time: number, delta: number): void {
    const w = this.world;
    this.hudEvents.length = 0;
    if (!this.paused && !this.finishing) {
      // raw (unsmoothed) frame time so the simulation stays real-time even on slow frames
      this.acc += Math.min(this.game.loop.rawDelta / 1000, 0.2);
      const player = w.player!;
      this.handleDeadControls(player);
      let first = true;
      while (this.acc >= SIM_DT) {
        this.acc -= SIM_DT;
        this.intents.clear();
        this.director.think(w, SIM_DT, this.intents);
        if (player.alive) this.intents.set(player.id, first ? this.input2.take(this.aimPoint()) : this.heldOnly());
        first = false;
        w.step(SIM_DT, this.intents);
        this.drainEvents();
        if (w.round.done) {
          this.finishRound();
          return;
        }
      }
      this.deviceBeeps();
    }
    this.viewState = this.computeView();
    this.updateCamera(delta);
    const vs = this.viewState;
    this.audioDir.listener = w.player!.alive ? w.player!.pos : vs.focus;
    this.worldR.render(
      { view: vs.view, team: 0, playerId: w.playerId },
      { debug: this.debug, director: this.director, showSpawn: w.round.phase === 'prep' },
    );
  }

  /** Intent for extra sim steps in the same frame: held inputs only, no repeated edges. */
  private heldOnly(): Intent {
    return this.input2.take(this.aimPoint());
  }

  private drainEvents(): void {
    const w = this.world;
    const vs = this.viewState;
    for (const e of w.events) {
      this.worldR.handle(e, { view: vs.view, team: 0, playerId: w.playerId });
      this.audioDir.play(e);
      this.hudEvents.push(e);
      if (e.type === 'explosion') {
        const d = Math.hypot(e.pos.x - this.camFocus.x, e.pos.y - this.camFocus.y);
        if (d < 360) this.cameras.main.shake(180, 0.006 * (1 - d / 360));
      }
    }
    w.events.length = 0;
  }

  private deviceBeeps(): void {
    const dev = this.world.round.device;
    if (!dev || this.world.round.phase !== 'planted') return;
    const interval = 0.2 + 0.9 * (dev.fuseLeft / this.world.round.rules.fuseTime);
    if (this.world.time - this.lastBeep > interval) {
      this.lastBeep = this.world.time;
      this.audioDir.play({ type: 'device', action: 'plant_tick', pos: dev.pos });
    }
  }

  aimPoint(): { x: number; y: number } {
    const ptr = this.input.activePointer;
    const wp = ptr.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
    return { x: wp.x, y: wp.y };
  }

  // ------------------------------------------------------------------ view & camera

  private handleDeadControls(player: Character): void {
    if (player.alive) {
      this.input2.clicks = { left: 0, right: 0 };
      return;
    }
    const slot = this.input2.consumeSlot();
    const team = this.world.chars.filter((c) => c.team === player.team);
    if (slot === 5) {
      if (this.deadCam) this.deadCam = null;
      else this.deadCam = this.firstFeed(player);
    }
    const { left, right } = this.input2.clicks;
    this.input2.clicks = { left: 0, right: 0 };
    this.input2.clearPending();
    if (this.deadCam) {
      if (right > 0) this.deadCam = this.nextFeed(player, this.deadCam);
      return;
    }
    const alive = team.filter((c) => c.alive);
    if (alive.length) {
      if (left > 0) this.spectateIdx = (this.spectateIdx + left) % alive.length;
      if (right > 0) this.spectateIdx = (this.spectateIdx - right + alive.length * 10) % alive.length;
    }
  }

  private feeds(player: Character): CamView[] {
    const w = this.world;
    if (player.side === 'attack') return w.drones.filter((d) => d.alive && d.team === player.team).map((d) => ({ kind: 'drone', id: d.id }) as CamView);
    return w.deployables.filter((d) => d.alive && d.team === player.team && (d.kind === 'camera' || d.kind === 'bp_camera')).map((d) => ({ kind: 'cam', id: d.id }) as CamView);
  }

  private firstFeed(player: Character): CamView {
    return this.feeds(player)[0] ?? null;
  }

  private nextFeed(player: Character, cur: CamView): CamView {
    const f = this.feeds(player);
    if (!f.length) return null;
    const i = f.findIndex((x) => x && cur && x.kind === cur.kind && x.id === cur.id);
    return f[(i + 1) % f.length];
  }

  private feedView(cv: NonNullable<CamView>): ViewState | null {
    const w = this.world;
    if (cv.kind === 'cam') {
      const cam = w.deployableById(cv.id);
      if (!cam || !cam.alive) return null;
      const disabled = w.isElectronicDisabled(cam);
      return {
        view: { origin: cam.pos, facing: cam.facing, fov: disabled ? 0.01 : (100 * Math.PI) / 180, range: disabled ? 1 : 720, near: 0, source: 'cam' },
        focus: cam.pos,
        mode: 'cam',
        label: cam.name ?? 'Camera',
        camId: cam.id,
        signalLost: disabled,
      };
    }
    const dr = w.droneById(cv.id);
    if (!dr || !dr.alive) return null;
    return {
      view: { origin: dr.pos, facing: dr.facing, fov: dr.jammed ? 0.01 : (120 * Math.PI) / 180, range: dr.jammed ? 1 : 460, near: dr.jammed ? 0 : 24, source: 'drone' },
      focus: dr.pos,
      mode: 'drone',
      label: `Drone (${w.charById(dr.ownerId)?.name ?? '?'})`,
      camId: dr.id,
      signalLost: dr.jammed,
    };
  }

  private computeView(): ViewState {
    const w = this.world;
    const p = w.player!;
    if (p.alive) {
      if (p.camView) {
        const fv = this.feedView(p.camView);
        if (fv) return fv;
      }
      const v = viewOf(w, p) ?? eyeView(p);
      return { view: v, focus: p.pos, mode: 'body', label: '', camId: -1, signalLost: false };
    }
    if (this.deadCam) {
      const fv = this.feedView(this.deadCam);
      if (fv) return { ...fv, mode: 'deadcam' };
      this.deadCam = null;
    }
    const alive = w.chars.filter((c) => c.team === p.team && c.alive);
    if (alive.length) {
      const t = alive[this.spectateIdx % alive.length];
      const v = viewOf(w, t) ?? eyeView(t);
      return { view: { ...v, origin: t.pos }, focus: t.pos, mode: 'spectate', label: t.name, camId: -1, signalLost: false };
    }
    const o = w.round.device?.pos ?? p.pos;
    return { view: { origin: o, facing: 0, fov: 0.01, range: 1, near: 0, source: 'sight' }, focus: o, mode: 'none', label: '', camId: -1, signalLost: false };
  }

  private updateCamera(delta: number): void {
    const cam = this.cameras.main;
    const vs = this.viewState;
    let tx = vs.focus.x;
    let ty = vs.focus.y;
    if (vs.mode === 'body') {
      const ptr = this.input.activePointer;
      const p = this.world.player!;
      const k = p.ads ? 0.55 : 0.3;
      const max = p.ads ? 300 : 170;
      let ox = ((ptr.x - cam.width / 2) / ZOOM) * k;
      let oy = ((ptr.y - cam.height / 2) / ZOOM) * k;
      const l = Math.hypot(ox, oy);
      if (l > max) {
        ox *= max / l;
        oy *= max / l;
      }
      tx += ox;
      ty += oy;
    }
    const f = 1 - Math.exp(-(vs.mode === 'body' ? 10 : 14) * (delta / 1000));
    this.camFocus.x += (tx - this.camFocus.x) * f;
    this.camFocus.y += (ty - this.camFocus.y) * f;
    cam.centerOn(this.camFocus.x, this.camFocus.y);
  }

  // ------------------------------------------------------------------ round end

  private finishRound(): void {
    if (this.finishing) return;
    this.finishing = true;
    const match = session.match!;
    match.addTallies(this.world.chars.map((c) => ({ name: c.name, team: c.team, ...c.stats })));
    match.record(this.world.round.result!);
    this.scene.stop('Hud');
    if (match.isOver()) this.scene.start('MatchEnd');
    else this.scene.start('Loadout');
  }
}
