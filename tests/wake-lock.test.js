import test from 'node:test';
import assert from 'node:assert/strict';
import { keepScreenAwake } from '../src/wake-lock.js';
const flush = () => new Promise(resolve => setImmediate(resolve));
test('screen lock is released in background and reacquired on return or after denial', async () => {
  const doc = new EventTarget(); doc.visibilityState = 'visible';
  let requests = 0, releases = 0, deny = false;
  const nav = { wakeLock: { async request(type) {
    assert.equal(type, 'screen'); requests++;
    if (deny) throw Error('low power');
    return { released: false, async release() { this.released = true; releases++; } };
  } } };
  keepScreenAwake(doc, nav); await flush(); assert.equal(requests, 1);
  doc.dispatchEvent(new Event('pointerdown')); await flush(); assert.equal(requests, 1);
  doc.visibilityState = 'hidden'; doc.dispatchEvent(new Event('visibilitychange'));
  await flush(); assert.equal(releases, 1);
  deny = true; doc.visibilityState = 'visible'; doc.dispatchEvent(new Event('visibilitychange'));
  await flush(); assert.equal(requests, 2);
  deny = false; doc.dispatchEvent(new Event('pointerdown')); await flush(); assert.equal(requests, 3);
});
test('unsupported browser can continue without a screen lock', () => {
  const doc = new EventTarget(); doc.visibilityState = 'visible';
  assert.doesNotThrow(() => keepScreenAwake(doc, {}));
});
