#!/usr/bin/env python3
"""Write bones.json for colab-rig.py from hand-annotated landmarks (read off the Hunyuan shape renders).
Mesh space: Y up, character faces +Z, height normalised to [-1, 1]. +X is the character's LEFT.

  python3 rig_profiles.py <phoebe|fluorolo|reggie> out.json
"""
import json
import sys

HUMAN = {
    'phoebe': dict(ymin=-1.0, top=0.995, hips=-0.58, waist=-0.42, chest=-0.18, neck=-0.03,
                   shoulder=(0.27, -0.15), elbow=(0.42, -0.34), wrist=(0.54, -0.49), tip=(0.61, -0.54),
                   hip=(0.17, -0.60), knee=(0.19, -0.79), ankle=(0.19, -0.94), zt=0.13, zh=0.15, za=0.09, toe=0.22),
    'fluorolo': dict(ymin=-1.0, top=0.995, hips=-0.55, waist=-0.38, chest=-0.17, neck=0.09,
                     shoulder=(0.27, -0.10), elbow=(0.42, -0.30), wrist=(0.52, -0.43), tip=(0.57, -0.50),
                     hip=(0.16, -0.60), knee=(0.17, -0.81), ankle=(0.17, -0.94), zt=0.12, zh=0.10, za=0.10, toe=0.22),
}


def humanoid(m):
    zt, zh, za = m['zt'], m['zh'], m['za']
    P = lambda x, y, z: [round(x, 4), round(y, 4), round(z, 4)]
    bones = [
        dict(name='Root', head=P(0, m['ymin'], zt), tail=P(0, m['ymin'] + 0.1, zt), parent=None, radius=0.02),
        dict(name='Hips', head=P(0, m['hips'], zt), tail=P(0, m['waist'], zt), parent='Root', radius=0.2),
        dict(name='Spine', head=P(0, m['waist'], zt), tail=P(0, m['chest'], zt), parent='Hips', radius=0.2),
        dict(name='Chest', head=P(0, m['chest'], zt), tail=P(0, m['neck'], zt), parent='Spine', radius=0.22),
        dict(name='Neck', head=P(0, m['neck'], zt), tail=P(0, m['neck'] + 0.07, zh), parent='Chest', radius=0.07),
        dict(name='Head', head=P(0, m['neck'] + 0.07, zh), tail=P(0, m['top'], zh), parent='Neck', radius=0.22, ymin=m['neck'] - 0.02),
    ]
    for side, sx in (('L', 1), ('R', -1)):
        sh, el, wr, tip = m['shoulder'], m['elbow'], m['wrist'], m['tip']
        mid = ((wr[0] + tip[0]) / 2, (wr[1] + tip[1]) / 2)
        bones += [
            dict(name=f'Shoulder_{side}', head=P(sx * 0.06, m['chest'], zt), tail=P(sx * sh[0], sh[1], za), parent='Chest', radius=0.06),
            dict(name=f'UpperArm_{side}', head=P(sx * sh[0], sh[1], za), tail=P(sx * el[0], el[1], za), parent=f'Shoulder_{side}', radius=0.075),
            dict(name=f'LowerArm_{side}', head=P(sx * el[0], el[1], za), tail=P(sx * wr[0], wr[1], za), parent=f'UpperArm_{side}', radius=0.07),
            dict(name=f'Hand_{side}', head=P(sx * wr[0], wr[1], za), tail=P(sx * mid[0], mid[1], za), parent=f'LowerArm_{side}', radius=0.06),
            dict(name=f'Fingers_{side}', head=P(sx * mid[0], mid[1], za), tail=P(sx * tip[0], tip[1], za), parent=f'Hand_{side}', radius=0.05),
            dict(name=f'UpperLeg_{side}', head=P(sx * m['hip'][0], m['hip'][1], zt), tail=P(sx * m['knee'][0], m['knee'][1], zt), parent='Hips', radius=0.1),
            dict(name=f'LowerLeg_{side}', head=P(sx * m['knee'][0], m['knee'][1], zt), tail=P(sx * m['ankle'][0], m['ankle'][1], zt), parent=f'UpperLeg_{side}', radius=0.09),
            dict(name=f'Foot_{side}', head=P(sx * m['ankle'][0], m['ankle'][1], zt), tail=P(sx * m['ankle'][0], m['ankle'][1] - 0.03, zt + m['toe']), parent=f'LowerLeg_{side}', radius=0.09),
        ]
    return dict(bones=bones, power=4, smooth=6)


