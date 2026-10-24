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
    await page.waitForFunction(() => window.__toukan?.game.world, {}, { polling:100 });
    console.log('Two-level world ready');
    const physics = await page.evaluate(async () => {
      const { GAP, floor, validateStage } = await import('./src/stage.js');
      const g=window.__toukan.game, original=structuredClone(g.stage), settings={...g.wallSettings};
      const check=(condition,message)=>{if(!condition)throw Error(message)};
      check(g.floorGroups.length===2 && g.lidReflections.length===1,'Exactly two floors and one outer lid required');
      const upperFloor=g.floorGroups[0].children.find(m=>m.userData.surface==='floor');
      const lowerWall=g.floorGroups[1].children.find(m=>m.userData.surface==='walls');
      upperFloor.geometry.computeBoundingBox();lowerWall.geometry.computeBoundingBox();
      check(Math.abs(upperFloor.position.y+upperFloor.geometry.boundingBox.min.y-lowerWall.position.y-lowerWall.geometry.boundingBox.max.y)<1e-6,'Lower walls must meet upper floor underside');
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
      check(d.postCollider.parent().handle===d.body.handle,'Post must share the moving door rigid body');
      b.body.setTranslation({x:-1.3,y:-GAP+b.radius+.01,z:-2},true);b.floor=1;g.keys.add('ArrowRight');
      for(let i=0;i<30;i++)g.step(1/60);
      g.keys.clear();check(b.body.translation().x<d.post.position.x-.39,'Lower ball passed through the door post');
      b.body.setTranslation({x:2.5,y:.42,z:4},true);b.body.setLinvel({x:0,y:0,z:0},true);b.floor=0;
      // Keep the ball away from the goal while testing motion.
      b.body.setTranslation({x:3,y:.42,z:4.8},true);g.elapsed=3.9;
      const y=d.mesh.position.y,postY=d.post.position.y;
      for(let i=0;i<60;i++) {
        g.step(1/60);
        const physical=d.body.translation();
        check(Math.abs(physical.x-d.mesh.position.x)<1e-5&&Math.abs(physical.z-d.mesh.position.z)<1e-5,'Door visual and rigid body diverged');
        check(d.mesh.position.y===y&&d.post.position.y===postY,'Door moved vertically');
        check(Math.abs(d.post.position.x-d.mesh.position.x)<1e-8&&Math.abs(d.post.position.z-d.mesh.position.z)<1e-8,'Door left its post behind');
      }
      check(d.slide>.99&&Math.abs(d.mesh.position.x-d.x-1)<1e-6,'Door must slide one cell into its reserved storage cell');
      // Four orientations must use the same smooth rigid-body motion.
      for(let rotation=0;rotation<4;rotation++) {
        const s={...original,balls:[{x:1,z:1}],floors:[floor(),floor()]};
        s.floors[0].cells=[{type:'door',x:3,z:5,rotation},{type:'goal',x:6,z:9}];
        const { direction, sharedEdge, footprint } = await import('./src/mechanics.js');
        const c=s.floors[0].cells[0], [dx,dz]=direction(c), tiles=footprint(c);
        const endWalls=[sharedEdge(tiles[0],{x:c.x-dx,z:c.z-dz}),sharedEdge(tiles[1],{x:c.x+2*dx,z:c.z+2*dz})];
        s.floors.forEach(f=>f.walls.push(...endWalls));
        g.load(validateStage(s),false);g.state='playing';g.elapsed=4.1;
        for(let i=0;i<40;i++) {
          g.step(1/60);
          const door=g.doors[0];
          g.world.forEachCollider(other=>{
            if(other.parent())return;
            for(const moving of [door.collider,door.postCollider]) {
              const contact=moving.contactCollider(other,0);
              check(!contact || contact.distance > -.001,'Door/post penetrated a static material while moving');
            }
          });
        }
        const door=g.doors[0];check(Math.abs(door.slide-1)<1e-6,'Rotated door failed to open');
        check(Math.abs(door.body.translation().x-(door.x+door.dx))<1e-5&&Math.abs(door.body.translation().z-(door.z+door.dz))<1e-5,'Rotated door moved outside its slot');
      }
      // A creator may start and finish in the lower layer; camera still stays above.
      const lower=structuredClone(original);lower.balls=[{x:6,z:8,floor:1}];lower.floors[1].cells.push({x:6,z:9,type:'goal'});
      g.load(validateStage(lower),false);b=g.balls[0];check(b.floor===1&&b.body.translation().y<0,'Lower start was ignored');
      g.state='playing';b.body.setTranslation({x:2.5,y:-GAP+b.radius+.01,z:4},true);g.step(1/60);
      for(let i=0;i<30&&!b.done;i++)g.step(1/60);
      check(b.done&&g.outcome?.won&&g.viewFloor===0,'Lower goal contact or fixed camera failed');
      // Replay horizontal door travel without changing viewpoint.
      g.load(original,false);d=g.doors[0];g.recordFrame();g.setDoorVisual(d,1);d.open=true;g.recordFrame();
      g.outcome={floor:1,ballIndex:0,reason:'test',won:false};g.playReplay(true);g.updateReplay(.1);
      check(g.viewFloor===0&&d.slide>.99&&d.mesh.position.y===.5,'Replay changed the camera or used vertical door movement');
      g.load(original,false);g.sync();g.renderScene();document.querySelector('#start-panel').hidden=true;
      check(JSON.stringify(g.wallSettings)===JSON.stringify(settings),'Wall tuning changed');
      return {layers:g.stage.floors.length,gap:GAP,ramps:g.ramps.length,doors:g.doors.length};
    });
    console.log('Physics checks passed:',JSON.stringify(physics));
    fs.mkdirSync('/workspace/ball-captures/v2.0.0',{recursive:true});
    await page.screenshot({path:'/workspace/ball-captures/v2.0.0/upper.png'});
    await page.evaluate(()=>{const g=window.__toukan.game;g.tilt={x:-.3,z:.2};g.renderScene()});
    await page.screenshot({path:'/workspace/ball-captures/v2.0.0/tilted.png'});
    await page.evaluate(()=>{document.querySelectorAll('dialog[open]').forEach(d=>d.close());const {game,editor}=window.__toukan;editor.open(game.stage)});
    assert.deepEqual(await page.locator('#edit-floor option').allTextContents(),['上段','下段']);
    assert.equal(await page.locator('#add-floor').count(),0);
    await page.selectOption('#edit-floor','1');await page.click('[data-tool=ball]');
    await page.evaluate(()=>{
      const ed=window.__toukan.editor,r=ed.canvas.getBoundingClientRect();ed.touched=new Set();
      ed.paint({clientX:r.left+r.width*6.5/8,clientY:r.top+r.height*8.5/11});
      if(!ed.stage.balls.some(b=>b.floor===1&&b.x===6&&b.z===8))throw Error('Editor refused lower start');
      ed.snapshot();ed.tool='sticky';ed.touched=new Set();const before=JSON.stringify(ed.stage);
      ed.paint({clientX:r.left+r.width*4.5/8,clientY:r.top+r.height*3.5/11});
      if(JSON.stringify(ed.stage)!==before)throw Error('Editor allowed material in upper door post travel');
      ed.history('undo','redo');ed.history('redo','undo');
    });
    await page.screenshot({path:'/workspace/ball-captures/v2.0.0/editor-lower.png'});
    assert.deepEqual(errors,[]);
    console.log('PASS: contiguous layers, S/M fall and ramp return, fixed camera/replay, horizontal doors/posts in four directions, lower starts/goals, editor reservations, tuning preservation');
  }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
