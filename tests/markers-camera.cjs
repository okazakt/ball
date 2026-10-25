const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox','--enable-unsafe-swiftshader']});
 try {
 const page=await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'block'});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{window.requestAnimationFrame=()=>0;window.lockRequests=0;Object.defineProperty(navigator,'wakeLock',{value:{request:async()=>{window.lockRequests++;return {released:false,release:async()=>{}}}}});});
 await page.goto('http://127.0.0.1:8000');await page.waitForFunction(()=>window.__toukan?.game.world,{}, {timeout:120000,polling:100});
 const physics=await page.evaluate(async()=>{
  const {floor,defaultStage}=await import('./src/stage.js');const {cellCenter}=await import('./src/mechanics.js');
  const g=window.__toukan.game; const check=(ok,msg)=>{if(!ok)throw Error(msg)};
  for(const fi of [0,1])for(const size of ['S','M'])for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){
   const goal = dx===1 ? {x:7,z:5,rotation:1} : dx===-1 ? {x:0,z:5,rotation:3} : dz===1 ? {x:4,z:10,rotation:0} : {x:4,z:0,rotation:2};
   const stage={...defaultStage(),size,balls:[{x:3,z:4,floor:fi}],floors:[floor(),floor()]};
   stage.floors[fi].cells=[{type:'goal',...goal}];
   g.load(stage,false);g.state='playing';const b=g.balls[0],y=-fi*1.24+b.radius;
   check(!g.floorGroups.some(f=>f.children.some(m=>['start','start-bump'].includes(m.userData.surface))),'Start marker remains');
   const initial=cellCenter(3,4);
   check(Math.abs(b.body.translation().x-initial.x)<.001&&Math.abs(b.body.translation().z-initial.z)<.001,'Initial ball position changed');
   b.body.setLinvel({x:dx*2,y:0,z:dz*2},true);
   for(let i=0;i<30;i++)g.step(1/60);
   const moved=b.body.translation();
   check((moved.x-initial.x)*dx+(moved.z-initial.z)*dz>.5,'Ball blocked by a start rim');
   const q=cellCenter(goal.x,goal.z);
   b.body.setTranslation({x:q.x,y:y+.01,z:q.z},true);b.body.setLinvel({x:dx*2,y:0,z:dz*2},true);
   for(let i=0;i<90&&!b.done;i++)g.step(1/60);
   check(b.done,'Side exit failed');

  }
  g.load(defaultStage(),false);g.sync();document.querySelectorAll('dialog[open]').forEach(d=>d.close());return '16 initial-position and side-exit approaches passed';
 });
 const ratios=[];
 for(const viewport of [{width:390,height:844},{width:591,height:1280},{width:844,height:390}]){
  await page.setViewportSize(viewport);
  ratios.push(await page.evaluate(()=>{
   const g=window.__toukan.game,T=window.THREE;g.resize();let worst=1;
   for(const tilt of [{x:0,z:0},{x:.5,z:.5},{x:-.5,z:.5}]){
    g.tilt={...tilt};g.updateCamera();
    for(const x of [-3,0,3])for(const z of [-4,0,4]){
     let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
     for(let a=0;a<=80;a++)for(let b=0;b<160;b++){
      const theta=a*Math.PI/80,phi=b*Math.PI/80,r=.4;
      const p=new T.Vector3(x+r*Math.sin(theta)*Math.cos(phi),r+r*Math.cos(theta),z+r*Math.sin(theta)*Math.sin(phi)).project(g.camera);
      const sx=p.x*g.host.clientWidth,sy=p.y*g.host.clientHeight;
      minX=Math.min(minX,sx);maxX=Math.max(maxX,sx);minY=Math.min(minY,sy);maxY=Math.max(maxY,sy);
     }
     const ratio=(maxX-minX)/(maxY-minY);worst=Math.max(worst,ratio,1/ratio);
    }
   }
   g.tilt={x:.5,z:.5};g.updateCamera();g.renderScene();document.querySelector('#start-panel').hidden=true;
   return {width:innerWidth,height:innerHeight,worst};
  }));
  assert.ok(ratios.at(-1).worst<1.035,JSON.stringify(ratios.at(-1)));
  fs.mkdirSync('/workspace/ball-captures/v2.0.1',{recursive:true});await page.screenshot({path:`/workspace/ball-captures/v2.0.1/tilted-${viewport.width}.png`});
 }
 await page.setViewportSize({width:390,height:844});
 await page.evaluate(()=>{const g=window.__toukan.game;g.resize();g.tilt={x:0,z:0};g.updateCamera();g.renderScene()});
 await page.screenshot({path:'/workspace/ball-captures/v2.0.1/flat-390.png'});
 assert.ok(await page.evaluate(()=>window.lockRequests>0));assert.deepEqual(errors,[]);
 console.log(JSON.stringify({physics,ratios,wakeLock:'requested',errors},null,2));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
