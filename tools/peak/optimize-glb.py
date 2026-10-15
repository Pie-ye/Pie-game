"""Re-encode embedded textures of Hunyuan GLBs (resize + JPEG) so the game stays under the 50 MB limit.
usage: optimize-glb.py [--size N] <glb>... (default 512 px; characters have larger budgets); keeps geometry untouched, rewrites the binary chunk."""
import io, json, struct, sys, pathlib
from PIL import Image
MAX = {'phoebe': 1536, 'fluorolo': 1536, 'reggie': 1024}
def process(path, limit, quality=84):
    data = path.read_bytes()
    jlen = struct.unpack('<I', data[12:16])[0]
    doc = json.loads(data[20:20 + jlen]); bstart = 28 + jlen
    blen = struct.unpack('<I', data[20 + jlen:24 + jlen])[0]; binary = data[bstart:bstart + blen]
    views = doc['bufferViews']; replace = {}
    for image in doc.get('images', []):
        v = views[image['bufferView']]; raw = binary[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']]
        im = Image.open(io.BytesIO(raw)).convert('RGB')
        if max(im.size) > limit: im = im.resize((limit, limit * im.size[1] // im.size[0]) if im.size[0] >= im.size[1] else (limit * im.size[0] // im.size[1], limit), Image.LANCZOS)
        out = io.BytesIO(); im.save(out, 'JPEG', quality=quality, optimize=True)
        replace[image['bufferView']] = out.getvalue(); image['mimeType'] = 'image/jpeg'
    chunks, offset = [], 0
    for i, v in enumerate(views):
        piece = replace.get(i, binary[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']])
        pad = (-offset) % 4; chunks.append(b'\0' * pad); offset += pad
        v['byteOffset'] = offset; v['byteLength'] = len(piece); chunks.append(piece); offset += len(piece)
    newbin = b''.join(chunks); newbin += b'\0' * ((-len(newbin)) % 4); doc['buffers'][0]['byteLength'] = len(newbin)
    js = json.dumps(doc, separators=(',', ':')).encode(); js += b' ' * ((-len(js)) % 4)
    path.write_bytes(b'glTF' + struct.pack('<II', 2, 12 + 8 + len(js) + 8 + len(newbin)) + struct.pack('<I', len(js)) + b'JSON' + js + struct.pack('<I', len(newbin)) + b'BIN\0' + newbin)
args = sys.argv[1:]
size = None
if args and args[0] == '--size': size = int(args[1]); args = args[2:]
for name in args:
    p = pathlib.Path(name); before = p.stat().st_size
    process(p, size or MAX.get(p.stem, 512)); print(p.name, before, '->', p.stat().st_size)
