const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--enable-unsafe-swiftshader']});
 try{
 const page=await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'block'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{requestAnimationFrame=()=>0});
 await page.goto('http://127.0.0.1:8000');await page.waitForFunction(()=>window.__toukan?.game.balls?.length,{}, {timeout:120000,polling:100});
 const checks=await page.evaluate(async()=>{
  const g=window.__toukan.game,T=window.THREE,{defaultStage}=await import('./src/stage.js');
  const check=(ok,msg)=>{if(!ok)throw Error(msg)};
  g.renderer.setPixelRatio(1);g.renderer.setSize(96,128);
  const canvas=g.renderer.domElement,original=canvas.captureStream.bind(canvas);window.exportStreams=[];window.captureCalls=0;
  canvas.captureStream=(rate)=>{captureCalls++;const s=original(rate);exportStreams.push(s);return s};
  g.start();check(captureCalls===0&&!g.recorder,'Normal play started recording');
  g.makeNoise({x:0,y:.4,z:0},0,1);g.updateLowerRipples(.5);check(g.ripples.length===0,'Upper ball made a ripple');
  const b=g.balls[0];b.body.setTranslation({x:0,y:-1.24+b.radius,z:0},true);b.floor=1;g.sync();g.setLighting();g.updateLowerRipples(.5);
  check(g.ripples.length===0,'Lower ball still emits position rings');
  check(!b.light&&!b.mesh.children.some(m=>m.isLight),'Ball still has a following light');
  check(b.mesh.material.visible&&b.mesh.visible,'Lower ball must be drawn and naturally occluded by the floor');
  check(!g.ambient.layers.isEnabled(2)&&!g.sun.layers.isEnabled(2)&&g.lowerAmbient.intensity<.05,'Sunlight reaches the closed lower chamber');
  g.load(defaultStage(),false);g.start();
  for(let i=0;i<40;i++)g.step(1/60);g.sync();g.finish(true,'test');
  check(captureCalls===0&&!g.recordedBlob,'Finishing generated an unsolicited video');
  g.playReplay(true);check(captureCalls===0,'Ordinary replay started recording');
  g.updateReplay(10);g.updateReplay(2);
  check(g.exportReplayVideo()&&captureCalls===1&&g.exportingVideo,'Explicit export failed to start');
  return {normalRecording:false,lowerRipple:true};
 });
 // Drive replay in real time so the encoder receives frames.
 for(let i=0;i<150;i++){
  await page.evaluate(()=>{const g=window.__toukan.game;if(g.state==='replay')g.updateReplay(1/60);g.renderScene()});
  await page.waitForTimeout(17);
  if(await page.evaluate(()=>!!window.__toukan.game.recordedBlob))break;
 }
 await page.waitForFunction(()=>!!window.__toukan.game.recordedBlob,{}, {timeout:10000});
 const result=await page.evaluate(()=>{
  const g=window.__toukan.game;
  return {bytes:g.recordedBlob.size,type:g.recordedBlob.type,tracksEnded:exportStreams[0].getTracks().every(t=>t.readyState==='ended'),state:g.state,button:document.querySelector('#video').textContent};
 });
 assert.ok(result.bytes>0);assert.ok(result.tracksEnded);assert.equal(result.state,'finished');assert.match(result.button,/共有/);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({...checks,...result}));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
