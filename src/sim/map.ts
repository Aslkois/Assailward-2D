import { CELL, PANEL_MAX_CELLS, SOFT_WALL_HP } from '../config/constants';
import type { AABB, Vec2 } from './math';
import type { Team } from './types';

// Cell materials. Plain objects instead of const enums (safe with isolatedModules / esbuild).
export const MAT = { EMPTY: 0, WALL: 1, SOFT: 2, REINF: 3, PROP: 4 } as const;
export type Mat = (typeof MAT)[keyof typeof MAT];
export const FLOOR = { EXTERIOR: 0, INTERIOR: 1, OBJECTIVE: 2, RUBBLE: 3, DOORWAY: 4 } as const;

export interface CellRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface MapDef {
  name: string;
  rows: string[];
  rooms: { name: string; rect: CellRect; objective?: boolean; interior: boolean }[];
  cameras: { name: string; cx: number; cy: number; angle: number }[];
  attackerSpawns: { name: string; zone: CellRect; points: [number, number][] }[];
  defenderSpawns: [number, number][];
  anchors: { cx: number; cy: number; facing: number }[];
  roamPoints: [number, number][];
  approaches: { name: string; spawn: string; waypoints: [number, number][]; hardBreach?: boolean }[];
}

/**
 * A wooden barricade spanning a doorway. Localized: the doorway width is split into sections,
 * each with its own HP. Only intact sections are collision/vision/bullet geometry.
 */
export interface Barricade {
  segments: number[]; // HP per section (0 = destroyed)
  maxSegHp: number;
  complete: boolean;
  progress: number; // 0..1 while being built
  builderId: number;
  team: Team;
  version: number; // bumps on every change (render/knowledge sync)
}

/** Permanent architectural opening. Never a hinged door: it is open until barricaded. */
export interface Doorway {
  id: number;
  cells: number[]; // cell indices
  orient: 'h' | 'v'; // 'h' = opening runs along x inside a horizontal wall (passage is north/south)
  rect: AABB; // px bounds of the opening
  center: Vec2;
  width: number; // px across the opening
  normal: Vec2; // passage direction (unit)
  exterior: boolean;
  rooms: [number, number]; // room ids on either side (-1 = none)
  barricade: Barricade | null;
}

export interface Panel {
  id: number;
  cells: number[];
  orient: 'h' | 'v';
  center: Vec2;
  normal: Vec2;
  reinforced: boolean;
  preReinforced: boolean;
}

export interface Room {
  id: number;
  name: string;
  rect: CellRect;
  center: Vec2;
  objective: boolean;
  interior: boolean;
}

export class GameMap {
  readonly w: number;
  readonly h: number;
  readonly mat: Uint8Array;
  readonly floor: Uint8Array;
  readonly hp: Float32Array;
  readonly panelOf: Int16Array;
  readonly doorOf: Int16Array;
  readonly roomOf: Int16Array;
  readonly doorways: Doorway[] = [];
  readonly panels: Panel[] = [];
  readonly rooms: Room[] = [];
  readonly objectiveCells: number[] = [];
  objectiveCenter: Vec2 = { x: 0, y: 0 };
  objectiveRect: AABB = { x0: 0, y0: 0, x1: 0, y1: 0 };
  /** Incremented whenever a cell's material changes (renderers & nav caches watch this). */
  version = 0;

  constructor(readonly def: MapDef) {
    this.h = def.rows.length;
    this.w = def.rows[0].length;
    const n = this.w * this.h;
    this.mat = new Uint8Array(n);
    this.floor = new Uint8Array(n);
    this.hp = new Float32Array(n);
    this.panelOf = new Int16Array(n).fill(-1);
    this.doorOf = new Int16Array(n).fill(-1);
    this.roomOf = new Int16Array(n).fill(-1);
    this.parse();
  }

  get pxWidth(): number {
    return this.w * CELL;
  }

  get pxHeight(): number {
    return this.h * CELL;
  }

  idx(cx: number, cy: number): number {
    return cy * this.w + cx;
  }

  inBounds(cx: number, cy: number): boolean {
    return cx >= 0 && cy >= 0 && cx < this.w && cy < this.h;
  }

  matAt(cx: number, cy: number): number {
    if (!this.inBounds(cx, cy)) return MAT.WALL;
    return this.mat[cy * this.w + cx];
  }

  isSolid(cx: number, cy: number): boolean {
    return this.matAt(cx, cy) !== MAT.EMPTY;
  }

