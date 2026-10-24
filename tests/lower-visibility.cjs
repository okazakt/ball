const {chromium}=require('playwright');const assert=require('node:assert/strict');const fs=require('node:fs');
(async()=>{const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--enable-unsafe-swiftshader']});try{
 const page=await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'block'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{requestAnimationFrame=()=>0});await page.goto('http://127.0.0.1:8000');await page.waitForFunction(()=>window.__toukan?.game.balls?.length,{}, {timeout:120000,polling:100});
 fs.mkdirSync('/workspace/ball-captures/v2.0.4',{recursive:true});
 const results=[];
 for(const kind of ['hole','ramp','covered']){
  const r=await page.evaluate(async kind=>{
   const g=window.__toukan.game,T=window.THREE,{defaultStage,floor}=await import('./src/stage.js');
   const s={...defaultStage(),balls:[{x:1,z:1}],floors:[floor(),floor()]};
   s.floors[0].cells=[{type:'hole',x:4,z:5},{type:'ramp',x:1,z:7,rotation:2},{type:'goal',x:6,z:9}];
   g.load(s,false);const b=g.balls[0];
   const p=kind==='hole'?{x:.5,y:-1.24+b.radius,z:0}:kind==='ramp'?{x:-2.5,y:-.6+b.radius,z:1.5}:{x:2,y:-1.24+b.radius,z:1};
   b.body.setTranslation(p,true);b.floor=1;g.sync();g.renderScene();
   if(!b.mesh.visible||!b.mesh.material.visible)throw Error('Lower ball hidden by code');
   const size=g.renderer.getDrawingBufferSize(new T.Vector2()),q=new T.Vector3(p.x,p.y,p.z).project(g.camera);
   const x=Math.round((q.x+1)*size.x/2),y=Math.round((q.y+1)*size.y/2),gl=g.renderer.getContext();
   const sample=()=>{const pixels=new Uint8Array(13*13*4);gl.readPixels(x-6,y-6,13,13,gl.RGBA,gl.UNSIGNED_BYTE,pixels);return pixels};
   const visible=sample(),balls=g.balls;g.balls=[];b.mesh.material.visible=false;g.renderScene();const hidden=sample();
   g.balls=balls;b.mesh.material.visible=true;g.renderScene();
   let difference=0;for(let i=0;i<visible.length;i++)if(i%4!==3)difference+=Math.abs(visible[i]-hidden[i]);
   document.querySelectorAll('dialog[open]').forEach(d=>d.close());document.querySelector('#start-panel').hidden=true;
   return {kind,difference:difference/(13*13*3)};
  },kind);
  results.push(r);await page.screenshot({path:`/workspace/ball-captures/v2.0.4/${kind}.png`});
 }
 assert.ok(results[0].difference>5,JSON.stringify(results));assert.ok(results[1].difference>5,JSON.stringify(results));assert.ok(results[2].difference<1,JSON.stringify(results));assert.deepEqual(errors,[]);console.log(results);
 }finally{await browser.close()}})().catch(e=>{console.error(e);process.exit(1)});
