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
   const stage={...defaultStage(),size,balls:[{x:1,z:1,floor:fi}],floors:[floor(),floor()]};stage.floors[fi].cells=[{type:'goal',x:4,z:5}];
   g.load(stage,false);g.state='playing';const b=g.balls[0],q=cellCenter(4,5),y=-fi*1.24+b.radius;
   check(g.floorGroups[fi].children.filter(m=>m.userData.surface==='start-bump').length===4,'Missing start ridges');
   check(g.floorGroups[fi].children.filter(m=>m.userData.surface==='goal-bump').length===4,'Missing goal ridges');
   b.body.setTranslation({x:q.x-dx*.5,y,z:q.z-dz*.5},true);b.body.setLinvel({x:0,y:0,z:0},true);g.step(1/60);check(!b.done,'Goal triggered on edge');
   b.body.setTranslation({x:q.x,y:y+.2,z:q.z},true);b.body.setLinvel({x:0,y:0,z:0},true);g.step(1/60);check(!b.done,'Goal triggered above rim');
   b.body.setTranslation({x:q.x-dx*1.1,y,z:q.z-dz*1.1},true);b.body.setLinvel({x:0,y:0,z:0},true);
   const key=dx===1?'ArrowRight':dx===-1?'ArrowLeft':dz===1?'ArrowDown':'ArrowUp';g.keys.add(key);
   let crossed=false;for(let i=0;i<180&&!b.done;i++){g.step(1/60);crossed ||= b.body.translation().y>y+.005;}
   g.keys.clear();check(b.done,`Failed to cross rim and goal ${fi}/${size}/${dx},${dz}`);check(crossed,'No physical bump contact');
  }
  g.load(defaultStage(),false);g.sync();document.querySelectorAll('dialog[open]').forEach(d=>d.close());return '16 approaches passed';
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
