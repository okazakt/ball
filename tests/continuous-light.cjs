const {chromium}=require('playwright');const assert=require('node:assert/strict');const fs=require('node:fs');
(async()=>{const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--enable-unsafe-swiftshader']});try{
 const page=await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'block'}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});await page.addInitScript(()=>{requestAnimationFrame=()=>0});
 await page.goto('http://127.0.0.1:8000');await page.waitForFunction(()=>window.__toukan?.game.prewarmedPrograms,{}, {timeout:180000,polling:100});
 const result=await page.evaluate(async()=>{
  const g=window.__toukan.game,T=window.THREE,b=g.balls[0],{exposureAt}=await import('./src/spatial-lighting.js');
  const size=g.renderer.getDrawingBufferSize(new T.Vector2()),gl=g.renderer.getContext();
  const sample=(p,n=9)=>{const q=new T.Vector3(p.x,p.y,p.z).project(g.camera),data=new Uint8Array(n*n*4);gl.readPixels(Math.round((q.x+1)*size.x/2)-Math.floor(n/2),Math.round((q.y+1)*size.y/2)-Math.floor(n/2),n,n,gl.RGBA,gl.UNSIGNED_BYTE,data);return data};
  const differences=[];
  for(const p of [{x:.5,y:.08,z:2},{x:.5,y:.28,z:2},{x:-3.5,y:-.215,z:3.5}]){
   const samples=[];for(const floor of [0,1]){b.body.setTranslation(p,true);b.floor=floor;b.mesh.layers.set(floor+1);g.sync();g.renderScene();samples.push(sample(p));}
   let delta=0;for(let i=0;i<samples[0].length;i++)if(i%4!==3)delta+=Math.abs(samples[0][i]-samples[1][i]);differences.push(delta/(9*9*3));
  }
  const d=g.doors[0],brightness=[];
  for(const retraction of [0,1]){g.setDoorVisual(d,retraction);g.renderScene();const data=sample({x:d.x,y:d.mesh.position.y+.46,z:d.z},3);let sum=0;for(let i=0;i<data.length;i+=4)sum+=.2126*data[i]+.7152*data[i+1]+.0722*data[i+2];brightness.push(sum/9);}
  const lowerEmpty=g.stage.floors[1].cells.length===0&&g.stage.floors[1].walls.every(w=>w.axis==='h'?[0,11].includes(w.z):[0,8].includes(w.x));
  return {differences,brightness,lowerEmpty,storedTop:d.mesh.position.y+.46,exposures:[.4,.28,.08,-.215,-.84].map(y=>exposureAt(y))};
 });assert.deepEqual(errors,[]);assert.ok(result.differences.every(x=>x<2),JSON.stringify(result));assert.ok(result.brightness[1]<result.brightness[0]*.75,JSON.stringify(result));assert.ok(result.lowerEmpty);assert.ok(result.storedTop<-.1);console.log(result);
 fs.mkdirSync('/workspace/ball-captures/v2.1.1',{recursive:true});
 for(const [name,retraction] of [['closed',0],['stored',1]]){
  await page.evaluate(async retraction=>{const g=window.__toukan.game,{defaultStage}=await import('./src/stage.js');g.warmupRenderVariants=()=>{};g.load(defaultStage(),false);g.setDoorVisual(g.doors[0],retraction);g.sync();g.renderScene();document.querySelectorAll('dialog[open]').forEach(d=>d.close());document.querySelector('#start-panel').hidden=true},retraction);
  await page.screenshot({path:`/workspace/ball-captures/v2.1.1/${name}.png`});
 }
 }finally{await browser.close()}})().catch(e=>{console.error(e);process.exit(1)});
