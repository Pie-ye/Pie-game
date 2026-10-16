"""Compute Phoebe's skeleton and skin weights offline for the LoRA chibi model (Anima + phoebe_chibi LoRA -> Hunyuan3D).
Bones are placed by hand from landmarks read off the model (see LANDMARKS); skin weights come from distance to bone capsules,
restricted by colour classes (hair, skin/cloth) so the long braids do not get dragged by the arms that hang next to them,
then Laplacian-smoothed along the mesh and across the loose shells (hair, face, dress).
usage: build-rig.py <phoebe.glb> <out.json>"""
import base64, colorsys, json, sys
import numpy as np, trimesh
from scipy import sparse
from scipy.spatial import cKDTree

glb, out = sys.argv[1], sys.argv[2]
mesh = list(trimesh.load(glb).geometry.values())[0]
V = np.asarray(mesh.vertices, float); F = np.asarray(mesh.faces)
uv = mesh.visual.uv; img = np.asarray(mesh.visual.material.baseColorTexture.convert('RGB'))
h, w, _ = img.shape; col = img[((1 - uv[:, 1]) % 1 * (h - 1)).astype(int), (uv[:, 0] % 1 * (w - 1)).astype(int)] / 255.
hsv = np.array([colorsys.rgb_to_hsv(*c) for c in col]); H, S, Vv = hsv[:, 0] * 360, hsv[:, 1], hsv[:, 2]
x, y, z = V[:, 0], V[:, 1], V[:, 2]

# ---- landmarks (raw model space, +z is the front, +x is the character's left) -----------------------------------------------------
CX = -.05                              # the body is slightly off the origin
L = dict(footY=-1.0, ankleY=-.94, kneeY=-.74, hipY=-.50, waistY=-.30, bellyY=-.07, chestY=.16, neckY=.28, topY=.99,
         shoulder=(.30, .04), elbow=(.46, -.05), wrist=(.58, -.13), fingers=(.67, -.19), legX=.11, braid=(.55, .26), braidTip=(.67, -.50))
B = []
def add(name, parent, head, tail): B.append(dict(name=name, parent=parent, head=head, tail=tail))
add('root', None, (CX, L['footY'], 0), (CX, L['hipY'], 0))
add('hips', 'root', (CX, L['hipY'], 0), (CX, L['waistY'], 0))
add('spine', 'hips', (CX, L['waistY'], 0), (CX, L['bellyY'], 0))
add('chest', 'spine', (CX, L['bellyY'], 0), (CX, L['chestY'], 0))
add('neck', 'chest', (CX, L['chestY'], 0), (CX, L['neckY'], 0))
add('head', 'neck', (CX, L['neckY'], 0), (CX, L['topY'], 0))
for s, sx in (('L', 1), ('R', -1)):
    add('hair' + s, 'head', (CX + sx * L['braid'][0], L['braid'][1], 0), (CX + sx * L['braidTip'][0], L['braidTip'][1], -.01))
    add('upperArm' + s, 'chest', (CX + sx * L['shoulder'][0], L['shoulder'][1], 0), (CX + sx * L['elbow'][0], L['elbow'][1], 0))
    add('foreArm' + s, 'upperArm' + s, (CX + sx * L['elbow'][0], L['elbow'][1], 0), (CX + sx * L['wrist'][0], L['wrist'][1], .01))
    add('hand' + s, 'foreArm' + s, (CX + sx * L['wrist'][0], L['wrist'][1], .01), (CX + sx * L['fingers'][0], L['fingers'][1], .02))
    add('thigh' + s, 'hips', (CX + sx * L['legX'], L['hipY'], 0), (CX + sx * L['legX'], L['kneeY'], .01))
    add('shin' + s, 'thigh' + s, (CX + sx * L['legX'], L['kneeY'], .01), (CX + sx * L['legX'], L['ankleY'], 0))
    add('foot' + s, 'shin' + s, (CX + sx * L['legX'], L['ankleY'], 0), (CX + sx * L['legX'], L['footY'], .14))
