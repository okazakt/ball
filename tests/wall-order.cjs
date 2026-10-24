const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const settings = { edgeWidth: .34, edgeBrightness: 3.82, sideGloss: 2.26, bottomEdge: .91,
  centerOpacity: .34, taperAngle: .39, cornerRadius: .88, lightAngle: 0,
  specularSharpness: 10.58, resinTint: .61, topFusion: .51, wallThickness: 2,
  bottomFusion: .89, resinDensity: .91 };
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
      localStorage.setItem('toukan.wall-settings', JSON.stringify(settings));
    }, settings);
    await page.goto('http://127.0.0.1:8000');
    await page.waitForFunction(() => window.__toukan?.game.ready, {}, { polling: 100 });
    await page.evaluate(() => {
      const g = window.__toukan.game, T = window.THREE;
      for (const tilt of [{ x: -.32, z: .2004841514179193 }, { x: .32, z: -.32 }, { x: 0, z: 0 }]) {
        g.tilt = tilt; g.setLighting();
        if (g.camera.getWorldDirection(new T.Vector3()).dot(new T.Vector3(0, -1, 0)) < .999999)
          throw Error('Height ordering requires the optical axis to remain perpendicular');
      }
      g.tilt = { x: -.32, z: .2004841514179193 };
      document.querySelector('#start-panel').hidden = true;
      g.renderScene();
      window.orderWalls = [];
      g.board.traverse(mesh => {
        if (mesh.isMesh && g.wallMaterials.has(mesh.material)) {
          if (!mesh.material.depthTest || mesh.material.depthWrite || mesh.renderOrder !== 0)
            throw Error('Must retain ordinary depth tests and transparent object ordering');
          window.orderWalls.push({ mesh, position: mesh.geometry.attributes.position.array.slice(),
            normal: mesh.geometry.attributes.normal.array.slice(), material: mesh.material.uuid });
        }
      });
      const gl = g.renderer.getContext();
      window.orderPixels = () => {
        const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
        gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        return pixels;
      };
      window.sortedWallPixels = window.orderPixels();
    });
    fs.mkdirSync('/workspace/ball-captures/v1.4.4', { recursive: true });
    await page.screenshot({ path: '/workspace/ball-captures/v1.4.4/user-settings.png' });
    const result = await page.evaluate(() => {
      const g = window.__toukan.game, T = window.THREE;
      // Restore only the old/native face order; every position and shader stays identical.
      for (const { mesh } of window.orderWalls)
        mesh.geometry.setIndex(Array.from({ length: mesh.geometry.attributes.position.count }, (_, i) => i));
      g.renderScene();
      const old = window.orderPixels(), sorted = window.sortedWallPixels;
      const gl = g.renderer.getContext(), width = gl.drawingBufferWidth, height = gl.drawingBufferHeight;
      const ray = new T.Raycaster(); ray.layers.set(1);
      const currentWalls = window.orderWalls.map(entry => entry.mesh).filter(mesh => mesh.layers.mask & 2);
      let changedPixels = 0, nearerRoofBrighterPixels = 0;
      for (let i = 0; i < old.length; i += 4) {
        const difference = Math.abs(old[i] - sorted[i]) + Math.abs(old[i + 1] - sorted[i + 1]) + Math.abs(old[i + 2] - sorted[i + 2]);
        if (difference <= 6) continue;
        changedPixels++;
        if (nearerRoofBrighterPixels >= 100 || (i / 4) % 3 !== 0) continue;
        const brightening = (sorted[i] + sorted[i + 1] + sorted[i + 2] - old[i] - old[i + 1] - old[i + 2]) / 3;
        if (brightening < 8) continue;
        const pixel = i / 4, x = pixel % width, y = Math.floor(pixel / width);
        ray.setFromCamera(new T.Vector2((x + .5) / width * 2 - 1, (y + .5) / height * 2 - 1), g.camera);
        const hit = ray.intersectObjects(currentWalls, false)[0];
        if (hit?.point.y > .985 && hit.face.normal.y > .8) nearerRoofBrighterPixels++;
      }
      for (const { mesh, position, normal, material } of window.orderWalls) {
        if (mesh.material.uuid !== material) throw Error('Wall material changed');
        if (!mesh.geometry.attributes.position.array.every((v, i) => v === position[i]) ||
            !mesh.geometry.attributes.normal.array.every((v, i) => v === normal[i])) throw Error('Wall shape/normals changed');
      }
      return { changedPixels, nearerRoofBrighterPixels };
    });
    await page.screenshot({ path: '/workspace/ball-captures/v1.4.4/native-face-order.png' });
    assert.ok(result.changedPixels > 100, 'Face ordering must affect overlapping transparent surfaces');
    assert.ok(result.nearerRoofBrighterPixels > 10, 'A nearer roof edge must remain visible over farther side faces');
    await page.evaluate(async () => {
      const { orderWallFacesByHeight } = await import('./src/case-visuals.js');
      const g = window.__toukan.game;
      for (const { mesh } of window.orderWalls) orderWallFacesByHeight(mesh.geometry);
      g.renderScene();
      const restored = window.orderPixels();
      if (!restored.every((v, i) => v === window.sortedWallPixels[i])) throw Error('Restored index order must reproduce the exact framebuffer');
      g.load(structuredClone(g.stage));
      g.board.traverse(mesh => {
        if (mesh.userData.wallGeometryFactory && mesh.geometry.userData.wallTriangleOrder !== 'bottom-to-top')
          throw Error('Wall rebuild lost triangle ordering');
      });
    });
    assert.deepEqual(await page.evaluate(() => window.__toukan.game.wallSettings), settings);
    assert.deepEqual(errors, []);
    console.log('PASS: nearer roof edges survive side-face overlap, geometry/material/settings unchanged, stable depth axis and rebuild order:', JSON.stringify(result));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
