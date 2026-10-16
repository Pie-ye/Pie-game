"""Headless screenshots of the running game for visual checks.
usage: shot.py out.png [--seed N] [--ascent N] [--js 'code run in the page after start'] [--wait SEC] [--size 1100x700]
Serves site/ on a private port. The page exposes window.__peak (game, sc, view)."""
import argparse, os, pathlib, subprocess, sys, time
ap = argparse.ArgumentParser(); ap.add_argument('out'); ap.add_argument('--seed', type=int, default=20000); ap.add_argument('--ascent', type=int, default=0)
ap.add_argument('--js', default=''); ap.add_argument('--wait', type=float, default=1.5); ap.add_argument('--size', default='1100x700'); ap.add_argument('--hud', action='store_true'); ap.add_argument('--extra', default=''); ap.add_argument('--cam', default='', help='x,y,z,lookx,looky,lookz applied after the game camera update (free camera)'); ap.add_argument('--fov', type=float, default=0); ap.add_argument('--fog', type=float, default=0)
a = ap.parse_args()
site = pathlib.Path(__file__).resolve().parents[2] / 'site'
port = 18900 + os.getpid() % 70
srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(port), '--directory', str(site), '--bind', '127.0.0.1'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    time.sleep(.8)
    from playwright.sync_api import sync_playwright
    w, h = map(int, a.size.split('x'))
    with sync_playwright() as pw:
        b = pw.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        pg = b.new_page(viewport={'width': w, 'height': h}); logs = []
        pg.on('console', lambda m: logs.append(m.type + ': ' + m.text)); pg.on('pageerror', lambda e: logs.append('PAGEERROR ' + str(e)))
        pg.goto(f'http://127.0.0.1:{port}/games/community/phoebe-peak/?seed={a.seed}&ascent={a.ascent}{a.extra}')
        try: pg.wait_for_function('!!window.__peak', timeout=int(os.environ.get('BOOT_MS', '240000')))
        except Exception:
            for l in logs[-14:]: print(l[:500])
            print('LOADTEXT', pg.evaluate("document.getElementById('load-text').textContent")); raise
        pg.evaluate('window.__peak.start()'); pg.wait_for_function("window.__peak.game.mode==='play'&&document.getElementById('loading').hidden", timeout=240000)
        if a.js: pg.evaluate(a.js)
        pg.wait_for_timeout(int(a.wait * 1000))
        cam = [float(v) for v in a.cam.split(',')] if a.cam else None
        url = pg.evaluate("([cam,fov,fog])=>{window.requestAnimationFrame=()=>0;const P=window.__peak;P.sc.update(.016,P.view);if(P.hud)P.hud.update(.016,P.view);const c=P.sc.camera;if(cam){c.position.set(cam[0],cam[1],cam[2]);c.lookAt(cam[3],cam[4],cam[5]);}if(fov){c.fov=fov;c.updateProjectionMatrix();}if(fog){P.sc.scene.fog.near=fog;P.sc.scene.fog.far=fog*3;}P.sc.renderer.render(P.sc.scene,c);return P.sc.renderer.domElement.toDataURL('image/png');}", [cam, a.fov, a.fog])
        if cam:
            import base64; pathlib.Path(a.out).write_bytes(base64.b64decode(url.split(',')[1]))
        else: pg.screenshot(path=a.out)
        print('triangles', pg.evaluate('window.__peak.sc.renderer.info.render.triangles'), 'calls', pg.evaluate('window.__peak.sc.renderer.info.render.calls'))
        for l in logs[:25]: print(l[:300])
        b.close()
finally:
    srv.terminate()
