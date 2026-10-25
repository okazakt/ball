const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox','--enable-unsafe-swiftshader']});
 try {
 const page=await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'block'});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 await page.addInitScript(()=>{window.requestAnimationFrame=cb=>setTimeout(()=>cb(performance.now()),100)});
 await page.goto(process.env.TEST_URL||'http://localhost:8000');
 await page.waitForFunction(()=>window.__toukan?.game.ready&&window.__toukan.game.stage,{}, {timeout:120000});
 console.log(await page.evaluate(()=>{
 const g=window.__toukan.game;const floors=[];
 g.board.traverse(m=>{if(['floor','hole-floor'].includes(m.userData.surface))floors.push(m)});
 const upper=floors.filter(m=>m.layers.mask===2),lower=floors.filter(m=>m.layers.mask===4);
 if(!upper.some(m=>m.userData.surface==='hole-floor'))throw Error('No circular hole fixture');
 for(const m of upper){
 if(!Array.isArray(m.material)||!m.material[0].map||m.material[1].map||!m.geometry.userData.paperThickness)throw Error('Laminate missing');
 const u=m.material[1].userData.frameUniforms;
 for(const [key,value] of Object.entries(g.frameSettings))if(u[key].value!==value)throw Error('ABS settings mismatch');
 }
 const core=upper[0].material[1];
 for(const m of lower){
 if(Array.isArray(m.material)||m.material.map||!m.material.userData.frameUniforms)throw Error('Lower ABS missing');
 if(m.material.color.getHex()!==core.color.getHex()||m.material.roughness!==core.roughness)throw Error('ABS finish differs');
 for(const [key,value] of Object.entries(g.frameSettings))if(m.material.userData.frameUniforms[key].value!==value)throw Error('Lower ABS settings mismatch');
 }
 g.updateFrameSettings({...g.frameSettings});
 document.querySelector('#start-panel').hidden=true;
 return {version:document.querySelector('#app-version').textContent,upperFloorParts:upper.length,lowerFloorParts:lower.length};
 }));
 for(const [name,tilt] of [['top',{x:0,z:0}],['tilted',{x:.35,z:-.35}]]){
 await page.evaluate(tilt=>{const g=window.__toukan.game;g.tilt=tilt;g.renderScene()},tilt);
 await page.screenshot({path:`/workspace/ball-captures/2.2.4-${name}.png`});
 }
 assert.deepEqual(errors,[]);
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
