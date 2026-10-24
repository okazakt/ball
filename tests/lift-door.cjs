const {chromium}=require('playwright');const assert=require('node:assert/strict');const fs=require('node:fs');
(async()=>{const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--enable-unsafe-swiftshader']});try{
 const page=await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'block'}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>{requestAnimationFrame=()=>0});
 await page.goto('http://127.0.0.1:8000');await page.waitForFunction(()=>window.__toukan?.game.prewarmedPrograms,{}, {timeout:180000,polling:100});
 const cold=await page.evaluate(()=>{
  const g=window.__toukan.game,b=g.balls[0],programs=g.renderer.info.programs.length;g.state='playing';
  b.body.setTranslation({x:.5,y:b.radius+.02,z:2},true);b.body.setLinvel({x:0,y:0,z:0},true);
  for(let i=0;i<120;i++){g.step(1/60);g.sync();if(b.floor===1)break;}
  g.updateLowerRipples(.5);g.renderScene();return {lower:b.floor===1,before:programs,after:g.renderer.info.programs.length};
 });assert.ok(cold.lower);assert.equal(cold.after,cold.before,JSON.stringify(cold));
 const physics=await page.evaluate(async()=>{
  const g=window.__toukan.game,{defaultStage,floor,validateStage}=await import('./src/stage.js'),{doorEdge,doorPose}=await import('./src/mechanics.js');
  const check=(ok,msg)=>{if(!ok)throw Error(msg)};g.warmupRenderVariants=()=>{};
  for(let rotation=0;rotation<4;rotation++)for(const size of ['S','M']){
   const c={type:'door',x:3,z:5,rotation},edge=doorEdge(c),s={...defaultStage(),size,balls:[{x:1,z:1}],floors:[floor(),floor()]};
   s.floors[0].cells=[c,{type:'goal',x:6,z:9}];
   s.floors[0].walls.push(...[-1,1].map(offset=>({...edge,x:edge.x+(edge.axis==='h'?offset:0),z:edge.z+(edge.axis==='v'?offset:0)})));
   g.load(validateStage(s),false);g.state='playing';const d=g.doors[0],b=g.balls[0],baseY=d.mesh.position.y;
   b.body.setTranslation({x:d.x-d.dx*.9,y:b.radius+.02,z:d.z-d.dz*.9},true);b.body.setLinvel({x:0,y:0,z:0},true);
   const key=['ArrowDown','ArrowRight','ArrowUp','ArrowLeft'][rotation];g.keys.add(key);
   for(let i=0;i<60;i++)g.step(1/60);
   let p=b.body.translation();check((p.x-d.x)*d.dx+(p.z-d.z)*d.dz<-.4,`Closed door leaked ${rotation}/${size}`);
   check(d.postCollider.containsPoint({x:d.x,y:-.6,z:d.z}),'Closed door has no lower support');
   g.elapsed=4.1;
   for(let i=0;i<80;i++)g.step(1/60);
   p=b.body.translation();check((p.x-d.x)*d.dx+(p.z-d.z)*d.dz>.5,`Open door obstructed ${rotation}/${size}`);
   check(Math.abs(d.mesh.position.x-d.x)<1e-8&&Math.abs(d.mesh.position.z-d.z)<1e-8,'Door moved sideways');
   check(d.mesh.position.y<baseY-.98&&Math.abs(d.mesh.position.y+.46+.14)<1e-6,'Stored panel is not just below the slot');
   g.keys.clear();b.body.setTranslation({x:d.x,y:b.radius+.004,z:d.z},true);b.body.setLinvel({x:0,y:0,z:0},true);g.elapsed=7.1;
   for(let i=0;i<50;i++)g.step(1/60);
   p=b.body.translation();check(Math.abs((p.x-d.x)*d.dx+(p.z-d.z)*d.dz)>b.radius+.06,`Ball not released from apex ${rotation}/${size}`);
   check(p.y+b.radius<1.02,'Door trapped the ball against the lid');check(d.slide<.001,'Door could not rise after releasing ball');
   // The collider and renderer follow the same vertical pose throughout replay.
   check(Math.abs(d.body.translation().y-d.mesh.position.y)<1e-5,'Door pose diverged');
   g.logCount=0;g.logHead=0;g.recordFrame();g.setDoorVisual(d,1);g.recordFrame();g.outcome={won:true,reason:'test',ballIndex:-1};g.playReplay(true);g.updateReplay(.1);
   check(Math.abs(d.mesh.position.y-doorPose(d,1).panelY)<1e-6,'Replay did not restore vertical retraction');
  }
  g.load(defaultStage(),false);g.sync();document.querySelectorAll('dialog[open]').forEach(d=>d.close());document.querySelector('#start-panel').hidden=true;
  return {orientations:4,sizes:2,passages:8,pinchEscapes:8};
 });assert.deepEqual(errors,[]);console.log({cold,physics});
 fs.mkdirSync('/workspace/ball-captures/v2.1.0',{recursive:true});
 for(const [name,open,tilt] of [['closed',0,{x:0,z:0}],['stored',1,{x:-.48,z:.24}]]){
  await page.evaluate(({open,tilt})=>{const g=window.__toukan.game;g.setDoorVisual(g.doors[0],open);g.tilt=tilt;g.renderScene()},{open,tilt});await page.screenshot({path:`/workspace/ball-captures/v2.1.0/${name}.png`});
 }
 }finally{await browser.close()}})().catch(e=>{console.error(e);process.exit(1)});
