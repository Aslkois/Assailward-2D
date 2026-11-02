import Phaser from 'phaser';
import { TEAM_NAMES } from '../../sim/setup';
import type { Team } from '../../sim/types';
import { synth } from '../audio/Synth';
import { session } from '../session';
import { C, CSS, MONO, teamCss, textStyle } from '../theme';
import { drawBackdrop, makeButton } from '../ui';

export class MatchEndScene extends Phaser.Scene {
  constructor() {
    super('MatchEnd');
  }

  create(): void {
    this.game.canvas.style.cursor = 'default';
    drawBackdrop(this);
    const match = session.match!;
    const won = match.winner() === 0;
    synth.sting(won);
    this.add.text(640, 80, won ? 'VICTORY' : 'DEFEAT', textStyle(72, won ? CSS.good : CSS.red, false, true)).setOrigin(0.5).setLetterSpacing(8);
    this.add.text(640, 140, `${TEAM_NAMES[0]} ${match.scores[0]}  —  ${match.scores[1]} ${TEAM_NAMES[1]}`, textStyle(22, CSS.white, true, true)).setOrigin(0.5);
    const g = this.add.graphics();
    g.fillStyle(C.panel, 0.92);
    g.fillRect(80, 190, 480, 400);
    g.fillRect(600, 190, 600, 400);
    g.lineStyle(1, C.edge, 1);
    g.strokeRect(80, 190, 480, 400);
    g.strokeRect(600, 190, 600, 400);
    this.add.text(100, 204, 'ROUNDS', textStyle(11, CSS.dim, false, true)).setLetterSpacing(2);
    match.history.forEach((r, i) => {
      const youAtk = r.attackers === 0;
      this.add.text(100, 232 + i * 26, `R${r.round}  ${youAtk ? 'ATK' : 'DEF'}  ${r.winner === 0 ? 'WON ' : 'LOST'}  ${r.reason}`, { fontFamily: MONO, fontSize: '13px', color: r.winner === 0 ? CSS.good : CSS.red });
    });
    this.add.text(620, 204, 'OPERATORS          K    D    A   PLANT DISABLE', textStyle(11, CSS.dim, true, true));
    let row = 0;
    for (const team of [0, 1] as Team[]) {
      for (const t of [...match.tallies.values()].filter((x) => x.team === team)) {
        this.add.text(620, 232 + row * 24, `${t.name.padEnd(16)}${String(t.kills).padStart(4)} ${String(t.deaths).padStart(4)} ${String(t.assists).padStart(4)} ${String(t.plants).padStart(6)} ${String(t.disables).padStart(7)}`, { fontFamily: MONO, fontSize: '13px', color: teamCss(team) });
        row++;
      }
      row++;
    }
    makeButton(this, 520, 650, 'PLAY AGAIN', () => {
      session.newMatch(session.settings.startSide, session.settings.difficulty);
      this.scene.start('Loadout');
    }, { width: 260, height: 48, primary: true, size: 18 });
    makeButton(this, 780, 650, 'Main menu', () => {
      session.match = null;
      this.scene.start('Menu');
    }, { width: 220, height: 48 });
  }
}
