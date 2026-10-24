const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--enable-unsafe-swiftshader']});
 try {
 const page=await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'block'}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{requestAnimationFrame=()=>0;localStorage.setItem('toukan.wall-settings',JSON.stringify({wallThickness:.5,edgeWidth:.1}));});
 await page.goto('http://127.0.0.1:8000');await page.waitForFunction(()=>window.__toukan?.game.balls?.length,{}, {timeout:120000,polling:100});
 const result=await page.evaluate(async()=>{
  const {defaultStage,floor,validateStage}=await import('./src/stage.js');
  const {cellCenter,HOLE_RADIUS,doorSpec,GAP}=await import('./src/mechanics.js');
  const {FIXED_WALL_SETTINGS}=await import('./src/wall-settings.js');
  const g=window.__toukan.game,T=window.THREE,check=(ok,msg)=>{if(!ok)throw Error(msg)};
  check(JSON.stringify(g.wallSettings)===JSON.stringify(FIXED_WALL_SETTINGS),'Stored values overrode fixed tuning');
  check([...document.querySelectorAll('#wall-controls input')].every(i=>i.disabled),'Wall controls enabled');
  const before={...g.wallSettings};g.updateWallSettings({wallThickness:.5});check(JSON.stringify(before)===JSON.stringify(g.wallSettings),'Fixed values changed');
  const hole=g.stage.floors[0].cells.find(c=>c.type==='hole'),p=cellCenter(hole.x,hole.z);
  g.world.step();
  const hit=(x,z)=>g.world.castRay(new g.R.Ray({x,y:.1,z},{x:0,y:-1,z:0}),.3,true);
  check(!hit(p.x,p.z),'Circular hole center is closed');
  for(const [x,z] of [[.49,.49],[-.49,.49],[.49,-.49],[-.49,-.49]])check(hit(p.x+x,p.z+z),'Square corner remains open');
  for(const size of ['S','M']){
   const s=defaultStage();s.size=size;g.load(s,false);g.state='playing';const b=g.balls[0];
   b.body.setTranslation({x:p.x,y:b.radius+.02,z:p.z},true);b.body.setLinvel({x:0,y:0,z:0},true);
   for(let i=0;i<120;i++)g.step(1/60);check(b.floor===1,`Ball ${size} cannot fall through circular aperture`);
  }
  for(let rotation=0;rotation<4;rotation++){
   const s=defaultStage();s.balls=[{x:1,z:1}];s.floors=[floor(),floor()];
   const [dx,dz]=[[0,1],[1,0],[0,-1],[-1,0]][rotation];
   const a={x:3,z:5,type:'ramp',rotation},b={...a,x:3-dz,z:5+dx};s.floors[0].cells=[a,b,{x:6,z:9,type:'goal'}];
   g.load(validateStage(s),false);const [r1,r2]=g.ramps;
   check(r1.mesh.geometry.index.count===30&&r2.mesh.geometry.index.count===30,'Internal ramp side remains');
   const q=cellCenter(a.x,a.z),seam={x:q.x-dz*.5,z:q.z+dx*.5};
   g.world.step();const cast=g.world.castRay(new g.R.Ray({x:seam.x,y:.4,z:seam.z},{x:0,y:-1,z:0}),2,true);
   check(cast,'Gap between adjacent ramp tops');
   check(g.ramps.every(r=>r.collider.containsPoint({x:cellCenter(r.c.x,r.c.z).x,y:-1.1,z:cellCenter(r.c.x,r.c.z).z})),'Ramp underside is hollow');
  }
  // Actual pad contact: airborne even by 1cm must not complete; settling must.
  for(const fi of [0,1])for(const size of ['S','M']){
   const s={...defaultStage(),size,balls:[{x:1,z:1,floor:fi}],floors:[floor(),floor()]};s.floors[fi].cells=[{type:'goal',x:4,z:5}];
   g.load(s,false);g.state='playing';const b=g.balls[0],q=cellCenter(4,5),y=-fi*GAP+b.radius+.004;
   b.body.setTranslation({x:q.x,y:y+.02,z:q.z},true);b.body.setLinvel({x:0,y:0,z:0},true);
   g.step(1/60);check(!b.done,'Airborne ball counted as grounded');
   for(let i=0;i<40&&!b.done;i++)g.step(1/60);check(b.done,'Actual goal contact did not complete');
  }
  g.load(defaultStage(),false);g.sync();document.querySelectorAll('dialog[open]').forEach(d=>d.close());document.querySelector('#start-panel').hidden=true;
  const frames=g.floorGroups.map(f=>{const m=f.children.find(m=>m.userData.surface==='frame');m.geometry.computeBoundingBox();return {minX:m.geometry.boundingBox.min.x,maxX:m.geometry.boundingBox.max.x,minZ:m.geometry.boundingBox.min.z,maxZ:m.geometry.boundingBox.max.z}});
  check(JSON.stringify(frames[0])===JSON.stringify(frames[1]),'Upper/lower exterior planes differ');
  for(const d of g.doors){check(Math.abs(d.z-cellCenter(d.c.x,d.c.z).z+.332)<1e-6,'Initial door not beside upper wall');check(g.floorGroups[d.fi].children.some(m=>m.userData.surface==='door-groove'&&m.material.color.getHex()===0x010203),'Missing black groove bottom');}
  return {roundHole:true,joinedRamps:4,contactGoals:4,fixedWalls:g.wallSettings,frames};
 });
 console.log(JSON.stringify(result));assert.deepEqual(errors,[]);
 fs.mkdirSync('/workspace/ball-captures/v2.0.2',{recursive:true});
 for(const [name,tilt] of [['flat',{x:0,z:0}],['tilted',{x:-.48,z:.24}]]){
  await page.evaluate(tilt=>{const g=window.__toukan.game;g.tilt=tilt;g.renderScene()},tilt);
  await page.screenshot({path:`/workspace/ball-captures/v2.0.2/${name}.png`});
 }
 console.log('PASS structure, contacts and captures');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
