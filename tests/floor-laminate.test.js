import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const context={};
vm.runInNewContext(readFileSync(new URL('../vendor/three.min.js',import.meta.url),'utf8'),context);
const T=context.THREE;
globalThis.window={THREE:T};
const {laminateFloorGeometry,PAPER_THICKNESS}=await import('../src/floor-laminate.js');
const {solidGeometry}=await import('../src/case-visuals.js');
test('floor print is limited to top and thin paper edge; aperture exposes ABS',()=>{
 const shape=new T.Shape();shape.moveTo(-.5,-.5);shape.lineTo(.5,-.5);shape.lineTo(.5,.5);shape.lineTo(-.5,.5);shape.closePath();
 const hole=new T.Path();hole.absarc(0,0,.3,0,Math.PI*2,true);shape.holes.push(hole);
 for(const source of [solidGeometry([[-100,-100,100,100]],.24),new T.ExtrudeGeometry(shape,{depth:.24,bevelEnabled:false,curveSegments:32}).rotateX(-Math.PI/2)]) {
  const g=laminateFloorGeometry(source);g.computeBoundingBox();
  const top=g.boundingBox.max.y,cut=top-PAPER_THICKNESS;
  for(const group of g.groups)for(let i=group.start;i<group.start+group.count;i++){
   const y=g.attributes.position.getY(i);
   assert.ok(group.materialIndex===0?y>=cut-1e-7:y<=cut+1e-7);
  }
  assert.ok([...g.attributes.position.array,...g.attributes.normal.array,...g.attributes.uv.array].every(Number.isFinite));
  const m=new T.Mesh(g,[new T.MeshBasicMaterial({side:T.DoubleSide}),new T.MeshBasicMaterial({side:T.DoubleSide})]);
  const ray=new T.Raycaster(new T.Vector3(.4,1,0),new T.Vector3(0,-1,0));
  assert.equal(ray.intersectObject(m)[0].face.materialIndex,0,'top retains paper');
  const side=new T.Raycaster(new T.Vector3(0,top-.08,0),new T.Vector3(1,0,0));
  assert.equal(side.intersectObject(m)[0].face.materialIndex,1,'side/circular hole reveals core');
  const paperEdge=new T.Raycaster(new T.Vector3(0,top-.001,0),new T.Vector3(1,0,0));
  assert.equal(paperEdge.intersectObject(m)[0].face.materialIndex,0,'thin printed paper edge');
  assert.ok(Math.abs(g.boundingBox.max.y-g.boundingBox.min.y-.24)<1e-6,'thickness unchanged');
 }
});
