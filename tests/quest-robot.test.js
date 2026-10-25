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
