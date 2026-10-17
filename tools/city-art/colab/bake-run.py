"""Colab CPU: bake the existing character into 16 RGBA frames and an atlas.

Upload hero-body.webp to /content first, then use colab exec -f this file.
This is deterministic artwork compositing, not diffusion image generation.
"""
import json
import math
from pathlib import Path
import zipfile
from PIL import Image, ImageDraw

OUT = Path('/content/hero-run')
OUT.mkdir(exist_ok=True)
SIZE, COUNT, COLS = 384, 16, 4
SCALE = 2
INK = '#171323'
body = Image.open('/content/hero-body.webp').convert('RGBA')
# Keep the full source canvas: its hip pivot is at (45%, 77.5%).
height = 320
width = round(height * body.width / body.height)
body = body.resize((width * SCALE, height * SCALE), Image.Resampling.LANCZOS)
ground, center = 360, 190

def frame(phase, idle=False):
    im = Image.new('RGBA', (SIZE * SCALE, SIZE * SCALE))
    d = ImageDraw.Draw(im)
    flight = 0 if idle else 6 * math.sin(phase * 2) ** 2
    hip = (center, ground - 64 - flight)
    top = hip[1] - height * .775
    left = center - width * .45

    def line(points, fill, thickness):
        pts = [(round(x * SCALE), round(y * SCALE)) for x, y in points]
        for color, w in [(INK, thickness + 4), (fill, thickness)]:
            r = w * SCALE / 2
            d.line(pts, fill=color, width=round(w * SCALE), joint='curve')
            for x, y in pts:
                d.ellipse((x-r, y-r, x+r, y+r), fill=color)

    def leg(p, far):
        # 40% stance leaves two short airborne phases per full run cycle.
        u = (p / (2 * math.pi)) % 1
        stride = 48
        if idle:
            fx, fy = center + (-13 if far else 13), ground
        elif u < .4:
            fx, fy = center + stride * (1 - 5*u), ground
        else:
            v = (u-.4)/.6
            fx = center + stride * (-1 + 2*v)
            fy = ground - 42 * math.sin(math.pi*v)
        hx, hy = hip
        hx += -5 if far else 5
        # Solve both fixed-length bones against the actual ankle target.
        ankle = (fx, fy - 7)
        dx, dy = ankle[0]-hx, ankle[1]-hy
        distance = math.hypot(dx, dy)
        length = 46
        assert 0 < distance < 2*length, (phase, distance)
        angle = math.atan2(dy, dx) - math.acos(distance/(2*length))
        knee = (hx + math.cos(angle)*length, hy + math.sin(angle)*length)
        line([(hx,hy), knee], '#bf8f85' if far else '#f2b3a3', 13)
        line([knee, ankle], '#292737' if far else '#3a3550', 12)
        line([(fx-5,fy-7),(fx+12,fy-7)], '#bd6029' if far else '#ff9d35', 12)
        line([(fx-9,fy),(fx+18,fy)], '#dddce7', 3)

    def arm(p, far):
        # Arms oppose the matching leg: forward leg => backward arm.
        swing = -.85 * math.cos(p) if not idle else .05
        sx = left + width * (.56 if far else .61)
        sy = top + height * (.45 if far else .47)
        elbow = (sx + math.sin(swing)*37, sy + math.cos(swing)*37)
        hand = (elbow[0]+math.sin(swing+1.15)*32, elbow[1]+math.cos(swing+1.15)*32)
        line([(sx,sy),elbow], '#c67636' if far else '#f2a64e', 17)
        line([elbow,hand], '#ae572c' if far else '#e7793d', 15)
        line([hand, (hand[0]+2,hand[1]-1)], '#efc5ae', 12)

    leg(phase+math.pi, True)
    leg(phase, False)
    arm(phase+math.pi, True)
    im.alpha_composite(body, (round(left*SCALE), round(top*SCALE)))
    arm(phase, False)
    return im.resize((SIZE,SIZE), Image.Resampling.LANCZOS)

frames = [frame(i*math.tau/COUNT) for i in range(COUNT)]
atlas = Image.new('RGBA', (SIZE*COLS, SIZE*4))
for i, img in enumerate(frames):
    img.save(OUT / f'run-{i:02}.png')
    atlas.alpha_composite(img, ((i%COLS)*SIZE, (i//COLS)*SIZE))
atlas.save(OUT/'hero-run.webp', lossless=True)
contact = Image.new('RGBA', atlas.size, '#29263e')
contact.alpha_composite(atlas)
contact.convert('RGB').save(OUT/'hero-run-contact.png')
frames[0].save(OUT/'hero-run-preview.webp', save_all=True, append_images=frames[1:], duration=50, loop=0, lossless=True)
frame(0, idle=True).save(OUT/'hero-idle.webp', lossless=True)
metadata = dict(frameWidth=SIZE, frameHeight=SIZE, frames=COUNT, columns=COLS,
                anchorX=center, anchorY=ground, characterHeight=height,
                cycleDistance=240, previewFps=20, method='Colab CPU deterministic artwork compositing')
(OUT/'hero-run.json').write_text(json.dumps(metadata, indent=2)+'\n')
with zipfile.ZipFile('/content/hero-run.zip','w',zipfile.ZIP_DEFLATED) as z:
    for path in sorted(OUT.iterdir()):
        z.write(path,path.name)
print(json.dumps(metadata))
print('Saved 16 frames, idle, atlas, animated WebP and /content/hero-run.zip')
