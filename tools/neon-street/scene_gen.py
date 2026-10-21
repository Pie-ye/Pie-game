"""星光電玩街：場景排版（純 Python，不依賴 bpy / PIL）。

make_textures.py 與 build_blend.py（Blender）都會 import 這個模組，用同一個種子重建同一份場景，
所以貼圖上的光暈位置、GLB 裡的招牌、遊戲裡的碰撞框永遠對得上。

座標：遊戲座標，X 東、Y 上、Z 南（three.js 慣例），單位公尺。
UV：Blender 慣例（v 向上，影像頂端 v=1）。
"""
import math
import random

# ───────────────────────── 尺寸常數 ─────────────────────────
W = 10.0      # 大道半寬（含兩側人行道）
ROAD = 6.0    # 馬路半寬
R = 24.0      # 廣場鋪面半徑
RING = 27.0   # 廣場外圈（弧形大樓前緣）
L = 96.0      # 大道長度（閘門所在位置）
SEED = 20261021

EYE = 1.65

# 大道：d 為從廣場向外的方向
AVENUES = {
    'N': dict(d=(0, -1), name='星光大道', en='STAR AVENUE'),
    'E': dict(d=(1, 0), name='電玩街', en='ARCADE STREET'),
    'S': dict(d=(0, 1), name='霓虹夜市', en='NEON NIGHT MARKET'),
    'W': dict(d=(-1, 0), name='賽博巷', en='CYBER ALLEY'),
}

NEON = {  # 材質名 → (hex, 強度)
    'neon_pink': ('#ff3fb4', 4.0),
    'neon_cyan': ('#29e6ff', 4.0),
    'neon_yellow': ('#ffd84a', 4.0),
    'neon_green': ('#46ff9a', 4.0),
    'neon_purple': ('#a96bff', 4.0),
    'neon_white': ('#f4efff', 4.0),
    'neon_red': ('#ff3d5a', 4.0),
    'neon_orange': ('#ff8a3d', 4.0),
}

THEME = {
    'N': dict(neon=['neon_pink', 'neon_purple', 'neon_cyan', 'neon_white', 'neon_yellow'], fac=[0, 1], shop='shop_N',
              awning='awning_N', light='#ff7ad9'),
    'E': dict(neon=['neon_cyan', 'neon_pink', 'neon_yellow', 'neon_green'], fac=[2, 1], shop='shop_E',
              awning='awning_E', light='#4fe8ff'),
    'S': dict(neon=['neon_orange', 'neon_yellow', 'neon_red', 'neon_pink'], fac=[4, 3], shop='shop_S',
              awning='awning_S', light='#ffb05a'),
    'W': dict(neon=['neon_cyan', 'neon_green', 'neon_purple', 'neon_red'], fac=[5, 2], shop='shop_W',
              awning='awning_W', light='#6dffc4'),
}
N_FAC = 6
# 每種立面用的 ambientCG（CC0）夜景立面材質與其實際邊長（公尺；依樓層高約 3.2 m 抓）
FAC_SRC = [('Facade009', 32.0), ('Facade007', 40.0), ('Facade010', 46.0),
           ('Facade017', 26.0), ('Facade016', 60.0), ('Facade011', 44.0)]
FAC_TILES = {f'fac_{i}': (t, t) for i, (_, t) in enumerate(FAC_SRC)}
# Poly Haven（CC0）道具模型。size＝實際尺寸 (寬, 深, 高) 公尺，用來算碰撞；tris＝減面目標。
# tex＝貼圖邊長（預設 512，小東西用 256）。only/skip：同一個檔案裡有新舊兩種外觀時，用網格名稱挑一種。
PROP_MODELS = {
    'ubox1': dict(id='utility_box_01', tris=500, tex=256, size=(0.52, 0.43, 1.12)),
    'ubox2': dict(id='utility_box_02', tris=550, tex=256, size=(0.92, 0.43, 1.12)),
    'trash': dict(id='metal_trash_can', tris=700, skip=('rust', 'lid'), size=(0.78, 0.56, 0.91)),
    'trash_rust': dict(id='metal_trash_can', tris=700, only='rust', skip='lid', size=(0.78, 0.56, 0.91)),
    'hydrant': dict(id='fire_hydrant', tris=700, skip='aged', size=(0.28, 0.32, 0.8)),
    'hydrant_old': dict(id='fire_hydrant', tris=700, only='aged', size=(0.28, 0.32, 0.8)),
    'aircon': dict(id='exterior_aircon_unit', tris=450, skip='rusted', size=(0.8, 0.38, 0.93)),
    'aircon_rust': dict(id='exterior_aircon_unit', tris=450, only='rusted', size=(0.8, 0.38, 0.93)),
    'phone': dict(id='korean_public_payphone_01', tris=600, tex=256, size=(0.4, 0.3, 0.74)),
    'tyre': dict(id='old_tyre', tris=350, tex=256, rx=90, size=(0.6, 0.6, 0.165)),
    'barrier': dict(id='concrete_road_barrier', tris=500, size=(1.55, 0.64, 0.83)),
    'manhole': dict(id='water_manhole_cover', tris=250, tex=256, size=(0.69, 0.69, 0.068)),
    'ccar': dict(id='covered_car', tris=2000, size=(1.79, 4.38, 1.41)),
    'camera': dict(id='security_camera_01', tris=300, tex=256, size=(0.17, 0.55, 0.29)),
}
# 弧形大樓的大看板：(材質, 寬, 高)
ARC_BB = [('bb_phoebe', 8.4, 8.4), ('bb_castle', 11.0, 4.6), ('bb_hero', 5.2, 9.0), ('bb_arcade', 11.0, 4.6),
          ('bb_phoebe', 8.4, 8.4), ('bb_casino', 11.0, 4.6), ('bb_hero', 5.2, 9.0), ('bb_castle', 11.0, 4.6)]

# 招牌圖集（make_textures.py 依這份清單畫字）。hex 是主色。
SIGNS_H = [  # 1024x256，2 欄 × 8 列
    ('PIE GAME', '#ff3fb4'), ('電玩街', '#29e6ff'), ('ARCADE', '#ffd84a'), ('星光少女', '#ff7ad9'),
    ('遊戲幣兌換', '#46ff9a'), ('夾娃娃', '#ff8a3d'), ('拉麵 RAMEN', '#ff3d5a'), ('CYBER BAR', '#a96bff'),
    ('太空射擊', '#29e6ff'), ('LUCKY 777', '#ffd84a'), ('24H 營業中', '#46ff9a'), ('魔法少女', '#ff3fb4'),
    ('STAR GIRL', '#a96bff'), ('節奏樂園', '#ff7ad9'), ('GAME OVER?', '#ff3d5a'), ('INSERT COIN', '#ffd84a'),
]
SIGNS_V = [  # 256x1024，8 欄 × 2 列（直排）
    ('電玩城', '#29e6ff'), ('街機', '#ff3fb4'), ('星光', '#ffd84a'), ('夜市', '#ff8a3d'),
    ('賽博', '#46ff9a'), ('拉麵', '#ff3d5a'), ('酒場', '#a96bff'), ('遊戲幣', '#ffd84a'),
    ('格鬥', '#ff3d5a'), ('賽車', '#29e6ff'), ('PIE', '#ff3fb4'), ('抽獎', '#46ff9a'),
    ('BAR', '#a96bff'), ('LIVE', '#ff7ad9'), ('NEON', '#29e6ff'), ('少女', '#ff7ad9'),
]
# 大招牌 2048x512，4 列：四座閘門
SIGNS_BIG = [
    ('PIE GAME  星光大道', '#ff7ad9'), ('PIE GAME  電玩街', '#29e6ff'),
    ('PIE GAME  霓虹夜市', '#ffb05a'), ('PIE GAME  賽博巷', '#6dffc4'),
]
GATE_CELL = {'N': 0, 'E': 1, 'S': 2, 'W': 3}
# 投幣機螢幕圖集 1024x512：4 種，2x2
N_CAB = 4
N_VEND = 3

BILLBOARDS = {  # 材質名 → 來源（make_textures 去 site/shell/city/assets 抓）
    'bb_phoebe': ('fac-phoebe.webp', (1.0, 1.0)),
    'bb_castle': ('bg-phoebe.webp', (1536, 640)),
    'bb_arcade': ('bg-arcade.webp', (1536, 640)),
    'bb_casino': ('bg-casino.webp', (1536, 640)),
    'bb_hero': ('hero.webp', (518, 900)),
}

# 材質：name → dict。base=底色，em=自發光色，es=自發光強度，tex/emtex=貼圖檔名（tex/ 底下）
MATERIALS = {}


def _mat(name, base='#202030', rough=0.7, metal=0.0, em=None, es=1.0, tex=None, emtex=None, double=False,
         mr=None, detail=None, detail2=None, dn=1.0, nrm=None):
    """mr＝遮罩貼圖（R＝detail 與 detail2 的混合，G＝粗糙度，B＝金屬度）；
    detail / detail2＝assets/pbr 內的細節層名稱（Poly Haven CC0，見 fetch_pbr.py），dn＝法線強度。"""
    MATERIALS[name] = dict(base=base, rough=rough, metal=metal, em=em, es=es, tex=tex, emtex=emtex, double=double,
                           mr=mr, detail=detail, detail2=detail2, dn=dn, nrm=nrm)


