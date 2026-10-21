# 星光電玩街：Blender 建置流程

整個街區由三個階段產生，全部可重現（固定亂數種子）：

```
scene_gen.py      純 Python 排版：大樓、招牌、道具、碰撞框、燈光點、動畫部件
   │  （同一份排版被下面兩步各自重建，所以貼圖光暈、GLB、碰撞永遠對得上）
   ├─ fetch_props.py     下載 Poly Haven 道具模型並縮貼圖（props_src/，不進版控）
   ├─ make_textures.py   Pillow 畫貼圖 → tex/*.jpg（立面窗戶、店面、霓虹招牌圖集、地面、投幣機、看板）
   └─ build_blend.py     Blender 4.5 無頭：建網格與材質 → 存 neon-street.blend → 匯出 GLB 與 scene.json
```

## 重建

```bash
tools/neon-street/build.sh                      # 約 10 秒
RENDER=/tmp/preview.png tools/neon-street/build.sh   # 順便用 Cycles 渲一張鳥瞰圖（約 30 秒）
```

需要網路（首次建置會從 Poly Haven、ambientCG 下載 CC0 素材，之後用快取）。需要 Blender 4.5（預設找 `~/tools/blender-4.5.14-linux-x64/blender`，可用 `BLENDER=` 指定）與 Pillow。
Blender 用下載的免安裝版即可：<https://download.blender.org/release/Blender4.5/>。

## 第三方素材（CC0）

| 用途 | 來源 | 腳本 | 輸出 |
|---|---|---|---|
| 地面與牆面細節層（顆粒、裂縫、髒污） | Poly Haven PBR 材質 | `fetch_pbr.py`（需要 numpy；手動執行，輸出進版控） | `assets/pbr/*.jpg`、`pbr.json` |
| 大樓立面（顏色、法線、粗糙度、發光） | ambientCG Facade007/009/010/011/016/017 | `make_textures.py` 的 `make_facade`（下載到 `acg_src/`，不進版控） | `tex/fac_*` |
| 反射環境 | Poly Haven `shanghai_bund` 1k HDRI | 手動下載 | `assets/env/` |
| 街頭道具 | Poly Haven 模型（`scene_gen.PROP_MODELS`） | `fetch_props.py` → `props_blender.py`、`build_blend.py` | GLB 內 `props__<名稱>` |

細節層的做法：手繪貼圖保留圖案，Poly Haven 材質由 `src/detail.js` 的著色器依世界座標平鋪，反照率以「每個色版平均為 1 的倍率」相乘，不改手繪的色相與亮度。
材質用哪一組由 `scene_gen.py` 的 `detail` / `detail2` 決定，經 Blender 自訂屬性進 glTF extras；水窪與玻璃（粗糙度很低）自動不加顆粒。
道具位置由 `place_props()` 以固定種子散佈，避開既有碰撞體，實心的會自動加碰撞框；
每種模型在 Blender 內複製後合併成單一物件（一種模型一次繪製）。換模型只要改 `PROP_MODELS`（id、減面目標、貼圖邊長、`only`/`skip` 挑變體）。
授權與作者列在 `assets/pbr/CREDITS.md`。

## 想在 Blender 裡改

用 Blender 開 `neon-street.blend`（建置時產生，不進版控；貼圖用相對路徑指向 `tex/`）。
物件依材質分開，名稱是 `mesh__<材質>`；轉動／漂浮的部件是 `spin_*__<材質>`、`float_*__<材質>`，原點就是旋轉中心；
`LightMarkers` 集合裡的空物件是點光源位置，有顏色、強度、距離屬性。
手改 .blend 不會回寫排版，要長久保留請改 `scene_gen.py`。

## 重要規則

- 座標：遊戲座標 X 東、Y 上、Z 南。Blender 內是 `(x, -z, y)`，匯出器轉回去。
- 材質定義集中在 `scene_gen.py` 的 `MATERIALS`；自發光強度 >1 會匯出成 `KHR_materials_emissive_strength`，three.js 端用泛光門檻 1.1 抓亮處。遊戲載入時再整體乘 0.5（網址 `em=` 可調）。
- 加新招牌：改 `SIGNS_H` / `SIGNS_V` / `SIGNS_BIG` 的文字與顏色，圖集格數固定（16／16／4），多加要同步改 `_cell_uv_*`。
- 單檔上限 25 MiB、整個遊戲資料夾 50 MB（`tools/validate_games.py`），目前 GLB 約 19 MB，加上細節層與 HDRI 整個遊戲約 26 MB。

## 測試

```bash
node --test tests/neon-street.test.mjs     # 物理、碰撞、洪水填充（確認鑽不進大樓縫隙）
python3 -m http.server 18770 --bind 127.0.0.1 --directory site &
python3 tools/neon-street/browser_test.py  # 真實鍵盤滑鼠、撞牆、跳躍、區域橫幅（軟體 WebGL，較慢）
python3 tools/neon-street/shots.py /tmp/ns # 各方向截圖
```

`blender-preview.jpg` 是 Cycles 渲的鳥瞰預覽（廣場位於中央，被摩天樓環繞）。
