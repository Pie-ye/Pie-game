# 菲比啾比搬蛋大作戰

單人第三人稱 3D 搬運遊戲：6 分鐘內將 3 顆蛋從北側蛋巢送回南側營地，躲避瑞吉的滑行衝撞、大吼、拍地與甩身。

## 操作

- WASD／方向鍵：以鏡頭方向移動；Shift：衝刺；Space：翻滾。
- E：取蛋、放下、攀爬；回到綠色營地按住 E 一秒交付。
- 滑鼠右鍵拖曳：旋轉鏡頭；滾輪：調整距離；Esc／P：暫停。
- 觸控裝置：左下搖桿，右下動作按鈕；拖曳場景旋轉鏡頭。「衝刺」為切換按鈕，「互動」可按住交付。
- 離開視窗或切換分頁會自動暫停。

抱蛋時可護蛋翻滾、衝刺及攀爬。空手／抱蛋翻滾分別消耗 22／30 耐力，攀爬消耗 25。翻滾中段可閃避攻擊。蛋可承受三次損傷，破裂後回巢重取。從高台直接落下會傷血與傷蛋，請走坡道或爬梯。營地為安全區，交付恢復 15 生命。放下的蛋會以小地圖金色標記追蹤，取回前不能再從巢中取第二顆。

## 3D 美術

角色與整個場景都是 GLB 模型，位於 `assets/models/`，由 Colab 上的 Hunyuan3D-2 依 Grok 生成的參考圖產出（形狀加貼圖）：菲比、瑞吉、岩石高台、石砌坡道、巨石、櫻花樹、鳥居、石燈籠、鳥巢、帳篷、補給箱、旗桿、木梯、蛋、雲，以及烘焙的島嶼地面、海面與天空。程式只負責碰撞（`src/rules.js`）、載入後把模型貼合碰撞體、角色骨架與動畫，以及特效粒子和遊戲提示標記。

生成流程、參數、環境建置與重建方式見 `tools/phoebe-egg/ART-NOTES.md`；生成紀錄在 `assets/models/textured.json`。角色骨架是載入時依模型高度與左右位置混合權重的七根骨頭，不是手工蒙皮；抱蛋、翻滾與攀爬動作是程式驅動的近似動畫。

`model-preview.html` 可檢視角色的各角度、動作與網格，並下載 GLB。本專案沒有使用 TripoSR 的成果。音效為 WebAudio 合成。角色同人造型權利屬於各自權利人。

使用專案既有 `../pie-phoebe/vendor/three.module.js` 與 `three.core.js`。不需 CDN、建置步驟或新增後端服務。

## 結構與驗證

- `src/rules.js`：共用地形、碰撞、路徑搜尋、攻擊範圍。
- `src/game.js`：獨立於繪圖的固定時間步長任務／角色／敵人狀態。
- `src/assets.js`：GLB 模板快取、貼合碰撞體的放置函式。
- `src/models.js`：蛋（egg.glb）與小工具。
- `src/anime-loader.js`：本專案 GLB 子集載入器（支援 JPEG/PNG 貼圖、頂點色）。
- `src/model-actors.js`：角色載入、七骨架蒙皮、抱蛋／翻滾／攀爬／攻擊動畫。
- `src/model-preview.js`：獨立多角度模型檢視器。
- `src/world.js`：以 GLB 組成海岸、岩台、坡道、營地、梯子與蛋巢。
- `src/main.js`：繪圖、鏡頭避障、鍵鼠／觸控、小地圖、介面及 SDK。
- `src/audio.js`：合成音效。

在專案根目錄執行 `python3 -m http.server 8765 --directory site --bind 127.0.0.1`，開啟 `/games/community/phoebe-egg/`。

邏輯、特效與 GLB 結構測試：`node --test tests/*.test.mjs`。
投稿規格：`python3 tools/validate_games.py site/games/community`。
開發觀察介面：`window.__egg`；正常遊戲不會自動移動或免傷。

瀏覽器測試（需已有 Playwright 與 Chromium）：`PLAYWRIGHT_MODULE=/path/to/playwright EGG_TEST_URL=http://127.0.0.1:8765/games/community/phoebe-egg/ node tests/phoebe-egg-browser.cjs`。測試截圖輸出至 `/tmp/phoebe-egg-*.png`。

已驗證：31 項 Node 測試（邏輯、特效、18 個 GLB 的結構與面數預算與生成紀錄）、桌面鍵鼠、手機觸控取蛋／翻滾、攀爬、鏡頭旋轉、暫停、三趟交付結算、紀錄保存與重新開始。瀏覽器測試使用 Chromium 軟體 WebGL，場景約 109 次繪製、105 萬三角形，不能用其結果保證實體手機幀率；低階手機可能需要減少樹木數量。

最佳完成時間保存於 `localStorage` 的 `pg-phoebe-egg-best`。第一版不包含多人、角色編輯或額外關卡。桌面目標為流暢 60 FPS，低效能裝置的實際幀率需依硬體測量。
