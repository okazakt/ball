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
    (s) => s.floors[1].cells.push({ x: 0, z: 0, type: 'hole' }),
    (s) => (s.limit = Infinity),
    (s) => (s.size = 'XL'),
    (s) => (s.size = 'L'),
    (s) => (s.floors[0].cells[0].type = 'script'),
  ]) {
    const s = defaultStage();
    mutate(s);
    assert.throws(() => validateStage(s));
  }
  assert.throws(() => decodeStage('x'.repeat(60001)));
});
test('one-cell lift doors reserve one upper/lower cell, require an open edge, and free the old parking cell',()=>{
  for(const layer of [0,1]){
    const s=defaultStage();s.floors[layer].cells.push({x:3,z:2,type:'sticky'});
    assert.throws(()=>validateStage(s),/可動域/);
    const w=defaultStage();w.floors[layer].walls.push({axis:'h',x:3,z:3});
    assert.throws(()=>validateStage(w),/固定壁/);
  }
  const s=defaultStage();s.floors[0].cells.push({x:4,z:3,type:'sticky'});
  assert.doesNotThrow(()=>validateStage(s));
  const lower=defaultStage();lower.floors[1].cells.push({x:6,z:5,type:'door'});
  assert.throws(()=>validateStage(lower),/上段/);
});
test('stage must contain a goal and unique ball starts', () => {
  const s = defaultStage();
  s.floors = [floor(), floor()];
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
  s.floors[0].cells = s.floors[0].cells.filter(c => c.type !== 'goal');
  s.floors[1].cells.push({ x: 7, z: 10, type: 'goal' });
  assert.doesNotThrow(() => validateStage(s));
  s.floors[1].cells.push({ x: 8, z: 10, type: 'goal' });
  assert.throws(() => validateStage(s));
});

test('quest uses adjacent upper/lower layers with upper start/goal and a corner return ramp', () => {
  const s = validateStage(defaultStage());
  assert.equal(s.floors.length,2);
  assert.ok(s.balls.every(b => (b.floor ?? 0) === 0));
  assert.ok(s.floors[0].cells.some(c => c.type === 'goal'));
  assert.ok(s.floors[0].cells.some(c => c.type === 'ramp' && c.x === 0 && c.z === 9));
  for (const floors of [[floor()], [floor(),floor(),floor()]]) assert.throws(() => validateStage({ ...s, floors }));
});
test('lower starts and goals survive sharing, with separate starts at equal coordinates', () => {
  const s = defaultStage();
  s.balls = [{ x:6,z:8,floor:0 }, { x:6,z:8,floor:1 }];
  s.floors[0].cells = s.floors[0].cells.filter(c => c.type !== 'goal');
  s.floors[1].cells.push({ x:7,z:9,type:'goal',rotation:1 });
  const shared = decodeStage(encodeStage(s));
  assert.deepEqual(shared.balls,s.balls);
  assert.ok(shared.floors[1].cells.some(c => c.type === 'goal'));
  s.balls[0].floor = 2; assert.throws(() => validateStage(s));
});
test('ramps reserve both layers and need an unobstructed upper exit', () => {
  const s = defaultStage(); s.floors[1].cells.push({ x:0,z:8,type:'sticky' });
  assert.throws(() => validateStage(s), /可動域/);
  const w = defaultStage(); w.floors[0].walls.push({ axis:'h',x:0,z:8 });
  assert.throws(() => validateStage(w), /出口/);
  const out = defaultStage(); out.floors[0].cells.find(c => c.type === 'ramp').rotation = 0;
  assert.throws(() => validateStage(out));
});
test('unfinished editor layouts can be checked without requiring a start or goal', () => {
  const s = defaultStage(); s.balls=[]; s.floors.forEach(f => f.cells=f.cells.filter(c=>c.type!=='goal'));
  assert.throws(() => validateStage(s));
  assert.doesNotThrow(() => validateStage(s,{allowIncomplete:true}));
});

test('initial lower chamber contains only its perimeter and the shared ramp',()=>{
 const s=defaultStage();assert.deepEqual(s.floors[1].cells,[]);
 assert.ok(s.floors[1].walls.every(w=>w.axis==='h'?[0,11].includes(w.z):[0,8].includes(w.x)));
 assert.ok(s.floors[0].cells.some(c=>c.type==='ramp'));
});

test('goals must be a single outward-facing perimeter exit', () => {
  const s = defaultStage(), goal = s.floors[0].cells.find(c => c.type === 'goal');
  goal.rotation = 3;
  assert.throws(() => validateStage(s), /外周/);
  goal.rotation = 1;
  s.floors[1].cells.push({...goal});
  assert.throws(() => validateStage(s), /1箇所/);
});
