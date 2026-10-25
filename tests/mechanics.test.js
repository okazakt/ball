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
    assert.ok(doorPose(spec,1).panelY+.46>-.16);
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
test('retracted door cap stays inside the floor channel, with safe telescoping support',()=>{
 const spec=doorSpec({x:3,z:2,rotation:0},0),pose=doorPose(spec,1);
 assert.ok(pose.panelY+.46<-.1);assert.ok(pose.panelY+.46>-.24);
 assert.ok(pose.postHeight>0);
});

test('side exits detect the center crossing the correct opening and layer', async () => {
  const {insideGoal,cellCenter} = await import('../src/mechanics.js');
  for (const cell of [{x:7,z:5,rotation:1},{x:0,z:5,rotation:3},{x:3,z:0,rotation:2},{x:3,z:10,rotation:0}]) {
    const q=cellCenter(cell.x,cell.z), dirs=[[0,1],[1,0],[0,-1],[-1,0]], [dx,dz]=dirs[cell.rotation];
    for(const fi of [0,1]) {
      const p={x:q.x+dx*.75,z:q.z+dz*.75,y:-fi*GAP+.1};
      assert.ok(insideGoal(p,.2,cell,fi));
      assert.ok(!insideGoal({...p,x:q.x,z:q.z},.2,cell,fi));
      assert.ok(!insideGoal({...p,y:p.y-GAP},.2,cell,fi));
      assert.ok(!insideGoal({...p,x:p.x-dz*.4,z:p.z+dx*.4},.2,cell,fi));
    }
  }
});


test('swept exit detection catches M balls near either jamb and fast crossings', async()=>{
 const {crossedGoal,insideGoal,cellCenter,direction}=await import('../src/mechanics.js');
 for(const cell of [{x:7,z:10,rotation:1},{x:0,z:5,rotation:3},{x:3,z:0,rotation:2},{x:3,z:10,rotation:0}])
 for(const fi of [0,1]) for(const radius of [.35,.4]) for(const offset of [-.08,0,.08]) {
  const q=cellCenter(cell.x,cell.z),[dx,dz]=direction(cell);
  const at=(along,y=-fi*GAP+radius)=>({x:q.x+dx*along-dz*offset,z:q.z+dz*along+dx*offset,y});
  assert.ok(crossedGoal(at(.45),at(1.2),radius,cell,fi),'cannot skip goal before out-of-bounds');
  assert.ok(insideGoal(at(.51),radius,cell,fi),'ball need not fall off the threshold before winning');
  assert.ok(!crossedGoal(at(1.2),at(.45),radius,cell,fi),'inward motion is not a goal');
  assert.ok(!crossedGoal(at(.1),at(.49),radius,cell,fi),'must cross the actual exit');
  assert.ok(!crossedGoal(at(.45,-fi*GAP-1),at(1.2,-fi*GAP-1),radius,cell,fi),'falling past another floor is not a goal');
  const bad=at(.45),badEnd=at(1.2);bad.x-=dz*.4;bad.z+=dx*.4;badEnd.x-=dz*.4;badEnd.z+=dx*.4;
  assert.ok(!crossedGoal(bad,badEnd,radius,cell,fi),'other perimeter edges remain out of bounds');
 }
});
