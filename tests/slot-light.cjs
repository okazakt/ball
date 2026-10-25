const {chromium}=require('playwright');const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--enable-unsafe-swiftshader']});try{
 const p=await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'block'});await p.addInitScript(()=>{requestAnimationFrame=()=>0});await p.goto('http://127.0.0.1:8000');await p.waitForFunction(()=>window.__toukan?.game.balls?.length,{}, {timeout:120000,polling:100});
 const result=await p.evaluate(()=>{
  const g=window.__toukan.game,T=window.THREE,d=g.doors[0];g.setDoorVisual(d,1);d.mesh.visible=false;g.tilt={x:0,z:0};g.renderScene();
  const size=g.renderer.getDrawingBufferSize(new T.Vector2()),q=new T.Vector3(d.x,-.05,d.z).project(g.camera);
  const x=Math.round((q.x+1)*size.x/2),y=Math.round((q.y+1)*size.y/2),gl=g.renderer.getContext();
  const sample=()=>{const data=new Uint8Array(5*5*4);gl.readPixels(x-2,y-2,5,5,gl.RGBA,gl.UNSIGNED_BYTE,data);let sum=0;for(let i=0;i<data.length;i+=4)sum+=data[i]+data[i+1]+data[i+2];return sum/75};
  const dark=sample();const light=new T.PointLight(0xffffff,8,4,1);light.position.set(d.x,-.65,d.z);light.layers.set(2);g.scene.add(light);g.renderScene();const lit=sample();g.scene.remove(light);
  return {dark,lit,delta:lit-dark};
 });assert.ok(result.delta>2,JSON.stringify(result));console.log(result);
 }finally{await browser.close()}})().catch(e=>{console.error(e);process.exit(1)});
