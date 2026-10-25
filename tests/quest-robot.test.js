import test from 'node:test';
import assert from 'node:assert/strict';
import {questStage} from '../src/quests.js';
import {QUEST_LAYOUTS} from '../src/quest-layouts.js';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Exercise the production patrol controller without a renderer or physics world.
const context={};
vm.runInNewContext(readFileSync(new URL('../vendor/three.min.js',import.meta.url),'utf8'),context);
globalThis.window={THREE:context.THREE};
const {Game}=await import('../src/game.js');
test('stage 4 robot patrol leaves its deep detour and enters the solution',()=>{
 const stage=questStage(3),c=stage.floors[0].cells.find(c=>c.type==='robot');
 const game=Object.create(Game.prototype);
 Object.assign(game,{stage,doors:[],balls:[],elapsed:0,sound:{tone(){}},finish(){throw Error('unexpected capture');}});
 const enemy={c,fi:0,x:c.x-3.5,z:c.z-5,dir:c.rotation,heading:c.rotation*Math.PI/2,state:'patrol',stun:0,alert:0,target:null,next:null,
  cone:{},badge:{material:{color:{set(){}}}},g:{rotation:{},position:{set(){}},children:[]}};
 game.enemies=[enemy];
 const main=new Set(QUEST_LAYOUTS[3].solution);let arrival;
 for(let tick=0;tick<3600;tick++) {
  game.elapsed+=1/60;game.updateEnemies(1/60);
  const x=Math.round(enemy.x+3.5),z=Math.round(enemy.z+5);
  if(main.has(z*8+x)&&Math.hypot(enemy.x-(x-3.5),enemy.z-(z-5))<.04){arrival=game.elapsed;break;}
 }
 assert.ok(arrival>25&&arrival<60,`robot must arrive on the main route after a playable delay, got ${arrival}`);
});

function controller() {
 const game=Object.create(Game.prototype),stage={floors:[{dark:false,walls:[],cells:[]},{dark:false,walls:[],cells:[]}]};
 Object.assign(game,{stage,doors:[],balls:[],elapsed:0,noise:0,jumpAt:-10,state:'playing',wallSettings:{wallThickness:1},sound:{tone(){}},finish(){throw Error('unexpected capture');}});
 const enemy={c:{type:'robot',rule:'left'},fi:0,x:-.5,z:0,dir:0,heading:0,state:'patrol',stun:0,alert:0,target:null,next:null,
  cone:{},badge:{material:{color:{set(){}}}},g:{rotation:{},position:{set(){}},children:[]}};
 game.enemies=[enemy];return {game,enemy};
}
test('production robot controller follows the right wall even with a noise or chase target',()=>{
 for(const state of ['patrol','investigate','chase'])for(let heading=0;heading<4;heading++)for(const allowed of [[3,0,1,2],[0,1,2],[1,2],[2]]) {
  const {game,enemy}=controller();enemy.dir=heading;enemy.state=state;enemy.alert=3;enemy.target={x:3,z:3};
  const dirs=[[0,1],[1,0],[0,-1],[-1,0]],available=allowed.map(relative=>(heading+relative)%4);
  game.blocked=(_fi,x,z,nx,nz)=>!available.some(dir=>nx-x===dirs[dir][0]&&nz-z===dirs[dir][1]);
  game.updateEnemies(1/60);assert.equal(enemy.dir,available[0],`${state} heading ${heading}`);
 }
});
test('small shakes and a single jump never stop the robot; sustained strong shaking does',()=>{
 const {game,enemy}=controller();
 const tick=rate=>{game.elapsed+=1/60;game.updateRobotShake(1/60,rate);game.updateEnemies(1/60);};
 for(let i=0;i<120;i++)tick(2);assert.equal(enemy.stun,0);assert.ok(Math.hypot(enemy.x+.5,enemy.z)>.5);
 game.jump();for(let i=0;i<60;i++)tick(0);assert.equal(enemy.stun,0);
 for(let i=0;i<71;i++)tick(8);assert.equal(enemy.stun,0);
 tick(8);assert.ok(enemy.stun>0);
 const stopped={x:enemy.x,z:enemy.z};for(let i=0;i<60;i++)tick(8);
 assert.deepEqual({x:enemy.x,z:enemy.z},stopped,'footsteps stay in place only after threshold');
 for(let i=0;i<65;i++)tick(0);assert.equal(enemy.stun,0);assert.ok(Math.hypot(enemy.x-stopped.x,enemy.z-stopped.z)>.1);
});