  cellCenter(cx: number, cy: number): Vec2 {
    return { x: (cx + 0.5) * CELL, y: (cy + 0.5) * CELL };
  }

  cellAabb(cx: number, cy: number): AABB {
    return { x0: cx * CELL, y0: cy * CELL, x1: (cx + 1) * CELL, y1: (cy + 1) * CELL };
  }

  toCell(v: number): number {
    return Math.floor(v / CELL);
  }

  roomAt(p: Vec2): Room | null {
    const cx = this.toCell(p.x);
    const cy = this.toCell(p.y);
    if (!this.inBounds(cx, cy)) return null;
    const r = this.roomOf[this.idx(cx, cy)];
    return r >= 0 ? this.rooms[r] : null;
  }

  isObjectiveAt(p: Vec2): boolean {
    const cx = this.toCell(p.x);
    const cy = this.toCell(p.y);
    return this.inBounds(cx, cy) && this.floor[this.idx(cx, cy)] === FLOOR.OBJECTIVE;
  }

  isInterior(p: Vec2): boolean {
    const r = this.roomAt(p);
    return !!r && r.interior;
  }

  /** Turns a destructible cell into rubble floor. Returns true if something changed. */
  destroyCell(cx: number, cy: number): boolean {
    if (!this.inBounds(cx, cy)) return false;
    const i = this.idx(cx, cy);
    const m = this.mat[i];
    if (m !== MAT.SOFT && m !== MAT.REINF) return false;
    this.mat[i] = MAT.EMPTY;
    this.floor[i] = FLOOR.RUBBLE;
    this.hp[i] = 0;
    this.version++;
    return true;
  }

  /** Converts every cell of an intact soft panel into reinforced wall. */
  reinforcePanel(panel: Panel): boolean {
    if (panel.reinforced) return false;
    for (const i of panel.cells) if (this.mat[i] !== MAT.SOFT) return false;
    for (const i of panel.cells) {
      this.mat[i] = MAT.REINF;
      this.hp[i] = Infinity;
    }
    panel.reinforced = true;
    this.version++;
    return true;
  }

  panelIntact(panel: Panel): boolean {
    return panel.cells.every((i) => this.mat[i] === MAT.SOFT || this.mat[i] === MAT.REINF);
  }

