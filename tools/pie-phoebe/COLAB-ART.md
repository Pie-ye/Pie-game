# v1.4 美術：Colab 生圖流程

v1.4 新增的 2D 素材（六隻頭目、共鳴柱、噪卵、赫卡忒、彼岸花特效）由 Google Colab GPU 生成，不走 Grok 命令列。弗洛洛本人的 Q 版圖來自專案圖庫（`refs/phrolova_chibi_front.png`）。

## 流程

1. `colab new --gpu T4 -s <名稱>` 開兩個 T4 工作階段並行（L4 在同一帳號上可能已被其他工作佔用，T4 不衝突）。
2. 上傳 `colab-img.py`、`prompts-a.json` / `prompts-b.json` 與一個放組別名稱的 `GROUP` 檔到 `/content/pp/`，用 `colab exec` 啟動 `nohup python -u colab-img.py <組別>`（背景執行，輪詢 `/content/pp/gen-<組別>.log`）。
3. 模型：`cagliostrolab/animagine-xl-4.0`（SDXL 動漫模型，fp16，26 步，Euler Ancestral，1024×1024）。單張約 25 秒。每個素材 4 到 6 個種子。
4. `colab download` 抓回原圖，挑選後用 `process_v14.py` 去背（四邊容差洪水填色）、裁切、縮小、量化成 256 色 PNG，輸出到 `site/games/community/pie-phoebe/assets/`。

## 提示詞心得

- 第一輪帶 `chibi, game sprite, sticker style` 與洋紅背景，模型常畫成「角色設定圖拼貼」且不理會洋紅背景。
- 第二輪改成 `solo, no humans` 加白底（`plain white background`），並在負面提示加入 `character sheet, collage, grid, lineup`，單一主體的成功率大幅提高；去背用白底或近純色底的容差填色即可。
- 特效圖（`fx_lily`）用黑底，遊戲內以加亮混合疊加，黑色即透明。

## 挑選結果

| 素材 | 原圖 |
| --- | --- |
| enemy_vanguard | v2_vanguard_14 |
| enemy_weaver | v2_weaver_13 |
| enemy_conductor | v2_conductor_16 |
| enemy_crab | v2_crab_15 |
| enemy_lighthouse | v2_lighthouse_16 |
| enemy_hive | v2_hive_12 |
| enemy_obelisk（共鳴柱） | v2_pillar_14 |
| enemy_egg | v2_egg_12 |
| hecate | v2_hecate_12 |
| fx_lily | fx_lily_1（黑底，裁切並加圓形遮罩） |

原圖不入庫（每張約 1 MB）。重新生成只要重跑上面流程，種子固定時結果可重現。

## v1.4.1：用菲比 Q 版 LoRA 重做弗洛洛與特效

LoRA：`Container/colab_lora/phoebe_chibi_anima_v1.safetensors`（kohya 格式、rank 64、以 `anima-base-v1.0` 訓練，觸發詞 `phoebe_chibi, chibi_style`，風格詞 `thick black outline, flat cel shading, sticker art style`）。檔案不入庫。

1. `colab new --gpu L4 -s pie-lora`。
2. 上傳並執行 `lora/colab-setup-comfy.py`：安裝 ComfyUI、下載 Anima 三個檔案（`anima-base-v1.0`、`qwen_3_06b_base`、`qwen_image_vae`，皆在 `circlestone-labs/Anima`）。
3. LoRA 約 184 MB，單檔上傳會被 Colab 擋掉（SSL EOF）。切成 20 MB 的段落逐段 `colab upload`，在遠端合併並比對 sha256。
4. `lora/colab-gen-comfy.py` 會啟動 ComfyUI 伺服器並用 API 送工作：UNETLoader → LoraLoaderModelOnly → KSampler（er_sde、30 步、CFG 4.5、simple）→ VAEDecode。CLIPLoader 的 type 用 `stable_diffusion`（ComfyUI 會自動認出 Anima 的文字編碼器）。工作清單是 `lora/jobs-phro1.json`、`jobs-phro2.json`。
5. 單張約 25 秒（1024×1024，L4）。`process_lora.py` 去背、裁切、量化，並把彎月斬翻轉、補成圓心在畫面中央的正方形。

提示詞心得：
- 要弗洛洛的特徵就逐項描述（淡薄荷綠長髮、黃色漸層髮尾、雙辮、左眼繃帶、單隻紅眼、紅色單泡袖洋裝、肩上的彼岸花、粉色疊裙、黑絲襪、紅鞋）。第一版用 aqua hair 會變成飽和青色；LoRA 會帶出菲比的十字髮飾，要在負面詞加 `hair ornament, hair clip, cross, hat`。
- 特效圖加 `no humans` 並在負面詞排除 `1girl, character, face, hand`。「單一花瓣」會畫成整朵站立的花，正好拿來當站立彼岸花。音符會被畫成蘋果，只有 `music note` 配紅色圓底那張可用。

| 素材 | 原圖 |
| --- | --- |
| phrolova | p_a_1 |
| phrolova_atk | atk_4 |
| hecate | hecate_3 |
| fx_slash | fx_slash_6（左右翻轉） |
| fx_lily_stand | fx_petal_2 |
| fx_lily_flat | fx_lilyflat_4 |
| fx_burst | fx_burst_2 |
| fx_note | fx_note_6 |
