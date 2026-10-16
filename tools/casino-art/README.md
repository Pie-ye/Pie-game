# 賭場貼圖（gwentCB01 LoRA）

官方賭場遊戲（拉霸、21 點、德撲、射龍門、妞妞、百家樂）與金幣投稿遊戲（猜硬幣、幸運轉盤）的底圖、按鈕、籌碼、牌背、符號、硬幣、轉盤，
全部是貼圖，不再用程式畫的漸層／SVG／霓虹光暈。

- LoRA：`/home/pieye/Container/colab_lora/gwentCB01.safetensors`（SD 1.5、kohya 格式、觸發詞 `gwentcb01_soul3142`、clip skip 2）。
- 產圖：`colab/gwent-gen.py <jobs.json>`（Colab T4 即可，約 4 秒一張）。LoRA 直接合併進權重，diffusers 的 `load_lora_weights` 對這份檔案會失敗；
  新版 transformers 也讓 `clip_skip` 參數壞掉，所以腳本自己算。要先 `pip uninstall -y torchao`。`tile:true` 用循環 padding 產可無縫拼貼的材質。
  同名檔案會被略過，換參數重產要先刪掉遠端舊檔。
- 挑圖與後製：`process_art.py <第一輪資料夾> <第二輪資料夾>` → `site/shell/casino/*.webp`（外框）與各投稿遊戲的 `assets/`（iframe 取不到外框貼圖）。
  按鈕與面板底板由挑好的材質合成 9 宮格。
- 套用：`site/shell/casino-skin.css`，只在 `#view.casino-skin`（會扣金幣的遊戲頁）生效。
- 預覽：`python3 -m server.app --dev`（要 `PG_API_ORIGIN=http://127.0.0.1:54480`）＋ `python3 tools/dev_stub_api.py` ＋ `python3 tools/casino_shots.py <輸出資料夾>`。

LoRA 權重高時一切都會變成金圈徽章（適合符號、硬幣、卡背）；平面材質與按鈕要壓到 0.2–0.3，仍不穩定，所以按鈕底板是用挑好的材質合成的。