_mat('ground_plaza', rough=0.42, tex='ground_plaza_c.jpg', emtex='ground_plaza_e.jpg', base='#ffffff', es=1.6,
     mr='ground_plaza_m.jpg', detail='plaza', detail2='pavement', dn=0.9)
for _a in 'NESW':
    _mat(f'ground_{_a}', rough=0.38, tex=f'ground_{_a}_c.jpg', emtex=f'ground_{_a}_e.jpg', base='#ffffff', es=1.6,
         mr=f'ground_{_a}_m.jpg', detail='asphalt', detail2='pavement', dn=1.0)
_mat('ground_far', base='#0c0a14', rough=0.9)
_mat('concrete', base='#25213a', rough=0.8, detail='wall_g')
_mat('roof', base='#17142a', rough=0.9, detail='wall_g')
_mat('metal', base='#33344a', rough=0.45, metal=0.7, detail='metal')
_mat('pole', base='#2a2b3c', rough=0.5, metal=0.6, detail='metal')
_mat('trim_dark', base='#15131f', rough=0.6, metal=0.3, detail='metal')
for _i in range(N_FAC):
    _mat(f'fac_{_i}', base='#ffffff', rough=0.85, tex=f'fac_{_i}_c.jpg', emtex=f'fac_{_i}_e.jpg', es=2.4,
         mr=f'fac_{_i}_m.jpg', nrm=f'fac_{_i}_n.jpg')
for _a in 'NESW':
    _mat(f'shop_{_a}', base='#ffffff', rough=0.6, tex=f'shop_{_a}_c.jpg', emtex=f'shop_{_a}_e.jpg', es=1.4)
_AW = {'N': '#b03c9a', 'E': '#1f6f9a', 'S': '#b8481c', 'W': '#1f8a6a'}
for _a in 'NESW':
    _mat(f'awning_{_a}', base=_AW[_a], rough=0.7, detail='corr')
for _n, (_h, _s) in NEON.items():
    _mat(_n, base='#000000', em=_h, es=_s)
_mat('signs_h', base='#000000', emtex='signs_h.jpg', es=2.2)
_mat('signs_h_f', base='#000000', emtex='signs_h.jpg', es=2.2)
_mat('signs_v', base='#000000', emtex='signs_v.jpg', es=2.2)
_mat('signs_v_f', base='#000000', emtex='signs_v.jpg', es=2.2)
_mat('signs_big', base='#000000', emtex='signs_big.jpg', es=2.4)
for _b in BILLBOARDS:
    _mat(_b, base='#000000', emtex=f'{_b}.jpg', es=1.5)
_mat('cab_body', base='#2b2a60', rough=0.45, metal=0.3, detail='paint')
_mat('cab_screen', base='#000000', emtex='cabs.jpg', es=2.4)
_mat('vend_body', base='#2a2c3e', rough=0.4, metal=0.5, detail='paint')
_mat('vend_front', base='#000000', emtex='vend.jpg', es=2.0)
_mat('bridge_glow', base='#06222a', em='#3fe0ff', es=1.2)
_mat('leaf_pink', base='#6a2a62', em='#ff6ad0', es=0.6, rough=0.8)
_mat('trunk', base='#2a1830', rough=0.9)
_mat('car_a', detail='paint', base='#6a1fa0', rough=0.25, metal=0.6)
_mat('car_b', detail='paint', base='#1f6a9a', rough=0.25, metal=0.6)
_mat('car_c', detail='paint', base='#a01f5a', rough=0.25, metal=0.6)
_mat('car_glass', base='#07070f', rough=0.1, metal=0.9)
_mat('monument', base='#201a38', rough=0.4, metal=0.6, detail='metal')
_mat('star_gold', base='#000000', em='#ffcf4a', es=4.5)
_mat('heart_pink', base='#000000', em='#ff4fb0', es=4.5)
_mat('moon_ring', base='#000000', em='#b88cff', es=4.0)

CAR_MATS = ['car_a', 'car_b', 'car_c']


# ───────────────────────── 向量小工具 ─────────────────────────
def v_sub(a, b): return (a[0] - b[0], a[1] - b[1], a[2] - b[2])
def v_cross(a, b): return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])
def v_dot(a, b): return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


_KEY_OFS = {'+a': 0.13, '-a': 0.41, '+b': 0.0, '-b': 0.67}
NEON_LIGHT = {'neon_pink': '#ff6ac8', 'neon_cyan': '#5ae8ff', 'neon_yellow': '#ffe27a', 'neon_green': '#7affb0',
              'neon_purple': '#b98cff', 'neon_white': '#f4efff', 'neon_red': '#ff6a7a', 'neon_orange': '#ffa05a'}


