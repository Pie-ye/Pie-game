# 遊戲城美術（Hi-Fi Rush LoRA）

首頁「遊戲城」（`site/shell/city/`）用的貼圖：天空、中景、人物、機器人、街機、13 棟遊戲房子。

- LoRA：`/home/pieye/Container/colab_lora/Hi-Fi_Rush_Style_Illustrious-000016.safetensors`（SDXL kohya 格式，觸發詞 `hifirushstyle`）。
  Illustrious 底模在 HF 上檔名不固定，`colab/hifi-gen.py` 先試它、失敗就退回 Animagine XL 4.0，結果都能用。
- 產圖：`upload-lora.sh` 把 LoRA 傳上去 → `colab/hifi-gen.py <jobs.json>` 在 Colab 背景跑（可同時開兩個工作階段分工；
  同一台 T4 跑兩個程序會 OOM）→ `fetch.sh <session> <資料夾> <jobs.json>` 下載（用檔案 API，不用 exec）。
  `cut:true` 的項目會另存 rembg 去背版 `_cut.png`。
- 提示詞超過 77 個 token 會被截掉，重要的字放前面。LoRA 權重 0.8 以上會把畫面塞滿細節、單棟房子去背失敗；
  所以現在的房子**不去背**：每款遊戲產一張「外牆壁畫」（`wall-*`、`cw-*`，1024 見方，不含門與窗），程式把它裁成各街區的外型、
  再用程式畫門、雨棚、地毯、招牌。門與外牆同一個中心，所以一定對齊。
- 三個街區（`city/scene.js` 的 `THEMES`）：賭場街＝賽博龐克夜城賭場（暗、雨、洋紅青金、紅地毯）；
  菲比廣場＝星光少女（粉彩、星星、聚光燈、無雨）；電玩巷＝傳統街機廳（像素粒子、賽車格、紅黃藍）。
  每個街區有自己的背景圖 `bg-*`、地面、路燈、天氣、門與招牌樣式，交界處（城門）前後會漸變。
- 外牆提示詞迭代紀錄：第一輪用「entrance door」會畫成門廊內部、第二輪（單棟房子去背）風格變成日式廟宇、
  第三輪（`wall-*`）三區有區別但賭場街偏金色宮殿，Codex 審核後第四輪（`cw-*`）改成 chrome／黑玻璃／全息招牌，LoRA 降到 0.6，
  負面詞加 `fantasy, temple, palace, art deco, gold ornate`。
- 挑圖：改 `picks.json`（name → seed）後跑 `process_art.py <資料夾>`，輸出到 `site/shell/city/assets/*.webp`。
  seed ≥ 10 的外牆讀 `cw-*`，背景 seed ≥ 20 讀 `bg2-*`（seed − 20）。人物原圖朝左，腳本會水平翻轉；
  街機是整張正面特寫不去背，螢幕位置寫在 `city/arcade-boot.js` 的 `SCREEN`。
- 預覽：`python3 -m server.app --dev`（`PG_API_ORIGIN=http://127.0.0.1:54480`）＋ `python3 tools/dev_stub_api.py`，
  然後 `tools/city_shots.py <資料夾>`（場景與開機轉場）、`tools/city_tour.py <資料夾>`（逐棟巡覽聯絡表）。
- 新增遊戲房子：在 `city/layout.js` 的 `LOOKS` 加一筆（art 檔名、霓虹色、街區、招牌字），再補一個 `wall-` jobs 項目產圖，picks 加 `fac-<art>`。
  沒登記的遊戲會自動用配色與程式畫的備用房子，不會壞。
