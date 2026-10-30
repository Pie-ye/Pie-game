// 雲端存檔同步：透過多人連線的 storage（伺服器依已驗證的帳號存放），本機 localStorage 仍是即時快取。
// 每筆資料帶 at（最後修改時間）；登入時雲端與本機比 at，新的贏。之後的修改延遲 3 秒上傳，
// 帶 ifRev 防止兩台裝置互相覆蓋：衝突時若對方比較新就採用對方的版本，否則以伺服器版本號重送。

// 伺服器每分鐘最多寫 30 次：農場最多每 4 秒一次（15 次），家園快照另外每 15 秒最多兩次（8 次）
const DEBOUNCE_MS = 4000, RETRY_MS = 15000;

/**
 * slots：{ key: { local() → 資料或 null, at(資料) → 毫秒, pack(資料) → 可 JSON 的值, unpack(值) → 資料或 null, apply(資料, 來源) } }
 * onStatus(text)：'同步中'、'已同步'、'本機（離線）'…
 */
export function createCloud(storage, slots, onStatus = () => {}) {
  const rev = {}, timers = {}, dirty = new Set();
  let ready = false, busy = 0;
  const status = () => onStatus(!storage ? '本機' : busy ? '同步中…' : dirty.size ? '等待上傳' : '已同步');

  async function pull(key) {
    const slot = slots[key];
    const remote = await storage.get(key);
    rev[key] = remote.rev || 0;
    const theirs = remote.value != null ? slot.unpack(remote.value) : null;
    const mine = slot.local();
    if (theirs && (!mine || slot.at(theirs) >= slot.at(mine))) { slot.apply(theirs, 'cloud'); return 'cloud'; }
    if (mine) { dirty.add(key); return 'local'; }
    return 'empty';
  }

  async function push(key) {
    const slot = slots[key];
    const data = slot.local();
    if (!data) { dirty.delete(key); return; }
    busy++; status();
    try {
      const r = await storage.put(key, slot.pack(data), { ifRev: rev[key] || 0 });
      rev[key] = r.rev;
      dirty.delete(key);
    } catch (err) {
      if (err && err.code === 'save_conflict') {
        const cur = err.current;
        rev[key] = cur ? cur.rev : 0;
        const theirs = cur && cur.value != null ? slot.unpack(cur.value) : null;
        if (theirs && slot.at(theirs) > slot.at(data)) { slot.apply(theirs, 'conflict'); dirty.delete(key); }
        else schedule(key, 50);                               // 我們比較新：用新的版本號重送
      } else {
        dirty.add(key);
        schedule(key, RETRY_MS);                              // 斷線或限流：稍後重試，本機已經存好了
      }
    } finally { busy--; status(); }
  }

  function schedule(key, ms = DEBOUNCE_MS) {
    dirty.add(key);
    clearTimeout(timers[key]);
    if (ready) timers[key] = setTimeout(() => push(key), ms);
    status();
  }

  return {
    /** 登入後呼叫一次：逐鍵比對雲端與本機，回傳 { key: 'cloud'|'local'|'empty'|'error' }。 */
    async start() {
      if (!storage) { status(); return {}; }
      const out = {};
      busy++; status();
      for (const key of Object.keys(slots)) {
        try { out[key] = await pull(key); } catch (_e) { out[key] = 'error'; dirty.add(key); }
      }
      busy--;
      ready = true;
      for (const key of dirty) schedule(key, 200);
      status();
      return out;
    },
    /** 資料改了（本機已存）：排程上傳。 */
    changed(key) { if (storage) schedule(key); },
    /** 斷線重連後補傳。 */
    resume() { if (storage && ready) for (const key of [...dirty]) schedule(key, 500); },
    get pending() { return dirty.size; },
  };
}
