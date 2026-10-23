# 美術簡報二：小島場景改成日式動漫畫風

你是「小島樂園」的美術總監（角色設計稿你已經做過，在 `../design/`）。現在要把**整座小島場景**改成日式動漫畫風，參考 X 帳號 **@keshiAIart**（https://x.com/keshiAIart）。

## 你要做的

1. **研究參考**：用你的 X／網路搜尋實際看 @keshiAIart 的貼文（盡量多看幾篇，記下貼文網址）。描述這個畫風：線條、上色（賽璐璐／水彩／厚塗）、光影、天空與雲、植物、水、建築、色票、構圖、氛圍。如果作者有提到使用的模型、LoRA、提示詞，記下來。
2. **找 LoRA 與底模**：我們會在 Google Colab（L4 GPU、diffusers 或 ComfyUI）跑 Stable Diffusion。請找出最能做出這種畫風、而且**能直接用網址下載**的底模與 LoRA（Hugging Face 優先；Civitai 也可以，但寫出模型版本 ID 與直接下載網址）。給 2–4 個候選，各自說明為什麼像、建議權重、觸發詞。已經有的本機 LoRA：`Mountain_village_fantasy`（SDXL 場景）、`Hi-Fi_Rush_Style_Illustrious`（Illustrious）、`phoebe_chibi_anima_v1`（Anima）、`gwentCB01`，如果其中有適合的也可以用。
3. **小島美術聖經**：寫 `island/ART-BIBLE.md`（繁體中文），內容包含：
   - 畫風關鍵詞、色票（hex）、天空時段與雲的畫法。
   - 3D 端怎麼做出這個畫風（three.js）：卡通著色的階數與陰影色、要不要描邊與粗細、草地／沙灘／水面／崖壁的畫法、霧與遠景、後製（bloom、色調）。
   - 需要用 SD＋LoRA 生成哪些素材，每一項給**完整的正向／負向提示詞**、尺寸、用途。至少包括：天空全景（equirectangular 2:1，可當 skybox）、遠景海平線與雲、可無縫平鋪的地面貼圖（草、沙、步道、崖壁、木板）、水面、樹葉貼圖或樹的設定圖（給 Hunyuan3D 轉 3D 用）、小屋與碼頭等建築的設定圖（單一物件、白底、三分之四視角，給 Hunyuan3D 轉 3D）、花草小物。
   - 角色（你上次設計的暖蘋果）放進這種場景時，角色材質要怎麼調才搭。
4. **概念稿**：用你的生圖工具畫 4 張這個畫風的小島概念圖放到 `island/concept/`：
   - `01-island-overview.png`：斜上方俯瞰整座島（廣場噴水池、木屋、碼頭、高台、蓮花池、沙灘、椰子樹）。
   - `02-plaza.png`：廣場近景，幾個暖蘋果角色在散步。
   - `03-beach-dock.png`：沙灘與碼頭，傍晚或晴天。
   - `04-sky-palette.png`：天空、雲、色票與材質樣本板。

目前的場景截圖在 `../current/island-*.png`，小島的配置寫在 `../../../../site/games/community/pie-island/README.md`。

完成後在 ART-BIBLE.md 最後列出所有參考貼文網址、候選 LoRA 下載網址與概念稿說明。
