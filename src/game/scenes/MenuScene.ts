import Phaser from 'phaser';
import { synth } from '../audio/Synth';
import { CONTROLS } from '../controls';
import { session } from '../session';
import { C, CSS, MONO, textStyle } from '../theme';
import { drawBackdrop, makeButton, type Button } from '../ui';
import type { Difficulty, Side } from '../../sim/types';

export class MenuScene extends Phaser.Scene {
  constructor() {
    super('Menu');
  }

  create(): void {
    this.game.canvas.style.cursor = 'default';
    drawBackdrop(this);
    synth.setVolume(session.settings.volume);
    this.add.text(80, 70, 'ASSAILWARD', textStyle(64, CSS.white, false, true)).setLetterSpacing(6);
    this.add.text(84, 146, '2D', textStyle(28, CSS.amber, true, true)).setLetterSpacing(4);
    this.add.text(130, 152, 'TOP-DOWN TACTICAL BREACH · OFFLINE 5v5 VS AI', textStyle(14, CSS.dim, false, true)).setLetterSpacing(2);

    // ---- match setup
    const px = 80;
    let y = 230;
    this.add.text(px, y, 'STARTING SIDE', textStyle(11, CSS.dim, false, true)).setLetterSpacing(2);
    y += 34;
    let side: Side = session.settings.startSide;
    let diff: Difficulty = session.settings.difficulty;
    const sideBtns: Record<Side, Button> = {
      attack: makeButton(this, px + 110, y, 'Attackers', () => pickSide('attack')),
      defend: makeButton(this, px + 340, y, 'Defenders', () => pickSide('defend')),
    };
    const pickSide = (s: Side) => {
      side = s;
      sideBtns.attack.setSelected(s === 'attack');
      sideBtns.defend.setSelected(s === 'defend');
    };
    pickSide(side);
    y += 56;
    this.add.text(px, y, 'AI DIFFICULTY', textStyle(11, CSS.dim, false, true)).setLetterSpacing(2);
    y += 34;
    const diffBtns: Record<Difficulty, Button> = {
      easy: makeButton(this, px + 70, y, 'Easy', () => pickDiff('easy'), { width: 140 }),
      normal: makeButton(this, px + 225, y, 'Normal', () => pickDiff('normal'), { width: 140 }),
      hard: makeButton(this, px + 380, y, 'Hard', () => pickDiff('hard'), { width: 140 }),
    };
    const pickDiff = (d: Difficulty) => {
      diff = d;
      for (const k of Object.keys(diffBtns) as Difficulty[]) diffBtns[k].setSelected(k === d);
    };
    pickDiff(diff);
    y += 80;
    makeButton(
      this,
      px + 225,
      y,
      'START MATCH',
      () => {
        session.newMatch(side, diff);
        this.scene.start('Loadout');
      },
      { width: 450, height: 56, size: 20, primary: true },
    );
    y += 64;
    this.add.text(px, y, 'First to 4 rounds · sides switch every 2 rounds · Mode: Disruptor (plant / disable)', textStyle(12, CSS.dim));
    this.add.text(px, y + 22, 'Map: Meridian Relay Station — objective: Server Room', textStyle(12, CSS.dim));

    // ---- controls panel
    const cx = 760;
    const g = this.add.graphics();
    g.fillStyle(C.panel, 0.9);
    g.fillRect(cx - 20, 210, 470, 470);
    g.lineStyle(1, C.edge, 1);
    g.strokeRect(cx - 20, 210, 470, 470);
    this.add.text(cx, 226, 'CONTROLS', textStyle(11, CSS.dim, false, true)).setLetterSpacing(2);
    CONTROLS.forEach(([k, v], i) => {
      this.add.text(cx, 254 + i * 22, k, { fontFamily: MONO, fontSize: '13px', color: CSS.amber });
      this.add.text(cx + 120, 254 + i * 22, v, textStyle(13, CSS.text));
    });
    this.add.text(80, 690, 'No doors: doorways are open passages. Defenders barricade them; anything can be broken.', textStyle(12, CSS.faint));
  }
}
