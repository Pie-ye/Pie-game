// 派派鎮：大廳（廣場）＋商店街＋個人農場與小屋。負責輸入、區域切換、主迴圈與畫面；
// 遊戲規則與資料全部在伺服器（server/games/plaza.py）。前端只送操作、套用伺服器的回覆與推播。
// 沒登入時改用本機沙盒（game/api.js，同一套規則，不存檔）。
import {
  TILE, VIEW, DIR_VEC, LOG_MAX, HEAR_DIST, cleanText, canSend, stepMove, stepToward, dirOf, facingTile, tileOf, cameraFor,
} from './logic.js';
import { getMap } from './maps/index.js';
import { syncFarm } from './maps/farm.js';
import { KIND } from './engine/grid.js';
import { loadImages } from './engine/sprites.js';
import { drawWorld, setScale } from './engine/render.js';
import { createAudio } from './audio.js';
import { connectPlaza, errText } from './net.js';
import { createDialog } from './ui/dialog.js';
import { createHud } from './ui/hud.js';
import { openDecor, openHouseDesign, openSeedShop, openEventBoard, closePanel, panelOpen } from './ui/panels.js';
import { openCreator, creatorOpen } from './ui/creator.js';
import { showFishing, hideFishing, drawFishing } from './ui/fishingUI.js';
import { openMarket } from './ui/market.js';
import { openExchange } from './ui/exchange.js';
import { openVisitPanel, openVisitorMenu, openMailbox, openPlayerCard, openEmotes } from './ui/social.js';
import { TOOLS, CROPS, useTool, debrisLeft, CROP_KEYS } from './farm/state.js';
import { furniture, canPlace, placeAt, itemAt, sanitizeDecor } from './house/catalog.js';
import { defaultLook, sanitizeLook } from './avatar/look.js';
import { FISH, newMinigame, stepMinigame, fishName } from './fish/fishing.js';
import { activeEvents, eventById, daylight } from './events/schedule.js';
import { eventObjects } from './events/effects.js';
import { isFriend, readMail, readCard, today, EMOTES, NOTE_MAX, itemName } from './social/home.js';
import { createServerApi, createLocalApi } from './game/api.js';
import { playerFarm, fieldFromPacked, applyMine, applyTiles } from './game/mirror.js';
import { decorData } from './store.js';

const $ = (id) => document.getElementById(id);
const infoEl = $('room-info'), titleEl = $('room-title'), logEl = $('log'), canvas = $('world'), ctx = canvas.getContext('2d');
const BUBBLE_MS = 6000, POS_TICK_MS = 100, POS_IDLE_MS = 1000, MOVING_MS = 260, NPC_SPEED = 26;
const VW = VIEW.w * TILE, VH = VIEW.h * TILE;

const audio = createAudio();
const dialog = createDialog();
const hud = createHud({ onSelect: (i) => selectTool(i) });

let scene = null, net = null, api = createLocalApi(), myId = 'guest', myName = '我';
let map = null, area = 'plaza';
const me = { id: 'guest', x: 240, y: 200, dir: 0, moving: false, bubble: '', bubbleAt: 0, acting: 0, look: null };
let farm = null, decor = null, social = { open: true, friends: [], coop: [], likes: 0, liked: {} };
let tool = 0, edit = null, hover = null, fishing = null, holding = false;
let target = null, warpLock = 0, warping = false, lastChat = -1e9, lastSent = null, lastSentAt = 0, lastArea = null;
let events = [], mails = [], ready = false;
const visits = new Map();      // 拜訪中的家園：owner -> { farm, decor, look, name, likes, role }
const people = new Map();      // 其他玩家：id -> { id, name, look, x, y, tx, ty, area, dir, moving, movedAt, bubble, bubbleAt, seen, lastStep }

// ---------- 聊天紀錄（一律 textContent，不吃 HTML） ----------
function addLog(text, who, cls) {
  const li = document.createElement('li');
  if (cls) li.className = cls;
  if (who) { const b = document.createElement('span'); b.className = 'who'; b.textContent = `${who}：`; li.append(b); }
  li.append(document.createTextNode(text));
  logEl.append(li);
  while (logEl.children.length > LOG_MAX) logEl.firstChild.remove();
  logEl.scrollTop = logEl.scrollHeight;
}
const sys = (t) => addLog(t, '', 'sys');
function updateInfo(extra) {
  titleEl.textContent = map ? map.title : '派派鎮';
  infoEl.textContent = extra || (net ? `${net.count} 人在線` : '訪客試玩（登入後才會存檔、看得到別人）');
}
function refreshHud() {
  if (!farm) return;
  hud.inventory(farm.inv); hud.gold(farm.gold); hud.seed(farm.seedSel, farm.seeds[farm.seedSel] || 0);
}
const serverEl = $('cloud');
const serverStatus = (t) => { if (serverEl) serverEl.textContent = t; };
/** 呼叫伺服器；失敗時顯示伺服器給的訊息。 */
async function call(op, data, { quiet } = {}) {
  try { return await api.call(op, data); } catch (e) {
    if (!quiet) { hud.toast(e.msg || errText(e)); audio.tool('nope'); }
    throw e;
  }
}

// ---------- 畫面大小：整數倍放大 ----------
function fit() {
  const stage = document.querySelector('.stage');
  const w = stage.clientWidth - 8, h = stage.clientHeight - 8;
  const k = Math.max(1, Math.floor(Math.min(w / VW, h / VH)));
  setScale(k);
  canvas.width = VW * k; canvas.height = VH * k;
  canvas.style.width = `${canvas.width}px`; canvas.style.height = `${canvas.height}px`;
}
new ResizeObserver(fit).observe(document.querySelector('.stage'));

// ---------- 定時活動 ----------
const isOn = (id) => events.includes(id);
function applyEvents(m) {
  const objs = eventObjects(m.id, events);
  m.eventObjects = objs;
  if (!m.farm) m.dynamic = objs.filter((o) => o.foot).map((o) => ({ x0: o.x - o.foot[0] / 2, x1: o.x + o.foot[0] / 2, y0: o.y - o.foot[1], y1: o.y }));
}
function checkEvents(first) {
  const now = activeEvents().map((e) => e.id);
  const started = now.filter((id) => !events.includes(id));
  const changed = started.length || now.length !== events.length;
  events = now;
  if (!changed && !first) return;
  if (map) applyEvents(map);
  const names = events.map((id) => `${eventById(id).icon} ${eventById(id).name}`);
  hud.badge(names.length ? `進行中：${names.join('、')}` : '');
  for (const id of started) {
    const e = eventById(id);
    sys(first ? `${e.icon} ${e.name}正在進行：${e.desc}` : `${e.icon} ${e.name}開始了！${e.desc}`);
    if (!first) hud.toast(`${e.icon} ${e.name}開始了！`, 3000);
  }
}

