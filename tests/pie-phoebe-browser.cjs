const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const base = process.env.PHOEBE_TEST_URL || 'http://127.0.0.1:18766/games/community/pie-phoebe/';
(async () => {
  const browser = await chromium.launch({ headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
    await page.goto(base); await page.waitForFunction(() => !!window.__pie);
    assert.match(await page.title(), /v1.3/);
    await page.click('#go');
    await page.keyboard.down('d');
    await page.waitForFunction(() => __pie.game.p.x > 0.5);
    await page.keyboard.up('d'); await page.keyboard.press('p');
    assert.equal(await page.evaluate(() => __pie.game.mode), 'pause');
    await page.click('#resume');
    await page.evaluate(() => {
      const g = __pie.game; g.newRun(); g.mode = 'play';
      g.weapons = { star: 3, chain: 3, frost: 3, litany: 3, trail: 3 };
      g.petSkills.slide = 3; g.ui.setSlots(g);
      for (const [i, type] of ['charger', 'fan', 'mortar', 'splitter'].entries()) g.makeEnemy(type, i * 2 - 3, -4);
      const boss = g.makeEnemy('boss', 0, -7);
      Object.assign(boss, { rank: 3, name: '終曲指揮', pattern: 0 });
      g.boss = boss; g.charge(boss, 0, 7);
      g.warnBlast(boss, 3, 1); g.leaveTrail(-2, 1, 1);
      g.buildGrid(); g.cd.chain = 0; g.cd.frost = 0; g.updateNewWeapons(0.01);
      g.hud(); g.mode = 'pause'; g.render();
    });
    assert.equal(await page.locator('.slot.combo').count(), 3);
    await page.screenshot({ path: '/tmp/pie-phoebe-v13-desktop.png' });
    const stats = await page.evaluate(() => {
      const g = __pie.game; g.mode = 'play'; g.p.hp = g.p.maxhp = 100000;
      // Exercise all waves, skills, boss state transitions and late-game spawns.
      g.t = 530; g.bossIdx = 2; g.swarmIdx = 2; g.pending = 0;
      for (let i = 0; i < 1200; i++) {
        if (g.mode === 'levelup') g.pick(0);
        g.input.x = Math.cos(i / 35); g.input.z = Math.sin(i / 35);
        g.update(0.05);
        if (i % 60 === 0) g.render();
      }
      g.mode = 'pause'; g.render();
      return { enemies: g.enemies.length, kills: g.kills, shots: g.eshots.length,
        finite: g.enemies.every((e) => Number.isFinite(e.x + e.z + e.hp)), calls: g.renderer.info.render.calls };
    });
    assert.ok(stats.finite); assert.ok(stats.kills > 0); assert.ok(stats.calls > 10);
    const visuals = await page.evaluate(() => {
      const g = __pie.game; g.newRun(); g.mode = 'play';
      g.weapons = { star: 4, ring: 4, litany: 4, rain: 4, field: 4 };
      g.ui.setSlots(g); g.ui.hideScreen(); document.getElementById('banner').hidden = true;
      for (let i = 0; i < 8; i++) {
        const e = g.makeEnemy(i % 2 ? 'golem' : 'fan', 3 + i % 3, -2 + Math.floor(i / 3));
        e.hp = e.maxhp = 10000;
      }
      g.buildGrid(); g.cd.ring = g.cd.litany = g.cd.rain = 0;
      g.updateWeapons(.05); g.updateMisc(.2);
      for (const e of g.enemies) e.flash = 0;
      g.hud(); g.mode = 'pause'; g.render();
      return { sigils: g.L.sigil.n, prisms: g.L.prism.n, pillars: g.L.pillar.n, map: g.ground.material.map.image.src };
    });
    assert.ok(visuals.sigils > 2 && visuals.prisms > 6 && visuals.pillars > 0);
    assert.match(visuals.map, /rinascita-plaza/);
    await page.screenshot({ path: '/tmp/pie-phoebe-v13-skills.png' });
    await page.evaluate(() => {
      const g = __pie.game; g.p.x = 17; g.p.z = 0; g.camPos.x = 17; g.camPos.z = 0;
      g.enemies = []; g.fxs = []; g.strikes = []; g.mirrorZone = null; g.weapons = {};
      g.pet.x = 15; g.pet.z = 1; g.render();
    });
    await page.screenshot({ path: '/tmp/pie-phoebe-v13-map.png' });
    const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    phone.on('pageerror', (e) => errors.push(e.message));
    await phone.goto(base); await phone.waitForFunction(() => !!window.__pie);
    await phone.tap('#go');
    const client = await phone.context().newCDPSession(phone);
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 190, y: 300 }] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 245, y: 300 }] });
    await phone.waitForFunction(() => __pie.game.p.x > 0.3);
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await phone.evaluate(() => {
      const g = __pie.game; g.pending = 1;
      g.pendingCards = ['chain', 'frost', 'trail'].map((key) => g.describeCard({ type: 'weapon', key }));
      g.mode = 'levelup'; g.ui.levelup(2, g.pendingCards);
    });
    await phone.screenshot({ path: '/tmp/pie-phoebe-v13-mobile.png' });
    await phone.locator('.card').last().tap();
    assert.equal(await phone.evaluate(() => __pie.game.weapons.trail), 1);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, stats, visuals, errors, checks: ['desktop movement', 'pause', 'new enemy rendering', 'three combos', 'boss warnings', '60s late-game simulation', 'mirror/column/crystal effects', 'map asset', 'mobile drag', 'mobile upgrades'] }));
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
