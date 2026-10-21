"""下載街頭道具模型（Poly Haven，CC0）並把貼圖縮到 512，供 build_blend.py 匯入。

用法：python3 tools/neon-street/fetch_props.py
輸出：tools/neon-street/props_src/<id>/<id>.gltf（不進版控；build.sh 會自動呼叫）
需要 Pillow。模型很高面數（數萬三角形），減面在 Blender 內做。
"""
import json
import sys
import urllib.request
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import scene_gen as S  # noqa: E402

SRC = HERE / 'props_src'
TEX_SIZE = 512


def get(u):
    req = urllib.request.Request(u, headers={'User-Agent': 'pie-game-asset-fetch/1.0'})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def fetch(pid, size):
    d = SRC / pid
    marker = d / f'.done{size}'
    if marker.exists():
        return
    fl = json.loads(get(f'https://api.polyhaven.com/files/{pid}'))
    g = fl['gltf']['1k']['gltf']
    d.mkdir(parents=True, exist_ok=True)
    (d / f'{pid}.gltf').write_bytes(get(g['url']))
    for rel, inc in g['include'].items():
        p = d / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(get(inc['url']))
        if p.suffix.lower() in ('.jpg', '.jpeg', '.png'):
            im = Image.open(p)
            if max(im.size) > size:
                im = im.resize((size, size), Image.LANCZOS)
                if p.suffix.lower() == '.png':
                    im.save(p, optimize=True)
                else:
                    im.convert('RGB').save(p, quality=86, subsampling=0)
    marker.write_text('ok')
    print('  ', pid)


def main():
    sizes = {}
    for m in S.PROP_MODELS.values():
        sizes[m['id']] = max(sizes.get(m['id'], 0), m.get('tex', TEX_SIZE))
    for pid, size in sorted(sizes.items()):
        fetch(pid, size)
    info = {}
    for pid in sorted({m['id'] for m in S.PROP_MODELS.values()}):
        try:
            info[pid] = ', '.join(json.loads(get(f'https://api.polyhaven.com/info/{pid}')).get('authors', {}).keys())
        except Exception:
            info[pid] = ''
    out = HERE.parent.parent / 'site' / 'games' / 'community' / 'neon-arcade-street' / 'assets' / 'pbr' / 'CREDITS.md'
    txt = out.read_text() if out.exists() else ''
    marker = '\n## 街頭道具模型（Poly Haven，CC0）\n'
    txt = txt.split(marker)[0].rstrip('\n') + '\n' + marker + '\n' + '\n'.join(
        f'- [{pid}](https://polyhaven.com/a/{pid})：{a}' for pid, a in info.items()) + '\n'
    out.write_text(txt)


if __name__ == '__main__':
    main()
