import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const context = {};
vm.runInNewContext(readFileSync(new URL('../vendor/three.min.js', import.meta.url), 'utf8'), context);
globalThis.window = { THREE: context.THREE };
const { frameGeometry, FRAME_DEFAULTS } = await import('../src/frame-plastic.js');
test('molded green shell stays finite with continuous unit normals at slider extremes', () => {
 const rects = [[-410,-560,410,-550],[-410,550,410,560],[-410,-560,-400,560],[400,-560,410,560]];
 for (const frameBevel of [0,.4,1]) for (const frameCornerRadius of [0,.5,1]) {
  const g=frameGeometry(rects,2.5,{...FRAME_DEFAULTS,frameBevel,frameCornerRadius});
  const p=g.attributes.position,n=g.attributes.normal,shared=new Map();
  for(let i=0;i<p.count;i++) {
   const normal=[n.getX(i),n.getY(i),n.getZ(i)];
   assert.ok(normal.every(Number.isFinite));
   assert.ok(Math.abs(Math.hypot(...normal)-1)<1e-5);
   const pos=[p.getX(i),p.getY(i),p.getZ(i)];
   assert.ok(pos.every(Number.isFinite));
   const key=pos.map(v=>Math.round(v*1e6)).join(':');
   if(shared.has(key))assert.deepEqual(normal,shared.get(key));
   shared.set(key,normal);
  }
  g.dispose();
 }
});