// ---------- 區域 ----------
const personal = (kind) => `${kind}:${myId}`;
/** 'farm:123' → '123'；共用地圖回傳 null。 */
const ownerOf = (a) => (/^(farm|house):/.test(a) ? a.slice(a.indexOf(':') + 1) : null);
const atHome = () => !!map && map.owner === myId;
const visiting = () => !!map && !!map.owner && map.owner !== myId;
const myRole = () => (atHome() ? 'owner' : visiting() ? (visits.get(map.owner) || {}).role : null);
function prepNpcs(m) {
  for (const n of m.npcs) {
    n.npc = true; n.moving = false; n.home = n.home || { x: n.x, y: n.y };
    n.next = n.next || performance.now() + 1000 + Math.random() * 3000;
  }
}
function toolAllowed(t) {
  if (!map) return false;
  if (map.farm) {
    const role = myRole();
    if (role === 'owner' || role === 'coop') return t !== 'hammer';
    return t === 'wateringcan' || t === 'rod';
  }
  if (map.id === 'plaza') return t === 'rod';
  return map.id === personal('house') && t === 'hammer';
}
/** opts.rebuild：同一區重建（不算換區）；opts.viewed：已經向伺服器 view 過了。 */
function loadArea(a, entry, opts = {}) {
  const owner = ownerOf(a), host = owner && owner !== myId ? visits.get(owner) : null;
  if (owner && owner !== myId && !host) { hud.toast('要先從「拜訪」選單進去'); return false; }
  const m = getMap(a, { decor: host ? host.decor : decor });
  if (!m) { sys(`找不到地區：${a}`); return false; }
  if (!m.shared) m.version = Date.now();
  if (m.farm) syncFarm(m, host ? host.farm : farm);
  if (host) {
    m.title = `${host.name}的${m.farm ? '農場' : '小屋'}`;
    m.signs = m.signs.map((t) => (t.action === 'houseDesign' ? { ...t, title: `${host.name}的信箱`, lines: [`這是${host.name}的家。要留言、稱讚或送禮嗎？`], action: 'visitor' }
      : t.action === 'ship' ? { ...t, title: '出貨箱', lines: [`${host.name}的出貨箱。`], action: null } : t));
  }
  prepNpcs(m);
  applyEvents(m);
  const moved = !opts.rebuild && a !== area, wasOwner = ownerOf(area);
  map = m; area = a;
  const e = (entry && m.entries[entry]) || Object.values(m.entries)[0];
  me.x = e.x; me.y = e.y; me.dir = e.dir; me.moving = false;
  target = null; warpLock = performance.now() + 400;
  stopFishing();
  if (edit && moved) stopEdit();
  hud.enable(toolAllowed);
  updateInfo();
  sendPose(undefined, true);
  // 伺服器推播只送給「正在看」這塊地的人
  if (api.server && moved && !opts.viewed) {
    if (owner) { if (owner !== wasOwner) call('view', { owner }, { quiet: true }).then((r) => onView(owner, r)).catch(() => {}); }
    else if (wasOwner) call('leave', {}, { quiet: true }).catch(() => {});
  }
  return true;
}
async function goArea(to, entry, opts) {
  if (warping) return;
  warping = true;
  audio.tool('door');
  $('fade').classList.add('on');
  await new Promise((r) => setTimeout(r, 180));
  loadArea(to, entry, opts);
  $('fade').classList.remove('on');
  warping = false;
}
const warpTo = (w) => goArea(w.to === 'farm' ? personal('farm') : w.to, w.entry);
/** 小屋外觀或裝潢改了：重建目前地圖但保留位置。 */
function rebuildHere() {
  const keep = { x: me.x, y: me.y, dir: me.dir };
  loadArea(area, null, { rebuild: true });
  Object.assign(me, keep);
  if (map.blocked(me.x, me.y)) { const e = map.entries.door || Object.values(map.entries)[0]; me.x = e.x; me.y = e.y; }
}
/** 伺服器回覆的家園資料（自己或別人）。 */
function onView(owner, r) {
  if (!r || !r.home) return;
  if (owner === myId) {
    const f = fieldFromPacked(r.home.farm, owner);
    Object.assign(farm, f);
    if (map && map.owner === myId && map.farm) syncFarm(map, farm);
    return;
  }
  const h = r.home;
  visits.set(owner, { farm: fieldFromPacked(h.farm, owner), decor: sanitizeDecor({ v: 1, ...h.decor }), look: sanitizeLook(h.look), name: cleanText(h.name, 20) || '鎮民', likes: h.likes | 0, role: r.role, coop: h.coop });
}