  private parse(): void {
    const { rows } = this.def;
    for (let y = 0; y < this.h; y++) {
      const row = rows[y];
      if (row.length !== this.w) throw new Error(`Map row ${y} has length ${row.length}, expected ${this.w}`);
      for (let x = 0; x < this.w; x++) {
        const i = this.idx(x, y);
        const ch = row[x];
        switch (ch) {
          case '#': this.mat[i] = MAT.WALL; this.floor[i] = FLOOR.INTERIOR; break;
          case '=': this.mat[i] = MAT.SOFT; this.hp[i] = SOFT_WALL_HP; this.floor[i] = FLOOR.INTERIOR; break;
          case '%': this.mat[i] = MAT.REINF; this.hp[i] = Infinity; this.floor[i] = FLOOR.INTERIOR; break;
          case '+': this.mat[i] = MAT.PROP; this.floor[i] = FLOOR.INTERIOR; break;
          case 'D': this.mat[i] = MAT.EMPTY; this.floor[i] = FLOOR.DOORWAY; break;
          case 'o': this.mat[i] = MAT.EMPTY; this.floor[i] = FLOOR.OBJECTIVE; this.objectiveCells.push(i); break;
          case '.': this.mat[i] = MAT.EMPTY; this.floor[i] = FLOOR.INTERIOR; break;
          case ',': this.mat[i] = MAT.EMPTY; this.floor[i] = FLOOR.EXTERIOR; break;
          default: throw new Error(`Unknown map char '${ch}' at ${x},${y}`);
        }
      }
    }
    // Rooms
    this.def.rooms.forEach((r, id) => {
      const room: Room = {
        id, name: r.name, rect: r.rect, objective: !!r.objective, interior: r.interior,
        center: { x: ((r.rect.x0 + r.rect.x1 + 1) / 2) * CELL, y: ((r.rect.y0 + r.rect.y1 + 1) / 2) * CELL },
      };
      this.rooms.push(room);
      for (let y = r.rect.y0; y <= r.rect.y1; y++) for (let x = r.rect.x0; x <= r.rect.x1; x++) this.roomOf[this.idx(x, y)] = id;
    });
    // Objective
    if (this.objectiveCells.length) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const i of this.objectiveCells) {
        const cx = i % this.w;
        const cy = Math.floor(i / this.w);
        x0 = Math.min(x0, cx); y0 = Math.min(y0, cy); x1 = Math.max(x1, cx); y1 = Math.max(y1, cy);
      }
      this.objectiveRect = { x0: x0 * CELL, y0: y0 * CELL, x1: (x1 + 1) * CELL, y1: (y1 + 1) * CELL };
      this.objectiveCenter = { x: ((x0 + x1 + 1) / 2) * CELL, y: ((y0 + y1 + 1) / 2) * CELL };
    }
    this.findDoorways();
    this.findPanels();
  }

  private components(pred: (i: number) => boolean, mark: Int8Array): number[][] {
    const out: number[][] = [];
    for (let i = 0; i < this.w * this.h; i++) {
      if (mark[i] || !pred(i)) continue;
      const comp: number[] = [];
      const stack = [i];
      mark[i] = 1;
      while (stack.length) {
        const c = stack.pop()!;
        comp.push(c);
        const cx = c % this.w;
        const cy = Math.floor(c / this.w);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (!this.inBounds(nx, ny)) continue;
          const ni = this.idx(nx, ny);
          if (!mark[ni] && pred(ni)) {
            mark[ni] = 1;
            stack.push(ni);
          }
        }
      }
      out.push(comp);
    }
    return out;
  }

  private findDoorways(): void {
    const mark = new Int8Array(this.w * this.h);
    const comps = this.components((i) => this.floor[i] === FLOOR.DOORWAY, mark);
    for (const cells of comps) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const i of cells) {
        const cx = i % this.w;
        const cy = Math.floor(i / this.w);
        x0 = Math.min(x0, cx); y0 = Math.min(y0, cy); x1 = Math.max(x1, cx); y1 = Math.max(y1, cy);
      }
      const orient: 'h' | 'v' = x1 - x0 >= y1 - y0 ? 'h' : 'v';
      const rect = { x0: x0 * CELL, y0: y0 * CELL, x1: (x1 + 1) * CELL, y1: (y1 + 1) * CELL };
      const center = { x: (rect.x0 + rect.x1) / 2, y: (rect.y0 + rect.y1) / 2 };
      const normal = orient === 'h' ? { x: 0, y: 1 } : { x: 1, y: 0 };
      const id = this.doorways.length;
      const sideA = this.roomAt({ x: center.x - normal.x * 24, y: center.y - normal.y * 24 });
      const sideB = this.roomAt({ x: center.x + normal.x * 24, y: center.y + normal.y * 24 });
      const d: Doorway = {
        id, cells, orient, rect, center, normal,
        width: orient === 'h' ? rect.x1 - rect.x0 : rect.y1 - rect.y0,
        exterior: !(sideA?.interior && sideB?.interior),
        rooms: [sideA ? sideA.id : -1, sideB ? sideB.id : -1],
        barricade: null,
      };
      this.doorways.push(d);
      for (const i of cells) this.doorOf[i] = id;
    }
  }

  private findPanels(): void {
    for (const matType of [MAT.SOFT, MAT.REINF]) {
      const mark = new Int8Array(this.w * this.h);
      const comps = this.components((i) => this.mat[i] === matType, mark);
      for (const comp of comps) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const i of comp) {
          const cx = i % this.w;
          const cy = Math.floor(i / this.w);
          x0 = Math.min(x0, cx); y0 = Math.min(y0, cy); x1 = Math.max(x1, cx); y1 = Math.max(y1, cy);
        }
        const orient: 'h' | 'v' = x1 - x0 >= y1 - y0 ? 'h' : 'v';
        const sorted = [...comp].sort((a, b) => (orient === 'h' ? (a % this.w) - (b % this.w) : a - b));
        const chunks = Math.ceil(sorted.length / PANEL_MAX_CELLS);
        const per = Math.ceil(sorted.length / chunks);
        for (let c = 0; c < chunks; c++) {
          const cells = sorted.slice(c * per, (c + 1) * per);
          if (!cells.length) continue;
          let sx = 0, sy = 0;
          for (const i of cells) {
            sx += (i % this.w) + 0.5;
            sy += Math.floor(i / this.w) + 0.5;
          }
          const id = this.panels.length;
          this.panels.push({
            id, cells, orient,
            center: { x: (sx / cells.length) * CELL, y: (sy / cells.length) * CELL },
            normal: orient === 'h' ? { x: 0, y: 1 } : { x: 1, y: 0 },
            reinforced: matType === MAT.REINF,
            preReinforced: matType === MAT.REINF,
          });
          for (const i of cells) this.panelOf[i] = id;
        }
      }
    }
  }
}
