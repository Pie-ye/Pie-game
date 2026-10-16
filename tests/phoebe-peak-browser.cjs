// Browser smoke test (needs Playwright + Chromium): PLAYWRIGHT_MODULE=/path PEAK_TEST_URL=http://127.0.0.1:8765/games/community/phoebe-peak/ node tests/phoebe-peak-browser.cjs
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.PEAK_TEST_URL||process.env.EGG_TEST_URL||'http://127.0.0.1:8765/games/community/phoebe-peak/';
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const errors=[],checks=[];const ok=n=>checks.push(n);
  try{
    const page=await browser.newPage({viewport:{width:1100,height:700}});
    page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!/404|Failed to load resource|cloudflareinsights/.test(m.text()))errors.push(m.text());});
    await page.goto(base+'?seed=20000');await page.waitForFunction(()=>!!window.__peak,null,{timeout:180000});ok('scene boots');
    assert.equal(await page.isVisible('#menu'),true);assert.match(await page.textContent('#daily'),/今日山脈 #20000/);
    assert.equal(await page.evaluate(()=>[...document.querySelectorAll('.asc')].filter(b=>!b.disabled).length),1,'only the first ascent is unlocked');
    assert.equal(await page.evaluate(()=>document.querySelectorAll('.asc').length),8,'eight ascents');ok('menu and ascent lock');
    await page.click('#start');await page.waitForFunction(()=>window.__peak.game.mode==='play',null,{timeout:60000});assert.equal(await page.evaluate(()=>!document.getElementById('hud').hidden),true);ok('start');
    // keyboard mapping: the camera starts behind the player, so W is the way the spawn faces; freeze the loop so it cannot consume the key edges
    await page.evaluate(()=>{window.__peak.game.mode='pause';});
    await page.keyboard.down('w');await page.keyboard.down('Shift');await page.keyboard.down('c');
    const inp=await page.evaluate(()=>{const P=window.__peak,i=P.readInput(),y=P.game.world.spawn.yaw;return {...i,dot:i.mx*Math.sin(y)+i.mz*Math.cos(y)};});assert.ok(inp.f===1&&inp.dot>.95&&inp.sprint&&inp.grab,JSON.stringify(inp));
    await page.keyboard.up('w');await page.keyboard.up('Shift');await page.keyboard.up('c');
    await page.keyboard.press('Space');assert.equal((await page.evaluate(()=>window.__peak.readInput())).jump,true);assert.equal((await page.evaluate(()=>window.__peak.readInput())).jump,false);ok('keyboard mapping');
    // mouse look without any button: with the pointer locked, plain movement turns the camera
    const turned=await page.evaluate(()=>{window.__peak.game.mode='play';Object.defineProperty(document,'pointerLockElement',{get:()=>document.getElementById('world'),configurable:true});const v=window.__peak.view,y0=v.yaw,p0=v.pitch;
      document.dispatchEvent(new MouseEvent('mousemove',{movementX:100,movementY:40}));const r={dyaw:v.yaw-y0,dpitch:v.pitch-p0};delete document.pointerLockElement;v.yaw=y0;v.pitch=p0;return r;});
    assert.ok(turned.dyaw<-.2&&turned.dpitch>.05,JSON.stringify(turned));ok('mouse look without clicking');
    // the route map
    await page.evaluate(()=>{window.__peak.game.mode='play';});await page.keyboard.press('m');
    assert.equal(await page.evaluate(()=>document.getElementById('map').classList.contains('big')),true);await page.keyboard.press('m');ok('map toggles');
    const lit=await page.evaluate(()=>{const c=document.getElementById('map'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=3;i<d.length;i+=4)if(d[i]>200)n++;return n;});assert.ok(lit>5000,'map is drawn');ok('route map drawn');
    // drive the real game objects: walk into the first wall of the trail lane, climb, check the stamina HUD
    const step=(sec,keys)=>page.evaluate(([sec,keys])=>{const P=window.__peak,g=P.game;for(let i=0;i<sec*60;i++){const inp=P.readInput();Object.assign(inp,keys);g.update(1/60,inp);P.route(g.events);g.events.length=0;}return {state:g.player.state,y:g.player.y,st:g.stamina,grounded:g.player.grounded};},[sec,keys]);
    const wall=await page.evaluate(()=>{const P=window.__peak,g=P.game,w=g.world,st=w.stages[0],b=w.boxes[st.cells[0][st.lanes.findIndex(l=>l.style==='trail')]],f=b.climbFace;
      Object.assign(g.player,{x:f.dx?f.x+f.dx*3:(b.x1+b.x2)/2,y:0,z:f.dz?f.z+f.dz*3:(b.z1+b.z2)/2,vx:0,vy:0,vz:0,grounded:true,state:'move',support:null});return {dx:-f.dx,dz:-f.dz,top:b.y2};});
    let r=await step(2.2,{mx:wall.dx,mz:wall.dz});assert.equal(r.state,'wall');ok('auto grab');
    r=await step(2,{f:1});assert.ok(r.y>2&&r.st<97);await page.evaluate(()=>{const P=window.__peak;P.sc.update(.016,P.view);P.hud.update(.016,P.view);P.sc.renderer.render(P.sc.scene,P.sc.camera);});
    const width=await page.evaluate(()=>parseFloat(document.getElementById('fill').style.width));assert.ok(width<97,'HUD stamina follows');ok('climb + HUD');
    r=await step(8,{f:1});assert.equal(r.state,'move');assert.ok(Math.abs(r.y-wall.top)<.6);ok('mantle onto the first column');
    // inventory + items through the real UI path: a backpack grows the bar from four to six slots
    const slots=()=>page.evaluate(()=>[...document.querySelectorAll('.slot')].filter(e=>e.style.display!=='none').length);
    assert.equal(await slots(),4);
    await page.evaluate(()=>{const g=window.__peak.game;g.inv[1]={kind:'medkit'};g.aff.injury=.3;g.addItem('backpack');});await page.waitForTimeout(300);await step(.2,{});assert.equal(await slots(),6);ok('backpack adds slots');
    await page.keyboard.press('2');
    await step(.2,{});await page.evaluate(()=>window.__peak.game.update(1/60,{...window.__peak.readInput(),use:true}));await step(1.2,{});const inj=await page.evaluate(()=>({i:window.__peak.game.aff.injury,item:window.__peak.game.inv[1]}));assert.ok(inj.i<.001&&!inj.item,JSON.stringify(inj));ok('number key selects, use heals');
    // a vine from a magic bean next to a wall: render a frame after planting
    await page.evaluate(()=>{const P=window.__peak,g=P.game,w=g.world;for(const b of w.boxes){const r=b.risers[0];if(!r||b.lane<0)continue;const nb=w.boxAtCell(b.i+r.dx,b.j+r.dz);if(nb.y2-b.y2>14||nb.y2-b.y2<3)continue;
      const edge=r.dx?(r.dx>0?b.x2:b.x1):(r.dz>0?b.z2:b.z1);Object.assign(g.player,{x:r.dx?edge-r.dx:(b.x1+b.x2)/2,y:b.y2,z:r.dz?edge-r.dz:(b.z1+b.z2)/2,vx:0,vy:0,vz:0,grounded:true,state:'move',support:b,wall:null});break;}
      g.inv[0]={kind:'magic_bean'};g.sel=0;g.update(1/60,{...P.readInput(),use:true});});
    assert.ok(await page.evaluate(()=>window.__peak.game.ropes.some(r=>r.bean)),'a vine grew');ok('magic bean');
    // rendering budget at the start and in the caldera
    const tri=await page.evaluate(()=>{const P=window.__peak;P.sc.update(.016,P.view);P.sc.renderer.render(P.sc.scene,P.sc.camera);return P.sc.renderer.info.render.triangles;});assert.ok(tri<1500000,`start triangles ${tri}`);ok('start triangles '+tri);
    await page.evaluate(()=>{const P=window.__peak,g=P.game,w=g.world,z=w.zones[3],b=w.boxes.find(b=>b.lane>=0&&b.zone===3&&b.y2>z.y0+40);Object.assign(g.player,{x:(b.x1+b.x2)/2,y:b.y2,z:(b.z1+b.z2)/2,grounded:true,support:b,state:'move',wall:null,vx:0,vy:0,vz:0});P.sc.update(.5,P.view);P.sc.renderer.render(P.sc.scene,P.sc.camera);});
    const tri2=await page.evaluate(()=>window.__peak.sc.renderer.info.render.triangles);assert.ok(tri2<1500000,`caldera triangles ${tri2}`);ok('caldera triangles '+tri2);
    // pause, win and restart (restart builds a fresh scene for the next mountain)
    await page.evaluate(()=>document.exitPointerLock());await page.waitForFunction(()=>window.__peak.game.mode==='pause',null,{timeout:5000});assert.equal(await page.isVisible('#modal'),true,'releasing the pointer pauses');
    await page.evaluate(()=>{const g=window.__peak.game,s=g.world.summit;g.mode='play';Object.assign(g.player,{x:s.x,y:s.y,z:s.z,grounded:true,support:g.world.boxes[s.box],state:'move'});window.__peak.route((g.update(1/60,window.__peak.readInput()),g.events.splice(0)));});
    assert.equal(await page.isVisible('#modal'),true);assert.match(await page.textContent('#modal-title'),/登頂/);
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('pg-phoebe-peak')).unlocked),1);ok('summit unlocks the next ascent');
    await page.screenshot({path:'/tmp/phoebe-peak-win.png',timeout:120000});
    await page.click('#restart');assert.equal(await page.isVisible('#menu'),true);
    await page.evaluate(()=>[...document.querySelectorAll('.asc')][1].click());await page.click('#start');await page.waitForFunction(()=>window.__peak.game.mode==='play'&&!document.getElementById('loading').offsetParent,null,{timeout:180000});
    assert.equal(await page.evaluate(()=>window.__peak.game.world.ascent),1);assert.equal(await page.evaluate(()=>window.__peak.sc.rig.root.visible),true);ok('restart on another ascent rebuilds the scene');
    const phone=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});phone.on('pageerror',e=>errors.push(e.message));
    await phone.goto(base+'?seed=20000&autostart=1');await phone.waitForFunction(()=>!!window.__peak,null,{timeout:180000});
    assert.equal(await phone.evaluate(()=>getComputedStyle(document.getElementById('touch')).display),'block');ok('touch controls visible');
  }finally{await browser.close();}
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,checks,errors}));
})().catch(e=>{console.error(e);process.exit(1);});