// ---------- 工具與互動 ----------
function selectTool(i) {
  if (i < 0 || i >= TOOLS.length) return;
  tool = i; hud.select(i);
  if (TOOLS[i] === 'hammer' && map && map.id === personal('house')) startEdit();
  else if (edit) stopEdit();
}
const SOUND = { weed: 'swish', stone: 'pick', twig: 'chop', stump: 'chop' };
function playResult(r) {
  if (r.hit) audio.tool(SOUND[r.hit]);
  else if (r.cleared) audio.tool(r.cleared === 'stone' ? 'break' : SOUND[r.cleared]);
  else if (r.till) audio.tool('dig');
  else if (r.water) audio.tool('water');
  else if (r.plant) audio.tool('plant');
  else if (r.harvest) audio.tool('harvest');
  else if (!r.ok) audio.tool('nope');
}
async function act(tx, ty) {
  const t = TOOLS[tool];
  if (t === 'rod') { castRod(); return; }
  if (!map.farm) {
    if (t === 'hammer' && map.id === personal('house')) { startEdit(); return; }
    hud.toast(map.id === 'plaza' ? '在廣場只能釣魚（選 6 釣竿）' : '這裡不能用工具'); return;
  }
  if (!toolAllowed(t)) { hud.toast('這是別人的農場：可以幫忙澆水或在池塘釣魚，被邀請共同耕作後才能用其他工具'); return; }
  me.acting = performance.now() + 220;
  const owner = map.owner, target = owner === myId ? farm : visits.get(owner).farm;
  // 自己的田先在畫面上預測（手感），伺服器回覆後以伺服器為準
  let predicted = null;
  if (owner === myId) {
    const copy = JSON.parse(JSON.stringify(farm));
    predicted = useTool(copy, t, tx, ty, Date.now());
    playResult(predicted);
    if (predicted.msg) hud.toast(predicted.msg);
  }
  let r;
  try { r = await api.call('tool', { owner, tool: t, x: tx, y: ty }); } catch (e) { hud.toast(e.msg || '連線不穩，這下沒有成功'); return; }
  applyTiles(target, r.tile);
  applyMine(farm, r);
  if (!predicted) { playResult(r.result); if (r.result.msg) hud.toast(r.result.msg); }
  else if (predicted.ok !== r.result.ok && r.result.msg) hud.toast(r.result.msg);
  if (map.owner === owner) syncFarm(map, target);
  refreshHud();
  if (owner === myId && r.result.cleared && debrisLeft(farm) === 0) hud.toast('田地清乾淨了！可以開始耕種了', 3000);
}
function linesFor(t) {
  const ev = t.event && events.find((id) => t.event[id]);
  return ev ? [...t.event[ev], ...t.lines] : t.lines;
}
function interact() {
  if (dialog.open) { dialog.next(); return true; }
  const t = map.interactAt(me);
  if (!t) return false;
  audio.tool('talk');
  const ev = t.eventAction && events.find((id) => t.eventAction[id]);
  const action = ev ? t.eventAction[ev] : t.action;
  if (t.npc) {
    t.dir = [1, 0, 3, 2][me.dir]; t.talking = true; t.moving = false; t.goal = null;
    dialog.show({ name: t.name, sprite: t.sprite }, linesFor(t), () => { t.talking = false; doAction(action); });
  } else {
    dialog.show({ name: t.title }, t.lines, () => doAction(action));
  }
  return true;
}
async function buyAt(k, n, _price, market) {
  try {
    const r = await call('buy', { crop: k, n, market: !!market });
    applyMine(farm, r); refreshHud(); audio.tool('harvest'); hud.toast(r.msg);
  } catch (_e) { /* 已提示 */ }
}
function doAction(action) {
  if (!action) return;
  if (action === 'shop') openSeedShop('皮爺爺雜貨店', () => farm.gold, (k, n, p) => buyAt(k, n, p, false), 1);
  else if (action === 'market') openSeedShop('山姆的早市攤（八折）', () => farm.gold, (k, n, p) => buyAt(k, n, p, true), 0.8);
  else if (action === 'flea') openFlea();
  else if (action === 'exchange') openXchg();
  else if (action === 'houseDesign') openDesign();
  else if (action === 'events') openEventBoard(Date.now());
  else if (action === 'visitor') openVisitor();
  else if (action === 'wish') wish();
  else if (action === 'show') showMenu();
  else if (action === 'ship') ship();
}
async function ship() {
  try {
    const r = await call('ship');
    applyMine(farm, r); refreshHud();
    if (!r.total) { hud.toast('背包裡沒有可以出貨的作物或魚'); return; }
    audio.tool('harvest'); sys(`出貨 ${r.sold.map(([k, n]) => `${itemName(k)}×${n}`).join('、')}，得到 ${r.total} G`);
    hud.toast(`+${r.total} G`, 2500);
  } catch (_e) { /* 已提示 */ }
}
async function saveDecorToServer() {
  try { const r = await call('decor', { decor: decorData(decor) }); decor = sanitizeDecor({ v: 1, ...r.decor }); } catch (_e) { /* 已提示 */ }
}
function openDesign() {
  openHouseDesign(decor, async (p) => {
    if (p.style) decor.style = p.style;
    if (p.roof != null) decor.ext.roof = p.roof;
    if (p.wall != null) decor.ext.wall = p.wall;
    if (p.yard) decor.ext.yard[p.yard[0]] = p.yard[1];
    if (map.farm && atHome()) rebuildHere(); else hud.toast('改好了，回農場看看吧！');
    await saveDecorToServer();
  }, null);
}

// ---------- 跳蚤市場 ----------
function openFlea() {
  if (!api.server) { hud.toast('登入後才能逛跳蚤市場'); return; }
  openMarket({
    list: async () => (await call('market', {}, { quiet: true })).items,
    buy: async (id) => { const r = await api.call('purchase', { id }); applyMine(farm, r); refreshHud(); audio.tool('harvest'); sys(`🛒 買到 ${itemName(r.bought.item)} ×${r.bought.n}（${r.bought.price} G，賣家 ${r.bought.sellerName}）`); },
    sell: async (item, n, price) => { const r = await api.call('sell', { item, n, price }); applyMine(farm, r); refreshHud(); audio.tool('plant'); },
    unlist: async (id) => { const r = await api.call('unlist', { id }); applyMine(farm, r); refreshHud(); },
  }, { id: myId, farm });
}

function openXchg() {
  openExchange({
    quote: async () => {
      const r = await call('quote', {}, { quiet: true });
      applyMine(farm, r); refreshHud();
      return r;
    },
    trade: async (side, ticker, n) => {
      const r = await call('trade', { side, ticker, n });
      applyMine(farm, r); refreshHud();
      audio.tool(side === 'buy' ? 'plant' : 'harvest');
      return r;
    },
  }, { guest: !api.server });
}

