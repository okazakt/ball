import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const context={};
vm.runInNewContext(readFileSync(new URL('../vendor/three.min.js',import.meta.url),'utf8'),context);
globalThis.window={THREE:context.THREE};
const {solidGeometry}=await import('../src/case-visuals.js');
const rect=(x,z,vertical)=>[x*100-3.8,z*100-3.8,x*100+(vertical?3.8:103.8),z*100+(vertical?103.8:3.8)];
function validate(rects) {
  const g=solidGeometry(rects,1,{bevel:.0375,bevelOffset:-.0375,bevelSegments:12,fillet:.038});
  const p=g.attributes.position,n=g.attributes.normal;
  assert.ok([...p.array,...n.array].every(Number.isFinite));
  const minX=Math.min(...rects.map(r=>r[0]))/100-.014;
  const maxX=Math.max(...rects.map(r=>r[2]))/100+.014;
  const minZ=Math.min(...rects.map(r=>r[1]))/100-.014;
  const maxZ=Math.max(...rects.map(r=>r[3]))/100+.014;
  for(let i=0;i<p.count;i++) {
    assert.ok(p.getX(i)>=minX&&p.getX(i)<=maxX&&p.getZ(i)>=minZ&&p.getZ(i)<=maxZ,'bevel spike outside footprint');
    assert.ok(Math.hypot(n.getX(i),n.getY(i),n.getZ(i))>.99,'invalid normal');
  }
  // A long malformed triangle may stay inside the overall board bounds.
  // Its centroid must also remain within the union of actual wall footprints.
  for(let i=0;i<p.count;i+=3) {
    const x=(p.getX(i)+p.getX(i+1)+p.getX(i+2))/3;
    const z=(p.getZ(i)+p.getZ(i+1)+p.getZ(i+2))/3;
    assert.ok(rects.some(r=>x>=r[0]/100-.03&&x<=r[2]/100+.03&&z>=r[1]/100-.03&&z<=r[3]/100+.03),
      JSON.stringify({x,z,triangle:[0,1,2].map(j=>[p.getX(i+j),p.getY(i+j),p.getZ(i+j)]),rects}));
  }
  const mesh=new context.THREE.Mesh(g,new context.THREE.MeshBasicMaterial());
  // Every wall segment must retain a top surface through its centerline.
  for(const r of rects) for(const t of [.2,.5,.8]) {
    const vertical=r[3]-r[1]>r[2]-r[0];
    const x=(vertical?(r[0]+r[2])/2:r[0]+(r[2]-r[0])*t)/100;
    const z=(vertical?r[1]+(r[3]-r[1])*t:(r[1]+r[3])/2)/100;
    const ray=new context.THREE.Raycaster(new context.THREE.Vector3(x,2,z),new context.THREE.Vector3(0,-1,0));
    assert.ok(ray.intersectObject(mesh).some(h=>h.point.y>.98),'missing top face');
  }
  g.dispose();mesh.material.dispose();
}
test('rounded connected U shape preserves every segment at decimal boundaries',()=>{
  validate([rect(-1,-5,true),rect(-1,-4,false),rect(0,-4,true)]);
});

test('round roofs at L/T/cross junctions',()=>{for(let mask=1;mask<16;mask++){const arms=[rect(-1,0,false),rect(0,0,false),rect(0,-1,true),rect(0,0,true)];validate(arms.filter((_,i)=>mask&(1<<i)));}});
