const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.addInitScript(() => { window.requestAnimationFrame = () => 0; localStorage.setItem('toukan.wall-settings', JSON.stringify({ wallThickness:2 })); });
    await page.goto(process.env.TEST_URL || 'http://127.0.0.1:8000');
    await page.waitForFunction(() => window.__toukan?.game.world, {}, { polling:100,timeout:180000 });
    console.log('Two-level world ready');
    const physics = await page.evaluate(async () => {
      const { GAP, floor, validateStage } = await import('./src/stage.js');
      const g=window.__toukan.game, original=structuredClone(g.stage), settings={...g.wallSettings};
      const check=(condition,message)=>{if(!condition)throw Error(message)};
      g.warmupRenderVariants=()=>{};
      const shell=g.floorGroups[0].children.find(m=>m.userData.continuousShell);
      check(shell,'Shared perimeter must be one upper/lower shell');
      shell.geometry.computeBoundingBox();
      check(Math.abs(shell.position.y+shell.geometry.boundingBox.min.y+GAP+.24)<1e-5,
        'Shared shell must extend below the lower floor');
      check(Math.abs(shell.position.y+shell.geometry.boundingBox.max.y-1.31)<1e-5,
        'Shared shell must retain its upper rim height');
      const shellP=shell.geometry.attributes.position;
      for(let i=0;i<shellP.count;i++)
        check(Math.abs(shellP.getY(i)+shell.position.y)>1e-5,
          'Shared shell must have no bevel or cap at the upper/lower join');
      // Every ramp quad is one plane, including the full upper/lower side.
      for (const rotation of [0,1,2,3]) {
        const rampStage=structuredClone(original);
        rampStage.floors[0].cells=rampStage.floors[0].cells.filter(c=>c.type!=='ramp');
        rampStage.floors[0].cells.push({x:3,z:5,type:'ramp',rotation});
        g.load(rampStage,false);
        const geometry=g.ramps[0].mesh.geometry, p=geometry.attributes.position, n=geometry.attributes.normal;
        check(!geometry.index,'Ramp faces must not share smoothed corner normals');
        for(let i=0;i<p.count;i+=6) {
          for(let j=0;j<6;j++) {
            check(Math.hypot(n.getX(i+j)-n.getX(i),n.getY(i+j)-n.getY(i),n.getZ(i+j)-n.getZ(i))<1e-5,
              'Ramp side has a shading seam between upper/lower vertices');
          }
        }
      }
      g.load(original,false);
      check(g.floorGroups.length===2 && g.lidReflections.length===1,'Exactly two floors and one outer lid required');
      const upperFloor=g.floorGroups[0].children.find(m=>m.userData.surface==='floor');
      upperFloor.geometry.computeBoundingBox();
      check(Math.abs(upperFloor.position.y+upperFloor.geometry.boundingBox.min.y+.24)<1e-6,'Upper slab underside must remain at -.24');
      for(const size of ['S','M']) {
        g.load({...original,size},false);g.state='playing';
        const b=g.balls[0];g.setLighting();const cameraY=g.camera.position.y;
        b.body.setTranslation({x:.5,y:b.radius+.02,z:2},true);
        for(let i=0;i<120;i++)g.step(1/60);
        check(b.floor===1&&Math.abs(b.body.translation().y-(-GAP+b.radius))<.03,'Hole must drop ball straight into the lower chamber');
        g.sync();g.setLighting();check(g.viewFloor===0&&g.camera.position.y===cameraY,'Camera followed the lower ball');
        b.body.setTranslation({x:-3.5,y:-GAP+b.radius+.01,z:5},true);b.body.setLinvel({x:0,y:0,z:0},true);b.floor=1;
        g.keys.add('ArrowUp');let returned=false;
        for(let i=0;i<240;i++){g.step(1/60);returned ||= b.floor===0 && b.body.translation().y>.3;}
        g.keys.clear();check(returned,`${size} must climb the two-cell ramp without jump/teleport`);
        check(g.ramps[0].collider.containsPoint({x:-3.5,y:-.9,z:3.5}),'Ramp underside contains an air cavity');
      }
      g.load(original,false);g.state='playing';let b=g.balls[0],d=g.doors[0];
      check(!d.mesh.material.transparent&&d.mesh.material.color.getHex()===0x269c67&&d.post.material.color.getHex()===0x269c67,'Door/post must be solid green molded plastic');
      check(d.postCollider.parent().handle===d.postBody.handle,'Post must use its telescoping support body');
      b.body.setTranslation({x:d.x-.8,y:-GAP+b.radius+.01,z:d.z},true);b.floor=1;g.keys.add('ArrowRight');
      for(let i=0;i<30;i++)g.step(1/60);
      g.keys.clear();check(b.body.translation().x<d.x-.35,'Lower ball passed through the door post');
      b.body.setTranslation({x:3,y:.42,z:4.8},true);b.body.setLinvel({x:0,y:0,z:0},true);b.floor=0;g.elapsed=4.1;
      for(let i=0;i<60;i++)g.step(1/60);
      check(d.slide>.99&&Math.abs(d.mesh.position.y+.6)<1e-6,'Door did not retract below the slot');
      check(Math.abs(d.mesh.position.x-d.x)<1e-6&&Math.abs(d.mesh.position.z-d.z)<1e-6,'Lift door moved sideways');
      // A creator may start and finish in the lower layer; camera still stays above.
      const lower=structuredClone(original);lower.balls=[{x:6,z:8,floor:1}];lower.floors[0].cells=lower.floors[0].cells.filter(c=>c.type!=='goal');lower.floors[1].cells.push({x:7,z:9,type:'goal',rotation:1});
      g.load(validateStage(lower),false);b=g.balls[0];check(b.floor===1&&b.body.translation().y<0,'Lower start was ignored');
      g.state='playing';b.body.setTranslation({x:3.5,y:-GAP+b.radius+.01,z:4},true);b.body.setLinvel({x:2,y:0,z:0},true);g.step(1/60);
      for(let i=0;i<30&&!b.done;i++)g.step(1/60);
      check(b.done&&g.outcome?.won&&g.viewFloor===0,'Lower side exit or fixed camera failed');
      // Replay vertical door travel without changing viewpoint.
      g.load(original,false);d=g.doors[0];g.recordFrame();g.setDoorVisual(d,1);d.open=true;g.recordFrame();
      g.outcome={floor:1,ballIndex:0,reason:'test',won:false};g.playReplay(true);g.updateReplay(.1);
      check(g.viewFloor===0&&d.slide>.99&&Math.abs(d.mesh.position.y+.6)<1e-6,'Replay changed the camera or lost vertical door movement');
      g.load(original,false);g.sync();g.renderScene();document.querySelector('#start-panel').hidden=true;
      check(JSON.stringify(g.wallSettings)===JSON.stringify(settings),'Wall tuning changed');
      return {layers:g.stage.floors.length,gap:GAP,ramps:g.ramps.length,doors:g.doors.length};
    });
    console.log('Physics checks passed:',JSON.stringify(physics));
    fs.mkdirSync('/workspace/ball-captures/v2.1.0',{recursive:true});
    await page.screenshot({path:'/workspace/ball-captures/v2.1.0/upper.png'});
    await page.evaluate(()=>{const g=window.__toukan.game;g.tilt={x:-.3,z:.2};g.renderScene()});
    await page.screenshot({path:'/workspace/ball-captures/v2.1.0/tilted.png'});
    await page.evaluate(()=>{document.querySelectorAll('dialog[open]').forEach(d=>d.close());const {game,editor}=window.__toukan;editor.open(game.stage)});
    assert.deepEqual(await page.locator('#edit-floor option').allTextContents(),['上段','下段']);
    assert.equal(await page.locator('#add-floor').count(),0);
    await page.selectOption('#edit-floor','1');await page.click('[data-tool=ball]');
    await page.evaluate(()=>{
      const ed=window.__toukan.editor,r=ed.canvas.getBoundingClientRect();ed.touched=new Set();
      ed.paint({clientX:r.left+r.width*6.5/8,clientY:r.top+r.height*8.5/11});
      if(!ed.stage.balls.some(b=>b.floor===1&&b.x===6&&b.z===8))throw Error('Editor refused lower start');
      ed.snapshot();ed.tool='sticky';ed.touched=new Set();const before=JSON.stringify(ed.stage);
      ed.paint({clientX:r.left+r.width*3.5/8,clientY:r.top+r.height*2.5/11});
      if(JSON.stringify(ed.stage)!==before)throw Error('Editor allowed material in upper door post travel');
      ed.history('undo','redo');ed.history('redo','undo');
    });
    await page.screenshot({path:'/workspace/ball-captures/v2.1.0/editor-lower.png'});
    assert.deepEqual(errors,[]);
    console.log('PASS: contiguous layers, S/M fall and ramp return, fixed camera/replay, vertical door/support motion, lower starts/goals, editor reservations, tuning preservation');
  }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