// ---------- 地標：菲比女神噴水池、瑞吉海獅秀 ----------
async function wish() {
  try {
    const r = await call('wish');
    applyMine(farm, r); refreshHud();
    audio.tool('harvest'); audio.voice('phoebe');
    const rw = r.reward;
    const text = rw.kind === 'gold' ? `女神回應了！得到 ${rw.n} G` : rw.kind === 'seed' ? `女神送你 ${CROPS[rw.item].name}種子 ×${rw.n}` : rw.kind === 'fish' ? '池底閃閃發光……撈到一條金色鯉魚！' : '硬幣沉進池底，女神靜靜地微笑著。';
    hud.toast(`✨ ${text}`, 3000); sys(`⛲ ${text}`);
    me.emote = { n: 29, until: performance.now() + 2600 };
  } catch (_e) { /* 已提示 */ }
}
function showMenu() {
  const fish = Object.entries(farm.inv).filter(([k, n]) => k.startsWith('fish_') && n > 0);
  if (!fish.length) { hud.toast(isShowTime() ? '瑞吉正在表演！帶條魚來餵牠會有回禮喔' : '瑞吉在休息。表演時間看公告欄'); return; }
  const [k] = fish.sort((a, b) => a[0].localeCompare(b[0]))[0];
  feedReggie(k);
}
async function feedReggie(item) {
  try {
    const r = await call('feed', { item });
    applyMine(farm, r); refreshHud();
    audio.voice('reggie'); reggieReact = performance.now() + 2400;
    if (net) net.send({ k: 'r' });
    const rw = r.reward;
    hud.toast(`🦭 瑞吉吃了${itemName(item)}，回送你 ${CROPS[rw.item].name}種子 ×${rw.n}！`, 3000);
  } catch (_e) { /* 已提示 */ }
}
let reggieReact = 0;
const isShowTime = () => isOn('reggie');
/** 每格畫面更新瑞吉的動作（表演中輪播、有人餵魚時跳起來）。 */
function animateLandmarks(now) {
  if (!map || map.id !== 'plaza') return;
  const reggie = map.objects.find((o) => o.reggie);
  if (!reggie) return;
  if (now < reggieReact) reggie.k = Math.floor(now / 300) % 2 ? 'reggieJump' : 'reggieBark';
  else if (isShowTime()) reggie.k = ['reggieIdle', 'reggieBark', 'reggieBall', 'reggieBall', 'reggieJump', 'reggieIdle'][Math.floor(now / 900) % 6];
  else reggie.k = 'reggieIdle';
  if (isShowTime() && Math.floor(now / 9000) !== Math.floor((now - 16) / 9000) && Math.hypot(me.x - reggie.x, me.y - reggie.y) < 140) audio.voice('reggie');
}

// ---------- 釣魚（伺服器抽魚與計時） ----------
async function castRod() {
  const where = map.id === 'plaza' ? 'sea' : map.farm ? 'pond' : null;
  if (!where) { hud.toast('這裡沒有地方釣魚'); return; }
  if (fishing) return;
  const { tx, ty } = tileOf(me.x, me.y - 2), [dx, dy] = DIR_VEC[me.dir];
  for (let k = 1; k <= 3; k++) {
    if (map.grid.get(tx + dx * k, ty + dy * k) === KIND.WATER) {
      const spot = { x: (tx + dx * k) * TILE + 8, y: (ty + dy * k) * TILE + 9 };
      fishing = { phase: 'casting', where, ...spot, sx: me.x, sy: me.y };
      me.acting = performance.now() + 300; audio.tool('swish');
      try {
        const r = await call('cast', { where });
        if (!fishing) return;
        Object.assign(fishing, { phase: 'wait', cast: r.cast, diff: r.diff, contest: r.contest, until: performance.now() + r.bite });
      } catch (_e) { stopFishing(); }
      return;
    }
  }
  hud.toast('面向水邊才能釣魚'); audio.tool('nope');
}
function stopFishing() { fishing = null; hideFishing(); }
function hookFish() {
  fishing = { ...fishing, phase: 'game', game: newMinigame({ diff: fishing.diff }) };
  showFishing();
}
async function landFish(ok) {
  const f = fishing; stopFishing();
  try {
    const r = await call('land', { cast: f.cast, ok });
    applyMine(farm, r); refreshHud();
    const fish = FISH.find((x) => x.id === r.fish) || { name: r.fish };
    if (!r.caught) { hud.toast(`${fish.name}溜走了…`); audio.tool('nope'); return; }
    if (fish.junk) { hud.toast('釣到一隻舊靴子……'); audio.tool('nope'); return; }
    audio.tool('harvest'); hud.toast(`釣到 ${fish.name}（${r.size} 公分）！`, 2500);
    if (r.contest) { sys(`🎣 你釣到了 ${fish.name}（${r.size} 公分）`); if (net) net.send({ k: 'f', f: fish.id, s: r.size }); }
  } catch (_e) { /* 已提示 */ }
}
function updateFishing(now, dt) {
  if (!fishing) return;
  if (Math.hypot(me.x - fishing.sx, me.y - fishing.sy) > 2) { stopFishing(); return; }
  if (fishing.phase === 'wait' && now > fishing.until) { fishing.phase = 'bite'; fishing.biteUntil = now + 1000; audio.tool('pick'); }
  else if (fishing.phase === 'bite' && now > fishing.biteUntil) { hud.toast('魚跑掉了，再試一次'); landFish(false); }
  else if (fishing.phase === 'game') {
    const g = stepMinigame(fishing.game, dt, holding);
    drawFishing(g);
    if (g.done) landFish(g.done === 'caught');
  }
}
/** 空白鍵／點擊：咬鉤時提竿，小遊戲中當作按住。 */
function fishingPress() {
  if (!fishing) return false;
  if (fishing.phase === 'bite') { hookFish(); return true; }
  if (fishing.phase === 'wait' || fishing.phase === 'casting') { stopFishing(); return true; }
  return fishing.phase === 'game';
}

// ---------- 裝潢 ----------
function startEdit() {
  if (edit) return;
  edit = { sel: 'remove' };
  openDecor(decor, {
    pickItem: (k) => { edit && (edit.sel = k); },
    pickFloor: (k) => { decor.floor = k; rebuildHere(); saveDecorToServer(); },
    pickWall: (k) => { decor.wall = k; rebuildHere(); saveDecorToServer(); },
  }, () => { edit = null; });
  hud.toast('裝潢模式：點房間擺放或拿起家具');
}
function stopEdit() { edit = null; if (panelOpen()) closePanel(); }
function editClick(tx, ty) {
  if (edit.sel === 'remove') {
    const it = itemAt(decor.items, tx, ty);
    if (!it) return;
    decor.items = decor.items.filter((x) => x !== it);
    audio.tool('dig');
  } else {
    const f = furniture(edit.sel);
    const ox = tx - Math.floor((f.w - 1) / 2), oy = ty - (f.h - 1);
    if (!canPlace(decor.items, f.k, ox, oy)) { audio.tool('nope'); hud.toast('這裡放不下'); return; }
    decor.items.push(placeAt(f, ox, oy));
    audio.tool('plant');
  }
  rebuildHere();
  saveDecorToServer();
}

