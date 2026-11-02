import Phaser from 'phaser';
import { CELL } from '../../config/constants';
import { FLOOR, MAT } from '../../sim/map';
import type { World } from '../../sim/world';
import type { KnownMap } from '../knowledge';
import { textStyle } from '../theme';

// Static environment drawn into a world-sized RenderTexture from the viewer's KnownMap. Only
// changed cells (and their neighbours, for edge shading) are redrawn.

const FLOOR_COL: Record<number, number> = {
  [FLOOR.EXTERIOR]: 0x1d2420,
  [FLOOR.INTERIOR]: 0x2f343c,
  [FLOOR.OBJECTIVE]: 0x3a3527,
  [FLOOR.RUBBLE]: 0x34322d,
  [FLOOR.DOORWAY]: 0x2f343c,
};

function hash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export class MapRenderer {
  readonly rt: Phaser.GameObjects.RenderTexture;
  private g: Phaser.GameObjects.Graphics;

  constructor(private scene: Phaser.Scene, private world: World, private known: KnownMap) {
    const m = world.map;
    this.rt = scene.add.renderTexture(0, 0, m.pxWidth, m.pxHeight).setOrigin(0, 0).setDepth(0);
    this.g = scene.make.graphics({}, false);
    const all: number[] = [];
    for (let i = 0; i < m.w * m.h; i++) all.push(i);
    this.drawCells(all, false);
    for (const r of m.rooms) {
      if (!r.interior) continue;
      scene.add
        .text(r.center.x, r.rect.y0 * CELL + 10, r.name.toUpperCase(), textStyle(11, '#ffffff', false, true))
        .setOrigin(0.5, 0)
        .setAlpha(r.objective ? 0.32 : 0.14)
        .setDepth(1)
        .setLetterSpacing?.(2);
    }
  }

  private solidKnown(cx: number, cy: number): boolean {
    const m = this.world.map;
    if (!m.inBounds(cx, cy)) return true;
    return this.known.mat[m.idx(cx, cy)] !== MAT.EMPTY;
  }

  /** Redraws dirty cells; returns true if anything was drawn. */
  flush(): boolean {
    if (!this.known.dirty.size) return false;
    this.drawCells(this.known.dirty, true);
    this.known.dirty.clear();
    return true;
  }

  private drawCells(cells: Iterable<number>, withNeighbours: boolean): void {
    const m = this.world.map;
    const set = new Set<number>();
    for (const i of cells) {
      set.add(i);
      if (withNeighbours) {
        const cx = i % m.w;
        const cy = (i / m.w) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (m.inBounds(cx + dx, cy + dy)) set.add(m.idx(cx + dx, cy + dy));
      }
    }
    const g = this.g;
    g.clear();
    for (const i of set) this.drawTile(g, i % m.w, (i / m.w) | 0);
    this.rt.draw(g, 0, 0);
    g.clear();
  }

  private drawTile(g: Phaser.GameObjects.Graphics, cx: number, cy: number): void {
    const m = this.world.map;
    const i = m.idx(cx, cy);
    const mat = this.known.mat[i];
    const floor = this.known.floor[i];
    const x = cx * CELL;
    const y = cy * CELL;
    const h = hash(cx, cy);
    if (mat === MAT.EMPTY) {
      g.fillStyle(FLOOR_COL[floor] ?? 0x2f343c, 1);
      g.fillRect(x, y, CELL, CELL);
      if (floor === FLOOR.EXTERIOR) {
        g.fillStyle(0x26302a, 1);
        if (h > 0.55) g.fillRect(x + ((h * 97) % 12), y + ((h * 53) % 12), 2, 2);
        if (h < 0.2) g.fillRect(x + 6, y + 9, 3, 1);
      } else {
        g.lineStyle(1, 0x282c33, 1);
        g.strokeRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1);
        if (floor === FLOOR.OBJECTIVE) {
          g.lineStyle(1, 0x5a4a22, 0.8);
          g.lineBetween(x, y + CELL, x + CELL, y);
        }
        if (floor === FLOOR.DOORWAY) {
          g.fillStyle(0x3d434c, 1);
          g.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
        }
        if (floor === FLOOR.RUBBLE) {
          g.fillStyle(0x7a7060, 1);
          for (let k = 0; k < 5; k++) {
            const hx = hash(cx * 7 + k, cy * 3 - k);
            const hy = hash(cx * 5 - k, cy * 11 + k);
            g.fillRect(x + hx * 13, y + hy * 13, 2 + (k % 2), 2);
          }
        }
      }
      return;
    }
    const exposed = (dx: number, dy: number) => !this.solidKnown(cx + dx, cy + dy);
    switch (mat) {
      case MAT.WALL: {
        g.fillStyle(0x15181d, 1);
        g.fillRect(x, y, CELL, CELL);
        g.fillStyle(0x262b33, 1);
        if (exposed(0, -1)) g.fillRect(x, y, CELL, 3);
        if (exposed(-1, 0)) g.fillRect(x, y, 2, CELL);
        g.fillStyle(0x0d0f12, 1);
        if (exposed(0, 1)) g.fillRect(x, y + CELL - 2, CELL, 2);
        if (exposed(1, 0)) g.fillRect(x + CELL - 2, y, 2, CELL);
        break;
      }
      case MAT.SOFT: {
        const hp = this.world.map.hp[i];
        const frac = Math.max(0.25, Math.min(1, hp / 100));
        g.fillStyle(Phaser.Display.Color.GetColor(140 * frac + 30, 124 * frac + 26, 96 * frac + 22), 1);
        g.fillRect(x, y, CELL, CELL);
        g.lineStyle(1, 0x6b5d45, 1);
        g.lineBetween(x + 4, y + 1, x + 4, y + CELL - 1);
        g.lineBetween(x + 11, y + 1, x + 11, y + CELL - 1);
        g.lineStyle(1, 0x5a4e3a, 1);
        g.strokeRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1);
        break;
      }
      case MAT.REINF: {
        g.fillStyle(0x4f5d6b, 1);
        g.fillRect(x, y, CELL, CELL);
        g.lineStyle(2, 0x6f8193, 1);
        g.lineBetween(x + 2, y + 2, x + CELL - 2, y + CELL - 2);
        g.lineBetween(x + CELL - 2, y + 2, x + 2, y + CELL - 2);
        g.fillStyle(0x9fb0c0, 1);
        g.fillRect(x + 2, y + 2, 2, 2);
        g.fillRect(x + CELL - 4, y + CELL - 4, 2, 2);
        g.lineStyle(1, 0x2d3640, 1);
        g.strokeRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1);
        break;
      }
      case MAT.PROP: {
        g.fillStyle(0x3d342b, 1);
        g.fillRect(x, y, CELL, CELL);
        g.fillStyle(0x4b4035, 1);
        g.fillRect(x + 2, y + 2, CELL - 4, CELL - 4);
        g.lineStyle(1, 0x231e19, 1);
        if (exposed(0, -1)) g.lineBetween(x, y + 0.5, x + CELL, y + 0.5);
        if (exposed(0, 1)) g.lineBetween(x, y + CELL - 0.5, x + CELL, y + CELL - 0.5);
        if (exposed(-1, 0)) g.lineBetween(x + 0.5, y, x + 0.5, y + CELL);
        if (exposed(1, 0)) g.lineBetween(x + CELL - 0.5, y, x + CELL - 0.5, y + CELL);
        break;
      }
    }
  }

  /** Repaints soft cells whose HP changed (visible damage shading). */
  repaint(cells: number[]): void {
    for (const i of cells) this.known.dirty.add(i);
  }

  destroy(): void {
    this.rt.destroy();
    this.g.destroy();
    void this.scene;
  }
}
