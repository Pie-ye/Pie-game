// Run with Playwright installed, or PLAYWRIGHT_MODULE=/path/to/playwright.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const base=process.env.EGG_TEST_URL||'http://127.0.0.1:18765/games/community/phoebe-egg/';
(async()=>{
  const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
    await page.goto(base);await page.waitForFunction(()=>!!window.__egg);
    await page.screenshot({path:'/tmp/phoebe-egg-title.png'});
    await page.click('#start');await page.waitForFunction(()=>__egg.game.mode==='play');
    // Real keyboard events feed the production input adapter; advance simulation deterministically.
    await page.keyboard.down('w');
    const moved=await page.evaluate(()=>{const before=__egg.game.player.z;for(let i=0;i<30;i++)__egg.game.update(1/60,__egg.readInput());return before-__egg.game.player.z;});
    await page.keyboard.up('w');assert.ok(moved>1);
    await page.keyboard.press('Space');assert.ok(await page.evaluate(()=>__egg.game.player.stamina<100));
    await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>__egg.game.mode),'pause');
    const pausedTime=await page.evaluate(()=>__egg.game.elapsed);await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>__egg.game.elapsed),pausedTime);
    await page.click('#resume');
    await page.evaluate(()=>{const g=__egg.game;Object.assign(g.player,{x:0,y:0,z:-23,roll:0,stamina:100});g.enemy.cooldown=100;});
    await page.keyboard.press('e');assert.equal(await page.evaluate(()=>__egg.game.player.egg.hp),3);
    await page.evaluate(()=>{Object.assign(__egg.game.player,{x:-15,y:0,z:10.1});});
    await page.keyboard.press('e');assert.ok(await page.evaluate(()=>!!__egg.game.player.climb));
    await page.evaluate(()=>{for(let i=0;i<135;i++)__egg.game.update(1/60,{x:0,z:0,run:false,use:false});});
    assert.equal(await page.evaluate(()=>__egg.game.player.y),3.2);
    await page.screenshot({path:'/tmp/phoebe-egg-climb.png'});
    // Front inspection of the 3D character; rotate the actual camera using pointer input.
    await page.mouse.move(900,400);await page.mouse.down({button:'right'});await page.mouse.move(1423,400,{steps:5});await page.mouse.up({button:'right'});
    await page.waitForTimeout(300);await page.screenshot({path:'/tmp/phoebe-egg-front.png'});
    for(let trip=0;trip<3;trip++){
      if(trip>0){await page.evaluate(()=>Object.assign(__egg.game.player,{x:0,y:0,z:-23}));await page.keyboard.press('e');}
      await page.evaluate(()=>Object.assign(__egg.game.player,{x:0,y:0,z:23}));
      await page.keyboard.down('e');
      await page.evaluate(()=>{for(let i=0;i<65;i++)__egg.game.update(1/60,__egg.readInput());});
      await page.keyboard.up('e');assert.equal(await page.evaluate(()=>__egg.game.delivered),trip+1);
    }
    await page.waitForFunction(()=>document.getElementById('modal-title').textContent==='委託完成！');
    assert.ok(await page.evaluate(()=>Number(localStorage.getItem('pg-phoebe-egg-best'))>0));
    await page.screenshot({path:'/tmp/phoebe-egg-win.png'});
    await page.click('#restart');assert.equal(await page.evaluate(()=>__egg.game.delivered),0);
    await page.screenshot({path:'/tmp/phoebe-egg-play.png'});
    const graphics=await page.evaluate(()=>({calls:__egg.renderer.info.render.calls,triangles:__egg.renderer.info.render.triangles}));
    const phone=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    phone.on('pageerror',e=>errors.push(e.message));await phone.goto(base);await phone.waitForFunction(()=>!!window.__egg);await phone.tap('#start');
    await phone.locator('#touch').waitFor({state:'visible'});
    await phone.evaluate(()=>Object.assign(__egg.game.player,{x:0,y:0,z:-23}));await phone.tap('#touch-use');assert.ok(await phone.evaluate(()=>!!__egg.game.player.egg));
    await phone.tap('#touch-roll');assert.ok(await phone.evaluate(()=>__egg.game.player.stamina<100));
    await phone.screenshot({path:'/tmp/phoebe-egg-mobile.png'});
    assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,checks:['desktop load','keyboard movement','roll','pause/resume','pickup','climb','camera orbit','three deliveries','result','best score','restart','touch pickup/roll'],graphics,errors}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
