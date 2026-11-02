// Browser smoke test: serves the production build, drives the real UI with mouse/keyboard in
// headless Chromium, asserts on game state, and fails on console errors.
//
// Usage: npm run build && npm run smoke [-- --out <dir>]
// Requires the `playwright` package with a Chromium browser available.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('playwright is not installed. Install it (npm i -D playwright && npx playwright install chromium) to run the smoke test.');
  process.exit(2);
}

const outIdx = process.argv.indexOf('--out');
const outDir = outIdx > 0 ? process.argv[outIdx + 1] : 'smoke-output';
mkdirSync(outDir, { recursive: true });
const PORT = 4179;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true });
const stopServer = () => {
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {
    server.kill();
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
const results = [];
const check = (name, ok, detail = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) errors.push(`check failed: ${name} ${detail}`);
};

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://localhost:${PORT}/`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  throw new Error('preview server did not start');
}

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(30000);
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.__assailward?.game?.isBooted);
  await sleep(800);
  const box = await page.locator('canvas').boundingBox();
  const at = (x, y) => [box.x + (x * box.width) / 1280, box.y + (y * box.height) / 720];
  const click = async (x, y) => {
    const [px, py] = at(x, y);
    await page.mouse.click(px, py);
    await sleep(300);
  };
  const G = (fn, arg) => page.evaluate(fn, arg);
  const player = () => G(() => {
    const p = window.__assailward.game.scene.getScene('Game').world.player;
    return { slot: p.inv.slot, util: p.inv.utilIndex, ads: p.ads, mag: p.inv.primary.mag, reloading: p.inv.primary.reloading, cam: p.camView, alive: p.alive, x: p.pos.x, y: p.pos.y };
  });
  const simTime = () => G(() => window.__assailward.game.scene.getScene('Game').world.time);

  // ---------------------------------------------------------------- menus via real clicks
  await page.screenshot({ path: path.join(outDir, '1-menu.png') });
  await click(305, 438); // START MATCH (attackers first)
  await page.waitForFunction(() => window.__assailward.game.scene.isActive('Loadout'));
  check('menu START MATCH opens loadout', true);
  await click(153, 306); // Breacher-12 shotgun
  await click(633, 263); // Frag grenade (replaces the oldest utility pick)
  const picked = await G(() => window.__assailward.game.scene.getScene('Loadout').loadout);
  check('loadout clicks change selection', picked.primary === 'breacher12' && picked.utilities.includes('frag'), JSON.stringify(picked));
  await page.screenshot({ path: path.join(outDir, '2-loadout.png') });
  await click(1050, 672); // DEPLOY
  await page.waitForFunction(() => window.__assailward.game.scene.isActive('Game'));
  check('deploy starts the round', true);
  await sleep(1200);

  // ---------------------------------------------------------------- input -> game state
  const [cx, cy] = at(900, 420);
  await page.mouse.move(cx, cy);
  const p0 = await player();
  await page.keyboard.down('d');
  await sleep(600);
  await page.keyboard.up('d');
  const p1 = await player();
  check('WASD moves the operator', p1.x > p0.x + 10, `${p0.x.toFixed(0)} -> ${p1.x.toFixed(0)}`);
  await page.keyboard.press('3');
  await sleep(150);
  const s3 = await player();
  await page.keyboard.press('3');
  await sleep(150);
  const s33 = await player();
  check('3 selects utilities, pressing again cycles', s3.slot === 3 && s33.slot === 3 && s33.util !== s3.util, `util ${s3.util} -> ${s33.util}`);
  await page.keyboard.press('1');
  await sleep(700);
  await page.mouse.down({ button: 'right' });
  await sleep(300);
  check('right mouse = precision aim', (await player()).ads === true);
  await page.mouse.up({ button: 'right' });
  const lockedBefore = await player();
  await page.mouse.down();
  await sleep(250);
  await page.mouse.up();
  await sleep(200);
  check('attackers are weapons-locked during preparation', (await player()).mag === lockedBefore.mag);
  await page.keyboard.press('5');
  await sleep(800);
  check('5 opens the drone feed', (await player()).cam?.kind === 'drone');
  await page.screenshot({ path: path.join(outDir, '3-drone-feed.png') });
  await page.keyboard.press('5');
  await sleep(300);
  check('5 again exits the camera system', (await player()).cam === null);
  await page.keyboard.press('Escape');
  await sleep(200);
  const tp0 = await simTime();
  await sleep(800);
  const tp1 = await simTime();
  check('Esc pauses the simulation', Math.abs(tp1 - tp0) < 0.02, `${tp0.toFixed(2)} vs ${tp1.toFixed(2)}`);
  await page.screenshot({ path: path.join(outDir, '4-pause.png') });
  await page.keyboard.press('Escape');
  await sleep(500);
  check('Esc resumes', (await simTime()) > tp1 + 0.1);
  await page.keyboard.down('Tab');
  await sleep(300);
  await page.screenshot({ path: path.join(outDir, '5-scoreboard.png') });
  await page.keyboard.up('Tab');

  // skip to the action phase and let the bots fight for a while
  await G(() => {
    window.__assailward.game.scene.getScene('Game').world.round.timeLeft = 0.05;
  });
  await sleep(500);
  const before = await player();
  await page.mouse.down();
  await sleep(250);
  await page.mouse.up();
  await sleep(300);
  const after = await player();
  check('left click fires in the action phase (ammo spent)', after.mag < before.mag, `${before.mag} -> ${after.mag}`);
  await page.keyboard.press('r');
  await sleep(200);
  check('R reloads', (await player()).reloading === true);
  const ta = await simTime();
  await sleep(7000);
  const tb = await simTime();
  check('simulation runs in real time', tb - ta > 5, `${(tb - ta).toFixed(1)}s sim in 7s`);
  await page.screenshot({ path: path.join(outDir, '6-action.png') });

  // ---------------------------------------------------------------- defender barricade with F
  await G(() => {
    const a = window.__assailward;
    a.game.scene.stop('Hud');
    a.session.newMatch('defend', 'normal');
    a.game.scene.start('Game');
  });
  await sleep(1500);
  await page.waitForFunction(() => window.__assailward.game.scene.getScene('Game').world?.round.phase === 'prep');
  const doorwayId = await G(() => {
    const w = window.__assailward.game.scene.getScene('Game').world;
    const p = w.player;
    const id = w.map.doorOf[w.map.idx(35, 17)]; // Lobby | Main Hall doorway
    p.pos.x = 36.5 * 16;
    p.pos.y = 17.5 * 16;
    return id;
  });
  await page.keyboard.down('f');
  await sleep(3400);
  await page.keyboard.up('f');
  const built = await G((id) => {
    const b = window.__assailward.game.scene.getScene('Game').world.map.doorways[id].barricade;
    return b ? { complete: b.complete, team: b.team } : null;
  }, doorwayId);
  check('defender holds F to barricade a doorway', !!built && built.complete, JSON.stringify(built));
  await page.screenshot({ path: path.join(outDir, '7-barricade.png') });

  // ---------------------------------------------------------------- round/match flow through the real scenes
  const endRound = (winner) =>
    G((winner) => {
      const w = window.__assailward.game.scene.getScene('Game').world;
      w.round.rules.endDelay = 0.3;
      w.round.end(w, winner, 'smoke test');
    }, winner);
  const sidesNow = () => G(() => window.__assailward.session.match.sides());
  const sidesR1 = await sidesNow();
  await endRound(0);
  await page.waitForFunction(() => window.__assailward.game.scene.isActive('Loadout'));
  check('round end returns to loadout for the next round', true);
  await page.screenshot({ path: path.join(outDir, '8-next-round-loadout.png') });
  await click(1050, 672); // DEPLOY round 2
  await page.waitForFunction(() => window.__assailward.game.scene.isActive('Game') && window.__assailward.session.match.round === 2);
  await sleep(800);
  await page.keyboard.press('Control');
  await sleep(200);
  const stance = await G(() => window.__assailward.game.scene.getScene('Game').world.player.stance);
  check('controls still bound after a scene restart (Ctrl crouch toggle in round 2)', stance === 'crouch', stance);
  await endRound(1);
  await page.waitForFunction(() => window.__assailward.game.scene.isActive('Loadout') && window.__assailward.session.match.round === 3);
  const sidesR3 = await sidesNow();
  check('sides switch after two rounds', sidesR1[0] !== sidesR3[0], `${sidesR1[0]} -> ${sidesR3[0]}`);
  await page.screenshot({ path: path.join(outDir, '9-sides-switched.png') });
  for (let r = 0; r < 3; r++) {
    await click(1050, 672);
    await page.waitForFunction(() => window.__assailward.game.scene.isActive('Game'));
    await sleep(800);
    await endRound(0);
    await page.waitForFunction(() => window.__assailward.game.scene.isActive('Loadout') || window.__assailward.game.scene.isActive('MatchEnd'));
    await sleep(300);
  }
  check('match ends at the win target', await G(() => window.__assailward.game.scene.isActive('MatchEnd')));
  await page.screenshot({ path: path.join(outDir, '10-match-end.png') });
  await click(520, 650); // PLAY AGAIN
  await page.waitForFunction(() => window.__assailward.game.scene.isActive('Loadout'));
  check('play again starts a fresh match', (await G(() => window.__assailward.session.match.round)) === 1);
} catch (e) {
  errors.push(String(e));
} finally {
  await browser?.close();
  stopServer();
}
console.log(results.join('\n'));
if (errors.length) {
  console.error('SMOKE FAILED:\n' + errors.join('\n'));
  process.exit(1);
}
console.log(`SMOKE OK — screenshots in ${outDir}/`);
process.exit(0);
