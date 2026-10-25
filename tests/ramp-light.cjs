const {chromium}=require('playwright');const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox','--enable-unsafe-swiftshader']});try{
 const page=await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'block'}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 await page.addInitScript(()=>{requestAnimationFrame=cb=>setTimeout(()=>cb(performance.now()),100)});
 await page.goto(process.env.TEST_URL||'http://localhost:8000');await page.waitForFunction(()=>window.__toukan?.game.prewarmedPrograms,{}, {timeout:180000});
 console.log(await page.evaluate(()=>{
 const g=window.__toukan.game,T=window.THREE,b=g.balls[0],ramp=g.ramps[0].mesh,floor=g.lowerFloorMeshes.find(m=>m.userData.surface==='floor');
 if(b.light||b.mesh.children.some(m=>m.isLight))throw Error('Ball light remains');
 if(g.movingLights.some(l=>l.parent===b.mesh))throw Error('Following light still registered');
 for(const m of [ramp,floor])if(!m.material.userData.surfaceField||!m.material.userData.frameUniforms)throw Error('Common ABS field missing');
 if(ramp.material.customProgramCacheKey()!==floor.material.customProgramCacheKey())throw Error('Materials use different shading');
 const gl=g.renderer.getContext(),size=g.renderer.getDrawingBufferSize(new T.Vector2());
 const sample=()=>{const p=new T.Vector3(.5,-1.24,2).project(g.camera),data=new Uint8Array(5*5*4);gl.readPixels(Math.round((p.x+1)*size.x/2)-2,Math.round((p.y+1)*size.y/2)-2,5,5,gl.RGBA,gl.UNSIGNED_BYTE,data);return [...data]};
 const shots=[];
 for(const z of [1,3]){b.body.setTranslation({x:.5,y:-.84,z},true);b.floor=1;g.sync();g.renderScene();shots.push(sample())}
 const ballGlowDelta=Math.max(...shots[0].map((v,i)=>Math.abs(v-shots[1][i])));
 if(ballGlowDelta>1)throw Error('Invisible ball changes floor light: '+ballGlowDelta);
 g.state='playing';g.updateLowerRipples(1);if(g.ripples.length)throw Error('Position rings remain');g.state='ready';
 // Render the same tangent plane using each surface's material and local
 // coordinates. Equal pixels at the toe rule out a material/lighting seam.
 const comparison=[];
 for(const [material,y,offset] of [[floor.material,.24,-1.48],[ramp.material,-1.24,0]]){
 const geometry=new T.PlaneGeometry(.5,.5).rotateX(-Math.PI/2).translate(.5,y+.001,2);
 const plane=new T.Mesh(geometry,material);plane.position.y=offset;plane.layers.set(2);g.board.add(plane);
 g.renderScene();comparison.push(sample());g.board.remove(plane);geometry.dispose();
 }
 const materialSeamDelta=Math.max(...comparison[0].map((v,i)=>Math.abs(v-comparison[1][i])));
 if(materialSeamDelta>2)throw Error('Toe materials differ: '+materialSeamDelta);
 document.querySelector('#start-panel').hidden=true;g.renderScene();
 return {ballGlowDelta,materialSeamDelta,followingLights:0,rings:g.ripples.length};
 }));
 assert.deepEqual(errors,[]);await page.screenshot({path:'/workspace/ball-captures/2.2.6-ramp.png'});
 }finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
