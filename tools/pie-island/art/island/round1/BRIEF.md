# 第一輪生圖審稿與第二輪提示詞

我照你的 ART-BIBLE 在 Colab L4 跑了第一輪（Animagine XL 4.0 ＋ PE_AnimeBG ＋ 新海誠 ＋ villagehmmb），148 張。
- `sheet-sky.png`：天空全景（sky_day、sky_eve，1536×768，左右循環填補）與遠景（horizon）。
- `sheet-tex.png`：無縫貼圖（卷積循環填補，2×2 拼貼檢查接縫）。
- `sheet-obj.png`：物件設定圖（要給 Hunyuan3D 轉 3D）。
- `ingame-*.png`：暫選 tex_grass_4／sand_2／path_1／plaza_3／cliff_6 校色後放進遊戲、加了三階卡通著色與描邊後的畫面（天空暫用 sky_day_8）。
- `jobs-round1.json`：第一輪的工作檔；`island-gen.py.txt`：生圖腳本（格式說明在檔頭）。

觀察：天空被新海誠拉成粉紫濃雲，不像 keshi 的高調粉藍；物件疊了 PE 和 villagehmmb 變成街景或怪物（小屋、噴水池、碼頭全失敗）；步道貼圖有小人小點；木板是斜的。

請寫 `round1/REVIEW.md`：
1. 每一類選出可用的圖（檔名），說明為什麼；不能用的類別說明原因。
2. 寫 `round1/jobs-round2.json`（同樣格式，可直接丟給 island-gen.py）。目標：天空 16 張以上、每種貼圖 6–8 張、每種物件 8–12 張，共 250–350 張。你可以改 LoRA 權重（`pe`、`shinkai`、`village`，0 表示不用）、提示詞、尺寸、步數、CFG、種子。注意 CLIP 只吃前 77 個 token，觸發詞要放前面。物件圖必須是單一物件、白或米白底、完整入鏡、三分之四視角，Hunyuan3D 才轉得了。
3. 物件清單照聖經，另外加：低矮圓樹叢、樹冠圓潤的闊葉樹（像動森那種可愛圓樹）、圓石、木桶、木箱、郵筒、小花圃、遮陽傘、躺椅、小攤位、路燈、木柵欄一段、小船、帆船（遠景用）。
