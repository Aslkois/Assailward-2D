// Browser smoke test: serves the production build, drives the real UI with mouse/keyboard in
// headless Chromium, and fails on console errors or if the simulation does not advance.
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

const errors = [];
let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
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
  await page.screenshot({ path: path.join(outDir, '1-menu.png') });
  await click(305, 438); // START MATCH
  await page.waitForFunction(() => window.__assailward.game.scene.isActive('Loadout'));
  await page.screenshot({ path: path.join(outDir, '2-loadout.png') });
  await click(1050, 672); // DEPLOY
  await page.waitForFunction(() => window.__assailward.game.scene.isActive('Game'));
  await sleep(1500);
  const t0 = await page.evaluate(() => window.__assailward.game.scene.getScene('Game').world.time);
  // move, aim, open the camera system and come back
  const [cx, cy] = at(800, 420);
  await page.mouse.move(cx, cy);
  await page.keyboard.down('s');
  await sleep(700);
  await page.keyboard.up('s');
  await page.keyboard.press('5');
  await sleep(1200);
  await page.screenshot({ path: path.join(outDir, '3-camera-system.png') });
  await page.keyboard.press('5');
  await sleep(400);
  await page.screenshot({ path: path.join(outDir, '4-prep.png') });
  // skip to the action phase and let the bots play
  await page.evaluate(() => {
    const w = window.__assailward.game.scene.getScene('Game').world;
    w.round.timeLeft = 0.05;
  });
  await sleep(6000);
  await page.screenshot({ path: path.join(outDir, '5-action.png') });
  await page.keyboard.down('Tab');
  await sleep(300);
  await page.screenshot({ path: path.join(outDir, '6-scoreboard.png') });
  await page.keyboard.up('Tab');
  await page.keyboard.press('Escape');
  await sleep(300);
  await page.screenshot({ path: path.join(outDir, '7-pause.png') });
  await page.keyboard.press('Escape');
  const state = await page.evaluate(() => {
    const w = window.__assailward.game.scene.getScene('Game').world;
    return { time: w.time, phase: w.round.phase, alive: w.chars.filter((c) => c.alive).length };
  });
  console.log('simulation state', state, 'advanced', (state.time - t0).toFixed(1), 's');
  if (state.time - t0 < 3) errors.push('simulation did not advance');
} catch (e) {
  errors.push(String(e));
} finally {
  await browser?.close();
  stopServer();
}
if (errors.length) {
  console.error('SMOKE FAILED:\n' + errors.join('\n'));
  process.exit(1);
}
console.log(`SMOKE OK — screenshots in ${outDir}/`);
process.exit(0);
