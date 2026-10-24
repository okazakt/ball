const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.addInitScript(() => { window.requestAnimationFrame = () => 0; });
    await page.goto('http://127.0.0.1:8000');
    await page.waitForFunction(() => window.__toukan?.game.ready, {}, { polling: 100 });
    await page.evaluate(() => {
      for (const [key, value] of [['bottomFusion', .73], ['wallThickness', 1.34]]) {
        const input = document.querySelector('#wall-' + key);
        input.value = value; input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    const saved = await page.evaluate(() => ({ ...window.__toukan.game.wallSettings }));
    await page.reload();
    await page.waitForFunction(() => window.__toukan?.game.ready, {}, { polling: 100 });
    assert.deepEqual(await page.evaluate(() => window.__toukan.game.wallSettings), saved);
    await page.evaluate(saved => {
      const g = window.__toukan.game;
      for (const [key, value] of Object.entries(saved)) {
        const input = document.querySelector('#wall-' + key);
        if (Number(input.value) !== value || document.querySelector(`output[for=wall-${key}]`).value !== value.toFixed(2)) throw Error('UI restore failed: ' + key);
        for (const material of g.wallMaterials)
          if (material.userData.wallUniforms[key].value !== value) throw Error('Material restore failed: ' + key);
      }
      if (![...g.wallMaterials].every(m => m.userData.wallShapeThickness.value === 1.34)) throw Error('Geometry restore failed');
      g.state = 'ready'; g.renderScene();
      document.querySelector('#start-panel').hidden = true;
    }, saved);
    fs.mkdirSync('/workspace/ball-captures/v1.4.0', { recursive: true });
    await page.screenshot({ path: '/workspace/ball-captures/v1.4.0/top.png' });
    await page.evaluate(() => { const g = window.__toukan.game; g.tilt = { x: .35, z: -.35 }; g.renderScene(); });
    await page.screenshot({ path: '/workspace/ball-captures/v1.4.0/tilted.png' });
    assert.deepEqual(errors, []);
    console.log('PASS: all 14 values, UI, materials and wall geometry survive page reload; initial course renders without errors');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
