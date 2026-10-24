const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const settings = { edgeWidth: .34, edgeBrightness: 3.82, sideGloss: 2.26,
  bottomEdge: .91, centerOpacity: .34, taperAngle: .39, cornerRadius: .88,
  lightAngle: 0, specularSharpness: 10.58, resinTint: .87, topFusion: .51,
  wallThickness: 2, bottomFusion: .89, resinDensity: .91 };
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.addInitScript(settings => {
      window.requestAnimationFrame = () => 0;
      if (!localStorage.getItem('toukan.wall-settings')) localStorage.setItem('toukan.wall-settings', JSON.stringify(settings));
    }, settings);
    await page.goto('http://127.0.0.1:8000');
    await page.waitForFunction(() => window.__toukan?.game.ready, {}, { polling: 100 });
    assert.deepEqual(await page.evaluate(() => window.__toukan.game.wallSettings), settings);
    await page.evaluate(() => {
      const g = window.__toukan.game;
      g.tilt = { x: -.17054040891682087, z: .15146947724160983 };
      document.querySelector('#start-panel').hidden = true;
      g.renderScene();
    });
    fs.mkdirSync('/workspace/ball-captures/v1.4.3', { recursive: true });
    await page.screenshot({ path: '/workspace/ball-captures/v1.4.3/user-settings.png' });
    const result = await page.evaluate(() => {
      const g = window.__toukan.game, T = window.THREE;
      const originalStage = structuredClone(g.stage), originalSettings = { ...g.wallSettings };
      const stage = structuredClone(g.stage);
      stage.floors[0].walls = stage.floors[0].walls.filter(w => w.axis === 'h' ? w.z === 0 || w.z === 11 : w.x === 0 || w.x === 8);
      for (let x = 1; x <= 5; x++) stage.floors[0].walls.push({ axis: 'h', x, z: 6 });
      stage.floors[0].cells = [];
      g.load(stage, false);
      g.balls.forEach(b => { b.done = true; b.displayDone = true; });
      g.renderer.shadowMap.enabled = false;
      const unchanged = [];
      g.board.traverse(m => { if (['floor', 'frame'].includes(m.userData.surface)) unchanged.push([m, m.geometry.uuid, m.material.uuid]); });
      const floor = g.floorGroups[0].children.find(m => m.userData.surface === 'floor');
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, 128, 128);
      const map = new T.CanvasTexture(canvas); map.encoding = T.sRGBEncoding;
      map.minFilter = map.magFilter = T.LinearFilter; map.generateMipmaps = false;
      floor.material.map.dispose(); floor.material.map = map; floor.material.needsUpdate = true;
      g.updateWallSettings({ edgeBrightness: 0, sideGloss: 0, bottomEdge: 0, topFusion: 0, bottomFusion: 0, centerOpacity: .34, resinTint: .87 });
      const sample = (x = -1) => {
        const factor = g.wallSettings.wallThickness;
        const point = new T.Vector3(x, .5, .5 + .038 * factor - .0038 * g.wallSettings.taperAngle * factor * .5).project(g.camera);
        const gl = g.renderer.getContext(), pixels = new Uint8Array(4), sums = [0, 0, 0, 0];
        gl.readPixels(Math.floor((point.x * .5 + .5) * gl.drawingBufferWidth),
          Math.floor((point.y * .5 + .5) * gl.drawingBufferHeight), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        for (let i = 0; i < pixels.length; i++) sums[i % 4] += pixels[i];
        return sums;
      };
      const flat = [];
      for (const density of [0, 1]) { g.updateWallSettings({ resinDensity: density }); flat.push(sample()); }
      // On a transparent backdrop, changing tint must leave body opacity alone.
      g.updateWallSettings({ resinDensity: 0 }); g.setLighting();
      const hidden = [];
      g.scene.traverse(m => { if ((m.isMesh || m.isSprite) && m.visible && !g.wallMaterials.has(m.material)) { hidden.push(m); m.visible = false; } });
      const tint = [];
      for (const value of [0, 1]) {
        // updateWallSettings renders normally, so hide after updating to avoid setLighting restoring the lid reflection.
        g.updateWallSettings({ resinTint: value });
        hidden.forEach(m => { m.visible = false; });
        g.renderer.clear(); g.renderer.render(g.scene, g.camera); tint.push(sample());
      }
      const opacity = [];
      for (const value of [0, .5]) {
        g.updateWallSettings({ centerOpacity: value }); hidden.forEach(m => { m.visible = false; });
        g.renderer.clear(); g.renderer.render(g.scene, g.camera); opacity.push(sample()[3]);
      }
      hidden.forEach(m => { m.visible = true; });
      // A high-frequency background must actually lose contrast when density increases.
      for (let x = 0; x < 128; x++) for (let y = 0; y < 128; y++) {
        ctx.fillStyle = (Math.floor(x / 2) + Math.floor(y / 2)) % 2 ? '#eeeeee' : '#111111';
        ctx.fillRect(x, y, 1, 1);
      }
      map.needsUpdate = true;
      g.updateWallSettings({ centerOpacity: 0, resinTint: 0 });
      const contrast = [];
      for (const density of [0, 1]) {
        g.updateWallSettings({ resinDensity: density });
        const values = Array.from({ length: 256 }, (_, i) => sample(-2.5 + i * 4 / 255).slice(0, 3).reduce((a, b) => a + b, 0) / 3);
        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        contrast.push({ mean, deviation: Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length) });
      }
      for (const [m, geo, mat] of unchanged)
        if (m.geometry.uuid !== geo || m.material.uuid !== mat) throw Error('Density/tint altered floor or frame geometry/material');
      g.updateWallSettings(originalSettings); g.load(originalStage, false);
      g.renderer.shadowMap.enabled = true; g.renderScene();
      return { flat, tint, opacity, contrast };
    });
    console.log('Optical separation measurements:', JSON.stringify(result));
    for (let channel = 0; channel < 3; channel++)
      assert.ok(Math.abs(result.flat[0][channel] - result.flat[1][channel]) <= 2, 'Density must not whiten a uniform backdrop');
    assert.ok(Math.abs(result.tint[0][3] - result.tint[1][3]) <= 1, 'Tint must not increase body opacity');
    assert.ok(Math.abs(result.tint[0][0] - result.tint[1][0]) > 3, 'Tint must change color');
    assert.ok(Math.abs(result.tint[0][3] - .34 * 255) < 3, 'Body opacity must match centerOpacity');
    assert.ok(result.opacity[0] < 1 && Math.abs(result.opacity[1] - .5 * 255) < 3, 'Opacity slider must directly control body coverage');
    assert.ok(result.contrast[0].deviation > 10, 'Background fixture must contain visible detail');
    assert.ok(result.contrast[1].deviation < result.contrast[0].deviation * .85, 'Density must blur background detail');
    assert.ok(Math.abs(result.contrast[1].mean - result.contrast[0].mean) < 8, 'Diffusion must preserve background brightness');
    assert.deepEqual(await page.evaluate(() => window.__toukan.game.wallSettings), settings);
    assert.deepEqual(errors, []);
    console.log('PASS: density blurs without whitening, tint changes color without opacity, body opacity is independent, user tuning preserved');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
