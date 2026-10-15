"""Compute Phoebe's skeleton and skin weights offline (distance-to-bone capsules, hair/body segmentation, Laplacian smoothing).
Output: site/games/community/phoebe-peak/assets/phoebe.rig.json — bones in the raw GLB space plus per-vertex 4 influences.
usage: build-rig.py <phoebe.glb> <out.json>"""
import base64, json, sys
import numpy as np, trimesh
from scipy import sparse

glb, out = sys.argv[1], sys.argv[2]
mesh = list(trimesh.load(glb).geometry.values())[0]
V = np.asarray(mesh.vertices, float); F = np.asarray(mesh.faces)
# Side naming: 'L' = +x (facing +z, the character's left), 'R' = -x.
def pair(name, parent, head, tail):
    return [(name + 'L', parent + 'L' if parent.endswith('_') else parent, head, tail),
            (name + 'R', parent + 'R' if parent.endswith('_') else parent, (-head[0], head[1], head[2]), (-tail[0], tail[1], tail[2]))]
B = []
def add(name, parent, head, tail): B.append(dict(name=name, parent=parent, head=head, tail=tail))
add('root', None, (0, -1.0, .1), (0, -.68, .12))
add('hips', 'root', (0, -.68, .12), (0, -.5, .12))
add('spine', 'hips', (0, -.5, .12), (0, -.28, .12))
add('chest', 'spine', (0, -.28, .12), (0, -.1, .12))
add('neck', 'chest', (0, -.1, .12), (0, -.02, .12))
add('head', 'neck', (0, -.02, .12), (0, .55, .12))
for s, sx in (('L', 1), ('R', -1)):
    add('hair' + s, 'head', (sx * .4, -.02, .0), (sx * .46, -.6, -.1))
    add('upperArm' + s, 'chest', (sx * .2, -.21, .12), (sx * .33, -.42, .14))
    add('foreArm' + s, 'upperArm' + s, (sx * .33, -.42, .14), (sx * .42, -.58, .17))
    add('hand' + s, 'foreArm' + s, (sx * .42, -.58, .17), (sx * .46, -.69, .2))
    add('thigh' + s, 'hips', (sx * .12, -.69, .12), (sx * .12, -.83, .12))
    add('shin' + s, 'thigh' + s, (sx * .12, -.83, .12), (sx * .13, -.96, .1))
    add('foot' + s, 'shin' + s, (sx * .13, -.96, .1), (sx * .13, -1.0, .32))
add('hairB', 'head', (0, -.02, -.3), (0, -.65, -.4))
names = [b['name'] for b in B]; idx = {n: i for i, n in enumerate(names)}
H = np.array([b['head'] for b in B]); T = np.array([b['tail'] for b in B])

def seg_dist(P, a, b):
    ab = b - a; t = np.clip(((P - a) @ ab) / (ab @ ab), 0, 1)
    return np.linalg.norm(P - (a + t[:, None] * ab), axis=1)
D = np.stack([seg_dist(V, H[i], T[i]) for i in range(len(B))], axis=1)
x, y, z = V[:, 0], V[:, 1], V[:, 2]
sm = lambda a, b, v: np.clip((v - a) / (b - a), 0, 1) ** 2 * (3 - 2 * np.clip((v - a) / (b - a), 0, 1))
W = np.zeros((len(V), len(B)))
hair = (y < -.02) & (y > -.72) & ((z < -.17) | ((np.abs(x) > .3) & (z < -.02)) | (np.abs(x) > .5))   # long hair behind and beside the body
head = (y >= -.1) & ~hair
for i, p in enumerate(V):
    pass
# --- head and hair --------------------------------------------------------------------------------------------
w_hair = sm(-.08, -.42, -y) * hair
for k in np.where(hair)[0]:
    bone = 'hairL' if x[k] > .22 else 'hairR' if x[k] < -.22 else 'hairB'
    W[k, idx[bone]] = w_hair[k]; W[k, idx['head']] = 1 - w_hair[k] + 0
    W[k, idx['chest']] += .0
hh = np.where(head)[0]
W[hh, idx['head']] = sm(-.14, -.04, y[hh]); W[hh, idx['neck']] = 1 - W[hh, idx['head']]
# --- body: inverse-distance blend restricted by anatomy --------------------------------------------------------
body = np.where(~hair & ~head)[0]
allowed = np.zeros((len(V), len(B)), bool)
for n in ('hips', 'spine', 'chest', 'neck'): allowed[body, idx[n]] = True
for s, sx in (('L', 1), ('R', -1)):
    arm = (x * sx > .1) & (y > -.72) & (y < -.1)
    for n in ('upperArm', 'foreArm', 'hand'): allowed[:, idx[n + s]] = arm
    leg = (x * sx > -.03) & (y < -.64)
    for n in ('thigh', 'shin', 'foot'): allowed[:, idx[n + s]] = leg
for k in body:
    d = D[k]; cand = np.where(allowed[k])[0]
    w = 1.0 / (d[cand] + .02) ** 4
    # torso bones lose to nearby limb bones, but keep a floor so the shoulder/hip joints blend
    W[k, cand] = w / w.sum()
# --- Laplacian smoothing -----------------------------------------------------------------------------------------
E = np.vstack([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]]); E = np.vstack([E, E[:, ::-1]])
A = sparse.coo_matrix((np.ones(len(E)), (E[:, 0], E[:, 1])), shape=(len(V),) * 2).tocsr(); A.data[:] = 1
deg = np.asarray(A.sum(axis=1)).ravel(); Dinv = sparse.diags(1 / np.maximum(deg, 1))
for _ in range(4): W = .55 * W + .45 * (Dinv @ A @ W)
# The model is several loose shells (face, hair, hat): also smooth across spatially close vertices so shells deform together.
from scipy.spatial import cKDTree
tree = cKDTree(V); pairs = tree.query_pairs(.045, output_type='ndarray')
if len(pairs):
    P = np.vstack([pairs, pairs[:, ::-1]])
    S = sparse.coo_matrix((np.ones(len(P)), (P[:, 0], P[:, 1])), shape=(len(V),) * 2).tocsr(); S.data[:] = 1
    sd = np.asarray(S.sum(axis=1)).ravel(); Sinv = sparse.diags(1 / np.maximum(sd, 1))
    mask = (sd > 0).astype(float)[:, None]
    for _ in range(3): W = np.where(mask > 0, .5 * W + .5 * (Sinv @ S @ W), W)
# keep top 4 and renormalize
top = np.argsort(-W, axis=1)[:, :4]; Wt = np.take_along_axis(W, top, 1); Wt /= Wt.sum(axis=1, keepdims=True)
q = np.round(Wt * 255).astype(np.uint8); q[:, 0] += (255 - q.sum(axis=1)).astype(np.uint8)  # exact 255
json.dump(dict(model=glb.split('/')[-1], vertices=len(V), bounds=[V.min(0).tolist(), V.max(0).tolist()],
               bones=[dict(name=b['name'], parent=b['parent'], head=list(map(float, b['head'])), tail=list(map(float, b['tail']))) for b in B],
               skinIndex=base64.b64encode(top.astype(np.uint8).tobytes()).decode(), skinWeight=base64.b64encode(q.tobytes()).decode()),
          open(out, 'w'))
print('rig', len(B), 'bones', len(V), 'vertices ->', out)
for n in ('upperArmL', 'handL', 'hairL', 'thighL', 'head', 'hips'):
    print(n, 'influenced vertices', int((W[:, idx[n]] > .3).sum()))