// ---------- 捏臉 ----------
function openLook(first) {
  openCreator(scene, me.look || defaultLook(myId), (l) => {
    me.look = l;
    call('look', { look: l }).catch(() => {});
    if (net) net.send({ k: 'l', l });
    hud.toast(first ? '歡迎來到派派鎮！' : '換好造型了！');
  }, { first });
}

// ---------- 社交：拜訪、共耕、信箱、表情 ----------
async function visit(owner, name) {
  if (!api.server) { hud.toast('登入後才能拜訪別人的家'); return; }
  if (owner === myId) { goArea(personal('farm'), 'door'); return; }
  hud.toast(`前往${name || '鎮民'}的家…`);
  try {
    const r = await call('view', { owner });
    onView(owner, r);
    await goArea(`farm:${owner}`, 'east', { viewed: true });
    const h = visits.get(owner);
    sys(`🏡 你來到了${h.name}的農場。${h.role === 'coop' ? '你是共同耕作夥伴，所有農具都能用！' : '在信箱前按 E 可以留言、稱讚或送禮，也可以幫忙澆水。'}`);
  } catch (_e) { /* 已提示（例如沒有開放） */ }
}
async function refreshVisit(owner) {
  if (ownerOf(area) !== owner) return;
  try { onView(owner, await call('view', { owner }, { quiet: true })); rebuildHere(); hud.enable(toolAllowed); } catch (e) {
    if (e.code === 'home_closed') { hud.toast('主人關閉了家園，送你回廣場'); goArea('plaza', 'center'); }
  }
}
function openVisitor() {
  const owner = map.owner, host = visits.get(owner);
  if (!host || !net) return;
  openVisitorMenu(scene, { id: owner, name: host.name, look: host.look, likes: host.likes, coop: host.role === 'coop' }, farm.inv, {
    canLike: social.liked[owner] !== today(),
    isFriend: (id) => isFriend(social, id),
    onFriend: () => setFriend(owner, host.name, !isFriend(social, owner)),
    onLike: () => { call('like', { owner }).then((r) => { social.liked[owner] = today(); host.likes = r.likes; hud.toast('👍 已稱讚！'); audio.tool('harvest'); }).catch(() => {}); },
    onNote: (text) => { const t = cleanText(text, NOTE_MAX); if (!t) return; net.mail.send(owner, 'note', { text: t }).then(() => hud.toast('✉ 留言已投進信箱')).catch((e) => hud.toast(e.code === 'mail_rate_limited' ? '寄太多了，等一下再寄' : '留言沒送出')); },
    onGift: (k) => {
      if (!(farm.inv[k] > 0)) return false;
      farm.inv[k] -= 1; if (!farm.inv[k]) delete farm.inv[k];
      call('gift', { to: owner, item: k }).then((r) => { applyMine(farm, r); refreshHud(); hud.toast('🎁 送出了！'); audio.tool('harvest'); })
        .catch(() => { farm.inv[k] = (farm.inv[k] || 0) + 1; refreshHud(); });
      return true;
    },
  });
}
function setFriend(id, name, on) {
  social.friends = social.friends.filter((f) => f.id !== id);
  if (on) social.friends.push({ id, name });
  call('social', { friend: id, name, on }, { quiet: true }).then((r) => { social = r.social; }).catch(() => {});
  return on;
}
async function setCoop(id, name, on) {
  try {
    const r = await call('social', { coop: id, on });
    social = r.social;
    hud.toast(on ? `🤝 已邀請${name}共同耕作` : `已取消和${name}共同耕作`);
    return social.coop.includes(id);
  } catch (_e) { return social.coop.includes(id); }
}
async function loadMail() {
  if (!net || !net.mail) return;
  try { mails = (await net.mail.list()).map(readMail).filter(Boolean); } catch (_e) { return; }
  const b = $('mail-badge'); b.textContent = mails.length ? String(mails.length) : ''; b.hidden = !mails.length;
}
async function openMail() {
  if (!net || !net.mail) { hud.toast('登入後才有信箱'); return; }
  await loadMail();
  openMailbox(mails, {
    onVisit: (id, name) => { closePanel(); visit(id, name); },
    onDelete: (m) => { net.mail.delete([m.id]).then(loadMail); },
    onRead: async (list) => { for (const m of list) await (m.sys ? call('claim', { id: m.id }, { quiet: true }).catch(() => {}) : net.mail.delete([m.id]).catch(() => {})); loadMail(); },
    onClaim: async (m) => {
      try { const r = await call('claim', { id: m.id }); applyMine(farm, r); refreshHud(); audio.tool('harvest'); hud.toast('🎁 收下了！'); } catch (_e) { /* 已提示 */ }
      loadMail();
    },
  });
}
function openVisits() {
  if (!api.server) { hud.toast('登入後才能拜訪別人的家'); return; }
  const online = net.online().map((p) => ({ ...p, look: (people.get(p.id) || {}).look }));
  const onlineIds = new Set(online.map((p) => p.id));
  const cards = call('directory', {}, { quiet: true }).then((r) => r.items.map((it) => { const c = readCard({ v: 1, ...it }); return c && { ...c, id: String(it.user), online: it.online }; }).filter(Boolean));
  openVisitPanel(scene, { online, friends: social.friends.map((f) => ({ ...f, online: onlineIds.has(f.id), look: (people.get(f.id) || {}).look })), cards }, {
    myOpen: social.open,
    onToggleOpen: (open) => { call('social', { open }).then((r) => { social = r.social; hud.toast(open ? '家園開放拜訪中' : '家園已關閉拜訪'); }).catch(() => {}); },
    onVisit: (id, name) => visit(id, name),
    isFriend: (id) => isFriend(social, id),
    onFriend: (id, name) => setFriend(id, name, !isFriend(social, id)),
    isCoop: (id) => social.coop.includes(id),
    onCoop: (id, name) => setCoop(id, name, !social.coop.includes(id)),
  });
}
function emote(i) {
  me.emote = { n: EMOTES[i], until: performance.now() + 2600 };
  if (net) net.send({ k: 'm', e: i });
}
const helpToasts = new Map();
/** 伺服器推播：有人改了我正在看的田、我的背包變了、主人改了小屋。 */
function onGame(m) {
  if (m.op === 'patch' && m.owner) {
    const target = m.owner === myId ? farm : (visits.get(m.owner) || {}).farm;
    if (!target) return;
    applyTiles(target, m.tiles);
    if (map && map.owner === m.owner && map.farm) syncFarm(map, target);
    if (m.owner === myId && m.by) {
      const n = (helpToasts.get(m.by) || 0) + 1; helpToasts.set(m.by, n);
      if (n === 1) setTimeout(() => { const c = helpToasts.get(m.by); helpToasts.delete(m.by); sys(`🤝 ${m.by} 在你的農場幫忙了 ${c} 次`); hud.toast(`🤝 ${m.by} 在幫你照顧農場`, 2500); }, 2500);
    }
  } else if (m.op === 'me') {
    applyMine(farm, m); if (Number.isFinite(m.likes)) social.likes = m.likes; refreshHud();
  } else if (m.op === 'home' && m.owner) refreshVisit(m.owner);
}

