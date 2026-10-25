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
   const g=window.__toukan.game,T=window.THREE,{floor}=await import('./src/stage.js');
   g.warmupRenderVariants=()=>{};
   const stage={version:1,name:'Robot regression',author:'test',size:'M',limit:300,balls:[{x:0,z:0}],floors:[floor(),floor()]};
   stage.floors[0].cells=[{type:'robot',x:3,z:5,rotation:0},{type:'goal',x:7,z:10,rotation:1}];
   stage.floors[0].walls.push({axis:'h',x:3,z:6},{axis:'v',x:4,z:5});
   g.load(stage,false);g.renderScene();
   const e=g.enemies[0],points=()=>{
    e.cone.updateWorldMatrix(true,false);
    const attr=e.cone.geometry.attributes.position;
    return Array.from({length:e.cone.geometry.drawRange.count},(_,i)=>new T.Vector3().fromBufferAttribute(attr,i).applyMatrix4(e.cone.matrixWorld));
   };
   const forwardMax=Math.max(...points().map(p=>p.z));
   if(forwardMax>.451)throw Error('Rendered cone crosses front wall: '+forwardMax);
   if(g.clearSight(0,e,{x:-.5,z:1}))throw Error('Detection crosses front wall');
   // Replay changes group transforms directly; the fan must be rebuilt there too.
   e.g.position.z=-.1;e.g.rotation.y=Math.PI/2;g.renderScene();
   const replayMax=Math.max(...points().map(p=>p.x));
   if(replayMax>-.049)throw Error('Replay cone crosses right wall: '+replayMax);
   // Moving a ball right up to the far face must not capture it through a wall.
   const ball=g.balls[0];ball.body.setTranslation({x:-.5,y:.4,z:.61},true);ball.floor=0;
   let captured=false;const finish=g.finish;g.finish=()=>{captured=true;};g.updateEnemies(1/60);g.finish=finish;
   if(captured)throw Error('Robot captures through a wall');
   document.querySelector('#start-panel').hidden=true;
   return {forwardMax,replayMax,drawnVertices:e.cone.geometry.drawRange.count,captured};
  });
  await page.screenshot({path:'/tmp/robot-wall-vision.png'});
  assert.deepEqual(errors,[]);console.log(JSON.stringify({...result,errors}));
  await page.click('#menu');await page.click('#quest');await page.locator('#quest-list button').nth(3).click();
  await page.waitForFunction(()=>window.__toukan.game.stage.name.startsWith('4'),{},{polling:100});
  await page.evaluate(()=>{document.querySelector('#start-panel').hidden=true;window.__toukan.game.renderScene();});
  await page.screenshot({path:'/tmp/quest-4-robot-vision.png'});
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
