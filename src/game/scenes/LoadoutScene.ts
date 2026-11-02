import Phaser from 'phaser';
import { ARMOR, type ArmorTier } from '../../config/constants';
import { gadgetPoolFor, utilityPoolFor, type EquipDef, type EquipId } from '../../config/equipment';
import { validateLoadout, type Loadout } from '../../config/loadouts';
import { weaponsFor, type WeaponDef } from '../../config/weapons';
import { COMPOUND } from '../../sim/maps/compound';
import { TEAM_NAMES } from '../../sim/setup';
import { session } from '../session';
import { C, CSS, textStyle } from '../theme';
import { drawBackdrop, makeButton } from '../ui';

const COL_W = 228;

/** Pre-round loadout selection for the side the player is on this round. */
export class LoadoutScene extends Phaser.Scene {
  private loadout!: Loadout;
  private refresh: (() => void)[] = [];
  private info!: Phaser.GameObjects.Text;
  private infoTitle!: Phaser.GameObjects.Text;
  private errors!: Phaser.GameObjects.Text;

  constructor() {
    super('Loadout');
  }

  create(): void {
    this.game.canvas.style.cursor = 'default';
    this.refresh = [];
    const match = session.match!;
    const side = match.sideOf(0);
    this.loadout = structuredClone(session.loadouts[side]);
    drawBackdrop(this);
    const swapped = match.history.length > 0 && match.history[match.history.length - 1].attackers !== (side === 'attack' ? 0 : 1);
    const last = match.history[match.history.length - 1];
    this.add.text(40, 26, `ROUND ${match.round}`, textStyle(13, CSS.dim, false, true)).setLetterSpacing(3);
    this.add.text(40, 46, side === 'attack' ? 'YOU ARE ATTACKING' : 'YOU ARE DEFENDING', textStyle(32, side === 'attack' ? CSS.amber : CSS.blue, false, true)).setLetterSpacing(2);
    this.add.text(40, 90, `${TEAM_NAMES[0]} ${match.scores[0]} — ${match.scores[1]} ${TEAM_NAMES[1]}   ·   first to ${match.config.roundsToWin}${swapped ? '   ·   SIDES SWITCHED' : ''}`, textStyle(14, CSS.text, true));
    if (last) this.add.text(40, 112, `Last round: ${last.winner === 0 ? 'WON' : 'LOST'} — ${last.reason}`, textStyle(12, last.winner === 0 ? CSS.good : CSS.red));

    let x = 40;
    const top = 150;
    // Primary
    this.column(x, top, 'PRIMARY', weaponsFor(side, 'primary'), (w) => w.name, (w) => this.loadout.primary === w.id, (w) => (this.loadout.primary = w.id), (w) => this.weaponInfo(w));
    x += COL_W + 12;
    this.column(x, top, 'SECONDARY', weaponsFor(side, 'secondary'), (w) => w.name, (w) => this.loadout.secondary === w.id, (w) => (this.loadout.secondary = w.id), (w) => this.weaponInfo(w));
    x += COL_W + 12;
    this.column(x, top, 'UTILITIES  (PICK 2)', utilityPoolFor(side), (e) => `${e.name}  [${e.pool === 'global' ? 'ALL' : e.pool === 'attack' ? 'ATK' : 'DEF'}]`, (e) => this.loadout.utilities.includes(e.id), (e) => this.pickTwo('utilities', e.id), (e) => this.equipInfo(e));
    x += COL_W + 12;
    this.column(x, top, 'SPECIAL GADGETS  (PICK 2)', gadgetPoolFor(side), (e) => e.name, (e) => this.loadout.gadgets.includes(e.id), (e) => this.pickTwo('gadgets', e.id), (e) => this.equipInfo(e));
    x += COL_W + 12;
    const armors = (Object.keys(ARMOR) as ArmorTier[]).map((id) => ({ id }));
    const y2 = this.column(x, top, 'ARMOR', armors, (a) => `${ARMOR[a.id].label}  (-${Math.round(ARMOR[a.id].reduction * 100)}% dmg)`, (a) => this.loadout.armor === a.id, (a) => (this.loadout.armor = a.id), (a) => ({ title: `${ARMOR[a.id].label} armor`, body: `Damage reduction ${Math.round(ARMOR[a.id].reduction * 100)}% (applied after range falloff and centerline scaling).\nMovement speed ×${ARMOR[a.id].speed.toFixed(2)}.` }));
    if (side === 'attack') {
      this.column(x, y2 + 24, 'SPAWN', COMPOUND.attackerSpawns.map((s) => ({ id: s.name })), (s) => s.id, (s) => session.spawn === s.id, (s) => (session.spawn = s.id), (s) => ({ title: `Spawn: ${s.id}`, body: 'You start the preparation phase confined to this spawn zone. Your drones can leave it.' }));
    }

    // info panel
    const g = this.add.graphics();
    g.fillStyle(C.panel, 0.92);
    g.fillRect(40, 520, 1200, 120);
    g.lineStyle(1, C.edge, 1);
    g.strokeRect(40, 520, 1200, 120);
    this.infoTitle = this.add.text(56, 532, 'Hover an item for details', textStyle(15, CSS.white, false, true));
    this.info = this.add.text(56, 558, '', { ...textStyle(13, CSS.text), wordWrap: { width: 1160 }, lineSpacing: 4 });
    this.errors = this.add.text(40, 660, '', textStyle(13, CSS.red));
    makeButton(this, 1050, 672, 'DEPLOY', () => this.deployNow(), { width: 300, height: 48, size: 18, primary: true });
    makeButton(this, 760, 672, 'Main menu', () => {
      session.match = null;
      this.scene.start('Menu');
    }, { width: 200, height: 40 });
    this.input.keyboard?.once('keydown-ENTER', () => this.deployNow());
    this.refreshUi();
  }

