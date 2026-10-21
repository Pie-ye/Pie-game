# 星光電玩街：Blender 建置流程

整個街區由三個階段產生，全部可重現（固定亂數種子）：

```
scene_gen.py      純 Python 排版：大樓、招牌、道具、碰撞框、燈光點、動畫部件
   │  （同一份排版被下面兩步各自重建，所以貼圖光暈、GLB、碰撞永遠對得上）
   ├─ make_textures.py   Pillow 畫貼圖 → tex/*.jpg（立面窗戶、店面、霓虹招牌圖集、地面、投幣機、看板）
   └─ build_blend.py     Blender 4.5 無頭：建網格與材質 → 存 neon-street.blend → 匯出 GLB 與 scene.json
```

## 重建

```bash
tools/neon-street/build.sh                      # 約 10 秒
RENDER=/tmp/preview.png tools/neon-street/build.sh   # 順便用 Cycles 渲一張鳥瞰圖（約 30 秒）
```

需要 Blender 4.5（預設找 `~/tools/blender-4.5.14-linux-x64/blender`，可用 `BLENDER=` 指定）與 Pillow。
Blender 用下載的免安裝版即可：<https://download.blender.org/release/Blender4.5/>。

## 想在 Blender 裡改

用 Blender 開 `neon-street.blend`（建置時產生，不進版控；貼圖用相對路徑指向 `tex/`）。
物件依材質分開，名稱是 `mesh__<材質>`；轉動／漂浮的部件是 `spin_*__<材質>`、`float_*__<材質>`，原點就是旋轉中心；
`LightMarkers` 集合裡的空物件是點光源位置，有顏色、強度、距離屬性。
手改 .blend 不會回寫排版，要長久保留請改 `scene_gen.py`。

## 重要規則

- 座標：遊戲座標 X 東、Y 上、Z 南。Blender 內是 `(x, -z, y)`，匯出器轉回去。
- 材質定義集中在 `scene_gen.py` 的 `MATERIALS`；自發光強度 >1 會匯出成 `KHR_materials_emissive_strength`，three.js 端用泛光門檻 1.1 抓亮處。遊戲載入時再整體乘 0.5（網址 `em=` 可調）。
- 加新招牌：改 `SIGNS_H` / `SIGNS_V` / `SIGNS_BIG` 的文字與顏色，圖集格數固定（16／16／4），多加要同步改 `_cell_uv_*`。
- 單檔上限 25 MiB、整個遊戲資料夾 50 MB（`tools/validate_games.py`），目前 GLB 約 7.5 MB。

## 測試

```bash
node --test tests/neon-street.test.mjs     # 物理、碰撞、洪水填充（確認鑽不進大樓縫隙）
python3 -m http.server 18770 --bind 127.0.0.1 --directory site &
python3 tools/neon-street/browser_test.py  # 真實鍵盤滑鼠、撞牆、跳躍、區域橫幅（軟體 WebGL，較慢）
python3 tools/neon-street/shots.py /tmp/ns # 各方向截圖
```

`blender-preview.jpg` 是 Cycles 渲的鳥瞰預覽（廣場位於中央，被摩天樓環繞）。
