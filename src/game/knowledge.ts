import type { GameEvent } from '../sim/events';
import type { Team } from '../sim/types';
import type { World } from '../sim/world';

// What the viewing player knows about the environment. The layout is known up front; changes made
// by the enemy (barricades going up, walls blown open) only become known once they are seen.
// Changes made by the viewer's own team are known immediately (team communication).

export interface BarricadeSnap {
  segments: number[];
  maxSegHp: number;
  complete: boolean;
  progress: number;
  team: Team;
  version: number;
}

export class KnownMap {
  readonly mat: Uint8Array;
  readonly floor: Uint8Array;
  readonly barricades: (BarricadeSnap | null)[];
  readonly dirty = new Set<number>();
  private seenDoors = new Set<number>();

  constructor(private world: World, public viewerTeam: Team) {
    this.mat = world.map.mat.slice();
    this.floor = world.map.floor.slice();
    this.barricades = world.map.doorways.map(() => null);
    for (const d of world.map.doorways) this.snapDoor(d.id);
  }

  beginFrame(): void {
    this.seenDoors.clear();
  }

  /** Called for each cell a sight ray reaches. */
  see = (i: number): void => {
    const m = this.world.map;
    if (this.mat[i] !== m.mat[i] || this.floor[i] !== m.floor[i]) {
      this.mat[i] = m.mat[i];
      this.floor[i] = m.floor[i];
      this.dirty.add(i);
    }
    const di = m.doorOf[i];
    if (di >= 0 && !this.seenDoors.has(di)) {
      this.seenDoors.add(di);
      this.snapDoor(di);
    }
  };

  private snapDoor(id: number): void {
    const b = this.world.map.doorways[id].barricade;
    const cur = this.barricades[id];
    if (!b) {
      this.barricades[id] = null;
      return;
    }
    if (cur && cur.version === b.version && cur.complete === b.complete && cur.segments.length === b.segments.length) {
      // cheap path: copy hp values (versions can lag for in-place hp edits)
      for (let k = 0; k < b.segments.length; k++) cur.segments[k] = b.segments[k];
      cur.progress = b.progress;
      return;
    }
    this.barricades[id] = { segments: [...b.segments], maxSegHp: b.maxSegHp, complete: b.complete, progress: b.progress, team: b.team, version: b.version };
  }

  /** Own-team changes are communicated immediately. */
  onEvent(e: GameEvent): void {
    if (e.type === 'wall' && e.team === this.viewerTeam) {
      const m = this.world.map;
      for (const i of e.cells) {
        if (this.mat[i] !== m.mat[i] || this.floor[i] !== m.floor[i]) {
          this.mat[i] = m.mat[i];
          this.floor[i] = m.floor[i];
          this.dirty.add(i);
        }
      }
    } else if (e.type === 'barricade') {
      const b = this.world.map.doorways[e.doorwayId].barricade;
      if (e.team === this.viewerTeam || (b && b.team === this.viewerTeam) || e.action === 'removed' || e.action === 'build_cancel') {
        if (e.team === this.viewerTeam) this.snapDoor(e.doorwayId);
      }
    }
  }

  /** Keeps barricades owned by the viewer's team in sync every frame. */
  syncOwn(): void {
    const ds = this.world.map.doorways;
    for (let i = 0; i < ds.length; i++) {
      const b = ds[i].barricade;
      const k = this.barricades[i];
      if ((b && b.team === this.viewerTeam) || (k && k.team === this.viewerTeam && !b)) this.snapDoor(i);
    }
  }
}
