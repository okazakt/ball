import test from 'node:test';
import assert from 'node:assert/strict';
import {robotShakeCharge,STRONG_SHAKE_DURATION,rightWallOrder,visionObstacles,sightDistance,visionPolygon} from '../src/robot-behavior.js';
import {floor} from '../src/stage.js';

test('strong shaking must accumulate continuously; isolated spikes and gaps drain it',()=>{
 let charge=0;
 for(let n=0;n<600;n++)charge=robotShakeCharge(charge,n%60<6,1/60);
 assert.ok(charge<STRONG_SHAKE_DURATION);
 for(let n=0;n<71;n++)charge=robotShakeCharge(charge,true,1/60);
 assert.ok(charge<STRONG_SHAKE_DURATION);
 charge=robotShakeCharge(charge,true,1/60);assert.equal(charge,STRONG_SHAKE_DURATION);
 charge=robotShakeCharge(charge,false,.6);assert.equal(charge,0);
});
test('right wall order is geometrically right then forward, left, back for all headings',()=>{
 const dirs=[[0,1],[1,0],[0,-1],[-1,0]];
 for(let heading=0;heading<4;heading++) {
  const [dx,dz]=dirs[heading],order=rightWallOrder(heading);
  assert.deepEqual(dirs[order[0]],[-dz,dx].map(v=>v||0));
  assert.equal(order[1],heading);assert.deepEqual(dirs[order[3]],[-dx,-dz].map(v=>v||0));
 }
});
test('vision fan stops at the wall face; its light never covers the far side',()=>{
 const origin={x:0,z:0},segments=[[-3,1,3,1]];
 assert.equal(sightDistance(origin,0,segments,2),1);
 const polygon=visionPolygon(origin,0,segments);
 assert.ok(polygon.length>=49);
 for(const p of polygon)assert.ok(p.z<1&&p.z>.99);
 assert.ok(Math.hypot(...Object.values(visionPolygon(origin,0,[])[24]))>1.99);
});
test('wall thickness, corners, ramp footprints and closed doors occlude sight',()=>{
 const stage={floors:[floor(),floor()]};stage.floors[0].walls.push({axis:'h',x:4,z:6});
 const origin={x:.5,z:0};
 assert.ok(sightDistance(origin,0,visionObstacles(stage,0),2)<=.451);
 stage.floors[0].walls=stage.floors[0].walls.filter(w=>!(w.axis==='h'&&w.x===4&&w.z===6));
 const door={fi:0,x:.5,z:.5,halfX:.397,halfZ:.07,open:false};
 assert.ok(sightDistance(origin,0,visionObstacles(stage,0,.05,.05,[door]),2)<.5);
 door.open=true;assert.equal(sightDistance(origin,0,visionObstacles(stage,0,.05,.05,[door]),2),2);
 stage.floors[0].cells=[{type:'ramp',x:4,z:6,rotation:0}];
 assert.ok(sightDistance(origin,0,visionObstacles(stage,0),2)<=.5);
 assert.ok(sightDistance(origin,0,visionObstacles(stage,1),2)<=.5);
});
