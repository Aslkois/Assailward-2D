import type { Side } from '../sim/types';

// Firearm definitions. All names/numbers are original to Assailward 2D: the original Assailward
// repository contains no weapon data, so these values are this project's own balance pass.

export type FireMode = 'auto' | 'semi' | 'pump';
export type WeaponClass = 'AR' | 'BR' | 'DMR' | 'SMG' | 'LMG' | 'SG' | 'PISTOL' | 'MP' | 'REVOLVER';
export type WeaponAudio = 'rifle' | 'smg' | 'shotgun' | 'pistol' | 'dmr' | 'lmg';

export interface Falloff {
  start: number; // px — full damage up to here
  end: number; // px — minimum factor from here on
  min: number; // damage factor at/after `end`
}

export interface WeaponDef {
  id: string;
  name: string;
  slot: 'primary' | 'secondary';
  cls: WeaponClass;
  sides: Side[]; // faction restriction
  damage: number; // base damage per projectile (per pellet for shotguns)
  pellets: number;
  pelletSpread: number; // rad, uniform cone for multi-pellet weapons
  rpm: number;
  mode: FireMode;
  magSize: number;
  reserve: number;
  reloadTime: number; // tactical reload (round still chambered)
  emptyReloadTime: number;
  spreadHip: number; // rad (1 sigma)
  spreadAds: number;
  spreadMove: number; // added at full movement speed
  bloomPerShot: number;
  bloomMax: number;
  bloomRecovery: number; // rad/s
  kick: number; // random aim kick per shot (rad)
  falloff: Falloff;
  range: number;
  materialMult: number; // multiplier vs barricades / soft walls
  moveMult: number;
  adsMoveMult: number;
  equipTime: number;
  soundRadius: number;
  audio: WeaponAudio;
}

const W = (d: WeaponDef): WeaponDef => d;