# Reggie: upright seal pup (front view). Filled in after the shape is inspected.
SEAL = dict(ymin=-1.0, top=0.99, body=(0.0, -0.17), neck=(0.0, 0.36), head=(0.0, 0.69),
            f_shoulder=(0.48, -0.17), f_tip=(0.99, -0.30), r_hip=(0.36, -0.58), r_tip=(0.88, -0.86), z=0.05)


def seal(m):
    z = m['z']
    P = lambda x, y, zz=z: [round(x, 4), round(y, 4), round(zz, 4)]
    bones = [
        dict(name='Root', head=P(0, m['ymin']), tail=P(0, m['ymin'] + 0.1), parent=None, radius=0.02),
        dict(name='Hips', head=P(0, m['r_hip'][1]), tail=P(0, m['body'][1]), parent='Root', radius=0.35),
        dict(name='Spine', head=P(0, m['body'][1]), tail=P(0, m['neck'][1]), parent='Hips', radius=0.35),
        dict(name='Neck', head=P(0, m['neck'][1]), tail=P(0, m['neck'][1] + 0.12), parent='Spine', radius=0.15),
        dict(name='Head', head=P(0, m['neck'][1] + 0.12), tail=P(0, m['top']), parent='Neck', radius=0.3, ymin=m['neck'][1] - 0.05),
    ]
    for side, sx in (('L', 1), ('R', -1)):
        fs, ft = m['f_shoulder'], m['f_tip']
        mid = ((fs[0] + ft[0]) / 2, (fs[1] + ft[1]) / 2)
        rh, rt = m['r_hip'], m['r_tip']
        rmid = ((rh[0] + rt[0]) / 2, (rh[1] + rt[1]) / 2)
        bones += [
            dict(name=f'FlipperF1_{side}', head=P(sx * fs[0], fs[1]), tail=P(sx * mid[0], mid[1]), parent='Spine', radius=0.1),
            dict(name=f'FlipperF2_{side}', head=P(sx * mid[0], mid[1]), tail=P(sx * ft[0], ft[1]), parent=f'FlipperF1_{side}', radius=0.08),
            dict(name=f'FlipperR1_{side}', head=P(sx * rh[0], rh[1]), tail=P(sx * rmid[0], rmid[1]), parent='Hips', radius=0.1),
            dict(name=f'FlipperR2_{side}', head=P(sx * rmid[0], rmid[1]), tail=P(sx * rt[0], rt[1]), parent=f'FlipperR1_{side}', radius=0.08),
        ]
    return dict(bones=bones, power=4, smooth=6)


if __name__ == '__main__':
    name, out = sys.argv[1], sys.argv[2]
    data = humanoid(HUMAN[name]) if name in HUMAN else seal(SEAL)
    if name == 'fluorolo':
        # her two long braids get their own 3-bone chains so they swing instead of dragging with the arms
        P = lambda x, y, z: [round(x, 4), round(y, 4), round(z, 4)]
        for side, sx in (('L', 1), ('R', -1)):
            chain = [(0.47, 0.14), (0.47, -0.18), (0.46, -0.48), (0.45, -0.76)]
            parent = 'Head'
            for i in range(3):
                data['bones'].append(dict(name=f'Braid{i + 1}_{side}', head=P(sx * chain[i][0], chain[i][1], 0.10), tail=P(sx * chain[i + 1][0], chain[i + 1][1], 0.10), parent=parent, radius=0.07))
                parent = f'Braid{i + 1}_{side}'
        data.update(hairHue=[42, 200], hairMinSat=0.04, braid=dict(prefix='Braid', minX=0.33, maxY=0.2))
    json.dump(data, open(out, 'w'), indent=1)
    print(name, len(data['bones']), 'bones ->', out)
