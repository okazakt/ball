import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultStage, validateStage, encodeStage, decodeStage, floor } from '../src/stage.js';
import * as storage from '../src/storage.js';
test('default quest is valid and Unicode survives sharing', () => {
  const s = defaultStage();
  s.name = '透環 🟢 光の迷路';
  const decoded = decodeStage('https://example.test/ball/#stage=' + encodeStage(s));
  assert.equal(decoded.name, s.name);
  assert.equal(encodeStage(decoded), encodeStage(s));
  assert.ok(encodeStage(s).length < 2200);
});
test('untrusted shared stages reject invalid coordinates, overlaps and bounds', () => {
  for (const mutate of [
    (s) => (s.balls[0].x = -1),
    (s) => s.floors[0].walls.push({ ...s.floors[0].walls[0] }),
    (s) => s.floors[0].cells.push({ x: 4, z: 7, type: 'goal' }),
    (s) => s.floors[2].cells.push({ x: 0, z: 0, type: 'hole' }),
    (s) => (s.limit = Infinity),
    (s) => (s.size = 'XL'),
    (s) => (s.floors[0].cells[0].type = 'script'),
  ]) {
    const s = defaultStage();
    mutate(s);
    assert.throws(() => validateStage(s));
  }
  assert.throws(() => decodeStage('x'.repeat(60001)));
});
test('sticky floor and door may coexist; duplicate floor items may not', () => {
  const s = defaultStage();
  s.floors[1].cells.push({ x: 2, z: 4, type: 'door' });
  assert.doesNotThrow(() => validateStage(s));
  s.floors[1].cells.push({ x: 2, z: 4, type: 'sticky' });
  assert.throws(() => validateStage(s));
});
test('stage must contain a goal and unique ball starts', () => {
  const s = defaultStage();
  s.floors = [floor()];
  assert.throws(() => validateStage(s));
  s.floors[0].cells.push({ x: 3, z: 8, type: 'goal' });
  s.balls[1] = { ...s.balls[0] };
  assert.throws(() => validateStage(s));
});
test('storage rotates 50 recent stages while protecting favorites', async () => {
  await storage.openStorage();
  for (let i = 0; i < 55; i++) {
    const s = defaultStage();
    s.name = 'Stage ' + i;
    await storage.saveStage(s, i === 0);
  }
  let items = await storage.listStages();
  assert.equal(items.filter((s) => !s.favorite).length, 50);
  assert.equal(items.filter((s) => s.favorite).length, 1);
  const fav = items.find((s) => s.favorite);
  await storage.saveStage(fav.stage);
  items = await storage.listStages();
  assert.equal(items.find((s) => s.id === fav.id).favorite, true);
  await storage.removeStage(fav.id);
  assert.equal(
    (await storage.listStages()).some((s) => s.id === fav.id),
    false
  );
});

test('quest begins with one ball, no enemies, bright floors and expanded bounds', () => {
  const s = defaultStage();
  assert.equal(s.balls.length, 1);
  assert.ok(s.floors.every((f) => !f.dark));
  assert.ok(s.floors.every((f) => !f.cells.some((c) => ['robot', 'spider', 'slime'].includes(c.type))));
  s.floors[2].cells.push({ x: 7, z: 10, type: 'goal' });
  assert.doesNotThrow(() => validateStage(s));
  s.floors[2].cells.push({ x: 8, z: 10, type: 'goal' });
  assert.throws(() => validateStage(s));
});

test('initial B1 matches the reference layout without changing later floors', () => {
  const s = validateStage(defaultStage()), f = s.floors[0];
  const interior = f.walls.filter(w => w.axis === 'h' ? w.z > 0 && w.z < 11 : w.x > 0 && w.x < 8)
    .map(w => `${w.axis}:${w.x}:${w.z}`).sort();
  assert.deepEqual(interior, [
    'h:0:3', 'h:1:3', 'h:2:3', 'h:4:3', 'h:5:3', 'h:7:3',
    'h:1:6', 'h:2:6', 'h:3:6', 'h:4:6',
    'h:5:1', 'h:6:1', 'h:7:1', 'h:4:2', 'h:6:2', 'h:7:2', 'h:5:4', 'h:6:4',
    'v:2:0', 'v:3:0', 'v:4:0', 'v:5:2', 'v:7:2', 'v:5:4',
  ].sort());
  assert.deepEqual(s.balls, [{ x: 1, z: 1 }]);
  assert.deepEqual(f.cells, [
    { x: 4, z: 7, type: 'hole' }, { x: 1, z: 4, type: 'sticky' },
    { x: 3, z: 3, type: 'door', rotation: 0 }, { x: 2, z: 2, type: 'switch' },
  ]);
  assert.equal(s.floors.length, 3);
});
