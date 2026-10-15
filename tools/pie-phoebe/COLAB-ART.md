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
