# 星光電玩街（STAR ARCADE STREET）

賽博龐克 × 星光少女 × 電玩街的第一人稱 3D 環景，是 Pie Game 首頁環景的原型。場景用 **Blender 4.5** 組裝後匯出成 GLB，網頁用 three.js 載入。

## 操作

- **WASD**：移動（以視線方向為準）；**Shift**：奔跑；**Space**：跳。
- **滑鼠**：轉視角（按「進入街區」會鎖定滑鼠）；**Esc**：釋放滑鼠並暫停。
- 方向鍵可轉視角（沒有滑鼠時的備案）。無法鎖定滑鼠的環境會自動改成按住左鍵拖曳。
- **R** 雨、**B** 泛光、**M** 音效、**N** 配樂、**H** 隱藏介面。
- 靠近南側夜市入口（x=10.45、z=49.1）按 **E** 可進入「星光電玩屋」室內原型；回到室內門口再按 **E** 返回街上。手機會顯示互動按鈕。
- 手機：左半邊拖曳移動，右半邊拖曳轉視角，右側有跳躍鍵。
- 離開分頁會自動暫停。畫面持續低於 24 fps 時，會依序自動關泛光、降像素比、減少動態光源。

## 場景

中央是半徑 24 m 的圓形**星光廣場**（地面刻五芒星魔法陣、紀念碑立著轉動的星與三道光環、14 棵賽博櫻花），向四個方向各連一條 96 m 的大道，每條有自己的配色與店面：

| 方向 | 街名 | 氣氛 |
| --- | --- | --- |
| 北 | 星光大道 | 粉紫、星星精品店、愛心 |
| 東 | 電玩街 | 青藍、店面裡一整排街機，路邊還有投幣機 |
| 南 | 霓虹夜市 | 橙黃、燈籠與攤位 |
| 西 | 賽博巷 | 青綠、螢幕牆 |

大道盡頭是閘門與巨幅看板牆，兩側有空橋、串燈、路燈、停放的懸浮車、販賣機，以及幾條可以走進去的小巷。四周是霧中的摩天樓天際線，夜空有彎月與星空，持續下雨。

看板用的是專案既有的星光少女美術（`site/shell/city/assets/`）。

## 素材來源

畫面質感用第三方 CC0 素材庫，不是手繪：

- 地面、牆面、金屬的顆粒、裂縫與髒污：[Poly Haven](https://polyhaven.com) PBR 材質，依世界座標平鋪成「細節層」（`src/detail.js`），手繪貼圖只留標線、窗戶、霓虹與色調。
- 大樓立面（窗內窗簾、人影、金屬框）：[ambientCG](https://ambientcg.com) 夜景立面材質。
- 反射用的環境光：Poly Haven `shanghai_bund` HDRI。
- 街頭道具（消防栓、垃圾桶、配電箱、冷氣室外機、公共電話、輪胎、護欄、人孔蓋、蓋布的車、監視器）：Poly Haven 模型，建置時減面並放進 GLB。

授權與作者見 `assets/pbr/CREDITS.md`。

室內使用 Kenney Mini Arcade CC0 的原始 GLB，包含地板、牆、門和七台機台；
來源與原始授權見 `assets/interior/CREDITS.md`。尺寸以玩家視高 1.65 m 調整，
重複的牆與地板使用 instancing。室內有碰撞與小地圖；
靠近左側兩台街機按 E，可玩「星光反應」（方向鍵／點擊／觸控），
失誤三次結束，可重玩，關閉後保留室內位置。不使用帳號金幣。
其他機台目前為場景模型，平台既有遊戲的跳轉與回程尚未接入。
鏡頭晃動已降低；系統的降低動態效果偏好或網址 `motion=0` 會關閉 bob 與側傾。

## 資料夾

```
assets/street.glb     Blender 匯出的整個街區（約 19 MB，含所有貼圖與道具）
assets/pbr/           Poly Haven 細節層貼圖與 pbr.json（每組材質的實際尺寸）、CREDITS.md
assets/env/           反射用 HDRI
assets/scene.json     碰撞框、燈光點、動畫物件、區域名稱（與 GLB 由同一次建置產生）
src/main.js           渲染、輸入、HUD、光源池、泛光
src/physics.js        第一人稱移動與碰撞（純函式，可在 node 測）
src/detail.js         世界座標細節層著色器（把 CC0 PBR 材質疊到手繪貼圖上）
src/sky.js            夜空穹頂著色器    src/rain.js 雨絲    src/audio.js 程式合成音效與配樂
vendor/               three.js 範例元件（GLTFLoader、泛光後製），版本與 ../pie-phoebe/vendor 相同（r186）
```

three.js 本體共用 `../pie-phoebe/vendor/three.module.js`，用 `index.html` 裡的 相對路徑匯入（線上 CSP 不允許內嵌 import map）。不需要 CDN、建置步驟或後端。

## 重新建置場景

場景不是手工擺的，是程式排版後交給 Blender 組裝，改參數後可一鍵重建。流程與細節見 `tools/neon-street/README.md`。

```bash
tools/neon-street/build.sh      # 貼圖 → Blender → street.glb / scene.json
node --test tests/neon-street.test.mjs
```

## 效能與限制

- 動態光源只讓離玩家最近的 10 盞點光源真的打光，其餘靠自發光貼圖與泛光撐氣氛。
- 星光電玩屋使用 Kenney Mini Arcade 的 CC0 模組化 GLB（地板、牆、門、街機、彈珠台、舞力機、夾娃娃機等），搭配首頁的 `arcade.webp` 做主視覺海報；主街與室內使用獨立 root 與碰撞集合。其他店面仍是貼圖，小巷可以進去但是死路。
- 網址參數可調光：`exp`（曝光）、`em`（自發光倍率）、`bs`／`bt`（泛光強度／門檻）、`hemi`、`lg`（點光源增益）、`lights`（光源池大小）、`detail=0`（關掉細節層）、`fps`（幀率上限，預設 60，0 為不限）、`hdri`（環境反射強度，預設 0.25）、`hrot`（HDRI 旋轉）、`rain=0`、`bloom=0`、`spawn=x,z,yaw,pitch`。
