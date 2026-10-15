// Browser smoke test (needs Playwright + Chromium): PLAYWRIGHT_MODULE=/path EGG_TEST_URL=http://127.0.0.1:8765/games/community/phoebe-peak/ node tests/phoebe-peak-browser.cjs
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.EGG_TEST_URL||'http://127.0.0.1:8765/games/community/phoebe-peak/';
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const errors=[],checks=[];const ok=n=>checks.push(n);
  try{
    const page=await browser.newPage({viewport:{width:1100,height:700}});
    page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!/404/.test(m.text()))errors.push(m.text());});
    await page.goto(base+'?seed=20000');await page.waitForFunction(()=>!!window.__peak,null,{timeout:90000});ok('scene boots');
    assert.equal(await page.isVisible('#menu'),true);assert.match(await page.textContent('#daily'),/今日山脈 #20000/);
    assert.equal(await page.evaluate(()=>[...document.querySelectorAll('.asc')].filter(b=>!b.disabled).length),1,'only the first ascent is unlocked');ok('menu and ascent lock');
    await page.click('#start');assert.equal(await page.evaluate(()=>!document.getElementById('hud').hidden),true);assert.equal(await page.evaluate(()=>window.__peak.game.mode),'play');ok('start');
    // keyboard mapping (camera yaw 0: forward is -z)
    await page.keyboard.down('w');await page.keyboard.down('Shift');await page.keyboard.down('c');
    const inp=await page.evaluate(()=>window.__peak.readInput());assert.ok(inp.f===1&&inp.mz<-.9&&inp.sprint&&inp.grab);
    await page.keyboard.up('w');await page.keyboard.up('Shift');await page.keyboard.up('c');
    await page.keyboard.press('Space');assert.equal((await page.evaluate(()=>window.__peak.readInput())).jump,true);assert.equal((await page.evaluate(()=>window.__peak.readInput())).jump,false);ok('keyboard input');
    // drive the real game objects: walk into the wall, climb, check stamina HUD
    const step=(sec,keys)=>page.evaluate(([sec,keys])=>{const P=window.__peak,g=P.game;for(let i=0;i<sec*60;i++){const inp=P.readInput();Object.assign(inp,keys);g.update(1/60,inp);P.route(g.events);g.events.length=0;P.sc.update(1/60,P.view);}return {state:g.player.state,y:g.player.y,st:g.stamina};},[sec,keys]);
    let r=await step(2.2,{mx:0,mz:-1});assert.equal(r.state,'wall');ok('auto grab');
    r=await step(2,{f:1});assert.ok(r.y>2&&r.st<95);await page.evaluate(()=>{const P=window.__peak;P.sc.update(.016,P.view);P.sc.renderer.render(P.sc.scene,P.sc.camera);});
    const width=await page.evaluate(()=>parseFloat(document.getElementById('fill').style.width));assert.ok(width<95,'HUD stamina follows');ok('climb + HUD');
    r=await step(7,{f:1});assert.equal(r.state,'move');ok('mantle onto the first ledge');
    // inventory + items through the real UI path
    await page.evaluate(()=>{const g=window.__peak.game;g.inv[1]={kind:'medkit'};g.aff.injury=.3;});await page.keyboard.press('2');
    await step(.2,{});await page.evaluate(()=>window.__peak.game.update(1/60,{...window.__peak.readInput(),use:true}));await step(1.2,{});const inj=await page.evaluate(()=>({i:window.__peak.game.aff.injury,sel:window.__peak.game.sel,inv:window.__peak.game.inv.map(x=>x&&x.kind),eat:window.__peak.game.player.eat,mode:window.__peak.game.mode}));assert.ok(inj.i<.05,JSON.stringify(inj));ok('use item');
    // rendering budget at the start and in the caldera
    const tri=await page.evaluate(()=>{const P=window.__peak;P.sc.update(.016,P.view);P.sc.renderer.render(P.sc.scene,P.sc.camera);return P.sc.renderer.info.render.triangles;});assert.ok(tri<1400000,`triangles ${tri}`);ok('triangle budget '+tri);
    await page.evaluate(()=>{const P=window.__peak,g=P.game,w=g.world,b=w.boxes[w.zones[3].firstBox+3];Object.assign(g.player,{x:(b.x1+b.x2)/2,y:b.y2,z:(b.z1+b.z2)/2,grounded:true,support:b,state:'move'});for(let i=0;i<60;i++)P.sc.update(1/30,P.view);P.sc.renderer.render(P.sc.scene,P.sc.camera);});
    const tri2=await page.evaluate(()=>window.__peak.sc.renderer.info.render.triangles);assert.ok(tri2<1400000,`caldera triangles ${tri2}`);ok('caldera triangles '+tri2);
    // pause and win flow
    await page.click('#pause');assert.equal(await page.evaluate(()=>window.__peak.game.mode),'pause');await page.click('#resume');assert.equal(await page.evaluate(()=>window.__peak.game.mode),'play');ok('pause/resume');
    await page.evaluate(()=>{const g=window.__peak.game,s=g.world.summit;Object.assign(g.player,{x:s.x,y:s.y,z:s.z,grounded:true,support:g.world.boxes[48],state:'move'});window.__peak.route((g.update(1/60,window.__peak.readInput()),g.events.splice(0)));});
    assert.equal(await page.isVisible('#modal'),true);assert.match(await page.textContent('#modal-title'),/登頂/);
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('pg-phoebe-peak')).unlocked),1);ok('summit unlocks the next ascent');
    await page.screenshot({path:'/tmp/phoebe-peak-win.png',timeout:120000});
    const phone=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});phone.on('pageerror',e=>errors.push(e.message));
    await phone.goto(base+'?seed=20000&autostart=1');await phone.waitForFunction(()=>!!window.__peak,null,{timeout:90000});
    assert.equal(await phone.evaluate(()=>getComputedStyle(document.getElementById('touch')).display),'block');ok('touch controls visible');
  }finally{await browser.close();}
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,checks,errors}));
})().catch(e=>{console.error(e);process.exit(1);});