class Geo:
    """每個物件（名稱）→ 每種材質 → 面清單。面的頂點存成相對於 pivot 的座標。"""

    def __init__(self):
        self.objs = {'static': dict(pivot=(0.0, 0.0, 0.0), mats={})}
        self.cur = 'static'

    def use(self, name, pivot=(0.0, 0.0, 0.0)):
        if name not in self.objs:
            self.objs[name] = dict(pivot=tuple(pivot), mats={})
        self.cur = name

    def face(self, mat, pts, uvs, n=None):
        assert mat in MATERIALS, mat
        if n is not None and len(pts) >= 3:
            nn = v_cross(v_sub(pts[1], pts[0]), v_sub(pts[2], pts[0]))
            if v_dot(nn, n) < 0:
                pts = pts[::-1]
                uvs = uvs[::-1]
        o = self.objs[self.cur]
        px, py, pz = o['pivot']
        local = [(p[0] - px, p[1] - py, p[2] - pz) for p in pts]
        o['mats'].setdefault(mat, []).append((local, list(uvs)))

    # 垂直面：中心點 c(x,z)、外向法線 n(x,z)、半寬 hw。左右依「從外側看」。
    def vface(self, mat, c, n, hw, y0, y1, uv=(0, 0, 1, 1), uoff=0.0, tile=None):
        rx, rz = n[1], -n[0]
        p0 = (c[0] - rx * hw, y0, c[1] - rz * hw)
        p1 = (c[0] + rx * hw, y0, c[1] + rz * hw)
        p2 = (p1[0], y1, p1[2])
        p3 = (p0[0], y1, p0[2])
        if tile:  # 以公尺平鋪
            tw, th = FAC_TILES.get(mat, tile)
            u0, u1 = uoff, uoff + 2 * hw / tw
            v0, v1 = y0 / th, y1 / th
            uvs = [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]
        else:
            uvs = [(uv[0], uv[1]), (uv[2], uv[1]), (uv[2], uv[3]), (uv[0], uv[3])]
        self.face(mat, [p0, p1, p2, p3], uvs, n=(n[0], 0, n[1]))

    def hface(self, mat, pts_xz, y, uvs, up=True):
        pts = [(x, y, z) for x, z in pts_xz]
        self.face(mat, pts, uvs, n=(0, 1 if up else -1, 0))

    def box(self, mat, cx, cz, ex, hw, hd, y0, y1, tile=(8.0, 24.0), uoff=0.0, over=None, top=None,
            skip=(), vofs=None):
        """有向長方體。ex 為寬度方向單位向量，ez=(-ex.z, ex.x) 為深度方向。
        over: {'+b': (mat, (u0,v0,u1,v1))} 覆蓋某面的材質與 UV。"""
        ez = (-ex[1], ex[0])
        over = over or {}
        for key, n, half_n, half_r in (('+b', ez, hd, hw), ('-b', (-ez[0], -ez[1]), hd, hw),
                                       ('+a', ex, hw, hd), ('-a', (-ex[0], -ex[1]), hw, hd)):
            if key in skip:
                continue
            c = (cx + n[0] * half_n, cz + n[1] * half_n)
            if key in over:
                m, uv = over[key]
                self.vface(m, c, n, half_r, y0, y1, uv=uv)
            elif tile:
                self.vface(mat, c, n, half_r, y0, y1, tile=tile, uoff=uoff + _KEY_OFS[key])
            else:
                self.vface(mat, c, n, half_r, y0, y1, uv=(0, 0, 1, 1))
        if '+y' not in skip:
            corners = [(cx + ex[0] * a + ez[0] * b, cz + ex[1] * a + ez[1] * b)
                       for a, b in ((-hw, -hd), (hw, -hd), (hw, hd), (-hw, hd))]
            self.hface(top or mat, corners, y1, [(0, 0), (1, 0), (1, 1), (0, 1)] if not top else
                       [(0, 0), (hw * 2 / 8, 0), (hw * 2 / 8, hd * 2 / 8), (0, hd * 2 / 8)])

    def prism(self, mat, poly, y0, y1, cx=0.0, cz=0.0, rot=0.0, plane='xz'):
        """多邊形柱（poly 為凸或星形，逆時針；用扇形剖分）。plane='xz' 為水平放置，'xy' 為站立（沿 z 擠出）。"""
        pts = []
        for px, py in poly:
            if plane == 'xz':
                pts.append((px, py))
            else:
                pts.append((px, py))
        n = len(pts)
        cxp = sum(p[0] for p in pts) / n
        cyp = sum(p[1] for p in pts) / n
        if plane == 'xz':
            def P(p, y): return (cx + p[0], y, cz + p[1])
            for i in range(n):
                a, b = pts[i], pts[(i + 1) % n]
                self.face(mat, [P((cxp, cyp), y1), P(a, y1), P(b, y1)], [(0.5, 0.5), (0, 0), (1, 0)], n=(0, 1, 0))
                self.face(mat, [P((cxp, cyp), y0), P(a, y0), P(b, y0)], [(0.5, 0.5), (0, 0), (1, 0)], n=(0, -1, 0))
                mid = ((a[0] + b[0]) / 2 - cxp, (a[1] + b[1]) / 2 - cyp)
                self.face(mat, [P(a, y0), P(b, y0), P(b, y1), P(a, y1)], [(0, 0), (1, 0), (1, 1), (0, 1)],
                          n=(mid[0], 0, mid[1]))
        else:  # 'xy'：多邊形在 XY 平面，沿 Z 從 y0 擠到 y1（這裡 y0,y1 當作 z 範圍）
            def P(p, z): return (cx + p[0], cz + p[1], z)  # cz 當作基準高度
            for i in range(n):
                a, b = pts[i], pts[(i + 1) % n]
                self.face(mat, [P((cxp, cyp), y1), P(a, y1), P(b, y1)], [(0.5, 0.5), (0, 0), (1, 0)], n=(0, 0, 1))
                self.face(mat, [P((cxp, cyp), y0), P(a, y0), P(b, y0)], [(0.5, 0.5), (0, 0), (1, 0)], n=(0, 0, -1))
                mid = ((a[0] + b[0]) / 2 - cxp, (a[1] + b[1]) / 2 - cyp)
                self.face(mat, [P(a, y0), P(b, y0), P(b, y1), P(a, y1)], [(0, 0), (1, 0), (1, 1), (0, 1)],
                          n=(mid[0], mid[1], 0))

    def cyl(self, mat, cx, cz, r, y0, y1, seg=10, cap=True, r1=None):
        r1 = r if r1 is None else r1
        for i in range(seg):
            a0 = 2 * math.pi * i / seg
            a1 = 2 * math.pi * (i + 1) / seg
            p0 = (cx + math.cos(a0) * r, y0, cz + math.sin(a0) * r)
            p1 = (cx + math.cos(a1) * r, y0, cz + math.sin(a1) * r)
            p2 = (cx + math.cos(a1) * r1, y1, cz + math.sin(a1) * r1)
            p3 = (cx + math.cos(a0) * r1, y1, cz + math.sin(a0) * r1)
            am = (a0 + a1) / 2
            self.face(mat, [p0, p1, p2, p3], [(i / seg, 0), ((i + 1) / seg, 0), ((i + 1) / seg, 1), (i / seg, 1)],
                      n=(math.cos(am), 0, math.sin(am)))
            if cap:
                self.face(mat, [(cx, y1, cz), p3, p2], [(.5, .5), (0, 0), (1, 0)], n=(0, 1, 0))

    def torus(self, mat, big, small, seg=36, ring=6, tilt=0.0, cx=0.0, cy=0.0, cz=0.0):
        def pt(i, j):
            a = 2 * math.pi * i / seg
            b = 2 * math.pi * j / ring
            x = (big + small * math.cos(b)) * math.cos(a)
            z = (big + small * math.cos(b)) * math.sin(a)
            y = small * math.sin(b)
            # 繞 X 軸傾斜
            y2 = y * math.cos(tilt) - z * math.sin(tilt)
            z2 = y * math.sin(tilt) + z * math.cos(tilt)
            return (cx + x, cy + y2, cz + z2)
        for i in range(seg):
            for j in range(ring):
                ps = [pt(i, j), pt(i + 1, j), pt(i + 1, j + 1), pt(i, j + 1)]
                # 外向法線：由環心指向面心
                ca = 2 * math.pi * (i + .5) / seg
                c0 = (cx + big * math.cos(ca), cy + big * math.sin(ca) * math.sin(tilt) * 0 + 0, cz + big * math.sin(ca))
                fc = tuple(sum(p[k] for p in ps) / 4 for k in range(3))
                # 環心（含傾斜）
                bx, bz = big * math.cos(ca), big * math.sin(ca)
                ccy = -bz * math.sin(tilt)
                ccz = bz * math.cos(tilt)
                cen = (cx + bx, cy + ccy, cz + ccz)
                self.face(mat, ps, [(i / seg, j / ring), ((i + 1) / seg, j / ring), ((i + 1) / seg, (j + 1) / ring),
                                    (i / seg, (j + 1) / ring)], n=v_sub(fc, cen))

    def blob(self, mat, cx, cy, cz, r, seg=7, rings=4):
        def pt(i, j):
            a = 2 * math.pi * i / seg
            b = math.pi * j / rings
            return (cx + r * math.sin(b) * math.cos(a), cy + r * math.cos(b), cz + r * math.sin(b) * math.sin(a))
        for i in range(seg):
            for j in range(rings):
                ps = [pt(i, j), pt(i + 1, j), pt(i + 1, j + 1), pt(i, j + 1)]
                if j == 0:
                    ps = [ps[0], ps[2], ps[3]]
                elif j == rings - 1:
                    ps = [ps[0], ps[1], ps[2]]
                fc = tuple(sum(p[k] for p in ps) / len(ps) for k in range(3))
                self.face(mat, ps, [(0, 0), (1, 0), (1, 1), (0, 1)][:len(ps)], n=v_sub(fc, (cx, cy, cz)))


def star_poly(r_out, r_in, n=5, rot=-math.pi / 2):
    pts = []
    for i in range(n * 2):
        r = r_out if i % 2 == 0 else r_in
        a = rot + math.pi * i / n
        pts.append((math.cos(a) * r, math.sin(a) * r))
    return pts


def heart_poly(s=1.0, n=28):
    pts = []
    for i in range(n):
        t = 2 * math.pi * i / n
        x = 16 * math.sin(t) ** 3
        y = 13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)
        pts.append((x * s / 17, y * s / 17))
    return pts


class Scene:
    def __init__(self):
        self.geo = Geo()
        self.colliders = []   # dict(t='obb', cx,cz,ax,az,hw,hd) / dict(t='circle',...)
        self.lights = []      # dict(p=(x,y,z), c='#hex', i=, d=)
        self.parts = []       # 動畫物件清單 dict(name, kind, ...)
        self.glows = []       # 地面光暈：dict(x,z,c,r,a) 給貼圖用
        self.zones = {}
        self.buildings = []
        self.alleys = []
        self.props = []       # Poly Haven 道具實例 dict(m, x, y, z, f=(fx, fz))
        self.stats = {}


def _obb(sc, cx, cz, ex, hw, hd, tag='b'):
    sc.colliders.append(dict(t='obb', cx=round(cx, 3), cz=round(cz, 3), ax=round(ex[0], 4), az=round(ex[1], 4),
                             hw=round(hw, 3), hd=round(hd, 3), tag=tag))


def _circle(sc, cx, cz, r, tag='p'):
    sc.colliders.append(dict(t='circle', cx=round(cx, 3), cz=round(cz, 3), r=round(r, 3), tag=tag))


def _light(sc, p, c, i=2.0, d=22.0):
    sc.lights.append(dict(p=[round(p[0], 2), round(p[1], 2), round(p[2], 2)], c=c, i=i, d=d))


def _glow(sc, x, z, c, r, a=0.5):
    sc.glows.append(dict(x=x, z=z, c=c, r=r, a=a))


def _cell_uv_h(i):   # 1024x256 圖集，2 欄 × 8 列
    col, row = i % 2, i // 2
    return (col / 2, 1 - (row + 1) / 8, (col + 1) / 2, 1 - row / 8)


def _cell_uv_v(i):   # 256x1024，8 欄 × 2 列
    col, row = i % 8, i // 8
    return (col / 8, 1 - (row + 1) / 2, (col + 1) / 8, 1 - row / 2)


def _cell_uv_big(i):  # 2048x512，4 列
    return (0, 1 - (i + 1) / 4, 1, 1 - i / 4)


def _cell_uv_cab(i):  # 1024x512：2x2
    col, row = i % 2, i // 2
    return (col / 2, 1 - (row + 1) / 2, (col + 1) / 2, 1 - row / 2)


def _cell_uv_vend(i):  # 768x512?? → 3 欄一列
    return (i / 3, 0, (i + 1) / 3, 1)


def _hex_lum(h):
    return h


