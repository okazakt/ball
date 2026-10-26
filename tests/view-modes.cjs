const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox','--enable-unsafe-swiftshader']});
 try {
  const page=await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'block'}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.addInitScript(()=>requestAnimationFrame=()=>0);
  await page.goto(process.env.TEST_URL||'http://127.0.0.1:8000');
  await page.waitForFunction(()=>window.__toukan?.game.balls?.length,{},{timeout:120000,polling:100});
  assert.equal(await page.locator('#view-mode option').count(),2);
  // Creator test-play shares the same view control as ordinary play/replay.
  await page.click('#menu');await page.click('#edit');await page.click('#test-stage');
  await page.selectOption('#view-mode','tilt');
  assert.equal(await page.evaluate(()=>window.__toukan.game.cameraMode),'tilt');
  const checks=await page.evaluate(async()=>{
   const g=window.__toukan.game,T=window.THREE,{defaultStage}=await import('./src/stage.js');
   const check=(ok,msg)=>{if(!ok)throw Error(msg);};
   g.warmupRenderVariants=()=>{};
   document.querySelector('#start-panel').hidden=true;
   const pose=()=>[...g.camera.matrixWorld.elements,...g.camera.projectionMatrix.elements];
   const unchanged=(a,b)=>a.every((n,i)=>Math.abs(n-b[i])<1e-10);
   g.setCameraMode('fixed');g.tilt={x:0,z:0};g.renderScene();const fixed=pose();
   g.tilt={x:.35,z:-.3};g.renderScene();
   check(g.board.rotation.x===0&&g.board.rotation.z===0,'Fixed view moved the board');
   check(!unchanged(fixed,pose()),'Fixed view lost parallax');
   g.setCameraMode('tilt');const camera=pose(),body=g.balls[0].body.translation();
   for(const tilt of [{x:-.5,z:.5},{x:.5,z:-.5},{x:0,z:0}]) {
    g.tilt={...tilt};g.renderScene();
    check(unchanged(camera,pose()),'3D camera tracks the tilt');
    check(Math.abs(g.board.rotation.x-tilt.x)<1e-10&&Math.abs(g.board.rotation.z+tilt.z)<1e-10,'Wrong 3D board tilt');
   }
   g.balls[0].body.setTranslation({x:body.x+.2,y:body.y,z:body.z+.2},true);g.sync();g.renderScene();
   check(unchanged(camera,pose()),'3D camera tracks the ball');
   g.recordedBlob=new Blob(['old view']);g.setCameraMode('fixed');
   check(g.recordedBlob===null,'Old video was reused after changing view');
   const beforeSwitch=g.world.takeSnapshot(),elapsedBefore=g.elapsed;
   g.setCameraMode('tilt');
   const afterSwitch=g.world.takeSnapshot();
   check(beforeSwitch.length===afterSwitch.length&&beforeSwitch.every((n,i)=>n===afterSwitch[i])&&g.elapsed===elapsedBefore,'View switch touched the physics world');
   const runs=[];
   // The first same-view run warms Rapier's first-use setup. Compare subsequent
   // independent worlds, and above assert byte-identical state on a live switch.

   for(const mode of ['fixed','fixed','tilt']) {
    g.load(defaultStage(),false);g.setCameraMode(mode);g.start();
    for(let tick=0;tick<90;tick++) {
     g.keys.clear();g.keys.add(tick<30?'ArrowRight':tick<60?'ArrowDown':'ArrowLeft');
     g.step(1/60);g.sync();if(tick%15===0)g.renderScene();
    }
    const b=g.balls[0],p=b.body.translation(),v=b.body.linvel();
    runs.push([p.x,p.y,p.z,v.x,v.y,v.z,g.elapsed,g.logCount]);
   }
   check(runs[1].every((n,i)=>Math.abs(n-runs[2][i])<1e-7),'View changed the physics result: '+JSON.stringify(runs));
   g.finish(true,'view regression');document.querySelectorAll('dialog[open]').forEach(d=>d.close());
   g.playReplay(true);const replayCamera=pose();
   for(let i=0;i<20;i++){g.updateReplay(1/30);g.renderScene();check(unchanged(replayCamera,pose()),'3D replay camera moved');}
   // Exercise the UI while a native picker has a pending, uncommitted choice.
   // The per-frame HUD update must not reset it before the change event.
   g.setCameraMode('fixed');
   const selector=document.querySelector('#view-mode');
   selector.value='tilt';
   for(let i=0;i<5;i++){g.events.frame(g);g.updateReplay(1/60);}
   check(selector.value==='tilt'&&g.cameraMode==='fixed','Frame reset the pending replay view selection');
   const selectionCursor=g.replayIndex;
   selector.dispatchEvent(new Event('change',{bubbles:true}));
   check(g.cameraMode==='tilt'&&g.replayIndex===selectionCursor,'Replay view selection failed or reset playback');
   const cursor=g.replayIndex,position=g.balls[0].mesh.position.clone();g.setCameraMode('fixed');
   check(g.replayIndex===cursor&&g.balls[0].mesh.position.equals(position),'View switch reset replay');
   g.exportingVideo=true;check(!g.setCameraMode('tilt')&&g.cameraMode==='fixed','Export view was changed during recording');g.exportingVideo=false;
   return {creatorTestPlay:true,fixedParallax:true,cameraFixedDuringTilt:true,cameraDoesNotFollowBall:true,identicalPhysics:true,replaySwitch:true};
  });
  // Capture the actual board in both views, without start/result overlays.
  await page.evaluate(()=>{const g=window.__toukan.game;g.tilt={x:.35,z:-.3};g.setCameraMode('fixed');g.renderScene();});
  await page.screenshot({path:'/tmp/view-fixed.png'});
  await page.selectOption('#view-mode','tilt');
  await page.screenshot({path:'/tmp/view-tilt.png'});
  for(const viewport of [{width:390,height:844},{width:844,height:390}]) {
   await page.setViewportSize(viewport);
   const bounds=await page.evaluate(()=>{
    const g=window.__toukan.game,T=window.THREE;g.resize();let max=0;
    for(const tilt of [{x:.5,z:.5},{x:-.5,z:.5},{x:.5,z:-.5},{x:-.5,z:-.5}]) {
     g.tilt={...tilt};g.renderScene();
     for(const x of [-4.2,4.2])for(const y of [-1.48,1.31])for(const z of [-5.7,5.7]) {
      const p=new T.Vector3(x,y,z).applyMatrix4(g.board.matrixWorld).project(g.camera);max=Math.max(max,Math.abs(p.x),Math.abs(p.y));
     }
    }
    return {max,overflow:document.documentElement.scrollWidth>innerWidth};
   });
   assert.ok(bounds.max<=1,JSON.stringify(bounds));assert.equal(bounds.overflow,false);
  }
  assert.deepEqual(errors,[]);console.log(JSON.stringify({...checks,portraitAndLandscapeFit:true,errors}));
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
