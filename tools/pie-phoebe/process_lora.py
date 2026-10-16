#!/usr/bin/env python3
"""把 Anima＋菲比 Q 版 LoRA 生成的弗洛洛角色與特效原圖，處理成遊戲素材（白底去背、裁切、量化）。

用法：python3 tools/pie-phoebe/process_lora.py <原圖資料夾> <輸出資料夾> [名稱=檔名 ...]
"""
import sys
from pathlib import Path
from PIL import Image, ImageOps
sys.path.insert(0, str(Path(__file__).parent))
from process_v14 import cutout, crop_resize  # noqa: E402

# 輸出名: (預設原圖, 最長邊, 是否左右翻轉, 是否輸出成「圓心在畫面中心」的正方形)
CHOICES = {
    'phrolova': ('p_a_1.png', 512, False, False),
    'phrolova_atk': ('atk_4.png', 512, False, False),
    'hecate': ('hecate_3.png', 512, False, False),
    'fx_slash': ('fx_slash_6.png', 384, True, True),         # 翻轉後弧線凸面朝 +x（攻擊方向）
    'fx_lily_stand': ('fx_petal_2.png', 320, False, False),   # 站立的彼岸花（底部是花莖）
    'fx_lily_flat': ('fx_lilyflat_4.png', 320, False, True),
    'fx_burst': ('fx_burst_2.png', 384, False, True),
    'fx_note': ('fx_note_6.png', 128, False, False),
}


def square_centered(im: Image.Image) -> Image.Image:
    """以不透明範圍的中心為畫面中心補成正方形，讓『繞圓心旋轉、半徑＝畫面一半』成立。"""
    bbox = im.getchannel('A').point(lambda v: 255 if v > 24 else 0).getbbox()
    im = im.crop(bbox)
    s = max(im.size)
    canvas = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    canvas.paste(im, ((s - im.width) // 2, (s - im.height) // 2))
    return canvas


def main(src: Path, dst: Path, overrides: dict):
    dst.mkdir(parents=True, exist_ok=True)
    for name, (default, size, flip, square) in CHOICES.items():
        f = src / overrides.get(name, default)
        if not f.exists():
            print('略過（找不到）', f); continue
        im = cutout(Image.open(f))
        if flip:
            im = ImageOps.mirror(im)
        if square:
            out = square_centered(im)
            out.thumbnail((size, size), Image.LANCZOS)
        else:
            out = crop_resize(im, size, pad=6)
        out = out.quantize(colors=256, method=Image.FASTOCTREE, dither=Image.NONE)
        out.save(dst / f'{name}.png', optimize=True)
        print(name, out.size, f.name)


if __name__ == '__main__':
    ov = dict(a.split('=', 1) for a in sys.argv[3:])
    main(Path(sys.argv[1]), Path(sys.argv[2]), ov)