# ───────────────────────── 大樓 ─────────────────────────
def make_building(sc, r, b, theme_key, shop=True, signs=True):
    """b: dict(cx,cz,fx,fz,hw,hd,h,fac)。front=(fx,fz) 為外向正面法線。"""
    g = sc.geo
    th = THEME[theme_key]
    fx, fz = b['fx'], b['fz']
    ex = (fz, -fx)
    ez = (-ex[1], ex[0])      # == (fx, fz)
    cx, cz, hw, hd, h = b['cx'], b['cz'], b['hw'], b['hd'], b['h']
    fac = f"fac_{b['fac']}"
    uoff = r.random()
    g.use('static')
    shop_h = 5.0 if shop else 0.0
    # 側面與背面：整面牆
    g.box(fac, cx, cz, ex, hw, hd, 0, h, tile=(8, 24), uoff=uoff, skip=('+b', '+y'))
    # 正面
    front_c = (cx + fx * hd, cz + fz * hd)
    if shop:
        g.vface(f"shop_{theme_key}", front_c, (fx, fz), hw, 0, shop_h, tile=(10, 5), uoff=r.random())
        g.vface(fac, front_c, (fx, fz), hw, shop_h, h, tile=(8, 24), uoff=uoff)
        # 腰線與霓虹
        g.box('trim_dark', cx + fx * (hd + 0.2), cz + fz * (hd + 0.2), ex, hw + 0.1, 0.22, shop_h - 0.15, shop_h + 0.35,
              tile=None)
        nm = r.choice(th['neon'])
        g.box(nm, cx + fx * (hd + 0.42), cz + fz * (hd + 0.42), ex, hw, 0.04, shop_h + 0.0, shop_h + 0.1, tile=None)
        # 雨棚（斜面）
        aw = f"awning_{theme_key}"
        awd = 1.7
        y_hi, y_lo = 4.55, 3.85
        p_hi0 = (cx + ex[0] * (-hw + .6) + fx * hd, y_hi, cz + ex[1] * (-hw + .6) + fz * hd)
        p_hi1 = (cx + ex[0] * (hw - .6) + fx * hd, y_hi, cz + ex[1] * (hw - .6) + fz * hd)
        p_lo1 = (p_hi1[0] + fx * awd, y_lo, p_hi1[2] + fz * awd)
        p_lo0 = (p_hi0[0] + fx * awd, y_lo, p_hi0[2] + fz * awd)
        n_up = (fx * (y_hi - y_lo), awd, fz * (y_hi - y_lo))
        g.face(aw, [p_hi0, p_hi1, p_lo1, p_lo0], [(0, 0), (1, 0), (1, 1), (0, 1)], n=n_up)
        g.face(aw, [p_lo0, p_lo1, (p_lo1[0], y_lo - .45, p_lo1[2]), (p_lo0[0], y_lo - .45, p_lo0[2])],
               [(0, 0), (1, 0), (1, 1), (0, 1)], n=(fx, 0, fz))
        g.box(nm, cx + fx * (hd + awd + 0.03), cz + fz * (hd + awd + 0.03), ex, hw - .6, 0.03, y_lo - .58, y_lo - .46,
              tile=None)
        # 店面燈光
        _light(sc, (cx + fx * (hd + 2.2), 3.0, cz + fz * (hd + 2.2)), th['light'], 1.6, 14)
        _glow(sc, cx + fx * (hd + 3.0), cz + fz * (hd + 3.0), th['light'], min(hw + 3, 9), 0.30)
    else:
        g.vface(fac, front_c, (fx, fz), hw, 0, h, tile=(8, 24), uoff=uoff)
    # 大看板（沿用專案既有美術）
    if b.get('bb'):
        name, bw, bh = b['bb']
        y0 = shop_h + 3.2
        c = (cx + fx * (hd + 0.08), cz + fz * (hd + 0.08))
        g.vface(name, c, (fx, fz), bw / 2, y0, y0 + bh, uv=(0, 0, 1, 1))
        g.box(r.choice(th['neon']), cx + fx * (hd + 0.1), cz + fz * (hd + 0.1), ex, bw / 2 + .25, 0.03, y0 - .25, y0 - .1, tile=None)
        g.box(r.choice(th['neon']), cx + fx * (hd + 0.1), cz + fz * (hd + 0.1), ex, bw / 2 + .25, 0.03, y0 + bh + .1, y0 + bh + .25, tile=None)
        _light(sc, (c[0] + fx * 4, y0 + bh / 2, c[1] + fz * 4), '#ffffff', 2.4, 28)
        _glow(sc, c[0] + fx * 8, c[1] + fz * 8, '#ffffff', 7, 0.25)
    # 屋頂
    corners = [(cx + ex[0] * a + ez[0] * bb, cz + ex[1] * a + ez[1] * bb) for a, bb in ((-hw, -hd), (hw, -hd), (hw, hd), (-hw, hd))]
    g.hface('roof', corners, h, [(0, 0), (1, 0), (1, 1), (0, 1)])
    # 屋頂邊緣霓虹
    if r.random() < 0.85:
        nm2 = r.choice(th['neon'])
        for key, n_, half_n, half_r in (('+b', ez, hd, hw), ('+a', ex, hw, hd), ('-a', (-ex[0], -ex[1]), hw, hd)):
            c = (cx + n_[0] * (half_n + 0.05), cz + n_[1] * (half_n + 0.05))
            exn = (n_[1], -n_[0])
            g.box(nm2, c[0], c[1], exn, half_r, 0.04, h - 0.25, h + 0.05, tile=None)
    # 屋頂雜物
    for _ in range(r.randint(1, 3)):
        a = r.uniform(-hw + 1.5, hw - 1.5)
        bb = r.uniform(-hd + 1.5, hd - 1.5)
        px, pz = cx + ex[0] * a + ez[0] * bb, cz + ex[1] * a + ez[1] * bb
        sx, sz, sh = r.uniform(1, 2.5), r.uniform(1, 2.5), r.uniform(0.8, 2.2)
        g.box('metal', px, pz, ex, sx / 2, sz / 2, h, h + sh, tile=None)
    if h > 28 and r.random() < 0.7:  # 天線＋紅燈
        a = r.uniform(-hw + 1, hw - 1)
        bb = r.uniform(-hd + 1, hd - 1)
        px, pz = cx + ex[0] * a + ez[0] * bb, cz + ex[1] * a + ez[1] * bb
        g.cyl('pole', px, pz, 0.12, h, h + 7, seg=5)
        g.box('neon_red', px, pz, (1, 0), 0.25, 0.25, h + 7, h + 7.5, tile=None)
        _glow(sc, px, pz, '#ff3d5a', 0, 0)
    # 碰撞
    _obb(sc, cx, cz, ex, hw, hd)
    sc.buildings.append(dict(cx=cx, cz=cz, hw=hw, hd=hd, h=h, f=(fx, fz), theme=theme_key))
    if not signs:
        return
    # 招牌
    cellsH = list(range(len(SIGNS_H)))
    cellsV = list(range(len(SIGNS_V)))
    flick = lambda: r.random() < 0.18
    # 橫招（貼牆）
    if hw > 4:
        i = r.choice(cellsH)
        sw = min(2 * hw - 2.0, r.choice([5.0, 6.4, 8.0]))
        sh = sw / 4.0
        y0 = shop_h + r.uniform(0.7, 2.2) if shop else 2.5
        a = r.uniform(-(hw - sw / 2 - .5), hw - sw / 2 - .5)
        c = (cx + ex[0] * a + fx * (hd + 0.06), cz + ex[1] * a + fz * (hd + 0.06))
        mat = 'signs_h_f' if flick() else 'signs_h'
        g.vface(mat, c, (fx, fz), sw / 2, y0, y0 + sh, uv=_cell_uv_h(i))
        # 框
        g.box('trim_dark', c[0] - fx * .01, c[1] - fz * .01, ex, sw / 2 + .12, 0.07, y0 - .1, y0 + sh + .1, tile=None,
              skip=('+b',))
        col = SIGNS_H[i][1]
        _light(sc, (c[0] + fx * 1.8, y0 + sh / 2, c[1] + fz * 1.8), col, 2.2, 20)
        _glow(sc, c[0] + fx * 4.5, c[1] + fz * 4.5, col, 5 + sw * .35, 0.55)
    # 直招（垂直牆面伸出）：兩個
    for side in (-1, 1):
        if r.random() < 0.6:
            i = r.choice(cellsV)
            sw, sh = 1.1, 4.4
            y0 = shop_h + r.uniform(1.0, 6.0)
            a = side * (hw - 0.3)
            px, pz = cx + ex[0] * a + fx * (hd + 0.1), cz + ex[1] * a + fz * (hd + 0.1)
            # 招牌面的法線沿 ex（兩面）；中心往外伸 0.9 m
            c = (px + fx * 0.95, pz + fz * 0.95)
            mat = 'signs_v_f' if flick() else 'signs_v'
            u0, v0, u1, v1 = _cell_uv_v(i)
            for sgn in (1, -1):
                n = (ex[0] * sgn, ex[1] * sgn)
                uvr = (u0, v0, u1, v1) if sgn == 1 else (u1, v0, u0, v1)
                g.vface(mat, (c[0] + n[0] * 0.04, c[1] + n[1] * 0.04), n, sw / 2, y0, y0 + sh, uv=uvr)
            g.box('trim_dark', c[0], c[1], ex, 0.05, sw / 2 + .08, y0 - .08, y0 + sh + .08, tile=None)
            g.box('metal', px + fx * .5, pz + fz * .5, ex, 0.04, 0.5, y0 + sh - .3, y0 + sh - .2, tile=None)
            col = SIGNS_V[i][1]
            _light(sc, (c[0] + fx * 0.8, y0 + sh / 2, c[1] + fz * 0.8), col, 2.0, 18)
    # 屋頂大招牌（靠廣場側較大）
    if shop and r.random() < 0.4:
        i = r.choice(cellsH)
        sw = min(2 * hw - 1, 10.0)
        sh = sw / 4
        base = h + 1.0
        c = (cx + fx * (hd - 1.0), cz + fz * (hd - 1.0))
        g.vface('signs_h', c, (fx, fz), sw / 2, base, base + sh, uv=_cell_uv_h(i))
        uu = _cell_uv_h(i)
        g.vface('signs_h', (c[0] - fx * .05, c[1] - fz * .05), (-fx, -fz), sw / 2, base, base + sh, uv=(uu[2], uu[1], uu[0], uu[3]))
        for s_ in (-1, 1):
            g.box('metal', c[0] + ex[0] * s_ * (sw / 2 - .4), c[1] + ex[1] * s_ * (sw / 2 - .4), ex, .08, .08, h, base + sh, tile=None)
        _light(sc, (c[0] + fx * 3, base + sh / 2, c[1] + fz * 3), SIGNS_H[i][1], 2.6, 30)


