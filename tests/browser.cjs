// Run against `npm run serve`: npm run test:browser
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
  });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } }),
      page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(process.env.TEST_URL || 'http://localhost:8000');
    await page.waitForFunction(() => window.__toukan?.game.ready, {}, { timeout: 30000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
    assert.equal(await page.evaluate(() => window.__toukan.game.state), 'ready');
    // Off-axis projection must pin the lid at every tilt, floor and viewport.
    for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => {
        const g = window.__toukan.game, T = window.THREE;
        g.resize();
        for (const floor of [0, 1, 2]) {
          g.viewFloor = floor;
          for (const [x, z] of [[0, 0], [0.3, -0.3], [-0.4, 0.4]]) {
            g.tilt = { x, z };
            g.setLighting();
            if (g.board.rotation.x !== 0 || g.board.rotation.z !== 0)
              throw Error('Board rotated');
            for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
              const p = new T.Vector3(sx * 4.1, -floor * 3 + 1.335, sz * 5.6).project(g.camera);
              if (Math.abs(p.x - sx) > 1e-6 || Math.abs(p.y + sz) > 1e-6)
                throw Error('Lid corner moved');
            }
          }
        }
        g.viewFloor = 0;
        g.tilt = { x: 0, z: 0 };
        g.setLighting();
        const origin = new T.Vector3(0, 0, 0).project(g.camera);
        g.tilt = { x: 0.3, z: 0.3 };
        g.setLighting();
        const floor = new T.Vector3(0, 0, 0).project(g.camera);
        const lower = new T.Vector3(0, -3, 0).project(g.camera);
        if (!(floor.x > origin.x && floor.y < origin.y && lower.x > floor.x))
          throw Error('Missing depth-dependent parallax');
        g.tilt = { x: 0, z: 0 };
        g.setLighting();
      });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => {
      const g = window.__toukan.game;
      const original = g.stage;
      const stage = structuredClone(original);
      stage.floors = [{ dark: false, cells: [], walls: original.floors[0].walls.filter(
        (w) => w.axis === 'h' ? w.z === 0 || w.z === 11 : w.x === 0 || w.x === 8
      ) }];
      stage.balls = [{ x: 4, z: 5 }];
      g.load(stage, false);
      const b = g.balls[0];
      g.keys.add('ArrowRight');
      for (let i = 0; i < 12; i++) g.step(1 / 60);
      if (b.body.linvel().x < 1.5) throw Error('Sluggish tilt acceleration');
      g.keys.clear();
      g.keys.add('ArrowLeft');
      for (let i = 0; i < 24; i++) g.step(1 / 60);
      if (b.body.linvel().x > -1) throw Error('Sluggish direction reversal');
      g.keys.clear();
      g.tilt = g.target = { x: 0, z: 0 };
      b.body.setTranslation({ x: 3, y: b.radius + 0.005, z: 0 }, true);
      b.body.setLinvel({ x: 4, y: 0, z: 0 }, true);
      b.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      let rebound = 0;
      for (let i = 0; i < 40; i++) {
        const incoming = b.body.linvel().x;
        g.step(1 / 60);
        if (b.body.linvel().x < 0) {
          rebound = -b.body.linvel().x / incoming;
          break;
        }
      }
      if (rebound < 0.6 || rebound > 0.8) throw Error(`Unexpected wall restitution: ${rebound}`);
      g.load(original);
    });
    await page.waitForTimeout(700);
    assert.equal(await page.evaluate(() => window.__toukan.game.elapsed), 0);
    await page.click('#start');
    const start = await page.evaluate(() => window.__toukan.game.balls[0].body.translation().x);
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(450);
    await page.keyboard.up('ArrowRight');
    assert.ok(
      (await page.evaluate(() => window.__toukan.game.balls[0].body.translation().x)) > start
    );
    await page.click('#retry');
    await page.click('#start');
    // A real floor hole must allow the physical body to fall to B2.
    await page.evaluate(() => {
      const g = window.__toukan.game;
      g.enemies.forEach((e) => (e.stun = 100));
      g.balls[0].body.setTranslation({ x: 0.5, y: 0.3, z: 2 }, true);
      g.balls[0].body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    });
    await page.waitForFunction(() => window.__toukan.game.balls[0].floor === 1);
    await page.evaluate(() => {
      const g = window.__toukan.game;
      g.balls[0].body.setTranslation({ x: 5, y: -2.7, z: 0 }, true);
    });
    await page.waitForFunction(
      () => window.__toukan.game.outcome?.reason === '盤面の外に落ちました'
    );
    await page.waitForFunction(() => window.__toukan.game.state === 'replay');
    await page.waitForFunction(() => window.__toukan.game.state === 'finished');
    assert.equal(await page.evaluate(() => window.__toukan.game.viewFloor), 1);
    await page.click('#again');
    await page.click('#start');
    await page.evaluate(() => {
      const g = window.__toukan.game;
      g.enemies.forEach((e) => (e.stun = 100));
      for (const b of g.balls) {
        b.floor = 2;
        b.body.setTranslation({ x: 0.5, y: -6 + b.radius + 0.01, z: 2 }, true);
        b.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      }
    });
    await page.waitForFunction(() => window.__toukan.game.outcome?.won === true);
    assert.equal(await page.locator('#result-title').textContent(), '光の先に、到着。');
    await page.click('#favorite');
    assert.equal(
      await page.evaluate(
        async () => (await window.__toukan.store.listStages()).filter((s) => s.favorite).length
      ),
      1
    );
    await page.click('#again');
    await page.click('#start');
    await page.click('#menu');
    await page.click('#qr-button');
    assert.equal(await page.locator('#qr canvas').count(), 1);
    await page.click('#edit');
    // Use the editor's normal pointer path to reject an occupied start cell.
    await page.click('[data-tool="hole"]');
    await page.evaluate(() => {
      const ed = window.__toukan.editor,
        r = ed.canvas.getBoundingClientRect();
      ed.touched = new Set();
      ed.paint({ clientX: r.left + (r.width * 1.5) / 8, clientY: r.top + (r.height * 1.5) / 11 });
    });
    assert.match(await page.locator('#toast').textContent(), /共存できない/);
    await page.click('[data-tool="wall"]');
    await page.evaluate(() => {
      const ed = window.__toukan.editor;
      ed.snapshot();
      ed.stage.name = 'Undo test';
      ed.draw();
    });
    await page.click('#undo');
    assert.notEqual(await page.locator('#edit-name').inputValue(), 'Undo test');
    await page.click('#redo');
    assert.equal(await page.locator('#edit-name').inputValue(), 'Undo test');
    await page.screenshot({ path: process.env.SCREENSHOT_PATH || '/tmp/toukan-editor.png' });
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await context.setOffline(true);
    await page.reload();
    await page.waitForFunction(() => window.__toukan?.game.ready);
    await context.setOffline(false);
    assert.deepEqual(errors, []);
    console.log(
      'PASS: pinned lid, parallax, tilt response, wall rebound, rendering, input, physics hole, NG replay, goals, favorites, QR, editor conflict/undo/redo, offline startup'
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
