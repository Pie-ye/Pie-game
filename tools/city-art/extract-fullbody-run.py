"""Extract generated full-body art; no body parts are drawn or replaced.

inspect VIDEO OUT: save keyed frames and a numbered contact sheet.
pack OUT --start N --end N: pack an inspected [start,end) full run cycle.
Dependencies: pillow numpy imageio imageio-ffmpeg.
"""
import argparse
import json
import math
from pathlib import Path
import imageio.v2 as imageio
import numpy as np
from PIL import Image, ImageDraw


def key_green(rgb):
    data = np.asarray(rgb).astype(np.float32)
    dominance = data[:, :, 1] - np.maximum(data[:, :, 0], data[:, :, 2])
    alpha = np.clip((65 - dominance) / 45, 0, 1)
    # The orange/gray source design has no green: suppress reflected green spill.
    red, green, blue = data[:, :, 0], data[:, :, 1], data[:, :, 2]
    edge = (alpha > 0) & ((dominance > 8) | ((green-blue > .7*(red-blue)) & (green-blue > 15)))
    neutral = np.where(red >= blue, blue + .6*(red-blue), np.maximum(red,blue))
    data[:, :, 1][edge] = np.minimum(green[edge], neutral[edge])
    rgba = np.dstack((data, alpha * 255)).astype(np.uint8)
    return Image.fromarray(rgba)


def contact_sheet(frames, path, labels=None):
    thumb, columns = 160, 8
    sheet = Image.new('RGB', (thumb * columns, (thumb+22)*math.ceil(len(frames)/columns)), '#29263e')
    draw = ImageDraw.Draw(sheet)
    for i, frame in enumerate(frames):
        small = frame.copy()
        small.thumbnail((thumb, thumb), Image.Resampling.LANCZOS)
        x, y = (i % columns)*thumb, (i//columns)*(thumb+22)
        sheet.paste(small, (x+(thumb-small.width)//2, y), small)
        draw.text((x+6,y+thumb+3), str(labels[i] if labels else i), fill='white')
    sheet.save(path)


def inspect(video, out):
    out.mkdir(parents=True, exist_ok=True)
    reader = imageio.get_reader(str(video), 'ffmpeg')
    fps = reader.get_meta_data()['fps']
    frames, bounds = [], []
    for rgb in reader:
        frame = key_green(rgb)
        box = frame.getchannel('A').point(lambda a: 255 if a > 160 else 0).getbbox()
        if box is None:
            raise ValueError('Empty frame after keying')
        bounds.append(box)
        frames.append(frame)
    reader.close()
    # One scale and ground line for the whole take, so flight is preserved.
    heights = [b[3]-b[1] for b in bounds]
    ground = float(np.percentile([b[3] for b in bounds], 95))
    scale = min(320 / max(heights), 350 / max(b[2]-b[0] for b in bounds))
    normalized = []
    for i, (frame, box) in enumerate(zip(frames,bounds)):
        # Use head/upper torso for root x; moving arms/feet cannot shift the pivot.
        alpha = np.asarray(frame.getchannel('A'))
        ys, xs = np.where((alpha > 160) & (np.indices(alpha.shape)[0] < box[1]+(box[3]-box[1])*.42))
        center = float(np.median(xs))
        # Affine resampling preserves a shared scale and fixed vertical origin.
        tile = frame.transform((384,384), Image.Transform.AFFINE,
            (1/scale,0,center-190/scale,0,1/scale,ground-360/scale),
            resample=Image.Resampling.BICUBIC)
        tile.save(out/f'frame-{i:03}.png')
        normalized.append(tile)
    contact_sheet(normalized, out/'all-frames.png')
    (out/'source.json').write_text(json.dumps(dict(video=str(video), fps=fps, frames=len(frames), scale=scale, ground=ground), indent=2)+'\n')
    # Rank potential full cycles by endpoint similarity, emphasizing the legs.
    arrays = []
    for frame in normalized:
        bg = Image.new('RGBA',frame.size,'#29263e')
        bg.alpha_composite(frame)
        arrays.append(np.asarray(bg.resize((48,48))).astype(float))
    candidates = []
    for start in range(12,len(arrays)-30):
        for period in range(12,31):
            end = start+period
            delta = np.abs(arrays[start]-arrays[end])
            score = float(delta[20:,:,:3].mean())
            variation = float(np.abs(arrays[start][20:,:,:3]-arrays[start+period//2][20:,:,:3]).mean())
            if variation > 5:
                candidates.append(dict(start=start,end=end,score=round(score,3),variation=round(variation,3)))
    candidates.sort(key=lambda item:item['score'])
    (out/'cycle-candidates.json').write_text(json.dumps(candidates[:30],indent=2)+'\n')
    print(json.dumps(dict(frames=len(frames), fps=fps, candidates=candidates[:8])))


def pack(out, start, end):
    source = json.loads((out/'source.json').read_text())
    assert 0 <= start < end <= source['frames']
    # Keep native generated frames without pose interpolation or mirrored limbs.
    frames = [Image.open(out/f'frame-{i:03}.png').convert('RGBA') for i in range(start,end)]
    count, columns = len(frames), 4
    atlas = Image.new('RGBA',(384*columns,384*math.ceil(count/columns)))
    for i, frame in enumerate(frames):
        alpha = np.asarray(frame.getchannel('A'))
        assert alpha.max() == 255 and alpha.min() == 0, 'Frame must retain transparent background and opaque subject'
        assert max(alpha[0].max(),alpha[-1].max(),alpha[:,0].max(),alpha[:,-1].max()) < 32, 'Character touches frame edge'
        atlas.alpha_composite(frame,((i%columns)*384,(i//columns)*384))
        frame.save(out/f'run-{i:02}.png')
    atlas.save(out/'hero-run-fullbody.webp',lossless=True)
    duration = round(1000/source['fps'])
    frames[0].save(out/'preview.webp',save_all=True,append_images=frames[1:],duration=duration,loop=0,lossless=True)
    contact_sheet(frames,out/'cycle.png',list(range(start,end)))
    metadata = dict(frameWidth=384,frameHeight=384,frames=count,columns=columns,anchorX=190,anchorY=360,
        characterHeight=320,cycleDistance=240,previewFps=source['fps'],sourceStart=start,sourceEnd=end,
        method='Colab MiniMax H3 full-body reference-to-video; chroma key and whole-frame alignment only')
    (out/'hero-run-fullbody.json').write_text(json.dumps(metadata,indent=2)+'\n')
    print(json.dumps(metadata))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command',required=True)
    analyze = sub.add_parser('inspect')
    analyze.add_argument('video',type=Path)
    analyze.add_argument('out',type=Path)
    export = sub.add_parser('pack')
    export.add_argument('out',type=Path)
    export.add_argument('--start',type=int,required=True)
    export.add_argument('--end',type=int,required=True)
    args = parser.parse_args()
    if args.command == 'inspect':
        inspect(args.video,args.out)
    else:
        pack(args.out,args.start,args.end)
