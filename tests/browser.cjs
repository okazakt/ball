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
    await page.waitForTimeout(700);
    const start = await page.evaluate(() => window.__toukan.game.balls[0].body.translation().x);
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(450);
    await page.keyboard.up('ArrowRight');
    assert.ok(
      (await page.evaluate(() => window.__toukan.game.balls[0].body.translation().x)) > start
    );
    await page.click('#retry');
    // A real floor hole must allow the physical body to fall to B2.
    await page.evaluate(() => {
      const g = window.__toukan.game;
      g.enemies.forEach((e) => (e.stun = 100));
      g.balls[0].body.setTranslation({ x: 1.5, y: 0.3, z: 3 }, true);
      g.balls[0].body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    });
    await page.waitForFunction(() => window.__toukan.game.balls[0].floor === 1);
    await page.evaluate(() => {
      const g = window.__toukan.game;
      g.balls[0].body.setTranslation({ x: 4, y: -2.7, z: 0 }, true);
    });
    await page.waitForFunction(
      () => window.__toukan.game.outcome?.reason === '盤面の外に落ちました'
    );
    await page.waitForFunction(() => window.__toukan.game.state === 'replay');
    await page.waitForFunction(() => window.__toukan.game.state === 'finished');
    assert.equal(await page.evaluate(() => window.__toukan.game.viewFloor), 1);
    await page.click('#again');
    await page.evaluate(() => {
      const g = window.__toukan.game;
      g.enemies.forEach((e) => (e.stun = 100));
      for (const b of g.balls) {
        b.floor = 2;
        b.body.setTranslation({ x: 1.5, y: -6 + b.radius + 0.01, z: 3 }, true);
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
      ed.paint({ clientX: r.left + (r.width * 1.5) / 6, clientY: r.top + (r.height * 1.5) / 9 });
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
      'PASS: rendering, input, physics hole, NG replay, goals, favorites, QR, editor conflict/undo/redo, offline startup'
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
