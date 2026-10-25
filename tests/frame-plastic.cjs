const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
 const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader']});
 try {
 const page = await browser.newPage({viewport:{width:600,height:900},serviceWorkers:'block'});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.addInitScript(() => { window.requestAnimationFrame = cb => setTimeout(() => cb(performance.now()), 100); });
 await page.goto(process.env.TEST_URL || 'http://localhost:8000');
 await page.waitForFunction(()=>window.__toukan?.game.ready && window.__toukan.game.world,{}, {timeout:60000});
 assert.equal(await page.locator('#wall-controls, #frame-controls, input[type=range]').count(), 0);
 const result=await page.evaluate(()=>{
 const g=window.__toukan.game;g.state='ready';g.tilt={x:.25,z:-.25};
 const meshes=[];g.board.traverse(m=>{if(m.material?.userData.frameUniforms)meshes.push(m)});
 if(!meshes.some(m=>m.userData.surface==='door'))throw Error('Door fixture missing');
 const rows=[];
 for(const [key,min,max] of [['frameBevel',0,1],['frameEdgeHighlight',0,5],['frameGloss',1,30],['frameSSS',0,1],['frameCornerRadius',0,1],['frameAO',0,1]]) {
 const images=[];
 for(const value of [min,max]){
 g.updateFrameSettings({[key]:value});
 for(const m of meshes) {
 if(m.material.userData.frameUniforms[key].value!==value)throw Error(key+' uniform mismatch');
 const {position,normal}=m.geometry.attributes;
 if(![...position.array,...normal.array].every(Number.isFinite))throw Error('invalid geometry');
 }
 images.push(g.renderer.domElement.toDataURL());
 }
 if(images[0]===images[1])throw Error(key+' no immediate framebuffer change');
 rows.push(key);
 }
 g.updateFrameSettings({frameBevel:.96,frameEdgeHighlight:4.12,frameGloss:2.20,frameSSS:.79,frameCornerRadius:.92,frameAO:.93});
 return {rows,surfaces:meshes.map(m=>m.userData.surface)};
 });
 await page.screenshot({path:'/workspace/frame-plastic.png'});
 assert.deepEqual(errors,[]);console.log(result);
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
