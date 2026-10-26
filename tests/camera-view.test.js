import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {tiltedBoardCamera} from '../src/camera-view.js';
import {GAP,FLOOR_THICKNESS,COLS,ROWS} from '../src/mechanics.js';
const context={};vm.runInNewContext(readFileSync(new URL('../vendor/three.min.js',import.meta.url),'utf8'),context);
const T=context.THREE;
test('fixed 3D camera retains the whole tilted board in portrait and landscape',()=>{
 for(const aspect of [320/500,390/590,844/240,1,300/1200]) {
  const pose=tiltedBoardCamera(aspect),camera=new T.PerspectiveCamera(pose.fov,aspect,pose.near,pose.far);
  camera.position.set(pose.position.x,pose.position.y,pose.position.z);
  camera.up.set(0,1,0);camera.lookAt(pose.target.x,pose.target.y,pose.target.z);camera.updateMatrixWorld(true);
  for(let tx=-.5;tx<=.50001;tx+=.05)for(let tz=-.5;tz<=.50001;tz+=.05) {
   const rotation=new T.Euler(tx,0,-tz);
   for(const x of [-COLS/2-.2,COLS/2+.2])for(const y of [-GAP-FLOOR_THICKNESS,1.31])for(const z of [-ROWS/2-.2,ROWS/2+.2]) {
    const p=new T.Vector3(x,y,z).applyEuler(rotation).project(camera);
    assert.ok(Math.abs(p.x)<=1&&Math.abs(p.y)<=1&&p.z>-1&&p.z<1,JSON.stringify({aspect,tx,tz,p}));
   }
  }
 }
});
test('camera pose depends on viewport only and rejects invalid sizes',()=>{
 assert.deepEqual(tiltedBoardCamera(.7),tiltedBoardCamera(.7));
 for(const aspect of [0,-1,Infinity,NaN])assert.throws(()=>tiltedBoardCamera(aspect));
});
