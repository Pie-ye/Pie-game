"""Render a contact sheet of GLB files with the game's own loader (headless Chromium).
usage: glb-sheet.py out.png file1.glb file2.glb ... [--views front,three,back] [--size 360]
GLBs are served from their directories through symlinks, so files may come from anywhere."""
import argparse, os, pathlib, shutil, subprocess, sys, tempfile, time
ap = argparse.ArgumentParser(); ap.add_argument('out'); ap.add_argument('files', nargs='+'); ap.add_argument('--views', default='front,three,back'); ap.add_argument('--size', type=int, default=360); ap.add_argument('--grid', type=int, default=0); ap.add_argument('--icons', default='', help='write one trimmed 96px transparent PNG per model into this folder')
a = ap.parse_args()
repo = pathlib.Path(__file__).resolve().parents[2]
www = pathlib.Path(tempfile.mkdtemp(prefix='glbsheet-'))
(www / 'games/community').mkdir(parents=True)
for g in ('phoebe-peak', 'pie-phoebe'): (www / 'games/community' / g).symlink_to(repo / 'site/games/community' / g)
(www / 'sheet.html').symlink_to(repo / 'tools/phoebe-peak/glb-sheet.html')
(www / 'glb').mkdir()
names = []
for i, f in enumerate(a.files):
    p = pathlib.Path(f).resolve(); n = f'{i:02d}_{p.name}'; (www / 'glb' / n).symlink_to(p); names.append(n)
port = 18990 + os.getpid() % 500
srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(port), '--directory', str(www), '--bind', '127.0.0.1'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    time.sleep(.8)
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        b = pw.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        pg = b.new_page(viewport={'width': 400, 'height': 400}); logs = []
        pg.on('console', lambda m: logs.append(m.text)); pg.on('pageerror', lambda e: logs.append(str(e)))
        pg.goto(f'http://127.0.0.1:{port}/sheet.html?files={",".join(names)}&views={"icon" if a.icons else a.views}&size={a.size}&grid={a.grid}{"&bg=clear" if a.icons else ""}')
        pg.wait_for_function('window.__done===true', timeout=180000)
        data = pg.evaluate("document.getElementById('c').toDataURL('image/png')"); info = pg.evaluate('window.__info')
        import base64; pathlib.Path(a.out).write_bytes(base64.b64decode(data.split(',')[1]))
        if a.icons:
            from PIL import Image
            import io
            sheet = Image.open(io.BytesIO(base64.b64decode(data.split(',')[1]))).convert('RGBA'); pathlib.Path(a.icons).mkdir(parents=True, exist_ok=True)
            for r, f in enumerate(a.files):
                cell = sheet.crop((0, r * a.size, a.size, (r + 1) * a.size)); box = cell.getchannel('A').point(lambda v: 255 if v > 30 else 0).getbbox()
                if box: cell = cell.crop(box)
                side = max(cell.size); canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0)); canvas.paste(cell, ((side - cell.width) // 2, (side - cell.height) // 2))
                canvas.resize((96, 96), Image.LANCZOS).save(pathlib.Path(a.icons) / (pathlib.Path(f).stem + '.png'), optimize=True)
        for i in info: print(i)
        for l in logs[:5]: print('LOG', l)
        b.close()
finally:
    srv.terminate(); shutil.rmtree(www, ignore_errors=True)
