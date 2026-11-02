import type { Team } from '../sim/types';

// Visual language: a dark tactical-ops console. Cool slate surfaces, a warm amber accent for the
// objective/interactions, and two clearly separated team colours.

export const FONT = '"Segoe UI", "Helvetica Neue", Roboto, Arial, sans-serif';
export const MONO = 'Consolas, "SFMono-Regular", Menlo, "Liberation Mono", monospace';

export const C = {
  bg: 0x0a0d11,
  panel: 0x10151c,
  panelHi: 0x18202a,
  edge: 0x2b3642,
  edgeHi: 0x41505f,
  amber: 0xffb547,
  blue: 0x4cc9f0,
  red: 0xff5a4e,
  good: 0x7ddc6f,
  bad: 0xff5a4e,
  white: 0xffffff,
  fog: 0x04070b,
};

export const CSS = {
  text: '#d7dee6',
  dim: '#7f8e9e',
  faint: '#4a5765',
  amber: '#ffb547',
  blue: '#4cc9f0',
  red: '#ff5a4e',
  good: '#7ddc6f',
  white: '#ffffff',
};

export const teamColor = (t: Team): number => (t === 0 ? C.blue : C.red);
export const teamCss = (t: Team): string => (t === 0 ? CSS.blue : CSS.red);

export function textStyle(size: number, color = CSS.text, mono = false, bold = false): Phaser.Types.GameObjects.Text.TextStyle {
  return { fontFamily: mono ? MONO : FONT, fontSize: `${size}px`, color, fontStyle: bold ? 'bold' : 'normal' };
}

export function fmtTime(s: number): string {
  const t = Math.max(0, Math.ceil(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}
