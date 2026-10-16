"""Contact sheet of Phoebe's procedural poses (rig-preview.html), headless. usage: rig-sheet.py out.png [pose,pose,...] [view]"""
import base64, os, pathlib, subprocess, sys, time
out = sys.argv[1]; poses = (sys.argv[2] if len(sys.argv) > 2 else 'idle,walk,run,air,wall,rope,anchored,mantle,eat,tool,faint,chain').split(','); view = sys.argv[3] if len(sys.argv) > 3 else 'three'
site = pathlib.Path(__file__).resolve().parents[2] / 'site'; port = 18970 + os.getpid() % 25
srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(port), '--directory', str(site), '--bind', '127.0.0.1'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    time.sleep(.8)
    from playwright.sync_api import sync_playwright
    from PIL import Image
    import io
    with sync_playwright() as pw:
        b = pw.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        pg = b.new_page(viewport={'width': 420, 'height': 520}); logs = []
        pg.on('console', lambda m: logs.append(m.text)); pg.on('pageerror', lambda e: logs.append('ERR ' + str(e)))
        pg.goto(f'http://127.0.0.1:{port}/games/community/phoebe-peak/rig-preview.html?view={view}')
        pg.wait_for_function('!!window.__rig', timeout=120000)
        shots = []
        for p in poses:
            pg.evaluate(f"window.__rig.setMode('{p}')"); pg.wait_for_timeout(500); shots.append(Image.open(io.BytesIO(pg.screenshot())).convert('RGB'))
        cols = 4; rows = (len(shots) + cols - 1) // cols
        sheet = Image.new('RGB', (420 * cols, 520 * rows), 'white')
        for i, im in enumerate(shots): sheet.paste(im, (420 * (i % cols), 520 * (i // cols)))
        sheet.save(out); print(poses)
        for l in logs[:6]: print(l[:200])
        b.close()
finally:
    srv.terminate()
