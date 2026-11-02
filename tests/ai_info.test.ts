import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BotBrain, DIFFICULTY } from '../src/sim/ai/brain';
import { findPath, obstacleBlocking } from '../src/sim/ai/nav';
import { createBarricade } from '../src/sim/barricade';
import { KnownMap } from '../src/game/knowledge';
import { Rng } from '../src/sim/rng';
import { canSeeCircle, eyeView, lineOfSight } from '../src/sim/sight';
import { byTeam, doorAtCell, makeWorld, place, run, toAction } from './helpers';

const BODY = 9;

function barricade(w: ReturnType<typeof makeWorld>, cx: number, cy: number) {
  const d = doorAtCell(w, cx, cy);
  d.barricade = createBarricade(d, w.defendTeam, -1);
  d.barricade.complete = true;
  return d;
}

describe('AI navigation understands doorway states', () => {
  // Lobby (west) -> Main Hall (east) through the doorway at x=35,y=16..18
  const from = { x: 30 * 16, y: 17 * 16 };
  const to = { x: 40 * 16, y: 17 * 16 };

  it('walks straight through an open doorway', () => {
    const w = makeWorld();
    const p = findPath(w, from, to, { barricades: 'avoid', softWalls: false, hardWalls: false, radius: BODY })!;
    expect(p).not.toBeNull();
    expect(p.obstacles.every((o) => o === null)).toBe(true);
    expect(p.points.length).toBeLessThan(16);
  });

  it('defenders route around a barricaded doorway; attackers plan to breach it', () => {
    const w = makeWorld();
    const d = barricade(w, 35, 17);
    expect(w.doorwayStatus(d.id).state).toBe('barricaded');
    expect(w.doorwayStatus(d.id).breachable).toBe(true);
    const def = findPath(w, from, to, { barricades: 'avoid', softWalls: false, hardWalls: false, radius: BODY })!;
    expect(def).not.toBeNull();
    expect(def.points.length).toBeGreaterThan(20); // detour
    expect(def.points.some((pt) => w.map.doorOf[w.map.idx(Math.floor(pt.x / 16), Math.floor(pt.y / 16))] === d.id)).toBe(false);
    const atk = findPath(w, from, to, { barricades: 'breach', softWalls: false, hardWalls: false, radius: BODY })!;
    const obs = atk.obstacles.filter(Boolean);
    expect(obs.length).toBeGreaterThan(0);
    expect(obs[0]).toEqual({ kind: 'barricade', doorwayId: d.id });
    expect(obstacleBlocking(w, obs[0]!)).toBe(true);
  });

  it('treats a breached (partially destroyed) barricade as open', () => {
    const w = makeWorld();
    const d = barricade(w, 35, 17);
    w.damageBarricade(d.id, new Map([[2, 999], [3, 999], [4, 999]]), 0, d.center);
    expect(w.doorwayStatus(d.id).state).toBe('breached');
    const p = findPath(w, from, to, { barricades: 'avoid', softWalls: false, hardWalls: false, radius: BODY })!;
    expect(p.points.length).toBeLessThan(16);
  });

  it('reports shields placed in a doorway as obstructed and routes around them', () => {
    const w = makeWorld();
    const d = doorAtCell(w, 35, 17);
    const sh = w.makeDeployable('shield', 1, -1, d.center, 0, 500);
    sh.rect = { x0: d.center.x - 4, x1: d.center.x + 4, y0: d.rect.y0, y1: d.rect.y1 };
    w.deployables.push(sh);
    w.invalidateSolids();
    const st = w.doorwayStatus(d.id);
    expect(st.obstructed).toBe(true);
    expect(st.passable).toBe(false);
    const p = findPath(w, from, to, { barricades: 'breach', softWalls: false, hardWalls: false, radius: BODY })!;
    expect(p.points.length).toBeGreaterThan(20);
  });

  it('drones ignore barricades (they slip underneath)', () => {
    const w = makeWorld();
    barricade(w, 35, 17);
    const p = findPath(w, from, to, { barricades: 'ignore', softWalls: false, hardWalls: false, radius: 5 })!;
    expect(p.points.length).toBeLessThan(16);
  });

  it('only routes through walls when carrying a matching breaching tool', () => {
    const w = makeWorld();
    const storage = { x: 30 * 16, y: 31 * 16 };
    const server = { x: 40 * 16, y: 31 * 16 };
    const noTool = findPath(w, storage, server, { barricades: 'breach', softWalls: false, hardWalls: false, radius: BODY })!;
    expect(noTool.obstacles.some((o) => o?.kind === 'soft')).toBe(false);
    const tool = findPath(w, storage, server, { barricades: 'breach', softWalls: true, hardWalls: false, radius: BODY, softCost: 5 })!;
    expect(tool.obstacles.some((o) => o?.kind === 'soft')).toBe(true);
  });
});

