import test from 'node:test';
import assert from 'node:assert/strict';
import { MotionInertia } from '../src/motion-inertia.js';
test('horizontal translation leaves marbles behind in all screen orientations', () => {
  for (const [angle, x, y] of [[0, 4, 0], [90, 0, 4], [180, -4, 0], [270, 0, -4]]) {
    const motion = new MotionInertia();
    motion.sample({ x, y }, angle, 100);
    assert.ok(motion.read(100).x < -12);
    assert.ok(Math.abs(motion.read(100).z) < 1e-10);
  }
  const motion = new MotionInertia();
  motion.sample({ x: 0, y: 4 }, 0, 100);
  assert.ok(motion.read(100).z > 12);
});
test('noise, missing data, expiry and reset cannot leave residual acceleration', () => {
  const m = new MotionInertia();
  m.sample({x: .03, y: -.04}, 0, 0);
  assert.equal(Math.hypot(...Object.values(m.read(0))), 0);
  m.sample({x: 10, y: 0}, 0, 0);
  assert.deepEqual(m.read(151), {x: 0, z: 0});
  for (const a of [null, {x: null, y: 1}, {x: NaN, y: 1}]) {
    m.sample(a, 0, 0);
    assert.deepEqual(m.read(0), {x: 0, z: 0});
  }
  m.sample({x: 1000, y: 1000}, 0, 0);
  assert.ok(Math.hypot(...Object.values(m.read(0))) <= 35 * 32 / 9.80665 + 1e-9);
  m.reset();
  assert.deepEqual(m.read(0), {x: 0, z: 0});
});