// ---------- 連線 ----------
function sendPose(to, force) {
  if (!net) return;
  const now = performance.now();
  const moved = !lastSent || Math.hypot(me.x - lastSent.x, me.y - lastSent.y) > 0.5 || lastArea !== area;
  if (!force && !moved && now - lastSentAt < POS_IDLE_MS) return;
  if (to == null) { lastSent = { x: me.x, y: me.y }; lastSentAt = now; lastArea = area; }
  net.sendPose({ x: me.x, y: me.y, area }, to);
}
function person(id, name) {
  if (!people.has(id)) people.set(id, { id, name: name || (net && net.nameOf(id)) || '訪客', look: null, x: 0, y: 0, tx: 0, ty: 0, area: '', dir: 0, moving: false, movedAt: 0, bubble: '', bubbleAt: 0, seen: false, lastStep: 0 });
  return people.get(id);
}
const sendLook = (to) => { if (net && me.look) net.send({ k: 'l', l: me.look }, to); };
/** 從伺服器載入自己的全部資料（登入、重連時）。 */
async function loadMe() {
  const r = await api.call('load');
  const m = r.me;
  farm = playerFarm(m, myId);
  decor = sanitizeDecor({ v: 1, ...m.decor });
  me.look = sanitizeLook(m.look);
  social = m.social;
  refreshHud();
  if (ownerOf(area)) loadArea(area, null, { rebuild: true });
  if (map && atHome() && map.farm) syncFarm(map, farm);
}
async function connect() {
  try {
    net = await connectPlaza({
      joined(list) { people.clear(); for (const p of list) person(p.id, p.name); updateInfo(); sendPose(undefined, true); sendLook(); },
      playerJoined(p) { person(p.id, p.name).name = p.name; sys(`${p.name} 來到了派派鎮`); updateInfo(); audio.joined(); sendPose(p.id, true); sendLook(p.id); },
      playerLeft(id) { const p = people.get(id); if (p) sys(`${p.name} 離開了`); people.delete(id); updateInfo(); },
      pose(id, pos) {
        const p = person(id);
        if (p.area !== pos.area || !p.seen) { p.x = pos.x; p.y = pos.y; p.seen = true; }
        const dx = pos.x - p.tx, dy = pos.y - p.ty;
        if (Math.abs(dx) > 0.3 || Math.abs(dy) > 0.3) { p.dir = dirOf(dx, dy, p.dir); p.movedAt = performance.now(); }
        p.tx = pos.x; p.ty = pos.y; p.area = pos.area;
      },
      chat(id, text) {
        const p = person(id);
        p.bubble = text; p.bubbleAt = performance.now();
        addLog(text, p.name); audio.received();
      },
      mail(m) {
        loadMail();
        const t = { syslike: '👍 有人稱讚了你的家園', sysgift: '🎁 有人送你禮物，打開信箱看看', syssold: '💰 你的東西在跳蚤市場賣掉了！', syscoop: '🤝 有人邀請你共同耕作', sysdiv: '📈 交易所週一股息入帳了' }[m.kind] || '✉ 收到新的留言';
        hud.toast(t, 2500);
      },
      game: onGame,
      other(id, d) {
        const p = person(id);
        if (d.k === 'm') { if (Number.isInteger(d.e) && EMOTES[d.e]) p.emote = { n: EMOTES[d.e], until: performance.now() + 2600 }; return; }
        if (d.k === 'r') { if (map && map.id === 'plaza' && p.area === 'plaza') { reggieReact = performance.now() + 2400; audio.voice('reggie'); } return; }
        if (d.k === 'l') { const l = sanitizeLook(d.l); if (l) p.look = l; }
        else if (d.k === 'f' && isOn('fishing')) {
          const f = FISH.find((x) => x.id === d.f);
          if (f && !f.junk && Number.isInteger(d.s) && d.s > 0 && d.s < 300) sys(`🎣 ${p.name} 釣到了 ${f.name}（${d.s} 公分）`);
        }
      },
      status(t) { updateInfo(t || undefined); if (!t && api.server) loadMe().catch(() => {}); },
    });
    if (net.offline) { sys(net.reason); net = null; updateInfo(); serverStatus('訪客試玩（不存檔）'); return; }
    myId = net.me.id; myName = net.me.name; me.id = myId;
    if (net.game) {
      api = createServerApi(net);
      await loadMe();
      serverStatus('🖥 伺服器存檔');
      if (!me.look && !creatorOpen()) openLook(true);
      loadMail();
    } else {
      sys('伺服器還沒準備好遊戲存檔，先用試玩模式（進度不會留下來）。');
      serverStatus('試玩模式');
    }
    updateInfo();
    sendLook();
    sendPose(undefined, true);
    setInterval(() => sendPose(), POS_TICK_MS);
  } catch (err) { net = null; updateInfo(`連線失敗：${errText(err)}（試玩模式，不存檔）`); serverStatus('試玩模式'); }
}
function sendChat(raw) {
  const text = cleanText(raw);
  if (!text) return false;
  const now = performance.now(), gate = canSend(now, lastChat);
  if (!gate.ok) { sys('說話太快了，稍等一下'); return false; }
  lastChat = now;
  if (net) net.sendChat(text);
  addLog(text, '我', 'me');
  me.bubble = text; me.bubbleAt = now;
  audio.sent();
  return true;
}

