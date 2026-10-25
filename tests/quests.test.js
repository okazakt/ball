import test from 'node:test';
import assert from 'node:assert/strict';
import {questStage,QUESTS} from '../src/quests.js';
import {QUEST_LAYOUTS} from '../src/quest-layouts.js';
import {encodeStage,decodeStage} from '../src/stage.js';
import {sharedEdge,footprint,direction} from '../src/mechanics.js';
function graph(s) {
 const walls=new Set(s.floors[0].walls.map(w=>`${w.axis}:${w.x}:${w.z}`));
 return new Map(Array.from({length:88},(_,a)=>{
  const x=a%8,z=Math.floor(a/8),adj=[];
  for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
   const nx=x+dx,nz=z+dz,e=sharedEdge({x,z},{x:nx,z:nz});
   if(nx>=0&&nx<8&&nz>=0&&nz<11&&!walls.has(`${e.axis}:${e.x}:${e.z}`))adj.push(nz*8+nx);
  }
  return [a,adj];
 }));
}
function traverse(g,start,avoid=[]) {
 const parent=new Map([[start,null]]),queue=[start],blocked=new Set(avoid);
 for(const a of queue) for(const b of g.get(a)) if(!parent.has(b)&&!blocked.has(b)){parent.set(b,a);queue.push(b);}
 return parent;
}
function route(g,start,end,avoid=[]) {
 const parent=traverse(g,start,avoid);if(!parent.has(end))return [];
 const path=[];for(let a=end;a!==null;a=parent.get(a))path.push(a);return path.reverse();
}
function runs(path) {
 const result=[];let previous;
 for(let i=1;i<path.length;i++) {
  const d=`${path[i]%8-path[i-1]%8}:${Math.floor(path[i]/8)-Math.floor(path[i-1]/8)}`;
  if(d===previous)result[result.length-1]++;else result.push(1);previous=d;
 }
 return result;
}
const id=c=>c.z*8+c.x;
test('four fixed-seed quests share safely and retain corner starts and goals',()=>{
 assert.equal(QUESTS.length,4);
 for(let i=0;i<4;i++) {
  const s=questStage(i);assert.equal(s.size,'M');assert.deepEqual(s.balls,[{x:0,z:0}]);
  assert.ok(s.floors[0].cells.some(c=>c.type==='goal'&&c.x===7&&c.z===10));
  assert.equal(encodeStage(decodeStage(encodeStage(s))),encodeStage(s));
  assert.deepEqual(questStage(i),s,'retry layout must stay identical');
 }
});
test('all stages use all 88 upper cells without enclosed unused tiles',()=>{
 for(let i=0;i<4;i++) {
  const s=questStage(i),g=graph(s),front=traverse(g,0);
  if(i!==2)assert.equal(front.size,88);
  else {
   const ramp=s.floors[0].cells.find(c=>c.type==='ramp'),back=traverse(g,id(ramp));
   assert.equal(front.size+back.size,88);assert.ok(!front.has(id(ramp)));
   assert.ok(back.has(87));assert.ok(!front.has(87));
  }
 }
});
test('upper-only stages have exactly two deep winding and separated wrong routes',()=>{
 for(const index of [0,3]) {
  const s=questStage(index),g=graph(s),solution=route(g,0,87),on=new Set(solution);
  assert.equal([...g.values()].reduce((sum,v)=>sum+v.length,0)/2,87,'no shortcuts');
  assert.ok(solution.length>=44);assert.ok(runs(solution).length-1>=25);
  assert.ok(Math.max(...runs(solution))<=3,'limit straight runs on the solution');
  assert.ok(runs(solution.slice(-7)).length>=4,'several turns approaching the goal');
  const ends=[...g].filter(([a,v])=>v.length===1&&a!==0&&a!==87);assert.equal(ends.length,2);
  const junctions=[];
  for(const [end] of ends) {
   const path=[end];let previous;
   while(!on.has(path.at(-1))) {const a=path.at(-1),next=g.get(a).filter(b=>b!==previous);assert.equal(next.length,1);path.push(next[0]);previous=a;}
   assert.ok(path.length-1>=12);assert.ok(runs(path).length>=4);assert.ok(Math.max(...runs(path))<=4);
   junctions.push(solution.indexOf(path.at(-1)));
  }
  assert.ok(Math.abs(junctions[0]-junctions[1])>=12,'spread decisions across the maze');
  assert.ok(!s.floors[0].cells.some(c=>['hole','ramp'].includes(c.type)));
 }
 const s=questStage(3),robot=s.floors[0].cells.find(c=>c.type==='robot');assert.ok(robot);
 assert.equal(graph(s).get(id(robot)).length,1,'robot starts at the end of a detour');
});
test('trap quest has two straight-ahead one-cell holes at mandatory T turns',()=>{
 const s=questStage(1),g=graph(s),holes=s.floors[0].cells.filter(c=>c.type==='hole'),ramp=s.floors[0].cells.find(c=>c.type==='ramp');
 assert.equal(holes.length,2);assert.ok(s.floors[0].windows.length);assert.deepEqual(s.floors[1].cells,[]);assert.equal(s.floors[1].walls.length,38);
 const p=route(g,0,87,[...holes.map(id),...footprint(ramp).map(id)]);
 assert.ok(p.length>=48);assert.ok(runs(p).length-1>=25);assert.ok(Math.max(...runs(p))<=4);
 for(const hole of holes) {
  const tip=id(hole);assert.equal(g.get(tip).length,1);
  const junction=g.get(tip)[0],i=p.indexOf(junction);assert.ok(i>0&&i<p.length-1);assert.equal(g.get(junction).length,3);
  assert.equal(tip%8-junction%8,junction%8-p[i-1]%8);assert.equal(Math.floor(tip/8)-Math.floor(junction/8),Math.floor(junction/8)-Math.floor(p[i-1]/8));
 }
 assert.ok(QUEST_LAYOUTS[1].trapJunctions.every(n=>p.includes(n)));
});
test('mandatory descent is the only connection between two complex upper routes',()=>{
 const s=questStage(2),g=graph(s),ramp=s.floors[0].cells.find(c=>c.type==='ramp'),hole=s.floors[0].cells.find(c=>c.type==='hole');
 const front=route(g,0,id(hole));assert.ok(front.length>=24);assert.equal(g.get(id(hole)).length,1);
 const [dx,dz]=direction(ramp),exit=(ramp.z+2*dz)*8+ramp.x+2*dx;
 const back=route(g,exit,87,footprint(ramp).map(id));assert.ok(back.length>=20);
 for(const p of [front,back]) {assert.ok(runs(p).length-1>=10);assert.ok(Math.max(...runs(p))<=4);}
 assert.equal(route(g,0,87).length,0);assert.ok(!s.floors[0].windows);
});
