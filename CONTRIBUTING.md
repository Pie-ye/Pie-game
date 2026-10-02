# 投稿教學

歡迎把遊戲送到 Pie Game。合併後會自動出現在 [game.coinpilet.win](https://game.coinpilet.win)；遊戲檔案由 [play.piea.uk](https://play.piea.uk) 提供。預設所有路徑都需要擁有者審核，投稿者無法自行合併。

## 平台在做什麼

- **外框**（`game.coinpilet.win`）：登入、大廳、金幣下注列、嵌入你的遊戲。
- **投稿內容**（`play.piea.uk`）：你的 HTML／JS／素材，以及多人 WebSocket `/mp`。
- **股票大亂鬥**（`coinpilet.win`）：帳號與金幣帳本。金幣遊戲的開獎、扣款由那邊執行，遊戲程式不能自己下注。

遊戲跑在 iframe 裡，跟登入網域不同，拿不到玩家的 cookie。請只用 SDK 跟外框說話。

## 三種遊戲

| 類型 | `game.json` | 還要什麼 |
| --- | --- | --- |
| 一般 | `"kind": "free"`、`"multiplayer": false` | 自己畫畫面、可把最高分存 `localStorage` |
| 金幣 | `"kind": "coin"`、`"multiplayer": false` | 必附 `spec.json`。下注列由外框畫 |
| 多人 | `"kind": "free"`、`"multiplayer": true` | 用 `PieGame.multiplayer.connect()` 開房傳訊 |

金幣不能多人：房間規則由房主的瀏覽器裁定，平台不碰金幣。

## 目錄結構

```
site/games/community/
  index.json          # { "games": ["your-id", ...] }
  your-id/
    game.json
    index.html        # 或 game.json 的 entry
    README.md
    spec.json         # 僅金幣
    …其他素材
```

`id` 必須等於資料夾名，符合 `^[a-z0-9][a-z0-9-]{1,30}$`。底線開頭的資料夾是範本，不會上架。

範本：

- `site/games/community/_template-free/`
- `site/games/community/_template-coin/`
- `site/games/community/_template-multiplayer/`

複製一份、改 id，即可開始。

## `game.json` 欄位

```json
{
  "id": "my-game",
  "name": "我的遊戲",
  "kind": "free",
  "multiplayer": false,
  "author": "github-username",
  "entry": "index.html",
  "description": "一句話介紹",
  "tags": ["休閒"],
  "source": "https://github.com/you/repo"
}
```

- `kind`：`free` 或 `coin`
- `multiplayer`：布林值
- `entry`：相對路徑，檔案必須存在，不可含 `..`
- `source`：可省略
- 單檔 ≤ 25 MiB，整個遊戲 ≤ 50 MB
- HTML／CSS 不得用 `src=`、`href=`、`url(` 指向 `http://`、`https://`、`//`。`<a href>` 外連可以，但必須 `rel="noopener"`

## 金幣規格與回饋率

`spec.json` 由股票大亂鬥驗證，開獎也在那邊。格式（spec v1）：

```json
{
  "specVersion": 1,
  "id": "coin-flip",
  "name": "猜硬幣",
  "author": "github-username",
  "minBet": 5,
  "maxBet": 100,
  "choices": [
    {
      "id": "heads",
      "label": "正面",
      "outcomes": [
        {"id": "win", "label": "猜中", "weight": 48, "return": "2", "display": [{"face": "heads"}]},
        {"id": "lose", "label": "沒中", "weight": 52, "return": "0", "display": [{"face": "tails"}]}
      ]
    }
  ]
}
```

規則（全部用分數運算）：

- `id`、每個 choice／outcome 的 id 同遊戲 id 規則；`name` 1–20 字、`author` 1–39 字
- `choices` 1–12 個；每個 `outcomes` 2–64 個
- `weight` 為 1–1,000,000 的整數（布林不算）
- `return` 為字串，可為整數、小數或 `a/b`，非負、分母 ≤ 1000、值 ≤ 1000
- `5 ≤ minBet ≤ maxBet ≤ 100`
- 整份 JSON ≤ 64 KB；`display` 可省略，若有則 1–32 項、單項序列化 ≤ 2 KB
- 對 `minBet..maxBet` 的每一個整數押注，實際派彩為 `floor(bet × return)`，

  `RTP = Σ(weight × floor(bet×return)) / (Σweight × bet)` 必須 **≤ 98/100**

  單一結果返還倍數也不得超過 ×1000。

### 計算範例

猜硬幣：48 次返 2 倍、52 次返 0。

標稱 RTP = (48×2 + 52×0) / 100 = **0.96**。

因為返還是整數 2 與 0，`floor(bet × return)` 等於 `bet × return`，每個押注金額的 RTP 都是 96%，低於 98%。

若某格是 `return: "1/3"`，押 5 金幣時實際只派 `floor(5×1/3)=1`，有效倍數 0.2 而不是 0.333，**小注可能讓 RTP 看起來變高或變低**，驗證器會逐注重算，超標就拒收。

長期玩期望值為負，請在說明裡寫清楚。

## SDK API

從遊戲頁載入 `/sdk/pie-game-sdk.js`（範本用相對路徑 `../../../sdk/pie-game-sdk.js`）。一般 script 會掛 `window.PieGame`，ES module 則 `export default`。

| API | 說明 |
| --- | --- |
| `PieGame.ready()` | `Promise<{gameId, user, theme}>`。送 `pg:ready`、等 `pg:init`。不在 iframe 或 2 秒沒回應 → 獨立模式（`user=null`） |
| `PieGame.onTheme(cb)` | 主題變更（`playful`／`studio`／`classic`） |
| `PieGame.setHeight(px)` | 告訴外框 iframe 高度 |
| `PieGame.coin.onResult(cb)` | 金幣開獎。`cb({choice, outcome, display, bet, payout, net})` |
| `PieGame.coin.select(choiceId)` | 改外框目前選取的選項，**不會下注** |
| `PieGame.multiplayer.connect()` | `Promise<Client>`，連 `ws(s)://{host}/mp` |

`Client`：

| 成員 | 說明 |
| --- | --- |
| `list()` | 公開房間 |
| `create({maxPlayers, private, name})` | 建房，回 `joined` |
| `join(roomIdOrCode)` | 6 碼當私人代碼，其餘當 roomId |
| `leave()` | 離開房間 |
| `send(data, to?)` | 廣播或密語 |
| `setState(key, value)` | 僅房主 |
| `kick(playerId)` | 僅房主 |
| `on(event, cb)` | 見下 |
| `me` | `{id, username, displayName}` |
| `room` | 目前房間快照 |
| `isHost` | 是否為房主 |

事件：`joined`、`playerJoined`、`playerLeft`、`hostChanged`、`message`、`state`、`error`、`disconnected`、`reconnected`。

SDK 只接受 `event.source === window.parent` 的訊息；會自動回 `pong`；斷線用指數退避重連，並向外框要新 ticket（`pg:ticket`），成功後自動回到原房。

## 多人服務限制

- 每房最多 16 人
- 單則訊息 ≤ 16 KB
- 每連線 20 則／秒
- 伺服器重啟會清空所有房間（請自己處理斷線）
- 房主裁定規則，**不能用金幣**

## 本機開發

1. **直接開檔案**：瀏覽器打開 `index.html`。SDK 偵測不到外框會進獨立模式，`user` 為 `null`，方便調畫面。
2. **整站**：在 repo 根目錄

   ```bash
   python3 -m server.app --dev
   ```

   外框 `http://localhost:54470`，投稿內容 `http://127.0.0.1:54471`。登入需要本機的股票大亂鬥；沒有帳本時可用外框 `?mock=1` 看大廳與金幣演出。

本機檢查：

```bash
python3 tools/validate_games.py site/games/community
python3 tools/validate_games.py --vectors tests/spec_vectors.json
```

## 三種技術入門

### 純 HTML／JS

複製 `_template-free`（或金幣／多人範本），用相對路徑載入 SDK 與 CSS，不要引用 CDN。

### Phaser

在自己的專案建置，**只提交 `dist/`**（含 `index.html` 與打包後的 JS／素材）。把 `game.json` 的 `entry` 指到 `dist/index.html`。建置結果仍須通過外部網址與檔案大小檢查。

### Godot 4

匯出為 Web，選**單執行緒**（不要 SharedArrayBuffer／多執行緒）。把匯出目錄整包放進遊戲資料夾，注意單檔 25 MiB、整包 50 MB。

## 送 PR

1. Fork [Pie-ye/Pie-game](https://github.com/Pie-ye/Pie-game)，從 `main` 開分支。
2. 只改 `site/games/community/<你的 id>/` 與 `site/games/community/index.json`。
3. 把 id 加進 `index.json` 的 `games` 陣列。
4. 開 PR，勾選範本裡的清單。其他路徑會標「需要擁有者審核」。

## 審核標準

不會合併的內容包括：

- 外部資源、追蹤、廣告
- 成人或仇恨內容
- 誘導花金幣的設計（例如假裝「還差一點就回本」、隱藏 RTP、假按鈕）
- 金幣規格驗證失敗、檔案過大、id 不一致、缺少 README

通過後約數分鐘內由內容同步腳本驗證並上線。
