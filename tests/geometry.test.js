import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const context = {};
vm.runInNewContext(readFileSync(new URL('../vendor/three.min.js', import.meta.url), 'utf8'), context);
globalThis.window = { THREE: context.THREE };
const { ribGeometry } = await import('../src/case-visuals.js');

function checkBody(geometry) {
  const p = geometry.attributes.position, n = geometry.attributes.normal;
  assert.ok([...p.array, ...n.array].every(Number.isFinite));
  const a = new context.THREE.Vector3(), b = a.clone(), c = a.clone();
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    assert.ok(b.sub(a).cross(c.sub(a)).length() > 1e-10, 'zero-area face');
    assert.ok(Math.hypot(n.getX(i), n.getY(i), n.getZ(i)) > 0.99, 'invalid normal');
  }
  geometry.computeBoundingBox();
  assert.ok(Math.abs(geometry.boundingBox.min.y) < 1e-6);
  assert.ok(Math.abs(geometry.boundingBox.max.y - 1) < 1e-6);

}

function topArea(geometry) {
  const p = geometry.attributes.position, n = geometry.attributes.normal;
  let area = 0;
  for (let i = 0; i < p.count; i += 3) if (n.getY(i) > 0.9)
    area += Math.abs((p.getX(i + 1) - p.getX(i)) * (p.getZ(i + 2) - p.getZ(i)) -
      (p.getX(i + 2) - p.getX(i)) * (p.getZ(i + 1) - p.getZ(i))) / 2;
  return area;
}

test('straight walls retain valid faces at all 216 grid placements', () => {
  for (let x = -400; x <= 400; x += 100) for (let z = -550; z <= 550; z += 100) {
    for (const vertical of [false, true]) {
      const geometry = ribGeometry([[x - 3.8, z - 3.8,
        x + (vertical ? 3.8 : 103.8), z + (vertical ? 103.8 : 3.8)]]);
      checkBody(geometry);
      assert.ok(Math.abs(topArea(geometry) - 1.076 * 0.076) < 1e-6);
      assert.equal(geometry.attributes.position.count, 36);

      geometry.dispose();
    }
  }
});

test('L/T/cross junctions, closed loops and separate walls have no gaps or duplicate top faces', () => {
  const fixtures = [
    { name: 'L', rects: [[0, 0, 100, 10], [0, 0, 10, 100]], area: 0.19 },
    { name: 'T', rects: [[0, 0, 100, 10], [45, 0, 55, 100]], area: 0.19 },
    { name: 'cross', rects: [[0, 45, 100, 55], [45, 0, 55, 100]], area: 0.19 },
    { name: 'loop', rects: [[0, 0, 100, 10], [0, 90, 100, 100], [0, 0, 10, 100], [90, 0, 100, 100]], area: 0.36 },
    { name: 'separate', rects: [[0, 0, 100, 10], [0, 30, 100, 40]], area: 0.2 },
    { name: 'adjacent', rects: [[0, 0, 100, 10], [100, 0, 200, 10]], area: 0.2 },
  ];
  const T = context.THREE;
  for (const f of fixtures) for (const [dx, dz] of [[0, 0], [-303.8, -253.8], [96.2, 46.2]]) {
    const rects = f.rects.map(r => [r[0] + dx, r[1] + dz, r[2] + dx, r[3] + dz]);
    const geometry = ribGeometry(rects);
    checkBody(geometry);
    assert.ok(Math.abs(topArea(geometry) - f.area) < 1e-6, f.name);
    const mesh = new T.Mesh(geometry, new T.MeshBasicMaterial());
    for (let x = -2.37; x < 202; x += 7.13) for (let z = -2.19; z < 102; z += 7.27) {
      const ray = new T.Raycaster(new T.Vector3((x + dx) / 100, 2, (z + dz) / 100), new T.Vector3(0, -1, 0));
      const hits = ray.intersectObject(mesh).filter(hit => hit.face.normal.y > 0.9);
      const inside = f.rects.some(r => x > r[0] && x < r[2] && z > r[1] && z < r[3]);
      assert.equal(hits.length, Number(inside), `${f.name}: top coverage at ${x},${z}`);
    }
    geometry.dispose(); mesh.material.dispose();
  }
});


test('rounded plastic ribs remain valid at every grid placement', async () => {
  const { solidGeometry, setRibFaces, ribMaterials } = await import('../src/case-visuals.js');
  for (let x = -400; x <= 400; x += 100) for (let z = -550; z <= 550; z += 100)
    for (const vertical of [false, true]) {
      const geometry = setRibFaces(solidGeometry([[x - 3.8, z - 3.8,
        x + (vertical ? 3.8 : 103.8), z + (vertical ? 103.8 : 3.8)]], 1,
        { bevel: .012, fillet: .038 }));
      checkBody(geometry);
      assert.equal(geometry.groups.length, 1);
      assert.ok(geometry.groups.every(group => group.count > 0));
      geometry.dispose();
    }
  const material = ribMaterials();
  assert.equal(material.transmission, .95);
  assert.equal(material.ior, 1.52);
  assert.equal(material.thickness, 1.5);
  assert.equal(material.roughness, .03);
  material.dispose();
});
