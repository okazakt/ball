const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox','--enable-unsafe-swiftshader']});
 try {
  const page=await browser.newPage({serviceWorkers:'block'});
  await page.addInitScript(()=>requestAnimationFrame=()=>0);
  await page.goto(process.env.TEST_URL||'http://127.0.0.1:8000');
  await page.waitForFunction(()=>window.__toukan?.game.balls?.length,{},{timeout:120000,polling:100});
  const result=await page.evaluate(async()=>{
   const g=window.__toukan.game,{defaultStage}=await import('./src/stage.js');
   g.warmupRenderVariants=()=>{};
   const results=[];
   for(const acceleration of [{x:0,y:0,z:0},{x:5,y:0,z:0},{x:0,y:5,z:0}]) {
    const stage=defaultStage();stage.balls=[{x:4,z:5}];
    stage.floors=stage.floors.map(()=>({dark:false,cells:[],walls:[]}));
    g.load(stage,false);g.start();await g.enableGyro();
    const b=g.balls[0];
    for(let i=0;i<60;i++)g.step(1/60);
    b.body.setLinvel({x:0,y:0,z:0},true);b.body.sleep();
    const before=b.body.translation();
    for(let i=0;i<12;i++) {
     g.motionHandler({acceleration});g.step(1/60);
    }
    const after=b.body.translation();results.push({x:after.x-before.x,z:after.z-before.z});
   }
   g.motionHandler({acceleration:{x:5,y:0,z:0}});
   window.dispatchEvent(new Event('blur'));g.step(1/60);
   return {results,gravity:g.world.gravity,tilt:g.tilt};
  });
  assert.ok(Math.hypot(result.results[0].x,result.results[0].z)<.001);
  assert.ok(result.results[1].x<-.05,JSON.stringify(result));
  assert.ok(result.results[2].z>.05,JSON.stringify(result));
  assert.equal(result.gravity.x,0);assert.equal(result.gravity.z,0);
  assert.deepEqual(result.tilt,{x:0,z:0});
  console.log(JSON.stringify(result));
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