export const WEAPONS: Record<string, WeaponDef> = {
  // ---- Attacker primaries ----
  ar31: W({
    id: 'ar31', name: 'AR-31 Vantage', slot: 'primary', cls: 'AR', sides: ['attack'],
    damage: 30, pellets: 1, pelletSpread: 0, rpm: 700, mode: 'auto', magSize: 30, reserve: 150,
    reloadTime: 2.3, emptyReloadTime: 2.8, spreadHip: 0.045, spreadAds: 0.011, spreadMove: 0.03,
    bloomPerShot: 0.007, bloomMax: 0.06, bloomRecovery: 0.22, kick: 0.012,
    falloff: { start: 560, end: 900, min: 0.7 }, range: 1400, materialMult: 1.0,
    moveMult: 0.97, adsMoveMult: 0.65, equipTime: 0.45, soundRadius: 760, audio: 'rifle',
  }),
  k9: W({
    id: 'k9', name: 'K9 Battle Rifle', slot: 'primary', cls: 'BR', sides: ['attack'],
    damage: 42, pellets: 1, pelletSpread: 0, rpm: 520, mode: 'auto', magSize: 20, reserve: 120,
    reloadTime: 2.5, emptyReloadTime: 3.0, spreadHip: 0.05, spreadAds: 0.01, spreadMove: 0.035,
    bloomPerShot: 0.012, bloomMax: 0.08, bloomRecovery: 0.2, kick: 0.018,
    falloff: { start: 620, end: 1000, min: 0.72 }, range: 1500, materialMult: 1.2,
    moveMult: 0.94, adsMoveMult: 0.6, equipTime: 0.5, soundRadius: 820, audio: 'rifle',
  }),
  longshot: W({
    id: 'longshot', name: 'Longshot DMR', slot: 'primary', cls: 'DMR', sides: ['attack'],
    damage: 62, pellets: 1, pelletSpread: 0, rpm: 300, mode: 'semi', magSize: 10, reserve: 60,
    reloadTime: 2.4, emptyReloadTime: 2.9, spreadHip: 0.07, spreadAds: 0.004, spreadMove: 0.05,
    bloomPerShot: 0.02, bloomMax: 0.05, bloomRecovery: 0.3, kick: 0.02,
    falloff: { start: 900, end: 1400, min: 0.85 }, range: 1600, materialMult: 1.3,
    moveMult: 0.93, adsMoveMult: 0.55, equipTime: 0.55, soundRadius: 860, audio: 'dmr',
  }),
  // ---- Shared primary ----
  breacher12: W({
    id: 'breacher12', name: 'Breacher-12 Shotgun', slot: 'primary', cls: 'SG', sides: ['attack', 'defend'],
    damage: 13, pellets: 8, pelletSpread: 0.11, rpm: 75, mode: 'pump', magSize: 7, reserve: 35,
    reloadTime: 3.0, emptyReloadTime: 3.4, spreadHip: 0.015, spreadAds: 0.008, spreadMove: 0.02,
    bloomPerShot: 0.0, bloomMax: 0.0, bloomRecovery: 1, kick: 0.03,
    falloff: { start: 110, end: 280, min: 0.25 }, range: 700, materialMult: 2.5,
    moveMult: 0.98, adsMoveMult: 0.7, equipTime: 0.5, soundRadius: 800, audio: 'shotgun',
  }),
  // ---- Defender primaries ----
  wasp: W({
    id: 'wasp', name: 'Wasp SMG', slot: 'primary', cls: 'SMG', sides: ['defend'],
    damage: 22, pellets: 1, pelletSpread: 0, rpm: 950, mode: 'auto', magSize: 32, reserve: 192,
    reloadTime: 2.0, emptyReloadTime: 2.4, spreadHip: 0.04, spreadAds: 0.016, spreadMove: 0.02,
    bloomPerShot: 0.005, bloomMax: 0.055, bloomRecovery: 0.3, kick: 0.01,
    falloff: { start: 300, end: 650, min: 0.6 }, range: 1200, materialMult: 0.8,
    moveMult: 1.03, adsMoveMult: 0.72, equipTime: 0.35, soundRadius: 680, audio: 'smg',
  }),
  mastiff: W({
    id: 'mastiff', name: 'Mastiff SMG', slot: 'primary', cls: 'SMG', sides: ['defend'],
    damage: 28, pellets: 1, pelletSpread: 0, rpm: 760, mode: 'auto', magSize: 30, reserve: 150,
    reloadTime: 2.2, emptyReloadTime: 2.6, spreadHip: 0.042, spreadAds: 0.014, spreadMove: 0.024,
    bloomPerShot: 0.0065, bloomMax: 0.06, bloomRecovery: 0.26, kick: 0.012,
    falloff: { start: 360, end: 700, min: 0.62 }, range: 1250, materialMult: 0.9,
    moveMult: 1.0, adsMoveMult: 0.68, equipTime: 0.4, soundRadius: 700, audio: 'smg',
  }),
  bulwark: W({
    id: 'bulwark', name: 'Bulwark LMG', slot: 'primary', cls: 'LMG', sides: ['defend'],
    damage: 33, pellets: 1, pelletSpread: 0, rpm: 650, mode: 'auto', magSize: 80, reserve: 160,
    reloadTime: 4.2, emptyReloadTime: 4.8, spreadHip: 0.055, spreadAds: 0.013, spreadMove: 0.04,
    bloomPerShot: 0.006, bloomMax: 0.07, bloomRecovery: 0.2, kick: 0.014,
    falloff: { start: 520, end: 900, min: 0.7 }, range: 1400, materialMult: 1.1,
    moveMult: 0.88, adsMoveMult: 0.55, equipTime: 0.7, soundRadius: 800, audio: 'lmg',
  }),
  // ---- Secondaries ----
  p10: W({
    id: 'p10', name: 'P10 Sidearm', slot: 'secondary', cls: 'PISTOL', sides: ['attack', 'defend'],
    damage: 32, pellets: 1, pelletSpread: 0, rpm: 400, mode: 'semi', magSize: 15, reserve: 60,
    reloadTime: 1.6, emptyReloadTime: 1.9, spreadHip: 0.035, spreadAds: 0.014, spreadMove: 0.02,
    bloomPerShot: 0.012, bloomMax: 0.05, bloomRecovery: 0.35, kick: 0.016,
    falloff: { start: 260, end: 560, min: 0.6 }, range: 1000, materialMult: 0.7,
    moveMult: 1.05, adsMoveMult: 0.8, equipTime: 0.3, soundRadius: 600, audio: 'pistol',
  }),
  hornet: W({
    id: 'hornet', name: 'Hornet Machine Pistol', slot: 'secondary', cls: 'MP', sides: ['defend'],
    damage: 19, pellets: 1, pelletSpread: 0, rpm: 1100, mode: 'auto', magSize: 20, reserve: 100,
    reloadTime: 1.8, emptyReloadTime: 2.1, spreadHip: 0.05, spreadAds: 0.022, spreadMove: 0.025,
    bloomPerShot: 0.007, bloomMax: 0.07, bloomRecovery: 0.3, kick: 0.014,
    falloff: { start: 200, end: 480, min: 0.55 }, range: 900, materialMult: 0.6,
    moveMult: 1.05, adsMoveMult: 0.8, equipTime: 0.3, soundRadius: 620, audio: 'smg',
  }),
  judge: W({
    id: 'judge', name: 'Judge Revolver', slot: 'secondary', cls: 'REVOLVER', sides: ['attack'],
    damage: 55, pellets: 1, pelletSpread: 0, rpm: 160, mode: 'semi', magSize: 6, reserve: 36,
    reloadTime: 2.6, emptyReloadTime: 2.6, spreadHip: 0.03, spreadAds: 0.009, spreadMove: 0.03,
    bloomPerShot: 0.025, bloomMax: 0.05, bloomRecovery: 0.3, kick: 0.03,
    falloff: { start: 320, end: 700, min: 0.65 }, range: 1100, materialMult: 1.0,
    moveMult: 1.04, adsMoveMult: 0.75, equipTime: 0.35, soundRadius: 720, audio: 'pistol',
  }),
};

export function weaponsFor(side: Side, slot: 'primary' | 'secondary'): WeaponDef[] {
  return Object.values(WEAPONS).filter((w) => w.slot === slot && w.sides.includes(side));
}
