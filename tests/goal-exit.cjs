// NODE_PATH=/workspace/ball-tools/node_modules CHROMIUM_PATH=/usr/bin/chromium node tests/goal-exit.cjs
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox','--enable-unsafe-swiftshader']});
 try {
  const page=await browser.newPage({viewport:{width:900,height:1000},serviceWorkers:'block'}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{requestAnimationFrame=()=>0;});
  await page.goto(process.env.TEST_URL||'http://127.0.0.1:8000');
  await page.waitForFunction(()=>window.__toukan?.game.balls?.length,{},{timeout:120000,polling:100});
  const results=await page.evaluate(async()=>{
   const {floor}=await import('./src/stage.js'),{GAP,cellCenter,direction}=await import('./src/mechanics.js'),g=window.__toukan.game;
   g.warmupRenderVariants=()=>{};g.renderScene=()=>{};g.events.finished=()=>{};
   let count=0;
   const exits=[{x:7,z:10,rotation:1},{x:0,z:5,rotation:3},{x:3,z:0,rotation:2},{x:3,z:10,rotation:0}];
   for(const size of ['S','M']) for(const fi of [0,1]) for(const goal of exits) {
    const stage={version:1,name:'Exit regression',author:'test',size,limit:300,balls:[{x:3,z:5,floor:fi}],floors:[floor(),floor()]};
    stage.floors[fi].cells=[{type:'goal',...goal}];g.load(stage,false);
    const b=g.balls[0],q=cellCenter(goal.x,goal.z),[dx,dz]=direction(goal);
    for(const offset of [-.08,0,.08]) for(const speed of [1,4,12]) {
     clearTimeout(g.autoReplay);g.state='playing';g.elapsed=0;g.outcome=null;b.done=false;b.floor=fi;
     b.body.setBodyType(g.R.RigidBodyType.Dynamic,true);b.collider.setSensor(false);
     b.body.setTranslation({x:q.x+dx*.3-dz*offset,y:-fi*GAP+b.radius+.002,z:q.z+dz*.3+dx*offset},true);
     b.body.setLinvel({x:dx*speed,y:0,z:dz*speed},true);b.body.setAngvel({x:0,y:0,z:0},true);
     g.target={x:0,z:0};g.tilt={x:0,z:0};g.keys.clear();g.pointers.clear();g.gyro=false;
     for(let frame=0;frame<180&&g.state==='playing';frame++)g.step(1/60);
     if(!g.outcome?.won)throw Error(JSON.stringify({size,fi,goal,offset,speed,outcome:g.outcome,position:b.body.translation()}));
     count++;
    }
   }
   return {physicsExitCases:count};
  });
  assert.deepEqual(errors,[]);console.log(JSON.stringify({...results,errors}));
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
