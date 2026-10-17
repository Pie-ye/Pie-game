# 遊戲城美術（Hi-Fi Rush LoRA）

首頁「遊戲城」（`site/shell/city/`）用的貼圖：天空、中景、人物、機器人、街機、13 棟遊戲房子。

## 全身生成奔跑影格（目前使用）

`prepare-fullbody-run.py` 只使用原始完整 `hero.webp` 作參考，透過 `minimax-h3-colab` 技能的 Colab CLI runner 在 A100 生成 124 格、24 fps 的動作影片。提示詞與來源影片保存在 `output/hero-run-fullbody/`。頭、身體、手、腿與鞋都是同一次模型生成；後處理只做綠幕去背、去除綠色溢色與整張影格對齊，不重畫或拼接肢體。

生成完成後，使用 `extract-fullbody-run.py inspect <mp4> <frames-dir>` 輸出全片接觸表及候選循環，再目視選擇 `pack <frames-dir> --start 89 --end 101`，保留原生 12 格完整週期。依賴 `pillow numpy imageio imageio-ffmpeg`。

目前首頁載入 `site/shell/city/assets/hero-run-fullbody.webp` 與同名 JSON；JSON 決定影格數、錨點、圖集排列及步幅。原生逐格 PNG、循環預覽與接觸表在 `output/hero-run-fullbody/frames/`。停止／減少動態效果／載入失敗時顯示原始完整 `hero.webp`。舊的補畫四肢圖集已不再被首頁引用。

```sh
python3 tools/city-art/prepare-fullbody-run.py
python3 /home/pieye/.agents/skills/minimax-h3-colab/scripts/runner.py batch --manifest tools/city-art/output/hero-run-fullbody/jobs.json --gpu A100 --timeout 10800 --output-dir tools/city-art/output/hero-run-fullbody
python3 tools/city-art/extract-fullbody-run.py inspect tools/city-art/output/hero-run-fullbody/fullbody-run.mp4 tools/city-art/output/hero-run-fullbody/frames
python3 tools/city-art/extract-fullbody-run.py pack tools/city-art/output/hero-run-fullbody/frames --start 89 --end 101
```

## 舊版素材烘焙（已停用，保留歷史產物）

`colab/bake-run.py` 在 Colab CPU 使用 Pillow，將現有 `hero-body.webp` 與固定長度的兩節四肢合成 16 張透明影格；這是既有素材烘焙，不是 AI 逐格重繪。手腳反向擺動，每條腿 40% 著地、60% 回擺，包含短暫雙腳離地。髖部與身體使用同一個位移，腳踝在骨架可達範圍內。

```sh
colab new -s pie-city-run
colab upload -s pie-city-run site/shell/city/assets/hero-body.webp /content/hero-body.webp
colab exec -s pie-city-run -f tools/city-art/colab/bake-run.py --timeout 120
colab download -s pie-city-run /content/hero-run.zip /tmp/pie-city-hero-run.zip
colab stop -s pie-city-run
```

歷史產物：`site/shell/city/assets/hero-run.webp`（4×4 圖集）、`hero-idle.webp`（站立）、`hero-run.json`（尺寸與錨點）。獨立 PNG、動畫 WebP 與檢查用接觸表存於 `tools/city-art/output/hero-run/`。每格 384×384，腳底錨點 `(190,360)`，角色基準高 320。

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
