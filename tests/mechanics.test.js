import test from 'node:test';
import assert from 'node:assert/strict';
import { GAP, FLOOR_THICKNESS, footprint, doorSpec, doorPose, floorRectangles, rampHull } from '../src/mechanics.js';
import { defaultStage } from '../src/stage.js';
test('lower ceiling is the upper floor underside, with a full unit of clear space',()=>{
  assert.equal(GAP-FLOOR_THICKNESS,1);
});
test('one-cell lift doors and posts fit the slot in every orientation',()=>{
  for(let rotation=0;rotation<4;rotation++){
    const stage=defaultStage(),c={x:3,z:6,type:'door',rotation};
    stage.floors.forEach(f=>f.cells=[]);stage.floors[0].cells=[c];
    const rects=floorRectangles(stage,0),spec=doorSpec(c,0);
    for(const x of [-spec.halfX,0,spec.halfX])for(const z of [-spec.halfZ,0,spec.halfZ])
      assert.ok(!rects.some(r=>spec.x+x>r[0]&&spec.x+x<r[2]&&spec.z+z>r[1]&&spec.z+z<r[3]));
    assert.equal(footprint(c).length,1);
    assert.ok(doorPose(spec,1).panelY+.46<0);
    assert.ok(doorPose(spec,1).panelY+.46>-.04);
    assert.ok(doorPose(spec,0).postHeight>1);
    assert.ok(doorPose(spec,1).postHeight<.3);
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
test('ramp solid fills the entire cell width, allowing seamless side-by-side placement',()=>{
  const a=rampHull({x:3,z:5,rotation:2}),b=rampHull({x:4,z:5,rotation:2});
  const ax=Array.from({length:8},(_,i)=>a[3*i]),bx=Array.from({length:8},(_,i)=>b[3*i]);
  assert.equal(Math.max(...ax),Math.min(...bx));
  assert.equal(Math.max(...ax)-Math.min(...ax),1);
});