add('hairB', 'head', (CX, .30, -.22), (CX, -.40, -.38))
names = [b['name'] for b in B]; idx = {n: i for i, n in enumerate(names)}
Hd = np.array([b['head'] for b in B]); Tl = np.array([b['tail'] for b in B])
def seg_dist(P, a, b):
    ab = b - a; t = np.clip(((P - a) @ ab) / (ab @ ab), 0, 1)
    return np.linalg.norm(P - (a + t[:, None] * ab), axis=1)
D = np.stack([seg_dist(V, Hd[i], Tl[i]) for i in range(len(B))], axis=1)
sm = lambda a, b, v: (lambda t: t * t * (3 - 2 * t))(np.clip((v - a) / (b - a), 0, 1))
dx = x - CX

# ---- classes: hair versus everything else ---------------------------------------------------------------------------------------------
# The braids hang beside the arms (the arms are in front at z>0, the braids behind at z<-.1), so colour alone cannot separate them.
# Hair = teal or yellow pixels, plus anything behind the arm plane inside a capsule around each braid; dark outline pixels outside the capsule take the
# majority class of their neighbours along the mesh edges.
teal = (H > 150) & (H < 205) & (S > .2)
yellow = (H > 35) & (H < 65) & (S > .25) & (Vv > .55)
axis = np.array([(.50, .30), (.55, .05), (.60, -.15), (.66, -.35), (.70, -.52)])
def to_polyline(px, py):
    best = np.full(len(px), 9.0)
    for (ax, ay), (bx, by) in zip(axis[:-1], axis[1:]):
        abx, aby = bx - ax, by - ay; t = np.clip(((px - ax) * abx + (py - ay) * aby) / (abx ** 2 + aby ** 2), 0, 1)
        best = np.minimum(best, np.hypot(px - (ax + t * abx), py - (ay + t * aby)))
    return best
in_braid = (to_polyline(np.abs(dx), y) < .17) & (z < -.08)
hair = teal | yellow | in_braid
E0 = np.vstack([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]]); E0 = np.vstack([E0, E0[:, ::-1]])
A0 = sparse.coo_matrix((np.ones(len(E0)), (E0[:, 0], E0[:, 1])), shape=(len(V),) * 2).tocsr()
known = ~(Vv < .28) | in_braid; cls = hair.astype(float)
for _ in range(40):
    num = A0 @ (cls * known); den = A0 @ known.astype(float)
    todo = ~known & (den > 0)
    if not todo.any(): break
    cls[todo] = (num[todo] / den[todo] > .5).astype(float); known = known | todo
hair = cls > .5
W = np.zeros((len(V), len(B)))

# ---- head, neck and hair ----------------------------------------------------------------------------------------------------------
side = np.where(dx > 0, 1, -1)
braid = hair & (y < .30) & (np.abs(dx) > .30)
back = hair & ~braid & (y < .30) & (z < -.10)
for k in np.where(braid)[0]:
    wgt = sm(.30, -.05, y[k]) * .96
    W[k, idx['hairL' if dx[k] > 0 else 'hairR']] = wgt; W[k, idx['head']] = 1 - wgt
for k in np.where(back)[0]:
    wgt = sm(.28, -.10, y[k]) * .9
    W[k, idx['hairB']] = wgt; W[k, idx['head']] = 1 - wgt
rest_hair = hair & ~braid & ~back
for k in np.where(rest_hair)[0]:
    t = sm(.14, .30, y[k]); W[k, idx['head']] = t; W[k, idx['neck']] += 1 - t
face = ~hair & (y >= .20)
for k in np.where(face)[0]:
    t = sm(.20, .30, y[k]); W[k, idx['head']] = t; W[k, idx['neck']] += (1 - t) * .6; W[k, idx['chest']] += (1 - t) * .4

