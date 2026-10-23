# 審稿三

程式已照 `review2/REVIEW.md` 改完 1–8 項，角色改用你建議的高一階三階卡通 ramp（0.30／0.66）。描邊改成全畫面的深度邊緣後製（線色 #6A5A4E），不是倒殼，以免 16 個玩家時繪製次數加倍；材質依零件影色的部分還沒做。

截圖（鏡頭 2.4 m，場景已換成卡通著色與手繪草地）：`showcase-front-34-back.png`、`look0..5-front/34/back.png`。程式：`character.js.txt`、`face.js.txt`。

請寫 `review3/REVIEW.md`：
1. 跟設計稿比，剩下最影響美感的前 8 個問題與數字修正（含哪些是 three.js 幾何拼法的極限，建議怎麼繞過）。
2. 給一個「依零件影色」的具體實作建議：在 three.js 的 MeshToonMaterial 上用 onBeforeCompile 改哪一段 shader chunk、寫什麼 GLSL，讓影階是固有色往指定色混，而不是乘暗。請直接寫出可用的程式碼片段。
3. 用你的生圖工具畫一張「目標效果」：同樣六個人站在 `island/concept/02-plaza.png` 那種畫風的廣場上，但角色是暖蘋果比例，給我當最終對照。放在 `review3/target-lineup.png`。
