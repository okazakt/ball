import test from 'node:test';
import assert from 'node:assert/strict';
import { GAP, FLOOR_THICKNESS, footprint, doorSpec, floorRectangles, rampHull } from '../src/mechanics.js';
import { defaultStage } from '../src/stage.js';
test('lower ceiling is the upper floor underside, with a full unit of clear space',()=>{
  assert.equal(GAP-FLOOR_THICKNESS,1);
});
test('door posts fit the real floor slot throughout all four travel orientations',()=>{
  for(let rotation=0;rotation<4;rotation++) {
    const stage=defaultStage(), c={x:3,z:6,type:'door',rotation};
    stage.floors.forEach(f=>f.cells=[]);stage.floors[0].cells=[c];
    const rectangles=floorRectangles(stage,0), spec=doorSpec(c,0);
    for(let step=0;step<=20;step++) for(const across of [-.065,0,.065]) {
      const x=spec.x+spec.dx*step/20-spec.dz*across,z=spec.z+spec.dz*step/20+spec.dx*across;
      assert.ok(!rectangles.some(([x0,z0,x1,z1])=>x>x0&&x<x1&&z>z0&&z<z1),'Post intersects a floor tile');
    }
    assert.equal(footprint(c).length,2);
    assert.ok(Math.abs(Math.max(spec.groove[2]-spec.groove[0],spec.groove[3]-spec.groove[1])-1.2)<1e-8);
  }
});
test('ramps open both upper cells and fill a wedge extending to the lower base',()=>{
  const stage=defaultStage(), ramp=stage.floors[0].cells.find(c=>c.type==='ramp');
  const rects=floorRectangles(stage,0);
  for(const {x,z} of footprint(ramp))assert.ok(!rects.some(r=>x-3.5>r[0]&&x-3.5<r[2]&&z-5>r[1]&&z-5<r[3]));
  const hull=rampHull(ramp);assert.equal(hull.length,24);
  assert.ok(Math.abs(hull[1]+GAP+.025)<1e-6);
  assert.ok(Math.abs(hull[6*3+1]-.005)<1e-6);
});