describe('information rules: walls, smoke and perception', () => {
  it('walls block sight; open doorways and destroyed walls do not', () => {
    const w = makeWorld();
    const a = { x: 30 * 16, y: 31 * 16 };
    const b = { x: 40 * 16, y: 31 * 16 };
    expect(lineOfSight(w, a, b)).toBe(false); // soft wall between Storage and Server Room
    w.map.destroyCell(35, 31);
    expect(lineOfSight(w, a, b)).toBe(true);
  });

  it('smoke blocks line of sight once the ray goes deep enough into it', () => {
    const w = makeWorld();
    const a = { x: 20 * 16, y: 8.5 * 16 };
    const b = { x: 50 * 16, y: 8.5 * 16 };
    expect(lineOfSight(w, a, b)).toBe(true);
    w.smokes.push({ id: 1, pos: { x: 35 * 16, y: 8.5 * 16 }, radius: 60, maxRadius: 60, born: 0, life: 10 });
    expect(lineOfSight(w, a, b)).toBe(false);
  });

  it('enemies behind walls are not visible even though the camera is overhead', () => {
    const w = makeWorld();
    const atk = byTeam(w, 0);
    const def = byTeam(w, 1);
    place(atk, 30, 31); // Storage
    place(def, 40, 31); // Server Room, behind the soft wall
    atk.facing = 0;
    expect(canSeeCircle(w, eyeView(atk), def.pos, def.radius)).toBe(false);
    place(def, 30, 35); // same room, in front
    atk.facing = Math.PI / 2;
    expect(canSeeCircle(w, eyeView(atk), def.pos, def.radius)).toBe(true);
    atk.facing = -Math.PI / 2; // looking away: outside the view cone
    expect(canSeeCircle(w, eyeView(atk), def.pos, def.radius)).toBe(false);
  });

  it('bots only learn enemy positions through sight, sound or team call-outs', () => {
    const w = makeWorld();
    const atk = byTeam(w, 0);
    const def = byTeam(w, 1);
    const brain = new BotBrain(def.id, DIFFICULTY.normal, new Rng(1));
    toAction(w);
    place(atk, 49, 45); // Archive, behind the reinforced wall
    place(def, 49, 34); // Server Room
    run(w, 0.2);
    brain.think(w, 1 / 60);
    expect(brain.contacts.has(atk.id)).toBe(false); // no omniscient tracking
    // a gunshot is heard (through walls, with error) and becomes an approximate contact
    w.sounds = [{ pos: { ...atk.pos }, radius: 900, kind: 'gunshot', sourceId: atk.id, team: atk.team, time: w.time }];
    brain.think(w, 1 / 60);
    const c = brain.contacts.get(atk.id);
    expect(c).toBeDefined();
    expect(c!.visible).toBe(false);
    expect(Math.hypot(c!.pos.x - atk.pos.x, c!.pos.y - atk.pos.y)).toBeLessThan(60);
  });

  it("the player's map knowledge only updates enemy changes once they are seen", () => {
    const w = makeWorld({ sides: ['attack', 'defend'] });
    const known = new KnownMap(w, 0); // viewer = attackers
    const d = doorAtCell(w, 44, 27); // Server Room north doorway
    d.barricade = createBarricade(d, 1, -1);
    d.barricade.complete = true;
    w.map.destroyCell(70, 12);
    expect(known.barricades[d.id]).toBeNull(); // not seen yet
    expect(known.mat[w.map.idx(70, 12)]).not.toBe(0);
    for (const i of d.cells) known.see(i);
    known.see(w.map.idx(70, 12));
    expect(known.barricades[d.id]?.complete).toBe(true);
    expect(known.mat[w.map.idx(70, 12)]).toBe(0);
  });
});

describe('no conventional doors', () => {
  it('the source never models doors (only doorways and barricades)', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = path.join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.ts$/.test(f)) files.push(p);
      }
    };
    walk(path.resolve(path.dirname(new URL(import.meta.url).pathname), '../src'));
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      // "door" is only allowed as part of "doorway"; no hinges, door locks or open/close door logic
      if (/\bdoors?\b(?!way)/i.test(src.replace(/no hinged doors?|not a door|no doors?|never a hinged door|conventional doors?|There are no doors|No doors/gi, ''))) offenders.push(f);
      if (/\bhinge|openDoor|closeDoor|doorLock|lockDoor|unlockDoor/i.test(src.replace(/no hinged|never a hinged|no hinges/gi, ''))) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
});