def make_gate(sc, r, key):
    g = sc.geo
    a = AVENUES[key]
    dx, dz = a['d']
    nx, nz = -dz, dx           # 橫向
    # 閘門朝廣場的方向
    fx, fz = -dx, -dz
    ex = (nx, nz)
    t = L
    th = THEME[key]
    cxp, czp = dx * t, dz * t
    for s in (-1, 1):
        px, pz = cxp + nx * s * (W - 1.2), czp + nz * s * (W - 1.2)
        g.box('monument', px, pz, ex, 1.3, 1.3, 0, 26, tile=None)
        g.box(th['neon'][0], px + fx * 1.34, pz + fz * 1.34, ex, 0.12, 0.04, 0, 26, tile=None)
        _obb(sc, px, pz, ex, 1.3, 1.3, 'gate')
    # 橫梁
    g.box('monument', cxp, czp, ex, W, 1.0, 21.0, 25.0, tile=None)
    g.vface('signs_big', (cxp + fx * 1.02, czp + fz * 1.02), (fx, fz), W - 1.5, 21.4, 21.4 + (2 * (W - 1.5)) / 4, uv=_cell_uv_big(GATE_CELL[key]))
    # 閘門外側：反向文字不需要，放一片純霓虹條
    g.box(th['neon'][0], cxp, czp, ex, W, 0.05, 20.8, 21.0, tile=None)
    g.box(th['neon'][1], cxp, czp, ex, W, 0.05, 25.0, 25.2, tile=None)
    _light(sc, (cxp + fx * 4, 20, czp + fz * 4), SIGNS_BIG[GATE_CELL[key]][1], 3.0, 40)
    _glow(sc, cxp + fx * 6, czp + fz * 6, SIGNS_BIG[GATE_CELL[key]][1], 12, 0.5)
    # 閘門後的巨型看板牆
    bb = {'N': 'bb_castle', 'E': 'bb_arcade', 'S': 'bb_casino', 'W': 'bb_castle'}[key]
    wall_c = (dx * (L + 10), dz * (L + 10))
    ww, wh = 68.0, 68.0 * 640 / 1536 * 1.0
    wh = max(wh, 30)
    g.box('monument', wall_c[0], wall_c[1], ex, ww / 2, 1.5, 0, 66, tile=None)
    g.vface(bb, (wall_c[0] + fx * 1.52, wall_c[1] + fz * 1.52), (fx, fz), 33, 12, 12 + 66 * 0 + 28.3, uv=(0, 0, 1, 1))
    _light(sc, (wall_c[0] + fx * 8, 20, wall_c[1] + fz * 8), '#ffffff', 1.6, 50)
    _obb(sc, wall_c[0], wall_c[1], ex, ww / 2, 1.5, 'wall')


def _blocked(sc, x, z, rad, ignore=('far',)):
    """(x, z) 半徑 rad 內是否已有碰撞體或道具。ignore＝略過的碰撞體標籤（貼牆的東西要略過 'b'）。"""
    for c in sc.colliders:
        if c['tag'] in ignore:
            continue
        if c['t'] == 'circle':
            if math.hypot(x - c['cx'], z - c['cz']) < c['r'] + rad:
                return True
        else:
            u = (x - c['cx']) * c['ax'] + (z - c['cz']) * c['az']
            v = -(x - c['cx']) * c['az'] + (z - c['cz']) * c['ax']
            if abs(u) < c['hw'] + rad and abs(v) < c['hd'] + rad:
                return True
    for q in sc.props:
        if math.hypot(x - q['x'], z - q['z']) < q.get('rad', 0.3) + rad:
            return True
    return False


def _prop(sc, m, x, z, f, y=0.0, solid=True, rad=None):
    """放一個道具；solid 時加碰撞體。f＝正面朝向（單位向量）。"""
    w, d, h = PROP_MODELS[m]['size']
    rad = rad if rad is not None else max(w, d) / 2
    sc.props.append(dict(m=m, x=round(x, 3), y=round(y, 3), z=round(z, 3), f=[round(f[0], 4), round(f[1], 4)], rad=round(rad, 2)))
    if solid:
        if m in ('trash', 'trash_rust', 'hydrant', 'hydrant_old'):
            _circle(sc, x, z, max(w, d) / 2, 'prop')
        else:
            _obb(sc, x, z, (f[1], -f[0]), w / 2, d / 2, 'prop')


def place_props(sc):
    """把 Poly Haven 的街頭道具散在人行道、牆面與巷內。位置固定（SEED），避開既有碰撞體。"""
    pr = random.Random(SEED + 9)
    alley_t = {k: [] for k in AVENUES}
    for al in sc.alleys:
        dx, dz = AVENUES[al['key']]['d']
        alley_t[al['key']].append(al['cx'] * dx + al['cz'] * dz)

    for key, a in AVENUES.items():
        dx, dz = a['d']
        nx, nz = -dz, dx

        def at(t, lat):
            return dx * t + nx * lat, dz * t + nz * lat

        def in_alley(t):
            return any(abs(t - at_) < 3.0 for at_ in alley_t[key])

        def scatter(n, tmin, tmax, lat_of, models, face, y=0.0, solid=True, wall=False, tries=40, rad=None, ignore=('far',)):
            """face(side) → 正面朝向；wall＝貼牆（避開巷口）"""
            done = 0
            for _ in range(tries):
                if done >= n:
                    break
                side = pr.choice((-1, 1))
                t = pr.uniform(tmin, tmax)
                if wall and in_alley(t):
                    continue
                m = pr.choice(models)
                lat = lat_of(side, PROP_MODELS[m]['size'])
                x, z = at(t, lat)
                f = face(side)
                if _blocked(sc, x, z, (rad if rad is not None else max(PROP_MODELS[m]['size'][:2]) / 2) + 0.15, ignore):
                    continue
                yy = y(pr) if callable(y) else y
                _prop(sc, m, x, z, f, y=yy, solid=solid and not wall, rad=rad)
                done += 1

        toward_road = lambda side: (-nx * side, -nz * side)      # 面向大道中心
        # 消防栓：路緣
        scatter(3, 30, L - 8, lambda s_, sz: s_ * (ROAD + 0.55), ['hydrant', 'hydrant', 'hydrant_old'], toward_road)
        # 垃圾桶：靠牆那一側的人行道
        scatter(5, 29, L - 6, lambda s_, sz: s_ * (W - 0.6), ['trash', 'trash', 'trash_rust'], toward_road)
        # 配電箱：貼牆
        scatter(4, 29, L - 6, lambda s_, sz: s_ * (W - 0.1 - sz[1] / 2), ['ubox1', 'ubox2'], toward_road)
        # 冷氣室外機：掛在牆面中高處
        scatter(6, 30, L - 4, lambda s_, sz: s_ * (W - 0.03 - sz[1] / 2), ['aircon', 'aircon', 'aircon_rust'], toward_road,
                y=lambda r_: r_.choice((6.2, 7.4, 8.6, 10.0)), wall=True, solid=False,
                ignore=('far', 'b', 'cab', 'vend', 'lamp', 'bench', 'car', 'tree'))
        # 監視器：牆上高處
        scatter(2, 30, L - 4, lambda s_, sz: s_ * (W - 0.03 - sz[1] / 2), ['camera'], toward_road, y=lambda r_: r_.uniform(5.7, 6.6),
                wall=True, solid=False, ignore=('far', 'b', 'cab', 'vend', 'lamp', 'bench', 'car', 'tree'))
        # 人孔蓋：路面
        for t in (36.0, 58.0, 80.0):
            for lat in (-2.6, 2.4):
                x, z = at(t + pr.uniform(-3, 3), lat + pr.uniform(-0.6, 0.6))
                _prop(sc, 'manhole', x, z, (pr.choice((0, 1)), 0), y=-0.025, solid=False, rad=0.4)
        # 施工護欄：路邊成排
        t0 = pr.uniform(40, L - 25)
        side = pr.choice((-1, 1))
        lat = side * (ROAD - 1.0)
        for i in range(3):
            x, z = at(t0 + i * 1.62, lat)
            if not _blocked(sc, x, z, 0.8):
                _prop(sc, 'barrier', x, z, (nx, nz), y=0.0, rad=0.8)
        # 蓋布的車：停在路邊
        for _ in range(1):
            for _try in range(20):
                side = pr.choice((-1, 1))
                t = pr.uniform(34, L - 12)
                x, z = at(t, side * (ROAD - 1.35))
                if not _blocked(sc, x, z, 2.6):
                    _prop(sc, 'ccar', x, z, (dx * pr.choice((-1, 1)), dz * pr.choice((-1, 1))), rad=2.4)
                    break

    # 巷內：一台蓋布的車（順著巷子停）、輪胎堆、垃圾桶
    for i, al in enumerate(sc.alleys):
        nrm, ex = al['nrm'], al['ex']
        P = lambda u, lat: (al['cx'] + nrm[0] * u + ex[0] * lat, al['cz'] + nrm[1] * u + ex[1] * lat)
        if i % 3 == 1:
            x, z = P(4.9, 0.0)
            if not _blocked(sc, x, z, 2.3, ('far', 'b')):
                _prop(sc, 'ccar', x, z, (nrm[0], nrm[1]), rad=2.3)
        for lat in (-1.3, 1.3):
            x, z = P(pr.uniform(2.6, 4.2), lat)
            if _blocked(sc, x, z, 0.3, ('far', 'b')):
                continue
            for k in range(pr.choice((1, 2))):
                _prop(sc, 'tyre', x, z, (pr.uniform(-1, 1), pr.uniform(-1, 1)), y=0.165 * k, solid=(k == 0), rad=0.4)
        # 巷子兩側牆：公共電話（胸口高）與冷氣室外機
        for j, (m, yy) in enumerate((('phone', 1.0), (pr.choice(('aircon', 'aircon_rust')), pr.uniform(2.5, 3.6)),
                                     (pr.choice(('aircon', 'aircon_rust')), pr.uniform(3.4, 4.4)))):
            sgn = 1 if (i + j) % 2 == 0 else -1
            d_ = PROP_MODELS[m]['size'][1]
            x, z = P(pr.uniform(2.8, 6.2) if m == 'phone' else pr.uniform(2.0, 6.6), sgn * (2.0 - 0.03 - d_ / 2))
            if _blocked(sc, x, z, 0.2, ('far', 'b', 'prop')) and m == 'phone':
                continue
            _prop(sc, m, x, z, (-sgn * ex[0], -sgn * ex[1]), y=yy, solid=False, rad=0.2)
        x, z = P(pr.uniform(5.6, 6.6), pr.choice((-1.3, 1.3)))
        if not _blocked(sc, x, z, 0.4, ('far', 'b')):
            _prop(sc, pr.choice(('trash', 'trash_rust')), x, z, (nrm[0], nrm[1]))