// ---------- 輸入 ----------
const keys = new Set();
const typing = () => document.activeElement && document.activeElement.id === 'chat-input';
const muteBtn = $('mute');
const paintMute = () => { muteBtn.textContent = audio.muted ? '音效：關' : '音效：開'; muteBtn.setAttribute('aria-pressed', String(!audio.muted)); };
muteBtn.addEventListener('click', () => { audio.unlock(); audio.setMuted(!audio.muted); paintMute(); });
paintMute();
$('btn-look').addEventListener('click', () => { if (scene && !creatorOpen()) openLook(false); });
$('btn-events').addEventListener('click', () => openEventBoard(Date.now()));
$('btn-visit').addEventListener('click', openVisits);
$('btn-mail').addEventListener('click', openMail);
$('btn-emote').addEventListener('click', () => openEmotes(emote));
$('btn-market').addEventListener('click', openFlea);
$('chat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('chat-input');
  if (sendChat(input.value)) input.value = '';
  input.blur();
});
addEventListener('keydown', (e) => {
  audio.unlock();
  if (!map || creatorOpen()) return;
  if (typing()) { if (e.key === 'Escape') $('chat-input').blur(); return; }
  if (e.target && ['SELECT', 'TEXTAREA', 'INPUT'].includes(e.target.tagName)) return;
  const k = e.key.toLowerCase();
  if (e.key === 'Escape') { if (dialog.open) dialog.close(); else if (fishing) stopFishing(); else if (edit || panelOpen()) stopEdit(); return; }
  if (dialog.open) { if (['enter', ' ', 'e', 'x'].includes(k)) { e.preventDefault(); dialog.next(); } return; }
  if (k === ' ') {
    e.preventDefault();
    if (e.repeat) return;
    holding = true;
    if (fishingPress()) return;
    if (!interact()) { const f = facingTile(me); act(f.tx, f.ty); }
    return;
  }
  if (e.key === 'Enter') { e.preventDefault(); $('chat-input').focus(); return; }
  if (/^[1-8]$/.test(e.key)) { selectTool(Number(e.key) - 1); return; }
  if (k === 'q' && farm) {
    const have = CROP_KEYS.filter((c) => farm.seeds[c] > 0);
    if (!have.length) { hud.toast('沒有種子了'); return; }
    const next = have[(have.indexOf(farm.seedSel) + 1) % have.length];
    farm.seedSel = next; refreshHud(); hud.toast(`種子：${CROPS[next].name}`);
    call('seed', { crop: next }, { quiet: true }).then((r) => { applyMine(farm, r); refreshHud(); }).catch(() => {});
    return;
  }
  if (k === 'e' || k === 'x') { e.preventDefault(); interact(); return; }
  if (k === 't') { e.preventDefault(); openEmotes(emote); return; }
  if (k === 'c') { e.preventDefault(); if (!fishingPress() && !interact()) { const f = facingTile(me); act(f.tx, f.ty); } return; }
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) { keys.add(k); target = null; e.preventDefault(); }
});
addEventListener('keyup', (e) => { keys.delete(e.key.toLowerCase()); if (e.key === ' ') holding = false; });
addEventListener('blur', () => { keys.clear(); holding = false; });

function worldAt(e) {
  const r = canvas.getBoundingClientRect();
  const cam = cameraFor(me.x, me.y, map.pw, map.ph);
  return { x: (e.clientX - r.left) / r.width * VW + cam.x, y: (e.clientY - r.top) / r.height * VH + cam.y };
}
canvas.addEventListener('pointermove', (e) => { if (map) { const w = worldAt(e); hover = tileOf(w.x, w.y); } });
canvas.addEventListener('pointerleave', () => { hover = null; });
addEventListener('pointerup', () => { holding = false; });
canvas.addEventListener('pointerdown', (e) => {
  audio.unlock();
  if (!map) return;
  if (dialog.open) { dialog.next(); return; }
  if (fishing) { holding = true; fishingPress(); return; }
  const w = worldAt(e), t = tileOf(w.x, w.y);
  if (edit) { editClick(t.tx, t.ty); return; }
  // 點到同一區的其他玩家：名片（拜訪、打招呼、好友、共耕）
  const other = [...people.values()].find((p) => p.area === area && Math.hypot(p.x - w.x, p.y - 8 - w.y) < 10);
  if (other) {
    openPlayerCard(scene, other, {
      isFriend: (id) => isFriend(social, id),
      onFriend: () => setFriend(other.id, other.name, !isFriend(social, other.id)),
      isCoop: (id) => social.coop.includes(id),
      onCoop: () => setCoop(other.id, other.name, !social.coop.includes(other.id)),
      onVisit: () => visit(other.id, other.name),
      onWave: () => { me.dir = dirOf(other.x - me.x, other.y - me.y, me.dir); emote(1); if (net) net.sendChat(`👋 嗨，${other.name}！`); addLog(`👋 嗨，${other.name}！`, '我', 'me'); },
    });
    return;
  }
  // 點到附近的 NPC 或告示牌：轉身對話
  const near = [...map.npcs, ...map.signs].find((o) => Math.hypot(o.x - w.x, o.y - 8 - w.y) < (o.hit || 14));
  if (near && Math.hypot(near.x - me.x, near.y - me.y) < (near.reach || 0) + 34) { me.dir = dirOf(near.x - me.x, near.y - me.y, me.dir); interact(); return; }
  // 點水面且拿著釣竿：轉身拋竿
  const mine = tileOf(me.x, me.y - 2);
  if (TOOLS[tool] === 'rod' && map.grid.get(t.tx, t.ty) === KIND.WATER && Math.max(Math.abs(t.tx - mine.tx), Math.abs(t.ty - mine.ty)) <= 3) {
    me.dir = dirOf(t.tx - mine.tx, t.ty - mine.ty, me.dir); castRod(); return;
  }
  // 農場：點自己旁邊的格子就用工具
  if (map.farm && Math.max(Math.abs(t.tx - mine.tx), Math.abs(t.ty - mine.ty)) === 1) {
    me.dir = dirOf(t.tx - mine.tx, t.ty - mine.ty, me.dir); act(t.tx, t.ty); return;
  }
  target = { x: w.x, y: w.y };
});

