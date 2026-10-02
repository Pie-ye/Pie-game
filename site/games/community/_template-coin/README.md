# 金幣遊戲範本

複製本資料夾，讓目錄名、`game.json.id`、`spec.json.id` 三者相同。

- `kind` 必須是 `"coin"`，且不可 `multiplayer`
- 必須附 `spec.json`，每個 choice 的回饋率（含 `floor` 派彩）都要 ≤ 98%，建議落在 94–96%
- 遊戲畫面只負責演出；下注列由平台外框依規格繪製
- `display` 陣列裡的物件會隨機挑一個傳給 `PieGame.coin.onResult`
