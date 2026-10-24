// Deterministic real WebGL captures: no continuous animation while inspecting.
// TEST_URL=http://localhost:8000 NODE_PATH=... CHROMIUM_PATH=... node tests/walls-browser.cjs
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
  });
  const output = process.env.CAPTURE_DIR || '/tmp/toukan-walls';
  fs.mkdirSync(output, { recursive: true });
  const errors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    await page.addInitScript(() => { window.requestAnimationFrame = () => 0; });
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(process.env.TEST_URL || 'http://127.0.0.1:8000');
    await page.waitForFunction(() => window.__toukan?.game.ready, { }, { polling: 100, timeout: 60000 });
    const original = await page.evaluate(() => structuredClone(window.__toukan.game.stage));
    const version = await page.locator('#app-version').textContent();
    const records = [];
    async function capture(name, floor, tilt) {
      const result = await page.evaluate(({ floor, tilt }) => {
        const g = window.__toukan.game;
        g.viewFloor = floor;
        g.tilt = tilt;
        g.loop(performance.now());
        return { image: g.renderer.domElement.toDataURL('image/png'),
          calls: g.renderer.info.render.calls, triangles: g.renderer.info.render.triangles };
      }, { floor, tilt });
      fs.writeFileSync(path.join(output, `${name}.png`), Buffer.from(result.image.split(',')[1], 'base64'));
      records.push({ name, floor, tilt, version, calls: result.calls, triangles: result.triangles });
    }
    for (const [name, tilt] of [['top', { x: 0, z: 0 }], ['tilted-left', { x: .35, z: -.35 }], ['tilted-right', { x: -.35, z: .35 }]])
      await capture(name, 0, tilt);
    if (!process.env.BASELINE) {
      await page.evaluate(() => {
        const g = window.__toukan.game;
        for (const group of g.floorGroups) group.traverse(m => {
          if (m.isLineSegments) throw Error('Wireframe outline remains');
          if (m.userData.surface === 'walls' || g.doors.some(d => d.mesh === m)) {
            const [side, top] = m.material;
            if (side.transmission !== .95 || top.opacity !== .65 ||
                top.roughness !== .05 || top.clearcoat !== 1) throw Error('Plastic materials incorrect');
            if (m.geometry.groups.length !== 2) throw Error('Top and side ranges missing');
          }
        });
        if (!g.ribAccents.length) throw Error('Contact shadows missing');
      });
      // The same body and edge must move together when a door opens and in replay.
      await page.evaluate(() => {
        const g = window.__toukan.game;
        g.elapsed = 5;
        g.step(1 / 60);
        if (!g.doors.every(d => d.open && Math.abs(d.mesh.position.y - d.y - 1.55) < 1e-6))
          throw Error('Door opening changed');
      });
      await capture('door-open', 0, { x: .35, z: -.35 });
      await page.evaluate(stage => window.__toukan.game.load(stage), original);
      // A comb, T/cross junctions and a loop, with independent wall segments.
      await page.evaluate(() => {
        const g = window.__toukan.game, stage = structuredClone(g.stage);
        const f = stage.floors[0];
        f.walls = f.walls.filter(w => w.axis === 'h' ? w.z === 0 || w.z === 11 : w.x === 0 || w.x === 8);
        f.walls.push(...[1, 2, 3, 4, 5, 6].map(x => ({ axis: 'h', x, z: 3 })),
          ...[1, 3, 5, 7].map(x => ({ axis: 'v', x, z: 2 })),
          { axis: 'v', x: 3, z: 3 },
          ...[4, 6].flatMap(z => [2, 3, 4].map(x => ({ axis: 'h', x, z }))),
          ...[2, 5].flatMap(x => [4, 5].map(z => ({ axis: 'v', x, z }))),
          { axis: 'h', x: 1, z: 8 }, { axis: 'v', x: 6, z: 8 });
        f.cells.push(...[0, 1, 2, 3].map((rotation, i) =>
          ({ x: 1 + i * 2, z: 9, type: 'corner', rotation })),
          { x: 6, z: 7, type: 'door', rotation: 1 });
        g.load(stage);
        for (const d of g.doors) {
          if (!Array.isArray(d.mesh.material) || d.mesh.children.some(c => c.isLineSegments))
            throw Error('Door plastic material missing');
        }
      });
      await capture('junctions-top', 0, { x: 0, z: 0 });
      await capture('junctions-tilted', 0, { x: -.4, z: .4 });
      await page.evaluate(stage => window.__toukan.game.load(stage), original);
      for (const floor of [1, 2]) await capture(`floor-${floor + 1}`, floor, { x: .3, z: -.3 });
      await page.evaluate(() => {
        const g = window.__toukan.game, stage = structuredClone(g.stage);
        stage.floors[1].dark = true;
        g.load(stage);
      });
      await capture('dark-floor', 1, { x: -.3, z: .3 });
      await page.evaluate(stage => window.__toukan.game.load(stage), original);
      await page.setViewportSize({ width: 844, height: 390 });
      await page.evaluate(() => window.__toukan.game.resize());
      await capture('landscape', 0, { x: -.35, z: .35 });
    }
    fs.writeFileSync(path.join(output, 'captures.json'), JSON.stringify(records, null, 2));
    assert.deepEqual(errors, []);
    console.log(`PASS: ${version}, ${records.length} real WebGL captures at ${output}`);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });

