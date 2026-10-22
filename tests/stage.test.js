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
