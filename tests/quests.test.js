import test from 'node:test';
import assert from 'node:assert/strict';
import {questStage,QUESTS} from '../src/quests.js';
import {encodeStage,decodeStage} from '../src/stage.js';
import {sharedEdge,footprint,direction} from '../src/mechanics.js';
function reachable(s,start,avoid=[]) {
 const walls=new Set(s.floors[0].walls.map(w=>`${w.axis}:${w.x}:${w.z}`)), seen=new Set(avoid), queue=[start], result=new Set();
 while(queue.length) {const [x,z]=queue.shift(),key=`${x}:${z}`;if(seen.has(key))continue;seen.add(key);result.add(key);
 for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {const nx=x+dx,nz=z+dz,e=sharedEdge({x,z},{x:nx,z:nz});if(nx>=0&&nx<8&&nz>=0&&nz<11&&!walls.has(`${e.axis}:${e.x}:${e.z}`))queue.push([nx,nz]);}}
 return result;
}
test('four quests share safely and have corner starts and goals',()=>{
 assert.equal(QUESTS.length,4);
 for(let i=0;i<4;i++){const s=questStage(i);assert.equal(s.size,'M');assert.deepEqual(s.balls,[{x:0,z:0}]);assert.ok(s.floors[0].cells.some(c=>c.type==='goal'&&c.x===7&&c.z===10));assert.equal(encodeStage(decodeStage(encodeStage(s))),encodeStage(s));}
});
test('upper-only quests have two dead-end branches and no vertical access',()=>{
 for(const i of [0,3]) {const s=questStage(i),r=reachable(s,[0,0]);assert.ok(r.has('7:10'));assert.ok(!s.floors[0].cells.some(c=>['hole','ramp'].includes(c.type)));}
 assert.equal(questStage(3).floors[0].cells.filter(c=>c.type==='robot').length,1);
});
test('trap quest has two one-cell straight-ahead holes and an empty lower floor',()=>{
 const s=questStage(1);assert.equal(s.floors[0].cells.filter(c=>c.type==='hole').length,2);assert.ok(s.floors[0].windows.length);assert.deepEqual(s.floors[1].cells,[]);assert.equal(s.floors[1].walls.length,38);
 assert.ok(reachable(s,[0,0],['6:0','1:3']).has('7:10'));
});
test('mandatory descent separates the front and back routes',()=>{
 const s=questStage(2),ramp=s.floors[0].cells.find(c=>c.type==='ramp'),holes=s.floors[0].cells.filter(c=>c.type==='hole');
 const front=reachable(s,[0,0],footprint(ramp).map(p=>`${p.x}:${p.z}`));assert.ok(front.has(`${holes[0].x}:${holes[0].z}`));assert.ok(!front.has('7:10'));
 const [dx,dz]=direction(ramp);assert.ok(reachable(s,[ramp.x+2*dx,ramp.z+2*dz],footprint(ramp).map(p=>`${p.x}:${p.z}`)).has('7:10'));assert.ok(!s.floors[0].windows);
});

test('stage 1 uses every cell with exactly two long winding dead-end routes',()=>{
 const s=questStage(0), all=reachable(s,[0,0]);
 assert.equal(all.size,88,'every upper cell must be reachable');
 const walls=new Set(s.floors[0].walls.map(w=>`${w.axis}:${w.x}:${w.z}`));
 const graph=new Map([...all].map(key=>{
  const [x,z]=key.split(':').map(Number), neighbours=[];
  for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
   const nx=x+dx,nz=z+dz,e=sharedEdge({x,z},{x:nx,z:nz});
   if(all.has(`${nx}:${nz}`)&&!walls.has(`${e.axis}:${e.x}:${e.z}`))neighbours.push(`${nx}:${nz}`);
  }
  return [key,neighbours];
 }));
 assert.equal([...graph.values()].reduce((n,v)=>n+v.length,0)/2,87,'no loops or shortcuts');
 const ends=[...graph].filter(([key,v])=>v.length===1&&!['0:0','7:10'].includes(key));
 assert.equal(ends.length,2);
 for(const [end] of ends) {
  const path=[end];let previous;
  while(graph.get(path.at(-1)).length<3) {
   const current=path.at(-1), next=graph.get(current).find(k=>k!==previous);
   assert.ok(next,'dead end must lead back to a junction');path.push(next);previous=current;
  }
  assert.equal(path.length-1,15,'detour must extend fifteen cells beyond the junction');
  const steps=path.slice(1).map((key,i)=>{const [x,z]=key.split(':').map(Number),[px,pz]=path[i].split(':').map(Number);return `${x-px}:${z-pz}`;});
  assert.ok(steps.slice(1).filter((step,i)=>step!==steps[i]).length>=4,'dead ends must be hidden behind multiple turns');
 }
});
