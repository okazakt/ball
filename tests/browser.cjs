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
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' }),
      page = await context.newPage();
    // Pair LOGIC_ONLY with tests/walls-browser.cjs on software-rendered CI.
    // Keep the real animation/input/physics loop, but avoid continuously
    // drawing WebGL between assertions; visual captures run separately.
    if (process.env.LOGIC_ONLY) await page.addInitScript(() => {
      window.__testNativeRaf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = () => 0;
    });
    const waitForFunction = page.waitForFunction.bind(page);
    page.waitForFunction = (fn, arg, options) => waitForFunction(fn, arg, { polling: 100, ...options });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(process.env.TEST_URL || 'http://localhost:8000');
    await page.waitForFunction(() => window.__toukan?.game.ready, {}, { timeout: 30000 });
    console.log('PASS: application startup');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
    assert.equal(await page.evaluate(() => window.__toukan.game.state), 'ready');
    await page.evaluate(async () => {
      const g = window.__toukan.game;
      const area = geometry => {
        const p = geometry.attributes.position, n = geometry.attributes.normal;
        let total = 0;
        for (let i = 0; i < p.count; i += 3) if (n.getY(i) > 0.9)
          total += Math.abs((p.getX(i + 1) - p.getX(i)) * (p.getZ(i + 2) - p.getZ(i)) -
            (p.getX(i + 2) - p.getX(i)) * (p.getZ(i + 1) - p.getZ(i))) / 2;
        return total;
      };
      const floor = g.floorGroups[0].children.find(m => m.userData.surface === 'floor');
      const walls = g.floorGroups[0].children.find(m => m.userData.surface === 'walls');
      if (Math.abs(area(floor.geometry) - 87) > 0.001 || !floor.material.map || floor.material.transparent || floor.material.opacity !== 1)
        throw Error('Seamless wallpaper floor or floor hole missing');
      const side = walls.material;
      const edges = walls.children.find(m => m.userData.surface === 'rib-edges');
      walls.geometry.computeBoundingBox();
      if (area(walls.geometry) < 0.5 || area(walls.geometry) > 12 || side.transmission > 0 ||
          !side.transparent || side.opacity > 0.3 || side.depthWrite ||
          !edges?.isLineSegments || !edges.material.depthTest ||
          Math.abs(walls.geometry.boundingBox.max.y - 1) > 1e-6)
        throw Error('Simple transparent wall or outline is incorrect');
      if (!g.scene.environment?.isTexture || !g.environmentTarget?.texture.isRenderTargetTexture)
        throw Error('PMREM studio environment missing');
      for (const geometry of [walls.geometry, edges.geometry]) {
        if (![...geometry.attributes.position.array].every(Number.isFinite))
          throw Error('Wall contains invalid vertices');
      }
      edges.geometry.computeBoundingBox();
      if (!walls.geometry.boundingBox.min.equals(edges.geometry.boundingBox.min) ||
          !walls.geometry.boundingBox.max.equals(edges.geometry.boundingBox.max))
        throw Error('Wall outlines do not match the body');
      const frame = g.floorGroups[0].children.find(m => m.userData.surface === 'frame');
      if (!frame || frame.material.transparent || frame.material.transmission !== 0 ||
          frame.material.color.getHex() !== 0x269c67) throw Error('Opaque green plastic frame missing');
      if (!g.floorGroups[0].children.some(m => m.userData.surface === 'start' && m.material.color.getHex() === 0x176bff) ||
          !g.floorGroups[2].children.some(m => m.userData.surface === 'goal' && m.material.color.getHex() === 0xef334b))
        throw Error('Start and goal tile colors are incorrect');
      const { solidGeometry, ribGeometry } = await import(new URL('./src/case-visuals.js', location.href).href);
      for (const rectangles of [
        [[0, 0, 100, 100], [100, 0, 200, 100]],
        [[0, 0, 100, 100], [100, 100, 200, 200]],
      ]) {
        const geometry = solidGeometry(rectangles, 1);
        if (Math.abs(area(geometry) - 2) > 0.001) throw Error('Footprint union failed');
        geometry.dispose();
      }
      const junction = ribGeometry([
        [-50, -4.4, 50, 4.4], [-4.4, -4.4, 4.4, 50],
      ]);
      const mesh = new THREE.Mesh(junction, walls.material);
      const ray = new THREE.Raycaster(new THREE.Vector3(0.013, 2, 0.017), new THREE.Vector3(0, -1, 0));
      const tops = ray.intersectObject(mesh).filter(hit => hit.face.normal.y > 0.35);
      if (junction.groups.length !== 1 || tops.length !== 1 || Math.abs(tops[0].point.y - 1) > 1e-6)
        throw Error('Rib junction has a gap or overlapping top faces');
      junction.dispose();
    });
    console.log('PASS: wall geometry and outlines');
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
              const p = new T.Vector3(sx * 4.1, -floor * 3 + 1.07, sz * 5.6).project(g.camera);
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
      });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => {
      const g = window.__toukan.game, original = g.stage;
      const perimeter = original.floors[0].walls.filter(w =>
        w.axis === 'h' ? w.z === 0 || w.z === 11 : w.x === 0 || w.x === 8);
      const corridor = [5, 6].flatMap(z => Array.from({ length: 8 }, (_, x) => ({ axis: 'h', x, z })));
      for (const [size, radius] of [['S', 0.35], ['M', 0.4], ['L', 0.45]]) {
        g.load({ ...original, size, balls: [{ x: 4, z: 5 }],
          floors: [{ dark: false, cells: [], walls: [...perimeter, ...corridor] }] }, false);
        const b = g.balls[0], start = b.body.translation().x;
        if (b.radius !== radius || Math.abs(b.collider.radius() - radius) > 1e-6)
          throw Error('Ball dimensions do not match');
        g.keys.add('ArrowRight');
        for (let i = 0; i < 30; i++) g.step(1 / 60);
        if (b.body.translation().x - start < 0.5) throw Error(`${size} cannot pass a one-cell corridor`);
        g.keys.clear();
        g.tilt = g.target = { x: 0, z: 0 };
        b.body.setTranslation({ x: 0.5, y: radius + 0.01, z: 0 }, true);
        b.body.setLinvel({ x: 0, y: 6, z: 0 }, true);
        let bounced = false;
        for (let i = 0; i < 8; i++) {
          g.step(1 / 60);
          if (b.body.translation().y + radius > 1.015) throw Error(`Ball passed through ceiling: ${size} frame ${i}, top ${b.body.translation().y + radius}, vy ${b.body.linvel().y}`);
          if (b.body.linvel().y < 0) bounced = true;
        }
        if (!bounced) throw Error('Ceiling rebound missing');
      }
      g.load({ ...original, size: 'L', balls: [{ x: 4, z: 5 }],
        floors: Array.from({ length: 3 }, () => ({ dark: false, cells: [], walls: perimeter })) }, false);
      for (const fi of [1, 2]) {
        const b = g.balls[0];
        b.floor = fi;
        b.collider.setCollisionGroups((1 << 16) | 1 | (1 << (fi + 1)));
        b.body.setTranslation({ x: 0.5, y: -fi * 3 + 0.46, z: 0 }, true);
        b.body.setLinvel({ x: 0, y: 6, z: 0 }, true);
        for (let i = 0; i < 6; i++) {
          g.step(1 / 60);
          if (b.body.translation().y + b.radius > -fi * 3 + 1.015)
            throw Error('Lower-floor ceiling collision missing');
        }
      }
      g.load(original);
    });
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
      // Measure the material's normal restitution without simultaneous floor
      // friction/rolling impulses, which also change the horizontal velocity.
      b.body.setTranslation({ x: 3, y: 0.5, z: 0 }, true);
      b.body.setLinvel({ x: 4, y: 0, z: 0 }, true);
      b.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      g.world.gravity = { x: 0, y: 0, z: 0 };
      g.world.timestep = 1 / 240;
      let rebound = 0;
      for (let i = 0; i < 160; i++) {
        const incoming = b.body.linvel().x;
        g.world.step(g.queue);
        if (b.body.linvel().x < 0) {
          rebound = -b.body.linvel().x / incoming;
          break;
        }
      }
      // Rapier's speculative contacts soften the measured velocity ratio;
      // check both the configured coefficient and a substantial real rebound.
      if (b.collider.restitution() < 0.6 || rebound < 0.4 || rebound > 0.8)
        throw Error(`Unexpected wall restitution: ${rebound}`);
      g.load(original);
    });
    console.log('PASS: projection, physics clearance, ceiling collisions and rebound');
    await page.waitForTimeout(700);
    assert.equal(await page.evaluate(() => window.__toukan.game.elapsed), 0);
    if (process.env.LOGIC_ONLY) await page.evaluate(() => {
      const g = window.__toukan.game;
      g.renderer.clear = () => {};
      g.renderer.render = () => {};
      g.last = performance.now();
      window.requestAnimationFrame = window.__testNativeRaf;
      g.loop(performance.now());
    });
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
    await page.waitForFunction(async () =>
      (await window.__toukan.store.listStages()).filter(s => s.favorite).length === 1);
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
    // A fresh context exercises service-worker activation/reload separately
    // from the geometry, physics and editor assertions above.
    const offlineContext = await browser.newContext();
    const offlinePage = await offlineContext.newPage();
    offlinePage.on('pageerror', e => errors.push(e.message));
    await offlinePage.addInitScript(() => { window.requestAnimationFrame = () => 0; });
    await offlinePage.goto(process.env.TEST_URL || 'http://localhost:8000');
    await offlinePage.waitForFunction(() => navigator.serviceWorker.controller && window.__toukan?.game.ready,
      undefined, { polling: 100 });
    await offlinePage.waitForLoadState('networkidle');
    await offlineContext.setOffline(true);
    await offlinePage.reload();
    await offlinePage.waitForFunction(() => window.__toukan?.game.ready, undefined, { polling: 100 });
    await offlineContext.close();
    assert.deepEqual(errors, []);
    console.log(
      'PASS: straight floor/walls, start/goal colors, S/M/L corridor clearance, ceiling collisions, pinned lid, parallax, tilt response, wall rebound, rendering, input, physics hole, NG replay, goals, favorites, QR, editor conflict/undo/redo, offline startup'
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
