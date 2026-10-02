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

## 範例遊戲

- `snake` 貪吃蛇（一般）
- `coin-flip` 猜硬幣（金幣）
- `lucky-wheel` 幸運轉盤（金幣）
- `tic-tac-toe` 井字棋（多人）

## 授權

MIT。投稿即表示同意以 MIT 授權你送進本 repo 的檔案。