// ---------- 主迴圈 ----------
function updateNpcs(dt, now) {
  for (const n of map.npcs) {
    if (n.talking || !n.wander) { n.moving = false; continue; }
    if (!n.goal && now > n.next) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * n.wander;
      n.goal = { x: n.home.x + Math.cos(a) * r, y: n.home.y + Math.sin(a) * r * 0.6 };
    }
    if (n.goal) {
      const bx = n.x, by = n.y;
      const s = stepToward(n, n.goal.x, n.goal.y, dt * NPC_SPEED / 64, map.blockedFor(n));
      n.x = s.x; n.y = s.y; n.moving = Math.hypot(n.x - bx, n.y - by) > 0.01;
      if (n.moving) n.dir = dirOf(n.x - bx, n.y - by, n.dir);
      if (s.arrived || !n.moving) { n.goal = null; n.moving = false; n.next = now + 2000 + Math.random() * 4000; }
    }
  }
}
let prev = performance.now(), lastClock = 0, lastEvents = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - prev) / 1000); prev = now;
  if (map && scene && farm) {
    const lock = dialog.open || warping || creatorOpen() || (fishing && fishing.phase !== 'wait' && fishing.phase !== 'casting');
    const dx = lock ? 0 : (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
    const dy = lock ? 0 : (keys.has('s') || keys.has('arrowdown') ? 1 : 0) - (keys.has('w') || keys.has('arrowup') ? 1 : 0);
    const bx = me.x, by = me.y;
    if (dx || dy) { Object.assign(me, stepMove(me, dx, dy, dt, map.blocked)); me.dir = dirOf(dx, dy, me.dir); }
    else if (target && !lock) { const s = stepToward(me, target.x, target.y, dt, map.blocked); me.x = s.x; me.y = s.y; if (s.arrived) target = null; if (Math.hypot(me.x - bx, me.y - by) > 0.01) me.dir = dirOf(me.x - bx, me.y - by, me.dir); }
    me.moving = Math.hypot(me.x - bx, me.y - by) > 0.01;
    if (me.moving && audio.stepDue(now)) audio.step(now, 0, 0);
    if (now > warpLock && !warping) { const w = map.warpAt(me); if (w) warpTo(w); }
    updateNpcs(dt, now);
    updateFishing(now, dt);
    animateLandmarks(now);
    const list = [{ ...me, name: myName, self: true }];
    for (const p of people.values()) {
      const k = 1 - Math.exp(-dt * 12); p.x += (p.tx - p.x) * k; p.y += (p.ty - p.y) * k;
      p.moving = now - p.movedAt < MOVING_MS;
      if (p.area !== area) continue;
      if (p.moving && now - p.lastStep > 300) { p.lastStep = now; audio.step(now, Math.hypot(p.x - me.x, p.y - me.y), (p.x - me.x) / HEAR_DIST); }
      list.push(p);
    }
    for (const n of map.npcs) { n.near = Math.hypot(n.x - me.x, n.y - me.y) < 56; list.push(n); }
    const opts = { light: map.base === 'void' ? null : daylight() };
    if (fishing) opts.fishing = { x: fishing.x, y: fishing.y, fromX: me.x + [0, 0, -6, 6][me.dir], fromY: me.y - 12, bite: fishing.phase === 'bite', px: me.x, py: me.y };
    if (edit && hover && edit.sel !== 'remove') {
      const f = furniture(edit.sel), ox = hover.tx - Math.floor((f.w - 1) / 2), oy = hover.ty - (f.h - 1);
      const pl = placeAt(f, ox, oy);
      opts.ghost = { k: f.k, x: pl.x, y: pl.y, ok: canPlace(decor.items, f.k, ox, oy) };
    } else if (edit && hover) opts.cursor = { ...hover, ok: !!itemAt(decor.items, hover.tx, hover.ty) };
    else if (map.farm && !dialog.open && TOOLS[tool] !== 'rod' && toolAllowed(TOOLS[tool])) {
      const mine = tileOf(me.x, me.y - 2);
      const h = hover && Math.max(Math.abs(hover.tx - mine.tx), Math.abs(hover.ty - mine.ty)) === 1 ? hover : facingTile(me);
      opts.cursor = { ...h, ok: true };
    }
    if (!dialog.open && !edit && !fishing) {
      const t = map.interactAt(me);
      if (t) opts.hint = { x: t.x, y: t.y - (t.npc ? 22 : t.hintY || 18), text: t.npc ? 'E 對話' : t.hint || 'E 查看' };
      else { const w = map.warps.find((x) => Math.hypot((x.x0 + x.x1) / 2 - me.x, (x.y0 + x.y1) / 2 - me.y) < 26 && x.label); if (w) opts.hint = { x: (w.x0 + w.x1) / 2, y: w.y0 - 2, text: w.label }; }
    }
    if (fishing && fishing.phase === 'bite') opts.hint = { x: me.x, y: me.y - 26, text: '空白鍵 提竿！' };
    if (!canvas.width) fit();
    drawWorld(ctx, scene, map, list, cameraFor(me.x, me.y, map.pw, map.ph), now, BUBBLE_MS, opts);
    if (now - lastClock > 10000) { hud.clock(); lastClock = now; }
    if (now - lastEvents > 5000) { checkEvents(false); lastEvents = now; }
  }
  requestAnimationFrame(frame);
}

// ---------- 開始 ----------
async function start() {
  try { scene = await loadImages(); } catch (err) { updateInfo(`素材載入失敗：${err.message}`); return; }
  await loadMe();                                    // 先用試玩沙盒，登入後換成伺服器資料
  hud.clock(); selectTool(0);
  checkEvents(true);
  loadArea('plaza', 'center');
  sys('歡迎來到派派鎮！WASD 或點地面走路，E 對話，Enter 聊天，左下角可以拜訪、逛市場、捏臉、看活動。');
  sys('西橋通往你的農場（1–8 選工具、空白鍵使用、Q 換種子），東橋是商店街。廣場中央有菲比女神噴水池，東南角是瑞吉海獅秀。');
  fit();
  ready = true;
  requestAnimationFrame(frame);
  connect();
}
start();
// 測試用：讓瀏覽器測試能讀到目前狀態
window.__plaza = {
  get area() { return area; }, get me() { return me; }, get farm() { return farm; }, get decor() { return decor; }, get map() { return map; },
  get fishing() { return fishing; }, get events() { return events; }, get social() { return social; }, get mails() { return mails; }, get server() { return api.server; },
  get ready() { return ready; }, people, visits,
  warp: (to, entry) => loadArea(to === 'farm' || to === 'house' ? personal(to) : to, entry),
  setEvents: (ids) => { events = ids; applyEvents(map); },
  setLook: (l) => { const s = sanitizeLook(l); if (!s) return false; me.look = s; sendLook(); return true; },
  visit: (id, name) => visit(id, name), emote: (i) => emote(i), call: (op, data) => api.call(op, data), act: (x, y) => act(x, y),
  reload: () => loadMe(),
};
