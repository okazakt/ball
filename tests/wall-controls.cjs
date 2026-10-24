const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 },
      isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.addInitScript(() => { window.requestAnimationFrame = () => 0; });
    await page.goto(process.env.TEST_URL || 'http://127.0.0.1:8000');
    await page.waitForFunction(() => window.__toukan?.game.ready, {}, { polling: 100 });
    await page.evaluate(async () => {
      const { solidGeometry, prepareClearWall } = await import(new URL('./src/case-visuals.js', location.href));
      const arms = [[-103.8, -3.8, 3.8, 3.8], [-3.8, -3.8, 103.8, 3.8],
        [-3.8, -103.8, 3.8, 3.8], [-3.8, -3.8, 3.8, 103.8]];
      for (const mask of [3, 5, 7, 15]) {
        const geometry = solidGeometry(arms.filter((_, i) => mask & (1 << i)), 1,
          { bevel: .004, bevelOffset: -.004, bevelSegments: 5, fillet: .038 });
        const texture = prepareClearWall(geometry), { min, max } = geometry.boundingBox;
        const { data, width, height } = texture.image;
        const x = Math.floor((0 - min.x + .02) / (max.x - min.x + .04) * width);
        const y = Math.floor((0 - min.z + .02) / (max.z - min.z + .04) * height);
        if (data[(y * width + x) * 4] / 255 * .06 < .015)
          throw Error('Internal junction seam entered the edge field');
        const outward = geometry.attributes.wallOutward.array;
        if (![...outward].every(Number.isFinite)) throw Error('Invalid taper direction');
        geometry.dispose(); texture.dispose();
      }
    });
    await page.evaluate(() => {
      const g = window.__toukan.game, stage = structuredClone(g.stage);
      stage.floors[0].cells.push({ type: 'door', x: 2, z: 2 },
        ...[0, 1, 2, 3].map((rotation, x) => ({ type: 'corner', x, z: 4, rotation })));
      g.load(stage); g.state = 'playing';
      document.querySelector('#start-panel').hidden = true;
      g.loop(performance.now());
      window.wallUnchanged = [];
      for (const group of g.floorGroups) for (const m of group.children)
        if (['floor', 'frame'].includes(m.userData.surface))
          window.wallUnchanged.push([m, m.geometry.uuid, m.material.uuid, m.material.color.getHex()]);
    });
    await page.locator('#wall-controls summary').click();
    assert.equal(await page.locator('#wall-controls input[type=range]').count(), 5);
    assert.equal(await page.locator('#wall-centerOpacity').inputValue(), '0.02');
    for (const [key, min, max] of [['edgeWidth', 0, 2], ['edgeBrightness', 0, 5],
      ['sideGloss', 0, 3], ['centerOpacity', 0, .5], ['taperAngle', 0, 1]]) {
      for (const value of [min, max]) {
        await page.locator(`#wall-${key}`).evaluate((input, value) => {
          input.value = value; input.dispatchEvent(new Event('input', { bubbles: true }));
        }, value);
        await page.evaluate(({ key, value }) => {
          const g = window.__toukan.game;
          for (const group of g.floorGroups) group.traverse(m => {
            if (m.userData.surface === 'walls' || g.doors.some(d => d.mesh === m)) {
              if (m.children.length || Array.isArray(m.material) || !m.material.transparent || m.material.depthWrite)
                throw Error('Extra wall parts or opaque material remain');
              if (m.material.userData.wallUniforms[key].value !== value) throw Error('Uniform mismatch');
              if (!m.geometry.attributes.wallOutward || !m.material.alphaMap) throw Error('Molded wall data missing');
            }
          });
          for (const [m, geo, mat, color] of window.wallUnchanged)
            if (m.geometry.uuid !== geo || m.material.uuid !== mat || m.material.color.getHex() !== color)
              throw Error('Floor or frame changed');
          g.loop(performance.now());
        }, { key, value });
        assert.equal(await page.locator(`output[for=wall-${key}]`).textContent(), value.toFixed(2));
      }
    }
    const slider = page.locator('#wall-edgeWidth');
    await slider.scrollIntoViewIfNeeded();
    const before = await page.evaluate(() => ({ ...window.__toukan.game.target }));
    const box = await slider.boundingBox();
    await page.mouse.move(box.x + 5, box.y + box.height / 2); await page.mouse.down();
    await page.mouse.move(box.x + box.width * .8, box.y + box.height / 2, { steps: 4 });
    await page.mouse.up(); await slider.focus(); await page.keyboard.press('ArrowLeft');
    assert.deepEqual(await page.evaluate(() => ({ ...window.__toukan.game.target })), before);
    assert.equal(await page.evaluate(() => window.__toukan.game.pointers.size), 0);
    // With reflection and opacity disabled, the framebuffer must exactly match
    // the same scene with the wall meshes hidden: no diffuse gray or darkening.
    await page.evaluate(() => {
      const g = window.__toukan.game, settings = { ...g.wallSettings };
      g.load(structuredClone(g.stage));
      for (const m of g.wallMaterials) for (const key of Object.keys(settings))
        if (m.userData.wallUniforms[key].value !== settings[key]) throw Error('Settings lost on reload');
      g.updateWallSettings({ edgeBrightness: 0, sideGloss: 0, centerOpacity: 0 });
      g.setLighting(); g.camera.updateMatrixWorld(true);
      const render = () => { g.renderer.clear(); g.renderer.render(g.scene, g.camera); return g.renderer.domElement.toDataURL(); };
      const clear = render(), wallMeshes = [];
      for (const group of g.floorGroups) group.traverse(m => {
        if (m.userData.surface === 'walls' || g.doors.some(d => d.mesh === m)) { wallMeshes.push(m); m.visible = false; }
      });
      if (render() !== clear) throw Error('Clear wall changes the background');
      wallMeshes.forEach(m => m.visible = true);
      const defaults = { edgeWidth: 1, edgeBrightness: 2.5, sideGloss: 1, centerOpacity: .02, taperAngle: .5 };
      for (const [key, value] of Object.entries(defaults)) {
        const input = document.querySelector('#wall-' + key); input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      g.tilt = { x: .35, z: -.35 }; g.loop(performance.now());
      document.querySelector('#start-panel').hidden = true;
    });
    fs.mkdirSync('/workspace/ball-captures/clear-molded', { recursive: true });
    await page.screenshot({ path: '/workspace/ball-captures/clear-molded/panel.png' });
    await page.locator('#wall-controls summary').click();
    await page.screenshot({ path: '/workspace/ball-captures/clear-molded/tilted.png' });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
    assert.deepEqual(errors, []);
    console.log('PASS: five sliders, exact clear-background match, all wall types, floor/frame preservation, reload and input isolation');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
