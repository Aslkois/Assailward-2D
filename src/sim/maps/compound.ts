import type { MapDef } from '../map';
import { COMPOUND_ROWS } from './compoundLayout';

// "Meridian Relay Station" — an original multi-room facility. The Server Room (objective) sits in
// the middle with approaches from every side: doorways (N/E/S), soft walls (W, N, E) and a
// pre-reinforced south wall that only a hard-breach charge can open.

const PI = Math.PI;

export const COMPOUND: MapDef = {
  name: 'Meridian Relay Station',
  rows: COMPOUND_ROWS,
  rooms: [
    { name: 'Lobby', rect: { x0: 15, y0: 13, x1: 34, y1: 26 }, interior: true },
    { name: 'Main Hall', rect: { x0: 36, y0: 13, x1: 62, y1: 26 }, interior: true },
    { name: 'Offices', rect: { x0: 64, y0: 13, x1: 85, y1: 26 }, interior: true },
    { name: 'Storage', rect: { x0: 15, y0: 28, x1: 34, y1: 41 }, interior: true },
    { name: 'Server Room', rect: { x0: 36, y0: 28, x1: 62, y1: 41 }, interior: true, objective: true },
    { name: 'Break Room', rect: { x0: 64, y0: 28, x1: 85, y1: 41 }, interior: true },
    { name: 'Garage', rect: { x0: 15, y0: 43, x1: 34, y1: 57 }, interior: true },
    { name: 'Archive', rect: { x0: 36, y0: 43, x1: 62, y1: 57 }, interior: true },
    { name: 'Workshop', rect: { x0: 64, y0: 43, x1: 85, y1: 57 }, interior: true },
    { name: 'North Yard', rect: { x0: 1, y0: 1, x1: 98, y1: 11 }, interior: false },
    { name: 'West Yard', rect: { x0: 1, y0: 12, x1: 13, y1: 58 }, interior: false },
    { name: 'East Yard', rect: { x0: 87, y0: 12, x1: 98, y1: 58 }, interior: false },
    { name: 'South Yard', rect: { x0: 1, y0: 59, x1: 98, y1: 68 }, interior: false },
  ],
  cameras: [
    { name: 'Lobby', cx: 33, cy: 14, angle: (3 * PI) / 4 },
    { name: 'Main Hall', cx: 61, cy: 14, angle: (3 * PI) / 4 },
    { name: 'Break Room', cx: 84, cy: 29, angle: (3 * PI) / 4 },
    { name: 'Garage', cx: 16, cy: 56, angle: -PI / 4 },
    { name: 'Workshop', cx: 84, cy: 56, angle: (-3 * PI) / 4 },
    { name: 'North Yard', cx: 40, cy: 11, angle: -PI / 2 },
  ],
  attackerSpawns: [
    { name: 'North Gate', zone: { x0: 40, y0: 1, x1: 60, y1: 4 }, points: [[44, 2], [48, 2], [52, 2], [56, 2], [50, 4]] },
    { name: 'West Lot', zone: { x0: 1, y0: 30, x1: 5, y1: 44 }, points: [[3, 32], [3, 35], [3, 38], [3, 41], [5, 37]] },
    { name: 'Southeast Dock', zone: { x0: 88, y0: 62, x1: 97, y1: 67 }, points: [[90, 64], [93, 64], [96, 64], [91, 66], [94, 66]] },
  ],
  defenderSpawns: [[38, 29], [60, 29], [38, 40], [60, 40], [49, 30]],
  anchors: [
    { cx: 37, cy: 29, facing: PI / 4 },
    { cx: 61, cy: 29, facing: (3 * PI) / 4 },
    { cx: 37, cy: 40, facing: -PI / 4 },
    { cx: 61, cy: 40, facing: (-3 * PI) / 4 },
    { cx: 49, cy: 40, facing: -PI / 2 },
  ],
  roamPoints: [[25, 17], [49, 20], [74, 19], [24, 33], [75, 37], [26, 51], [47, 52], [75, 49]],
  approaches: [
    { name: 'North', spawn: 'North Gate', waypoints: [[49, 8], [49, 20]] },
    { name: 'Lobby', spawn: 'West Lot', waypoints: [[10, 19], [25, 19], [25, 34]] },
    { name: 'Garage', spawn: 'West Lot', waypoints: [[9, 49], [26, 50], [47, 45]] },
    { name: 'East', spawn: 'Southeast Dock', waypoints: [[92, 19], [74, 20], [74, 35]] },
    { name: 'South', spawn: 'Southeast Dock', waypoints: [[75, 62], [75, 50], [58, 48], [52, 44]], hardBreach: true },
  ],
};
