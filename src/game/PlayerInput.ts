import Phaser from 'phaser';
import { emptyIntent, type Intent } from '../sim/types';
import type { Vec2 } from '../sim/math';

// Keyboard/mouse -> Intent. Edge-triggered actions are queued until a simulation step consumes
// them, so presses are never lost when the display runs faster than the 60 Hz simulation.
//
// Ctrl (crouch) and Alt (quiet walk) are toggles: holding Ctrl while pressing W would trigger the
// browser's close-tab shortcut, and Alt+letter chords open browser menus. C also toggles crouch.

type KeyName = 'W' | 'A' | 'S' | 'D' | 'SHIFT' | 'CTRL' | 'ALT' | 'F' | 'R' | 'V' | 'C' | 'TAB' | 'ONE' | 'TWO' | 'THREE' | 'FOUR' | 'FIVE';

export class PlayerInput {
  readonly keys: Record<KeyName, Phaser.Input.Keyboard.Key>;
  crouch = false;
  quiet = false;
  private pend = { firePressed: false, secondaryPressed: false, reload: false, interactPressed: false, melee: false, selectSlot: null as number | null };
  /** Raw mouse clicks for UI modes (spectating etc). */
  clicks = { left: 0, right: 0 };
  private destroyed = false;

  constructor(private scene: Phaser.Scene) {
    const kb = scene.input.keyboard!;
    const K = Phaser.Input.Keyboard.KeyCodes;
    this.keys = kb.addKeys(
      { W: K.W, A: K.A, S: K.S, D: K.D, SHIFT: K.SHIFT, CTRL: K.CTRL, ALT: K.ALT, F: K.F, R: K.R, V: K.V, C: K.C, TAB: K.TAB, ONE: K.ONE, TWO: K.TWO, THREE: K.THREE, FOUR: K.FOUR, FIVE: K.FIVE },
      true,
    ) as Record<KeyName, Phaser.Input.Keyboard.Key>;
    kb.addCapture([K.TAB, K.ALT, K.CTRL, K.SPACE]);
    const on = (key: KeyName, fn: () => void) => this.keys[key].on('down', fn);
    on('CTRL', () => (this.crouch = !this.crouch));
    on('C', () => (this.crouch = !this.crouch));
    on('ALT', () => (this.quiet = !this.quiet));
    on('SHIFT', () => (this.crouch = false));
    on('R', () => (this.pend.reload = true));
    on('F', () => (this.pend.interactPressed = true));
    on('V', () => (this.pend.melee = true));
    on('ONE', () => (this.pend.selectSlot = 1));
    on('TWO', () => (this.pend.selectSlot = 2));
    on('THREE', () => (this.pend.selectSlot = 3));
    on('FOUR', () => (this.pend.selectSlot = 4));
    on('FIVE', () => (this.pend.selectSlot = 5));
    scene.input.mouse?.disableContextMenu();
    scene.input.on('pointerdown', this.onPointerDown, this);
  }

  private onPointerDown(p: Phaser.Input.Pointer): void {
    if (this.destroyed) return;
    if (p.rightButtonDown()) {
      this.pend.secondaryPressed = true;
      this.clicks.right++;
    }
    if (p.leftButtonDown()) {
      this.pend.firePressed = true;
      this.clicks.left++;
    }
  }

  get scoreboardHeld(): boolean {
    return this.keys.TAB.isDown;
  }

  /** Builds the intent for the next simulation step and consumes queued edges. */
  take(aim: Vec2): Intent {
    const k = this.keys;
    const it = emptyIntent(aim);
    let mx = (k.D.isDown ? 1 : 0) - (k.A.isDown ? 1 : 0);
    let my = (k.S.isDown ? 1 : 0) - (k.W.isDown ? 1 : 0);
    const l = Math.hypot(mx, my);
    if (l > 0) {
      mx /= l;
      my /= l;
    }
    it.move = { x: mx, y: my };
    const ptr = this.scene.input.activePointer;
    it.fire = ptr.leftButtonDown();
    it.secondary = ptr.rightButtonDown();
    it.sprint = k.SHIFT.isDown;
    it.crouch = this.crouch && !it.sprint;
    it.quiet = this.quiet;
    it.interact = k.F.isDown;
    it.firePressed = this.pend.firePressed;
    it.secondaryPressed = this.pend.secondaryPressed;
    it.reload = this.pend.reload;
    it.interactPressed = this.pend.interactPressed;
    it.melee = this.pend.melee;
    it.selectSlot = this.pend.selectSlot;
    this.pend = { firePressed: false, secondaryPressed: false, reload: false, interactPressed: false, melee: false, selectSlot: null };
    return it;
  }

  /** Drop queued edges (e.g. while paused) so they do not fire on resume. */
  clearPending(): void {
    this.pend = { firePressed: false, secondaryPressed: false, reload: false, interactPressed: false, melee: false, selectSlot: null };
    this.clicks = { left: 0, right: 0 };
  }

  peekSlot(): number | null {
    return this.pend.selectSlot;
  }

  consumeSlot(): number | null {
    const s = this.pend.selectSlot;
    this.pend.selectSlot = null;
    return s;
  }

  destroy(): void {
    this.destroyed = true;
    this.scene.input.off('pointerdown', this.onPointerDown, this);
  }
}
