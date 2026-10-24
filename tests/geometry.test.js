import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Exercise the same bundled Three.js implementation used by the browser.
const context = {};
vm.runInNewContext(readFileSync(new URL('../vendor/three.min.js', import.meta.url), 'utf8'), context);
globalThis.window = { THREE: context.THREE };
const { solidGeometry, ribRimGeometry } = await import('../src/case-visuals.js');

test('rounded walls retain valid faces and identical topology at every grid position', () => {
  let count;
  for (let x = -400; x <= 400; x += 100) for (let z = -550; z <= 550; z += 100) {
    for (const vertical of [false, true]) {
      const geometry = solidGeometry([[x - 3.8, z - 3.8,
        x + (vertical ? 3.8 : 103.8), z + (vertical ? 103.8 : 3.8)]],
      1, { bevel: 0.012, fillet: 0.038 });
      count ??= geometry.attributes.position.count;
      assert.equal(geometry.attributes.position.count, count, `topology at ${x},${z},${vertical}`);
      const rims = ribRimGeometry(geometry);
      for (const body of [geometry, rims]) {
        assert.ok([...body.attributes.position.array].every(Number.isFinite));
        const normals = body.attributes.normal;
        for (let i = 0; i < normals.count; i++)
          assert.ok(Math.hypot(normals.getX(i), normals.getY(i), normals.getZ(i)) > 0.99,
            `degenerate face at ${x},${z},${vertical}`);
      }
      geometry.dispose();
      rims.dispose();
    }
  }
});
