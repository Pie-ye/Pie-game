# Pie Game

本機架設的遊戲平台：大廳與官方遊戲在 **https://game.coinpilet.win**，投稿遊戲與多人服務在 **https://play.piea.uk**。帳號與金幣來自股票大亂鬥（https://coinpilet.win）。授權 MIT。

想投稿請看 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 架構

```
瀏覽器
├── https://game.coinpilet.win     外框：登入、大廳、下注列、官方遊戲
│     └── fetch → https://coinpilet.win  （帳號／金幣／community 開獎）
└── iframe https://play.piea.uk/games/community/<id>/
      └── wss://play.piea.uk/mp        平台多人服務
```

投稿遊戲與登入網域不同，拿不到 cookie，也不能自己呼叫下注 API。金幣遊戲的按鈕只存在外框。

```
Pie-game/
├── server/                 外框＋內容兩個埠、/mp WebSocket
├── site/shell/             外框前端
├── site/sdk/               投稿用 PieGame SDK
├── site/games/community/   投稿遊戲（含範本與範例）
├── tools/validate_games.py CI 與上線前驗證
└── scripts/sync_content.sh 內容自動上線
```

## 本機開發

Python 3.12，依賴見 `requirements.txt`。

```bash
python3 -m pip install -r requirements-dev.txt
python3 -m server.app --dev
```

- 外框：http://localhost:54470
- 投稿內容＋多人：http://127.0.0.1:54471

開發模式兩個 origin 不同，用來模擬正式的跨網域 iframe。不要對 compose 跑 `docker compose up` 做日常開發。

檢查投稿：

```bash
python3 tools/validate_games.py site/games/community
python3 tools/validate_games.py --vectors tests/spec_vectors.json
python3 -m pytest tools/tests -q
```

## 維護者：規格驗證與上游同步

`tools/validate_games.py` 開頭的 `validate_spec`／`rtp_for_bet` 是從股票大亂鬥
`server/casino/community.py` **整段複製**的，兩邊判定必須一字不差，否則 CI 放行的投稿
可能在開獎時被伺服器拒絕。

改上游規則時：

1. 把上游新版的 `validate_spec`／`rtp_for_bet` 複製過來。
2. 更新 `tools/upstream_validate_spec.sha256` 的 `commit` 與兩個 `sha256`
   （正規化方式＝`ast.unparse` 後取 sha256，註解與排版不影響）。
3. 讓 `tests/spec_vectors.json` 與上游 `tests/fixtures/community_spec_vectors.json` 保持同一份內容。
4. `python3 -m pytest tools/tests -q`：雜湊不一致會直接失敗並提示同步；
   本機有上游時還會逐向量比對兩邊 `validate_spec` 的判定。

## 內容自動上線

主機目錄固定長這樣（`scripts/sync_content.sh` 每 5 分鐘跑一次）：

```
~/pie-game-content/
├── repo/                 只追 origin/main 的 clone
├── releases/<sha>/site/  只含 games/community 與 sdk
└── live -> releases/<sha>（相對符號連結，首次部署前不存在）
```

compose 唯讀掛**整個** `~/pie-game-content`，`PG_CONTENT_DIR=/srv/pie-content/live/site`：
Docker 只在容器啟動時解析一次 bind 來源，綁 `live` 連結本身的話之後的切換永遠進不來。
伺服器每個請求重新解析 live，`live` 不存在時內容路由回 503 `content_unavailable`，
`/healthz` 仍是 200 但帶 `"content": false`。

驗證用的是**平台自己那份** `tools/validate_games.py`（`VALIDATOR`，預設
`/home/pieye/Container/Pie-game/tools/validate_games.py`），不會執行剛抓下來的內容裡的腳本。

## 範例遊戲

- `snake` 貪吃蛇（一般）
- `coin-flip` 猜硬幣（金幣）
- `lucky-wheel` 幸運轉盤（金幣）
- `tic-tac-toe` 井字棋（多人）

## 授權

MIT。投稿即表示同意以 MIT 授權你送進本 repo 的檔案。