# ---- body: distance weights restricted by anatomy -----------------------------------------------------------------------------------
body = np.where(~hair & (y < .20))[0]
allowed = np.zeros((len(V), len(B)), bool)
for n in ('hips', 'spine', 'chest', 'neck'): allowed[body, idx[n]] = True
for s, sx in (('L', 1), ('R', -1)):
    skirt = (y < -.04) & (np.abs(dx) < .24 + (-.04 - y) * .7)
    arm = (sx * dx > .26) & (y > -.30) & (y < .14) & ~hair & ~skirt
    for n in ('upperArm', 'foreArm', 'hand'): allowed[:, idx[n + s]] = arm
    leg = (sx * dx > -.06) & (y < -.40)
    for n in ('thigh', 'shin', 'foot'): allowed[:, idx[n + s]] = leg
for k in body:
    cand = np.where(allowed[k])[0]; d = D[k, cand]
    wgt = 1.0 / (d + .025) ** 4
    # skirt and torso follow the pelvis more than the legs underneath
    for j, c in enumerate(cand):
        if names[c].startswith(('thigh', 'shin', 'foot')): wgt[j] *= sm(-.30, -.50, y[k])
    W[k, cand] = wgt / wgt.sum()

# ---- smoothing --------------------------------------------------------------------------------------------------------------------
E = np.vstack([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]]); E = np.vstack([E, E[:, ::-1]])
A = sparse.coo_matrix((np.ones(len(E)), (E[:, 0], E[:, 1])), shape=(len(V),) * 2).tocsr(); A.data[:] = 1
deg = np.asarray(A.sum(axis=1)).ravel(); Dinv = sparse.diags(1 / np.maximum(deg, 1))
for _ in range(4): W = .6 * W + .4 * (Dinv @ A @ W)
tr = cKDTree(V); pairs = tr.query_pairs(.04, output_type='ndarray')
if len(pairs):
    P = np.vstack([pairs, pairs[:, ::-1]])
    Sm = sparse.coo_matrix((np.ones(len(P)), (P[:, 0], P[:, 1])), shape=(len(V),) * 2).tocsr(); Sm.data[:] = 1
    sd = np.asarray(Sm.sum(axis=1)).ravel(); Sinv = sparse.diags(1 / np.maximum(sd, 1)); mask = (sd > 0).astype(float)[:, None]
    for _ in range(2): W = np.where(mask > 0, .6 * W + .4 * (Sinv @ Sm @ W), W)
# the colour classes are a hard rule: hair only follows head and hair bones, everything else never follows hair bones
hair_bones = [idx[n] for n in ('hairL', 'hairR', 'hairB')]
head_bones = [idx[n] for n in ('head', 'neck', 'hairL', 'hairR', 'hairB')]
only = np.zeros(len(B), bool); only[head_bones] = True
W[hair] *= only[None, :]
nohair = np.ones(len(B), bool); nohair[hair_bones] = False
W[~hair] *= nohair[None, :]
unset = W.sum(axis=1) < 1e-6
W[unset & hair, idx['head']] = 1; W[unset & ~hair, idx['hips']] = 1
top = np.argsort(-W, axis=1)[:, :4]; Wt = np.take_along_axis(W, top, 1); Wt /= Wt.sum(axis=1, keepdims=True)
q = np.round(Wt * 255).astype(np.uint8); q[:, 0] += (255 - q.sum(axis=1)).astype(np.uint8)
json.dump(dict(model=glb.split('/')[-1], vertices=len(V), bounds=[V.min(0).tolist(), V.max(0).tolist()],
               bones=[dict(name=b['name'], parent=b['parent'], head=list(map(float, b['head'])), tail=list(map(float, b['tail']))) for b in B],
               skinIndex=base64.b64encode(top.astype(np.uint8).tobytes()).decode(), skinWeight=base64.b64encode(q.tobytes()).decode()), open(out, 'w'))
print('rig', len(B), 'bones', len(V), 'vertices ->', out)
for n in ('upperArmL', 'handL', 'hairL', 'hairB', 'thighL', 'head', 'hips', 'chest'):
    print(n, 'influenced vertices', int((W[:, idx[n]] > .3).sum()))
