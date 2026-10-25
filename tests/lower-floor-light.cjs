const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox','--enable-unsafe-swiftshader']});try{
 const page=await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'block'}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 await page.addInitScript(()=>{requestAnimationFrame=cb=>setTimeout(()=>cb(performance.now()),100)});
 await page.goto(process.env.TEST_URL||'http://localhost:8000');
 await page.waitForFunction(()=>window.__toukan?.game.prewarmedPrograms,{}, {timeout:180000});
 const result=await page.evaluate(async()=>{
 const g=window.__toukan.game,T=window.THREE,{prepareFramePlastic}=await import('./src/frame-plastic.js');
 const floor=g.lowerFloorMeshes[0],mat=floor.material;
 g.tilt={x:0,z:0};g.renderScene();
 if(mat.envMapIntensity!==.015)throw Error('Lower reflection not attenuated');
 if(mat.userData.spatialUniforms.movingSun.value.getHex()!==0)throw Error('Upper sunlight reaches lower floor');
 for(const [k,v] of Object.entries(g.frameSettings))if(mat.userData.frameUniforms[k].value!==v)throw Error('Material settings changed');
 const size=g.renderer.getDrawingBufferSize(new T.Vector2()),gl=g.renderer.getContext();
 const sample=()=>{const q=new T.Vector3(.5,-1.24,2).project(g.camera),data=new Uint8Array(9*9*4);gl.readPixels(Math.round((q.x+1)*size.x/2)-4,Math.round((q.y+1)*size.y/2)-4,9,9,gl.RGBA,gl.UNSIGNED_BYTE,data);let luma=0;for(let i=0;i<data.length;i+=4)luma+=.2126*data[i]+.7152*data[i+1]+.0722*data[i+2];return luma/81};
 const current=sample();
 const old=prepareFramePlastic(g.casePlastic(),g.frameSettings,.24);
 floor.material=old;
 const meshes=g.lowerFloorMeshes;g.lowerFloorMeshes=[];g.renderScene();const previous=sample();
 g.lowerFloorMeshes=meshes;floor.material=mat;old.dispose();
 const lights=g.movingLights.map(l=>[l,l.intensity,l.userData.baseIntensity]);
 for(const [l] of lights){l.intensity=0;l.userData.baseIntensity=0}
 g.renderScene();const sheltered=sample();
 for(const [l,intensity,base] of lights){l.intensity=intensity;if(base===undefined)delete l.userData.baseIntensity;else l.userData.baseIntensity=base}
 g.renderScene();document.querySelector('#start-panel').hidden=true;
 return {previous,current,sheltered,envMapIntensity:mat.envMapIntensity};
 });
 assert.ok(result.current<result.previous*.8,JSON.stringify(result));
 assert.ok(result.current>result.sheltered+2,'Opening light must remain: '+JSON.stringify(result));
 assert.deepEqual(errors,[]);console.log(result);
 await page.screenshot({path:'/workspace/ball-captures/2.2.5-lighting.png'});
 }finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
