# 素材來源與授權

此遊戲只收錄實際用到的檔案，沒有轉散布完整素材包。

## 圖像：Sprout Lands

- 作者：Cup Nooble　https://cupnooble.itch.io/sprout-lands-asset-pack
- 用途：地形（草地、水、土路、耕地）、木橋、樹、花、蘑菇、岩石、木頭、寶箱、雞舍、作物（小麥、甜菜）、室內家具（床、桌椅、燈、畫、地毯）。
- 授權（Basic Pack）：可修改；可用於非商業專案；禁止 NFT 與 AI 訓練用途；不得轉散布或轉售素材包本身；需署名 Cup Nooble。
- 檔案：`sprout/*.png`。
- 本專案為非商業專案。若要用於商業，需另向作者取得授權。

## 角色、對話框、音樂、音效：Ninja Adventure Asset Pack

- 作者：Pixel-boy（與 AAA）　https://pixel-boy.itch.io/ninja-adventure-asset-pack
- 授權：CC0 1.0，可自由使用。
- 檔案：`ninja/body/*.png`（捏臉的 13 個角色底版與頭像，執行時換髮色、膚色、衣服顏色；清單與換色分析見 `tools/pie-plaza/build_bodies.py`）、`ninja/dialog.png`、
  `ninja/house.png`（商店與房屋）、`ninja/element.png`（櫃台、書櫃、桶子等）、`ninja/nature.png`（樹、雜草、石頭）、
  `ninja/interior_floor.png`（室內地板與牆紙、市集石板）、`ninja/tools/*.png`（工具圖示）、`ninja/npc/*.png`（居民角色與對話頭像）、
  `audio/village.ogg`（音樂 Village）、`audio/bird.wav`、`audio/send.wav`、`audio/recv.wav`、`audio/join.wav`。
- `audio/wind.wav` 由該素材包的 `Ambient/Wind.wav` 截取 12 秒、降取樣為 11 kHz 單聲道並做首尾交叉淡化，腳本見 `tools/pie-plaza/prep_assets.py`。

## 補畫素材：grok 生成

- 檔案：`gen/*.png`：紅蘿蔔、番茄、南瓜、草莓的種子袋／四個生長階段／成品，八種魚與舊靴子，釣竿、營火、路燈、公告欄、節慶燈串。
- 以 Sprout Lands 的作物圖與官方調色盤為風格參考，由 grok（image_gen）產生後，用 `tools/pie-plaza/process_art.py` 縮回原生像素並去背。
- 提示詞與規格：`tools/pie-plaza/art/RULES.md`、`art/*/BRIEF.md`。

## 字型：Zpix（最像素）

- 作者：SolidZORO　https://github.com/SolidZORO/zpix-pixel-font
- 授權：個人與非商業使用免費，商業使用需付費授權。
- 檔案：`fonts/zpix.woff2`。

## 程式合成

腳步聲由 `src/audio.js` 以 Web Audio 即時合成，沒有使用外部音檔。
