import { describe, expect, it } from 'vitest';
import { REINFORCE_TIME } from '../src/config/constants';
import { findPlacement } from '../src/sim/equipment';
import { currentEquip, selectSlot } from '../src/sim/entities';
import { MAT } from '../src/sim/map';
import { lineOfSight } from '../src/sim/sight';
import { byTeam, loadoutWith, makeWorld, place, run, toAction } from './helpers';

describe('soft walls, reinforcement and breaching', () => {
  it('soft-breach charge opens a passable hole in a soft wall', () => {
    const w = makeWorld({
      roster: [
        { name: 'A', team: 0, isPlayer: true, loadout: loadoutWith('attack', { utilities: ['soft_breach', 'flash'] }) },
        { name: 'D', team: 1, isPlayer: false, loadout: loadoutWith('defend', {}) },
      ],
    });
    const atk = byTeam(w, 0);
    toAction(w);
    place(atk, 33, 31); // Storage, facing the Storage|Server soft wall at x=35
    atk.facing = 0;
    selectSlot(atk.inv, 3);
    atk.swapTimer = 0;
    expect(currentEquip(atk)?.def.id).toBe('soft_breach');
    const aim = () => ({ aim: { x: atk.pos.x + 100, y: atk.pos.y } });
    expect(findPlacement(w, atk, 'soft_breach').ok).toBe(true);
    run(w, 0.05, { [atk.id]: () => ({ ...aim(), fire: true, firePressed: true }) });
    run(w, 1.2, { [atk.id]: () => ({ ...aim(), fire: true }) });
    expect(w.deployables.some((d) => d.kind === 'soft_breach' && d.alive)).toBe(true);
    expect(atk.inv.utilities[0].charges).toBe(1);
    expect(atk.inv.utilities[1].charges).toBe(2); // separate charge pool for the flashbang
    // step back, then detonate with right click
    place(atk, 29, 31);
    run(w, 0.05, { [atk.id]: () => ({ ...aim(), secondaryPressed: true }) });
    expect(w.map.matAt(35, 31)).toBe(MAT.EMPTY);
    expect(w.map.matAt(35, 30)).toBe(MAT.EMPTY);
    expect(lineOfSight(w, w.map.cellCenter(33, 31), w.map.cellCenter(38, 31))).toBe(true);
  });

  it('hard-breach charges only go on reinforced walls and destroy them', () => {
    const w = makeWorld({
      roster: [
        { name: 'A', team: 0, isPlayer: true, loadout: loadoutWith('attack', { utilities: ['hard_breach', 'smoke'] }) },
        { name: 'D', team: 1, isPlayer: false, loadout: loadoutWith('defend', {}) },
      ],
    });
    const atk = byTeam(w, 0);
    toAction(w);
    place(atk, 33, 31);
    atk.facing = 0; // soft wall
    expect(findPlacement(w, atk, 'hard_breach').ok).toBe(false);
    place(atk, 50, 43); // Archive, below the pre-reinforced Server Room wall at y=42
    atk.facing = -Math.PI / 2;
    expect(w.map.matAt(50, 42)).toBe(MAT.REINF);
    expect(findPlacement(w, atk, 'hard_breach').ok).toBe(true);
    selectSlot(atk.inv, 3);
    atk.swapTimer = 0;
    const aim = () => ({ aim: { x: atk.pos.x, y: atk.pos.y - 100 } });
    run(w, 0.05, { [atk.id]: () => ({ ...aim(), fire: true, firePressed: true }) });
    run(w, 3.2, { [atk.id]: () => ({ ...aim(), fire: true }) });
    place(atk, 50, 50);
    run(w, 0.05, { [atk.id]: () => ({ ...aim(), secondaryPressed: true }) });
    expect(w.map.matAt(50, 42)).toBe(MAT.EMPTY);
    expect(w.map.matAt(49, 42)).toBe(MAT.EMPTY);
    expect(w.map.matAt(51, 42)).toBe(MAT.EMPTY);
  });

  it('defenders reinforce soft walls with F, consuming a team reinforcement', () => {
    const w = makeWorld();
    const def = byTeam(w, 1);
    place(def, 36, 31);
    const before = w.reinforcements[def.team];
    run(w, REINFORCE_TIME + 0.2, { [def.id]: () => ({ interact: true }) });
    expect(w.map.matAt(35, 31)).toBe(MAT.REINF);
    expect(w.reinforcements[def.team]).toBe(before - 1);
  });

  it('bullets chip away at soft wall cells until a hole appears', () => {
    const w = makeWorld();
    const before = w.map.hp[w.map.idx(35, 31)];
    w.bulletDamageCell(35, 31, 30, 1, 0);
    expect(w.map.hp[w.map.idx(35, 31)]).toBeLessThan(before);
    for (let i = 0; i < 20; i++) w.bulletDamageCell(35, 31, 30, 1, 0);
    expect(w.map.matAt(35, 31)).toBe(MAT.EMPTY);
    expect(w.map.matAt(35, 32)).toBe(MAT.SOFT); // localized: neighbours intact
  });

  it('concrete walls are indestructible by explosives', () => {
    const w = makeWorld();
    w.damageCell(35, 27, 99999, 0);
    expect(w.map.matAt(35, 27)).toBe(MAT.WALL);
  });
});

