const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox','--enable-unsafe-swiftshader']});
 try {
  const page=await browser.newPage({viewport:{width:900,height:1000},serviceWorkers:'block'}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>requestAnimationFrame=()=>0);
  await page.goto(process.env.TEST_URL||'http://127.0.0.1:8000');
  await page.waitForFunction(()=>window.__toukan?.game.balls?.length,{},{timeout:120000,polling:100});
  const result=await page.evaluate(async()=>{
   const g=window.__toukan.game,T=window.THREE,{questStage}=await import('./src/quests.js'),{GAP}=await import('./src/mechanics.js');
   g.warmupRenderVariants=()=>{};g.load(questStage(1),true);
   document.querySelector('#start-panel').hidden=true;
   const windows=g.floorGroups[0].children.filter(m=>m.userData.surface==='translucent-floor');
   const lower=g.floorGroups[1].children.find(m=>m.userData.surface==='floor');
   const upper=g.floorGroups[0].children.find(m=>m.userData.surface==='floor');
   const print=windows[0].material[2];
   const a=upper.material[0].map.image.getContext('2d').getImageData(0,0,768,1056).data;
   const b=lower.material.map.image.getContext('2d').getImageData(0,0,768,1056).data;
   const c=print.map.image.getContext('2d').getImageData(0,0,768,1056).data;
   if(!a.every((v,i)=>v===b[i]&&v===c[i]))throw Error('Floor prints differ');
   g.board.updateMatrixWorld(true);let covered=0;
   for(let z=0;z<11;z++)for(let x=0;x<8;x++) {
    const ray=new T.Raycaster(new T.Vector3(x-3.5,-.6,z-5),new T.Vector3(0,-1,0));ray.layers.set(2);
    if(ray.intersectObject(lower).length)covered++;
   }
   const beams=[];g.board.traverse(n=>{if(n.userData.surface==='transmitted-daylight')beams.push(n)});
   const sample=(x,z)=>{
    const p=new T.Vector3(x,-GAP+.01,z).project(g.camera),size=g.renderer.getDrawingBufferSize(new T.Vector2());
    const px=Math.round((p.x+1)*size.x/2),py=Math.round((p.y+1)*size.y/2),pixels=new Uint8Array(17*17*4);
    g.renderer.getContext().readPixels(px-8,py-8,17,17,g.renderer.getContext().RGBA,g.renderer.getContext().UNSIGNED_BYTE,pixels);
    let sum=0;for(let i=0;i<pixels.length;i++)if(i%4!==3)sum+=pixels[i];return sum/(17*17*3);
   };
   g.viewFloor=1;g.renderScene();const lit=sample(-3.5,-4),farLit=sample(2.5,4);
   beams.forEach(l=>l.visible=false);g.renderScene();const unlit=sample(-3.5,-4),farUnlit=sample(2.5,4);
   beams.forEach(l=>l.visible=true);g.viewFloor=0;g.renderScene();
   return {windowCount:windows.length,opacity:print.opacity,printed:!!print.map,lowerCoveredTiles:covered,matchingPatterns:true,beamCount:beams.length,lit,unlit,farLit,farUnlit};
  });
  await page.screenshot({path:'/tmp/translucent-floor-stage2.png'});
  assert.equal(result.windowCount,6);assert.equal(result.opacity,.6);assert.equal(result.lowerCoveredTiles,88);
  assert.equal(result.matchingPatterns,true);assert.equal(result.beamCount,6);
  assert.ok(result.lit>result.unlit+1,JSON.stringify(result));
  assert.ok(result.lit-result.unlit>result.farLit-result.farUnlit,JSON.stringify(result));
  assert.deepEqual(errors,[]);console.log(JSON.stringify({...result,errors}));
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
