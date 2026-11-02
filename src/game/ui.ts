import Phaser from 'phaser';
import { synth } from './audio/Synth';
import { C, CSS, textStyle } from './theme';

export interface ButtonOpts {
  width?: number;
  height?: number;
  size?: number;
  primary?: boolean;
}

export interface Button {
  container: Phaser.GameObjects.Container;
  bg: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
  setSelected(on: boolean): void;
  setEnabled(on: boolean): void;
}

/** Interactive button with hover/selected/disabled states. */
export function makeButton(scene: Phaser.Scene, x: number, y: number, text: string, onClick: () => void, opts: ButtonOpts = {}): Button {
  const w = opts.width ?? 220;
  const h = opts.height ?? 40;
  const c = scene.add.container(x, y);
  const bg = scene.add.rectangle(0, 0, w, h, opts.primary ? 0x2a2110 : C.panelHi, 1).setStrokeStyle(1, opts.primary ? C.amber : C.edgeHi);
  const label = scene.add.text(0, 0, text, textStyle(opts.size ?? 15, opts.primary ? CSS.amber : CSS.white, false, true)).setOrigin(0.5);
  c.add([bg, label]);
  let selected = false;
  let enabled = true;
  const base = () => bg.setStrokeStyle(selected ? 2 : 1, selected || opts.primary ? C.amber : C.edgeHi).setFillStyle(selected ? 0x2a2110 : opts.primary ? 0x2a2110 : C.panelHi, 1);
  bg.setInteractive({ useHandCursor: true })
    .on('pointerover', () => enabled && bg.setStrokeStyle(2, C.amber))
    .on('pointerout', base)
    .on('pointerdown', () => {
      if (!enabled) return;
      synth.unlock();
      synth.click(0.35, 0, 1.2);
      onClick();
    });
  return {
    container: c,
    bg,
    label,
    setSelected(on: boolean) {
      selected = on;
      base();
      label.setColor(on ? CSS.amber : opts.primary ? CSS.amber : CSS.white);
    },
    setEnabled(on: boolean) {
      enabled = on;
      c.setAlpha(on ? 1 : 0.4);
    },
  };
}

/** Subtle tactical grid backdrop for menu screens. */
export function drawBackdrop(scene: Phaser.Scene): void {
  const g = scene.add.graphics();
  g.fillStyle(C.bg, 1);
  g.fillRect(0, 0, 1280, 720);
  g.lineStyle(1, 0x141a21, 1);
  for (let x = 0; x <= 1280; x += 32) g.lineBetween(x, 0, x, 720);
  for (let y = 0; y <= 720; y += 32) g.lineBetween(0, y, 1280, y);
  g.lineStyle(1, 0x1c242e, 1);
  for (let x = 0; x <= 1280; x += 160) g.lineBetween(x, 0, x, 720);
  for (let y = 0; y <= 720; y += 160) g.lineBetween(0, y, 1280, y);
  g.fillStyle(C.amber, 1);
  g.fillRect(0, 0, 1280, 3);
}