  private column<T>(
    x: number,
    y: number,
    title: string,
    items: T[],
    label: (t: T) => string,
    isOn: (t: T) => boolean,
    pick: (t: T) => void,
    describe: (t: T) => { title: string; body: string },
  ): number {
    this.add.text(x, y, title, textStyle(11, CSS.dim, false, true)).setLetterSpacing(2);
    let yy = y + 30;
    for (const it of items) {
      const b = makeButton(this, x + COL_W / 2, yy, label(it), () => {
        pick(it);
        this.refreshUi();
      }, { width: COL_W, height: 36, size: 13 });
      b.bg.on('pointerover', () => {
        const d = describe(it);
        this.infoTitle.setText(d.title);
        this.info.setText(d.body);
      });
      this.refresh.push(() => b.setSelected(isOn(it)));
      yy += 42;
    }
    return yy;
  }

  private pickTwo(key: 'utilities' | 'gadgets', id: EquipId): void {
    const cur = this.loadout[key];
    if (cur.includes(id)) return;
    this.loadout[key] = [cur[1], id];
  }

  private weaponInfo(w: WeaponDef): { title: string; body: string } {
    return {
      title: `${w.name} — ${w.cls}${w.sides.length > 1 ? ' (both factions)' : w.sides[0] === 'attack' ? ' (attackers only)' : ' (defenders only)'}`,
      body:
        `Damage ${w.damage}${w.pellets > 1 ? ` × ${w.pellets} pellets` : ''} · ${w.rpm} RPM ${w.mode} · Magazine ${w.magSize} (+${w.reserve})` +
        ` · Reload ${w.reloadTime}s · Full damage to ${Math.round(w.falloff.start / 30)} m, min ×${w.falloff.min}` +
        `\nHip spread ${(w.spreadHip * 57.3).toFixed(1)}° · precision ${(w.spreadAds * 57.3).toFixed(1)}° · move speed ×${w.moveMult}` +
        ` · vs barricades/walls ×${w.materialMult}\nCenterline scaling: shots through the target's centre deal up to 1.5× damage.`,
    };
  }

  private equipInfo(e: EquipDef): { title: string; body: string } {
    const charges = e.charges < 0 ? 'unlimited' : `${e.charges} charge${e.charges === 1 ? '' : 's'}`;
    return {
      title: `${e.name}${e.provisional ? '   [PROVISIONAL]' : ''}`,
      body: `${e.description}\n${charges} · Left click: ${e.use === 'throw' ? 'throw toward cursor' : e.use === 'place' ? 'hold to place' : e.use === 'scan' ? 'hold to scan' : 'swing'} · Right click: ${e.secondaryAction}` +
        (e.provisional ? '\nProvisional: no original Assailward specification was available, so this is an original Assailward 2D design.' : ''),
    };
  }

  /** Re-applies selection highlights after a pick (not every frame, so hover states survive). */
  private refreshUi(): void {
    for (const r of this.refresh) r();
    const side = session.match!.sideOf(0);
    this.errors.setText(validateLoadout(side, this.loadout).join(' · '));
  }

  private deployNow(): void {
    const side = session.match!.sideOf(0);
    if (validateLoadout(side, this.loadout).length) return;
    session.loadouts[side] = this.loadout;
    session.save();
    this.scene.start('Game');
  }
}
