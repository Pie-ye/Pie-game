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

角色依 `../pie-phoebe/assets/phoebe.png`、`reggie_open.png`、`reggie_closed.png` 造型參考，以立體網格建模。菲比具完整側面、背面、帽子、髮束、臉部及四肢；瑞吉具口腔、下顎、獠牙、鬍鬚與鰭肢。角色使用階層關節與程序動畫，並非圖片看板，也不是外部 DCC 製作的蒙皮骨架資產。蛋與場景均為立體幾何。

這一版沒有呼叫 Grok，也沒有新增生成圖片；現有造型參考已足以製作程序式模型。音效為 WebAudio 合成，不沿用原遊戲未授權的語音取樣。角色同人造型權利屬於各自權利人。

使用專案既有 `../pie-phoebe/vendor/three.module.js` 與 `three.core.js`，授權見該 vendor 目錄。此共享依賴必須與新遊戲一同提供，不需 CDN、建置步驟或新增後端服務。

## 結構與驗證

- `src/rules.js`：共用地形、碰撞、路徑搜尋、攻擊範圍。
- `src/game.js`：獨立於繪圖的固定時間步長任務／角色／敵人狀態。
- `src/models.js`：3D 角色、階層關節、動畫及蛋。
- `src/world.js`：海岸、岩台、坡道、營地、梯子與蛋巢。
- `src/main.js`：繪圖、鏡頭避障、鍵鼠／觸控、小地圖、介面及 SDK。
- `src/audio.js`：合成音效。

在專案根目錄執行 `python3 -m http.server 8765 --directory site --bind 127.0.0.1`，開啟 `/games/community/phoebe-egg/`。

邏輯測試：`node --test tests/phoebe-egg.test.mjs`。
投稿規格：`python3 tools/validate_games.py site/games/community`。
開發觀察介面：`window.__egg`；正常遊戲不會自動移動或免傷。

瀏覽器測試（需已有 Playwright 與 Chromium）：`PLAYWRIGHT_MODULE=/path/to/playwright EGG_TEST_URL=http://127.0.0.1:8765/games/community/phoebe-egg/ node tests/phoebe-egg-browser.cjs`。測試截圖輸出至 `/tmp/phoebe-egg-*.png`。

已驗證：10 項邏輯測試（含瑞吉正常運作時的三趟完整路線）、桌面鍵鼠、手機觸控取蛋／翻滾、攀爬、鏡頭旋轉、暫停、交付結算、紀錄保存與重新開始。瀏覽器測試使用 Chromium 軟體 WebGL，確認載入與功能，不能用其結果保證實體手機幀率。靜態場景依材質合併以降低繪製呼叫。

最佳完成時間保存於 `localStorage` 的 `pg-phoebe-egg-best`。第一版不包含多人、角色編輯或額外關卡。桌面目標為流暢 60 FPS，低效能裝置的實際幀率需依硬體測量。
