const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
  const browser = await chromium.launch({ headless: true,
    executablePath: process.env.CHROMIUM_PATH,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 },
      isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.addInitScript(() => { window.requestAnimationFrame = () => 0; });
    await page.goto(process.env.TEST_URL || 'http://127.0.0.1:8000');
    await page.waitForFunction(() => window.__toukan?.game.ready, {}, { polling: 100 });
    await page.evaluate(() => {
      const g = window.__toukan.game, stage = structuredClone(g.stage);
      stage.floors[0].cells.push({ type: 'door', x: 2, z: 2 },
        ...[0, 1, 2, 3].map((rotation, x) => ({ type: 'corner', x, z: 4, rotation })));
      g.load(stage);
      document.querySelector('#start-panel').hidden = true;
      g.state = 'playing';
      g.loop(performance.now());
    });
    await page.locator('#wall-controls summary').click();
    assert.equal(await page.locator('#wall-controls input[type=range]').count(), 9);
    for (const [key, expected] of Object.entries({ clearcoat: 1, clearcoatRoughness: .05,
      attenuationDistance: .5, specularIntensity: 1, metalness: 0 })) {
      assert.equal(await page.locator(`#wall-${key}`).inputValue(), String(expected));
    }
    // Native vertical touch scrolling must reach the added controls on a phone.
    const cdp = await page.context().newCDPSession(page);
    const fieldsBox = await page.locator('.wall-fields').boundingBox();
    const touchX = fieldsBox.x + fieldsBox.width - 4, touchY = fieldsBox.y + fieldsBox.height - 40;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: touchX, y: touchY }] });
    for (let offset = 20; offset <= 160; offset += 20) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: touchX, y: touchY - offset }] });
      await page.waitForTimeout(20);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForFunction(() => document.querySelector('.wall-fields').scrollTop > 0);
    for (const [key, min, max] of [['transmission', 0, 1], ['roughness', 0, .6],
      ['ior', 1, 1.6], ['envMapIntensity', 0, 5],
      ['clearcoat', 0, 1], ['clearcoatRoughness', 0, .5], ['attenuationDistance', .01, 5],
      ['specularIntensity', 0, 2], ['metalness', 0, .3]]) {
      for (const value of [min, max]) {
        await page.locator(`#wall-${key}`).evaluate((input, value) => {
          input.value = value; input.dispatchEvent(new Event('input', { bubbles: true }));
        }, value);
        await page.evaluate(({ key, value }) => {
          const g = window.__toukan.game;
          for (const group of g.floorGroups) group.traverse(m => {
            if (m.userData.surface === 'walls' || g.doors.some(d => d.mesh === m)) {
              if (m.children.length || Array.isArray(m.material) || m.material.transparent || m.material.opacity !== 1)
                throw Error('Wall is not a single transmission mesh');
              if (m.material[key] !== value) throw Error('Wall value mismatch');
              if (Object.hasOwn(m.material, 'onBeforeCompile') || m.material.emissive.getHex() !== 0)
                throw Error('Custom wall highlight or emission remains');
            }
          });
          g.loop(performance.now());
        }, { key, value });
        assert.equal(await page.locator(`output[for=wall-${key}]`).textContent(), value.toFixed(2));
      }
    }
    // Real pointer drag and keyboard input must not tilt or jump the board.
    const before = await page.evaluate(() => ({ ...window.__toukan.game.target }));
    await page.locator('#wall-transmission').scrollIntoViewIfNeeded();
    const slider = page.locator('#wall-transmission'), box = await slider.boundingBox();
    await page.mouse.move(box.x + 5, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * .8, box.y + box.height / 2, { steps: 4 });
    await page.mouse.up();
    await slider.focus(); await page.keyboard.press('ArrowLeft');
    assert.deepEqual(await page.evaluate(() => ({ ...window.__toukan.game.target })), before);
    assert.equal(await page.evaluate(() => window.__toukan.game.pointers.size), 0);
    await page.evaluate(() => {
      const g = window.__toukan.game, settings = { ...g.wallSettings };
      g.load(structuredClone(g.stage));
      for (const material of g.wallMaterials)
        for (const key of ['transmission', 'roughness', 'ior', 'envMapIntensity',
          'clearcoat', 'clearcoatRoughness', 'attenuationDistance', 'specularIntensity', 'metalness'])
          if (material[key] !== settings[key]) throw Error('Settings lost after reload');
      for (const [key, value] of Object.entries({ transmission: .88, roughness: .12, ior: 1.5, envMapIntensity: 3, clearcoat: 1, clearcoatRoughness: .05, attenuationDistance: .5, specularIntensity: 1, metalness: 0 })) {
        const input = document.querySelector('#wall-' + key);
        input.value = value; input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      g.tilt = { x: .35, z: -.35 }; g.loop(performance.now());
      document.querySelector('#start-panel').hidden = true;
    });
    fs.mkdirSync('/workspace/ball-captures/sliders', { recursive: true });
    await page.screenshot({ path: '/workspace/ball-captures/sliders/panel.png' });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
    assert.deepEqual(errors, []);
    console.log('PASS: all nine PBR sliders, endpoints, wall/door/corner updates, reload, pointer and keyboard isolation');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