describe('inventory and slots', () => {
  it('pressing 3/4 repeatedly cycles the items in that category', () => {
    const w = makeWorld();
    const atk = byTeam(w, 0);
    const inv = atk.inv;
    expect(inv.slot).toBe(1);
    selectSlot(inv, 3);
    expect(currentEquip(atk)?.def.id).toBe(atk.loadout.utilities[0]);
    selectSlot(inv, 3);
    expect(currentEquip(atk)?.def.id).toBe(atk.loadout.utilities[1]);
    selectSlot(inv, 3);
    expect(currentEquip(atk)?.def.id).toBe(atk.loadout.utilities[0]);
    selectSlot(inv, 4);
    expect(currentEquip(atk)?.def.id).toBe(atk.loadout.gadgets[0]);
    selectSlot(inv, 4);
    expect(currentEquip(atk)?.def.id).toBe(atk.loadout.gadgets[1]);
    selectSlot(inv, 2);
    expect(inv.slot).toBe(2);
    selectSlot(inv, 4);
    expect(currentEquip(atk)?.def.id).toBe(atk.loadout.gadgets[1]); // remembers category position
  });

  it('weapons fire, spend ammo, and reload from reserve', () => {
    const w = makeWorld();
    const atk = byTeam(w, 0);
    toAction(w);
    place(atk, 49, 6);
    const ws = atk.inv.primary;
    const mag = ws.mag;
    run(w, 0.5, { [atk.id]: () => ({ fire: true, aim: { x: atk.pos.x, y: atk.pos.y - 200 } }) });
    expect(ws.mag).toBeLessThan(mag);
    const fired = mag - ws.mag;
    const reserve = ws.reserve;
    run(w, 0.05, { [atk.id]: () => ({ reload: true }) });
    expect(ws.reloading).toBe(true);
    run(w, ws.def.reloadTime + 0.1);
    expect(ws.mag).toBe(ws.def.magSize);
    expect(ws.reserve).toBe(reserve - fired);
  });

  it('attackers deploy drones through slot 5 and drive them while the body stays put', () => {
    const w = makeWorld();
    const atk = byTeam(w, 0);
    place(atk, 41, 3); // west of the spawn cover strip
    atk.spawnZone = null;
    atk.facing = Math.PI / 2;
    const body = { ...atk.pos };
    run(w, 0.05, { [atk.id]: () => ({ selectSlot: 5, aim: { x: atk.pos.x, y: atk.pos.y + 100 } }) });
    expect(atk.camView?.kind).toBe('drone');
    expect(atk.inv.drones).toBe(1);
    const dr = w.droneById(atk.camView!.id)!;
    const start = { ...dr.pos };
    run(w, 1.5, { [atk.id]: () => ({ move: { x: 0, y: 1 }, aim: { x: dr.pos.x, y: dr.pos.y + 100 } }) });
    expect(dr.pos.y).toBeGreaterThan(start.y + 100); // drone can leave the spawn zone in prep
    expect(Math.hypot(atk.pos.x - body.x, atk.pos.y - body.y)).toBeLessThan(1);
    run(w, 0.05, { [atk.id]: () => ({ selectSlot: 5 }) });
    expect(atk.camView).toBeNull();
  });

  it('drones slip under barricades but bodies do not', () => {
    const w = makeWorld();
    const atk = byTeam(w, 0);
    const doorId = w.map.doorOf[w.map.idx(48, 12)];
    const d = w.map.doorways[doorId];
    d.barricade = { segments: new Array(6).fill(60), maxSegHp: 60, complete: true, progress: 1, builderId: -1, team: 1, version: 0 };
    toAction(w);
    place(atk, 49, 9);
    atk.facing = Math.PI / 2;
    run(w, 0.05, { [atk.id]: () => ({ selectSlot: 5, aim: { x: atk.pos.x, y: atk.pos.y + 100 } }) });
    const dr = w.droneById(atk.camView!.id)!;
    run(w, 2, { [atk.id]: () => ({ move: { x: 0, y: 1 }, aim: { x: dr.pos.x, y: dr.pos.y + 100 } }) });
    expect(dr.pos.y).toBeGreaterThan(d.center.y + 20);
  });

  it('defenders view the camera network through slot 5 and cycle feeds with right click', () => {
    const w = makeWorld();
    const def = byTeam(w, 1);
    run(w, 0.05, { [def.id]: () => ({ selectSlot: 5 }) });
    expect(def.camView?.kind).toBe('cam');
    const first = def.camView!.id;
    run(w, 0.05, { [def.id]: () => ({ secondaryPressed: true }) });
    expect(def.camView!.id).not.toBe(first);
  });
});