def build():
    r = random.Random(SEED)
    sc = Scene()
    g = sc.geo

    # ── 地面 ──
    g.use('static')
    # 廣場圓盤：72 邊形（UV 以 ±RING 對應 0..1）
    seg = 72
    for i in range(seg):
        a0 = 2 * math.pi * i / seg
        a1 = 2 * math.pi * (i + 1) / seg
        def uvp(a): return (0.5 + 0.5 * math.cos(a), 0.5 - 0.5 * math.sin(a))
        # 圖片 y 向下 = +z，所以 v = 0.5 - 0.5*z/R
        p0 = (RING * math.cos(a0), 0.0, RING * math.sin(a0))
        p1 = (RING * math.cos(a1), 0.0, RING * math.sin(a1))
        uv0 = (0.5 + 0.5 * math.cos(a0), 0.5 - 0.5 * math.sin(a0))
        uv1 = (0.5 + 0.5 * math.cos(a1), 0.5 - 0.5 * math.sin(a1))
        g.face('ground_plaza', [(0, 0, 0), p1, p0], [(0.5, 0.5), uv1, uv0], n=(0, 1, 0))
    # 四條大道地面：t∈[T0, L+4]，橫向 ±W
    T0, T1 = 24.0, L + 4
    for key, a in AVENUES.items():
        dx, dz = a['d']
        nx, nz = -dz, dx
        pts = [(dx * T0 + nx * -W, dz * T0 + nz * -W), (dx * T0 + nx * W, dz * T0 + nz * W),
               (dx * T1 + nx * W, dz * T1 + nz * W), (dx * T1 + nx * -W, dz * T1 + nz * -W)]
        # 圖片：長邊為「沿大道」(x 方向)、短邊為橫向；make_textures 依 AVENUE_TEX 規則畫
        uvs = [(0, 0), (0, 1), (1, 1), (1, 0)]
        # 貼圖座標：u 沿大道（0=近廣場），v 橫向（0=nx 負側）。為了統一畫法，v 以 -W 為 1。
        uvs = [(0, 1), (0, 0), (1, 0), (1, 1)]
        g.hface(f'ground_{key}', [(p[0], p[1]) for p in pts], 0.012, uvs)
    g.hface('ground_far', [(-420, -420), (420, -420), (420, 420), (-420, 420)], -0.03,
            [(0, 0), (1, 0), (1, 1), (0, 1)])

    # ── 弧形廣場大樓（每象限 2 棟） ──
    for qi in range(4):
        for off in (33, 57):
            phi = math.radians(qi * 90 + off)
            hd = r.uniform(7.5, 9.0)
            hw = 6.2
            rad = RING + hd
            fx, fz = -math.cos(phi), -math.sin(phi)
            key = 'ESWN'[qi]  # φ 0°=東、90°=南 …
            key2 = 'ESWN'[(qi + (1 if off > 45 else 0)) % 4]
            b = dict(cx=rad * math.cos(phi), cz=rad * math.sin(phi), fx=fx, fz=fz, hw=hw, hd=hd,
                     h=r.uniform(34, 58), fac=r.choice(THEME[key2]['fac']), bb=ARC_BB[len(sc.buildings) % len(ARC_BB)])
            make_building(sc, r, b, key2, shop=True)

    # ── 大道兩側的連續店面 ──
    for key, a in AVENUES.items():
        dx, dz = a['d']
        nx, nz = -dz, dx
        th = THEME[key]
        for side in (-1, 1):
            t = 26.0
            idx = 0
            END = L + 2.5   # 蓋到閘門後方，兩側不留縫
            while t < END - 0.5:
                w = r.uniform(9, 15)
                if t + w > END - 5:
                    w = END - t   # 最後一棟吃掉剩下的長度
                alley = (idx > 0 and r.random() < 0.22 and t + w + 6 < L - 8)
                D = r.uniform(14, 18)
                # 前緣在橫向 side*W，往外深 D
                ctr_t = t + w / 2
                lat = side * (W + D / 2)
                cx, cz = dx * ctr_t + nx * lat, dz * ctr_t + nz * lat
                fx, fz = -nx * side, -nz * side
                tall = r.random() < 0.3
                h = r.uniform(34, 56) if tall else r.uniform(18, 34)
                b = dict(cx=cx, cz=cz, fx=fx, fz=fz, hw=w / 2, hd=D / 2, h=h, fac=r.choice(th['fac']))
                make_building(sc, r, b, key, shop=True)
                t += w
                idx += 1
                if alley:
                    aw = 4.0
                    ac_t = t + aw / 2
                    depth = 8.0
                    acx = dx * ac_t + nx * side * (W + depth)
                    acz = dz * ac_t + nz * side * (W + depth)
                    ex = (dx, dz)
                    # 巷底牆
                    g.box(f"fac_{r.choice(th['fac'])}", acx, acz, ex, aw / 2, 0.4, 0, 20, tile=(8, 24), skip=())
                    _obb(sc, acx, acz, ex, aw / 2, 0.4, 'alley')
                    # 巷底地板
                    fl = [(dx * (t) + nx * side * W, dz * (t) + nz * side * W),
                          (dx * (t + aw) + nx * side * W, dz * (t + aw) + nz * side * W),
                          (dx * (t + aw) + nx * side * (W + depth), dz * (t + aw) + nz * side * (W + depth)),
                          (dx * (t) + nx * side * (W + depth), dz * (t) + nz * side * (W + depth))]
                    g.hface('concrete', fl, 0.012, [(0, 0), (1, 0), (1, 1), (0, 1)])
                    nrm = (-nx * side, -nz * side)
                    nm = r.choice(th['neon'])
                    # 巷底霓虹字
                    i = r.randrange(len(SIGNS_H))
                    g.vface('signs_h', (acx + nrm[0] * 0.43, acz + nrm[1] * 0.43), nrm, 1.9, 5.0, 5.0 + 3.8 / 4 * 2, uv=_cell_uv_h(i))
                    _light(sc, (acx + nrm[0] * 2, 4.5, acz + nrm[1] * 2), SIGNS_H[i][1], 2.4, 18)
                    # 巷內販賣機
                    sc.alleys.append(dict(cx=acx, cz=acz, nrm=nrm, ex=ex, key=key))
                    t += aw
        # 閘門
        make_gate(sc, r, key)

    # ── 後方高樓天際線 ──
    far = random.Random(SEED + 7)
    gx = list(range(-216, 217, 24))
    for x0 in gx:
        for z0 in gx:
            ax, az = abs(x0), abs(z0)
            ok = (ax > W + 22 and az > W + 22 and (ax > 40 or az > 40)) or (ax <= W + 24 and az > L + 14) or (az <= W + 24 and ax > L + 14)
            if not ok:
                continue
            if ax < W + 22 + 1e-6 and az < W + 22:
                continue
            x = x0 + far.uniform(-5, 5)
            z = z0 + far.uniform(-5, 5)
            if (abs(x) < W + 20 and abs(z) < L + 14) or (abs(z) < W + 20 and abs(x) < L + 14):
                continue
            w = far.uniform(12, 20)
            d = far.uniform(12, 20)
            dist = math.hypot(x, z)
            h = far.uniform(48, 95) if dist < 120 else far.uniform(70, 160)
            ex = (1.0, 0.0)
            f = far.randrange(N_FAC)
            g.box(f'fac_{f}', x, z, ex, w / 2, d / 2, 0, h, tile=(8, 24), uoff=far.random(), skip=('+y',))
            g.hface('roof', [(x - w / 2, z - d / 2), (x + w / 2, z - d / 2), (x + w / 2, z + d / 2), (x - w / 2, z + d / 2)], h,
                    [(0, 0), (1, 0), (1, 1), (0, 1)])
            nm = far.choice(list(NEON.keys()))
            g.box(nm, x, z, ex, w / 2, d / 2 + 0.05, h - 0.3, h + 0.0, tile=None, skip=('+y',))
            if far.random() < 0.6:
                g.box('neon_red', x, z, ex, 0.3, 0.3, h, h + 1.0, tile=None)
            _obb(sc, x, z, ex, w / 2, d / 2, 'far')

    # ── 空橋 ──
    for key, a in AVENUES.items():
        dx, dz = a['d']
        nx, nz = -dz, dx
        for t in (46.0, 74.0):
            # 找兩側該位置的大樓高度
            hs = []
            for s in (-1, 1):
                p = (dx * t + nx * s * (W + 3), dz * t + nz * s * (W + 3))
                hh = [bd['h'] for bd in sc.buildings if abs(p[0] - bd['cx']) < bd['hw'] + 1.2 and abs(p[1] - bd['cz']) < bd['hd'] + 1.2
                      and (abs(math.hypot(bd['cx'] - p[0], bd['cz'] - p[1])) < 12)]
                hs.append(max(hh) if hh else 0)
            if min(hs) < 18:
                continue
            ex = (nx, nz)
            cx, cz = dx * t, dz * t
            g.box('monument', cx, cz, (dx, dz), 2.2, W + 0.3, 13.0, 14.0, tile=None)
            g.box('bridge_glow', cx, cz, (dx, dz), 2.25, W - 0.5, 14.0, 16.0, tile=None, skip=('+y',))
            g.box('monument', cx, cz, (dx, dz), 2.4, W + 0.3, 16.0, 16.3, tile=None)
            col = r.choice(THEME[key]['neon'])
            g.box(col, cx, cz, (dx, dz), 2.3, W - 0.3, 12.85, 13.0, tile=None)
            # 窗框：兩個端面各一排直欞與一條橫桿，避免整片平的玻璃
            for sgn in (-1, 1):
                for k in range(-4, 5):
                    lat = k * ((W - 0.6) / 4)
                    g.box('trim_dark', cx + dx * sgn * 2.3 + nx * lat, cz + dz * sgn * 2.3 + nz * lat, (dx, dz), 0.05, 0.09, 14.0, 16.0, tile=None)
                g.box('trim_dark', cx + dx * sgn * 2.3, cz + dz * sgn * 2.3, (dx, dz), 0.05, W - 0.4, 14.95, 15.1, tile=None)
            _light(sc, (cx, 11.5, cz), THEME[key]['light'], 2.2, 24)

    # ── 路燈 ──
    for key, a in AVENUES.items():
        dx, dz = a['d']
        nx, nz = -dz, dx
        th = THEME[key]
        for k, t in enumerate(range(32, 94, 14)):
            for s in (-1, 1):
                tt = t + (7 if s == 1 else 0)
                px, pz = dx * tt + nx * s * (ROAD + 0.4), dz * tt + nz * s * (ROAD + 0.4)
                g.cyl('pole', px, pz, 0.09, 0, 7.2, seg=6, cap=False)
                ax = (-nx * s, -nz * s)
                g.box('pole', px + ax[0] * 0.7, pz + ax[1] * 0.7, (nx, nz), 0.05, 0.75, 7.0, 7.12, tile=None)
                col = th['neon'][(k + (s > 0)) % len(th['neon'])]
                g.box(col, px + ax[0] * 1.4, pz + ax[1] * 1.4, (nx, nz), 0.3, 0.18, 6.88, 6.98, tile=None)
                _circle(sc, px, pz, 0.25, 'lamp')
                _light(sc, (px + ax[0] * 1.4, 6.6, pz + ax[1] * 1.4), NEON_LIGHT[col], 1.6, 18)
                _glow(sc, px + ax[0] * 1.4, pz + ax[1] * 1.4, NEON[col][0], 5.5, 0.4)

    # ── 懸掛串燈 ──
    for key, a in AVENUES.items():
        dx, dz = a['d']
        nx, nz = -dz, dx
        th = THEME[key]
        for t in (38.0, 54.0, 66.0, 82.0):
            nb = 14
            for i in range(nb + 1):
                u = i / nb
                lat = -(W - 0.3) + 2 * (W - 0.3) * u
                y = 9.5 - 2.2 * (1 - (2 * u - 1) ** 2) * 0.0 - 1.6 * (1 - (2 * u - 1) ** 2)
                col = th['neon'][i % len(th['neon'])]
                px, pz = dx * t + nx * lat, dz * t + nz * lat
                g.box(col, px, pz, (dx, dz), 0.1, 0.1, y - 0.1, y + 0.1, tile=None)
                if i % 4 == 2:
                    _light(sc, (px, y - .4, pz), NEON[col][0], 1.1, 12)

    # ── 路邊物件：投幣機、販賣機、長椅、車 ──
    prop = random.Random(SEED + 3)
    for key, a in AVENUES.items():
        dx, dz = a['d']
        nx, nz = -dz, dx
        th = THEME[key]
        n_cab = {'E': 20, 'N': 8, 'S': 6, 'W': 8}[key]
        for k in range(n_cab):
            side = prop.choice((-1, 1))
            t = prop.uniform(29, 90)
            lat = side * (W - 1.0)
            px, pz = dx * t + nx * lat, dz * t + nz * lat
            ex = (dx, dz)
            fnx, fnz = -nx * side * -1, -nz * side * -1  # 朝向大道中心
            fnx, fnz = -nx * side, -nz * side
            # 面向馬路：法線 = -side*n
            ex_ = (-fnz, fnx) if False else (fnz, -fnx)
            ci = prop.randrange(N_CAB)
            u0, v0, u1, v1 = _cell_uv_cab(ci)
            g.box('cab_body', px, pz, ex_, 0.45, 0.4, 0, 1.75, tile=None, over={'+b': ('cab_screen', (u0, v0, u1, v1))})
            g.box(prop.choice(th['neon']), px + fnx * .2, pz + fnz * .2, ex_, 0.46, 0.45, 1.75, 1.85, tile=None)
            _obb(sc, px, pz, ex_, 0.45, 0.4, 'cab')
            if k % 3 == 0:
                _light(sc, (px + fnx * 1.4, 1.5, pz + fnz * 1.4), prop.choice(['#8ae8ff', '#ff8ad8', '#ffe27a']), 1.0, 8)
        for k in range(4):
            side = prop.choice((-1, 1))
            t = prop.uniform(30, 90)
            lat = side * (W - 0.9)
            px, pz = dx * t + nx * lat, dz * t + nz * lat
            fnx, fnz = -nx * side, -nz * side
            ex_ = (fnz, -fnx)
            vi = prop.randrange(N_VEND)
            u0, v0, u1, v1 = _cell_uv_vend(vi)
            g.box('vend_body', px, pz, ex_, 0.5, 0.4, 0, 1.95, tile=None, over={'+b': ('vend_front', (u0, v0, u1, v1))})
            _obb(sc, px, pz, ex_, 0.5, 0.4, 'vend')
            _light(sc, (px + fnx * 1.2, 1.4, pz + fnz * 1.2), ['#ff9ad8', '#8affd8', '#ffe27a'][vi], 1.2, 9)
        # 長椅
        for k in range(3):
            side = prop.choice((-1, 1))
            t = prop.uniform(32, 88)
            lat = side * (ROAD + 1.6)
            px, pz = dx * t + nx * lat, dz * t + nz * lat
            ex_ = (dx, dz)
            g.box('trim_dark', px, pz, ex_, 0.9, 0.25, 0.4, 0.5, tile=None)
            g.box('metal', px - nx * side * 0.22, pz - nz * side * 0.22, ex_, 0.9, 0.04, 0.5, 1.0, tile=None)
            g.box(prop.choice(th['neon']), px, pz, ex_, 0.9, 0.26, 0.36, 0.4, tile=None)
            _obb(sc, px, pz, ex_, 0.9, 0.3, 'bench')
        # 停放的車
        for k in range(2 if key != 'E' else 3):
            side = prop.choice((-1, 1))
            t = prop.uniform(34, 88)
            lat = side * (ROAD - 1.5)
            px, pz = dx * t + nx * lat, dz * t + nz * lat
            ex_ = (dx, dz)
            body = CAR_MATS[prop.randrange(3)]
            g.box(body, px, pz, ex_, 2.2, 0.95, 0.35, 1.0, tile=None)
            g.box('car_glass', px - dx * 0.2, pz - dz * 0.2, ex_, 1.2, 0.86, 1.0, 1.55, tile=None)
            glow = prop.choice(['neon_cyan', 'neon_pink', 'neon_purple'])
            g.box(glow, px, pz, ex_, 2.0, 0.85, 0.22, 0.3, tile=None, skip=('+y',))
            g.box('neon_white', px + dx * 2.22, pz + dz * 2.22, (nx, nz), 0.7, 0.02, 0.55, 0.75, tile=None)
            g.box('neon_red', px - dx * 2.22, pz - dz * 2.22, (nx, nz), 0.7, 0.02, 0.6, 0.78, tile=None)
            _obb(sc, px, pz, ex_, 2.2, 0.95, 'car')
            _glow(sc, px, pz, NEON[glow][0], 3.2, 0.45)
        # 巷內販賣機
    for al in sc.alleys:
        nrm = al['nrm']
        ex_ = (nrm[1], -nrm[0])
        for s_, vi in ((-1, 0), (1, 1)):
            px, pz = al['cx'] + nrm[0] * 0.9 + (-nrm[1]) * s_ * 1.3 * -1, al['cz'] + nrm[1] * 0.9 + nrm[0] * s_ * 1.3
            u0, v0, u1, v1 = _cell_uv_vend((vi + 1) % N_VEND)
            g.box('vend_body', px, pz, ex_, 0.5, 0.4, 0, 1.95, tile=None, over={'+b': ('vend_front', (u0, v0, u1, v1))})
            _obb(sc, px, pz, ex_, 0.5, 0.4, 'vend')

    # ── 廣場中心紀念碑 ──
    g.use('static')
    for rr, hh in ((9.0, 0.3), (7.6, 0.6), (6.4, 0.9)):
        g.cyl('monument', 0, 0, rr, 0, hh, seg=32)
    g.cyl('neon_pink', 0, 0, 9.05, 0.0, 0.08, seg=48, cap=False)
    g.cyl('neon_cyan', 0, 0, 7.65, 0.3, 0.38, seg=48, cap=False)
    g.cyl('neon_yellow', 0, 0, 6.45, 0.6, 0.68, seg=48, cap=False)
    g.box('monument', 0, 0, (1, 0), 2.0, 2.0, 0.9, 3.0, tile=None)
    ph = {'+b': ('bb_phoebe', (0, 0, 1, 1)), '-b': ('bb_phoebe', (0, 0, 1, 1)),
          '+a': ('bb_phoebe', (0, 0, 1, 1)), '-a': ('bb_phoebe', (0, 0, 1, 1))}
    g.box('monument', 0, 0, (1, 0), 1.9, 1.9, 3.0, 12.0, tile=None, over={k: ('bb_phoebe', (0, 0, 1, 1)) for k in ph})
    for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        g.box('neon_pink', sx * 1.92, sz * 1.92, (1, 0), 0.07, 0.07, 3.0, 12.0, tile=None)
    g.box('monument', 0, 0, (1, 0), 2.1, 2.1, 12.0, 12.4, tile=None)
    g.box('neon_cyan', 0, 0, (1, 0), 2.15, 2.15, 12.4, 12.55, tile=None, skip=('+y',))
    _obb(sc, 0, 0, (1, 0), 6.4, 6.4, 'mon')
    sc.colliders[-1] = dict(t='circle', cx=0, cz=0, r=9.0, tag='mon')
    # 轉動的星與環
    g.use('spin_star', (0, 17.0, 0))
    g.prism('star_gold', star_poly(4.2, 1.8), 16.45, 17.55, 0, 0, plane='xz')
    sc.parts.append(dict(name='spin_star', kind='spin', axis='y', speed=0.5))
    g.use('spin_ring_a', (0, 17.0, 0))
    g.torus('neon_pink', 6.4, 0.16, seg=48, ring=5, tilt=math.radians(62), cy=17.0)
    sc.parts.append(dict(name='spin_ring_a', kind='spin', axis='y', speed=0.35))
    g.use('spin_ring_b', (0, 17.0, 0))
    g.torus('neon_cyan', 5.2, 0.14, seg=48, ring=5, tilt=math.radians(-58), cy=17.0)
    sc.parts.append(dict(name='spin_ring_b', kind='spin', axis='y', speed=-0.5))
    g.use('spin_ring_c', (0, 17.0, 0))
    g.torus('neon_yellow', 7.6, 0.12, seg=48, ring=5, tilt=math.radians(90), cy=17.0)
    sc.parts.append(dict(name='spin_ring_c', kind='spin', axis='y', speed=0.2))
    g.use('static')
    _light(sc, (0, 14, 0), '#ff7ad9', 4.0, 50)
    _light(sc, (6, 3, 6), '#29e6ff', 2.5, 30)
    _light(sc, (-6, 3, -6), '#ffd84a', 2.5, 30)
    _glow(sc, 0, 0, '#ff3fb4', 12, 0.5)

    # ── 廣場的賽博櫻花與長椅 ──
    for i in range(14):
        a = 2 * math.pi * (i + 0.5) / 14
        # 跳過大道出口
        ang = (math.degrees(a)) % 90
        if min(ang, 90 - ang) < 12:
            continue
        rr = 20.5
        px, pz = rr * math.cos(a), rr * math.sin(a)
        g.cyl('trunk', px, pz, 0.28, 0, 3.6, seg=6, cap=False)
        for k, (ox, oy, oz, rad) in enumerate(((0, 4.4, 0, 2.2), (1.3, 3.8, 0.4, 1.6), (-1.1, 3.9, -0.6, 1.7), (0.2, 5.5, 0.4, 1.4))):
            g.blob('leaf_pink', px + ox, oy, pz + oz, rad, seg=7, rings=4)
        _circle(sc, px, pz, 0.45, 'tree')
        if i % 2 == 0:
            _light(sc, (px, 4.0, pz), '#ff7ad9', 1.5, 14)
    for i in range(12):
        a = 2 * math.pi * (i + 0.25) / 12
        ang = (math.degrees(a)) % 90
        if min(ang, 90 - ang) < 14:
            continue
        rr = 15.0
        px, pz = rr * math.cos(a), rr * math.sin(a)
        ex_ = (-math.sin(a), math.cos(a))
        g.box('trim_dark', px, pz, ex_, 1.0, 0.28, 0.4, 0.5, tile=None)
        g.box('neon_purple', px, pz, ex_, 1.0, 0.29, 0.36, 0.4, tile=None)
        _obb(sc, px, pz, ex_, 1.0, 0.3, 'bench')

    # ── 漂浮的星星與愛心 ──
    fl = random.Random(SEED + 11)
    n_float = 0
    for i in range(26):
        key = 'NESW'[i % 4]
        dx, dz = AVENUES[key]['d']
        nx, nz = -dz, dx
        t = fl.uniform(12, 80)
        lat = fl.uniform(-6, 6)
        x, z = dx * t + nx * lat, dz * t + nz * lat
        if t < 26:
            x, z = fl.uniform(-18, 18), fl.uniform(-18, 18)
        y = fl.uniform(7, 14)
        name = f'float_{n_float}'
        n_float += 1
        g.use(name, (x, y, z))
        heart = (key == 'N' and fl.random() < 0.5) or fl.random() < 0.3
        s = fl.uniform(0.8, 1.5)
        if heart:
            g.prism('heart_pink', heart_poly(s * 1.2), y - 0.12, y + 0.12, x, z, plane='xz')
        else:
            g.prism('star_gold', star_poly(s, s * 0.45), y - 0.12, y + 0.12, x, z, plane='xz')
        sc.parts.append(dict(name=name, kind='float', speed=fl.uniform(0.4, 1.0), amp=fl.uniform(0.3, 0.8),
                             spin=fl.uniform(0.3, 1.1), phase=fl.uniform(0, 6.28)))
        _light(sc, (x, y, z), '#ffd0f0' if heart else '#ffe58a', 1.0, 10)
    g.use('static')

    # ── 廣場地面光暈 ──
    for i in range(10):
        a = 2 * math.pi * i / 10
        _glow(sc, 17 * math.cos(a), 17 * math.sin(a), ['#ff3fb4', '#29e6ff', '#a96bff'][i % 3], 5.5, 0.22)

    place_props(sc)
    sc.zones = {k: dict(name=v['name'], en=v['en']) for k, v in AVENUES.items()}
    sc.zones['P'] = dict(name='星光廣場', en='STAR PLAZA')
    sc.stats = dict(props=len(sc.props), buildings=len(sc.buildings), colliders=len(sc.colliders), lights=len(sc.lights),
                    objects=sum(len(o['mats']) for o in g.objs.values()),
                    faces=sum(len(f) for o in g.objs.values() for f in o['mats'].values()))
    return sc


if __name__ == '__main__':
    s = build()
    print(s.stats)
