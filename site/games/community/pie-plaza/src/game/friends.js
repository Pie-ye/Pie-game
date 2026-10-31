// 鎮民好感：名單與喜好（和伺服器 server/games/friends.py 一致）、依心數多出來的台詞、收禮反應。
// byName：地圖上的 NPC 用名字對到好感鍵（同一個人出現在不同地圖也算同一份好感）。
export const FRIENDS = {
  grandpa: { name: '皮爺爺', loves: ['pie_pumpkin', 'fish_catfish'], likes: ['wheat', 'carrot', 'pie_carrot'],
    tiers: [['年輕人，常來坐坐。'], ['你種的小麥長得真好，跟我年輕時一樣。'], ['這間店是我爸爸傳下來的，以後……說不定交給你？哈哈。']] },
  mary: { name: '瑪莉', loves: ['pie_strawberry', 'strawberry'], likes: ['wheat', 'pie_beet', 'pie_carrot'],
    tiers: [['麵包要趁熱吃喔！'], ['你烤的派越來越像樣了，我教你一個訣竅：奶油要冰的。'], ['我最大的夢想是開一間全鎮最大的派餅店，你會來幫忙嗎？']] },
  chubby: { name: '阿胖', loves: ['pie_tomato', 'fish_tuna'], likes: ['beet', 'tomato', 'pie_pumpkin'],
    tiers: [['今天的特餐是甜菜湯！'], ['你上次送的那個，我加進新菜單了。'], ['你是我的頭號常客，以後來吃飯都算你半價——開玩笑的！']] },
  clint: { name: '克林', loves: ['stone', 'fish_puffer'], likes: ['wood', 'pie_carrot'],
    tiers: [['……'], ['石頭的紋路很美，你看得出來嗎？'], ['……謝謝你常來。我不太會說話，但我很高興。']] },
  robin: { name: '蘿蘋', loves: ['wood', 'pie_strawberry'], likes: ['fiber', 'pumpkin'],
    tiers: [['需要木頭的話，自己砍比較便宜喔！'], ['派派新區的工程我也有幫忙設計！'], ['等新區蓋好，我想在那邊蓋一間大木屋給大家用。']] },
  doc: { name: '哈醫生', loves: ['pie_beet', 'fish_trout'], likes: ['carrot', 'beet'],
    tiers: [['記得多喝水。'], ['你的小動物很健康，看得出來你很疼牠。'], ['我年輕時想當獸醫，繞了一大圈，現在總算如願了。']] },
  nicole: { name: '妮可', loves: ['fish_golden', 'pie_strawberry'], likes: ['strawberry', 'tomato'],
    tiers: [['交易所營業時間是 9 點到 4 點。'], ['小道消息：釣魚大賽的時候 FISH 指數常常會漲。'], ['我叔叔是鎮長，可是我想靠自己的本事，你懂嗎？']] },
  mayor: { name: '路易斯鎮長', loves: ['pie_pumpkin', 'pumpkin'], likes: ['fish_bass', 'pie_tomato'],
    tiers: [['派派鎮歡迎你！'], ['多虧大家，派派新區一天比一天熱鬧。'], ['我老了，總有一天要找人接棒。你覺得你適合當鎮長嗎？']] },
  kid: { name: '小傑', loves: ['strawberry', 'pie_strawberry'], likes: ['fish_sardine', 'carrot'],
    tiers: [['你要跟我玩嗎？'], ['我跟你說一個秘密：大胃王蛙其實很怕癢！'], ['你是我最好的大人朋友！長大我也要像你一樣厲害！']] },
  granny: { name: '艾芙琳奶奶', loves: ['pie_carrot', 'fish_carp'], likes: ['pie_pumpkin', 'wheat'],
    tiers: [['哎呀，是你啊。'], ['我年輕的時候，派派鎮只有一條街和一口井呢。'], ['孩子，你讓這個小鎮又熱鬧起來了，奶奶很感謝你。']] },
  sam: { name: '山姆', loves: ['fish_shrimp', 'pie_tomato'], likes: ['tomato', 'fish_octopus'],
    tiers: [['今天的水果很新鮮！'], ['我的樂團缺一個鼓手，你有興趣嗎？'], ['等煙火台蓋好，我想在煙火底下開一場演唱會！']] },
  foreman: { name: '工頭阿土', loves: ['pie_pumpkin', 'stone'], likes: ['wood', 'fiber'],
    tiers: [['工地危險，別亂跑！'], ['你捐的東西我都記在本子上了。'], ['蓋房子最開心的，是看大家搬進去住的那一天。']] },
};
export const BY_NAME = Object.fromEntries(Object.entries(FRIENDS).map(([k, f]) => [f.name, k]));
export const HEART_TIERS = [2, 4, 6, 8, 10];

/** 依心數多出的那一句（0–3 心第一段、4–7 第二段、8 以上第三段）。 */
export function tierLine(id, hearts) {
  const f = FRIENDS[id];
  if (!f) return null;
  const i = hearts >= 8 ? 2 : hearts >= 4 ? 1 : 0;
  return f.tiers[i][0];
}

export function tasteOf(id, item) {
  const f = FRIENDS[id];
  return !f ? 'ok' : f.loves.includes(item) ? 'love' : f.likes.includes(item) ? 'like' : 'ok';
}

export const REACTION = {
  love: (n) => `哇！這是我最喜歡的！謝謝你！（${n}好開心）`,
  like: (n) => `謝謝，我很喜歡。（${n}笑了）`,
  ok: (n) => `喔，謝謝你。（${n}收下了）`,
};
