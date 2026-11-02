import Phaser from 'phaser';
import { GameScene } from './game/scenes/GameScene';
import { HudScene } from './game/scenes/HudScene';
import { LoadoutScene } from './game/scenes/LoadoutScene';
import { MatchEndScene } from './game/scenes/MatchEndScene';
import { MenuScene } from './game/scenes/MenuScene';
import { session } from './game/session';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: 1280,
  height: 720,
  backgroundColor: '#0a0d11',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  render: { antialias: true, pixelArt: false },
  disableContextMenu: true,
  scene: [MenuScene, LoadoutScene, GameScene, HudScene, MatchEndScene],
});

// Guard against accidental tab closes (e.g. Ctrl+W) during a match.
window.addEventListener('beforeunload', (e) => {
  if (session.match) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// Exposed for automated smoke tests and debugging from the console.
(window as unknown as { __assailward: unknown }).__assailward = { game, session };
