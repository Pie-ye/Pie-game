# 審稿一：暖蘋果角色的第一版實作

你是美術總監。程式已經照你的 `design/spec.json` 做出第一版角色，請審稿。

- `showcase-front-34-back.png`：spec 的六個展示角色，每人三張（正面、3/4、背面），上排 1–3、下排 4–6。
- `look0-front.png` … `look5-front.png`：六人的正面大圖。
- `creator.png`：捏臉畫面。
- `character.js.txt`、`face.js.txt`：目前的建模與五官繪製程式（three.js）。你可以讀懂後直接指出要改哪個常數、哪個零件。

請寫 `review1/REVIEW.md`（繁體中文）：
1. 跟 `design/01-turnaround.png`、`04-hairstyles.png`、`05-outfits.png`、`06-lineup.png` 比，列出最影響美感的前 10 個問題，依嚴重度排序。
2. 每個問題給**可直接實作的修正**：哪個零件、改成什麼形狀、具體數字（公尺、比例、色碼、角度）。例如「眼睛寬改成臉寬 30%，虹膜改成眼高 0.85」。如果規格本身要改，也一起改 `design/spec.json` 並在 REVIEW.md 註明改了什麼。
3. 頭髮特別重要：設計稿裡的短圓蓋其實是蓋住兩側到下顎的蓬鬆短髮加厚瀏海，請重新定義 10 種髮型的構造（可用的幾何：貼著頭型往外長的殼 `headShell(offset, keep(x,y,z))`、球、膠囊、圓錐、圓環、旋轉體），每種給具體參數。
4. 可以用你的生圖工具畫修正示意圖（例如把正面截圖標註哪裡要改），放在 `review1/`。
