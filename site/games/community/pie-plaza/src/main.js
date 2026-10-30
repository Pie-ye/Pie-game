// 派派鎮：大廳（廣場）＋商店街＋個人農場與小屋。負責輸入、區域切換、主迴圈，其餘交給各模組。
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
import { TOOLS, CROPS, useTool, grow, debrisLeft, nextSeed, shipAll, CROP_PRICES } from './farm/state.js';
import { furniture, canPlace, placeAt, itemAt } from './house/catalog.js';
import { defaultLook, sanitizeLook } from './avatar/look.js';
import { FISH, FISH_PRICES, rollFish, fishSize, newMinigame, stepMinigame, fishName } from './fish/fishing.js';
import { activeEvents, eventById, daylight, taipei } from './events/schedule.js';
import { eventObjects } from './events/effects.js';
import * as store from './store.js';
import { createCloud } from './cloud.js';
import { packFarm, unpackFarm } from './farm/state.js';
import { sanitizeDecor } from './house/catalog.js';

const $ = (id) => document.getElementById(id);
const infoEl = $('room-info'), titleEl = $('room-title'), logEl = $('log'), canvas = $('world'), ctx = canvas.getContext('2d');
const BUBBLE_MS = 6000, POS_TICK_MS = 100, POS_IDLE_MS = 1000, MOVING_MS = 260, NPC_SPEED = 26;
const VW = VIEW.w * TILE, VH = VIEW.h * TILE;
const SELL = { ...CROP_PRICES, ...FISH_PRICES };

const audio = createAudio();
const dialog = createDialog();
const hud = createHud({ onSelect: (i) => selectTool(i) });

let scene = null, net = null, myId = 'guest', myName = '我';
let map = null, area = 'plaza';
const me = { id: 'guest', x: 240, y: 150, dir: 0, moving: false, bubble: '', bubbleAt: 0, acting: 0, look: null };
let farm = null, decor = null;
let tool = 0, edit = null, hover = null, fishing = null, holding = false;
let target = null, warpLock = 0, warping = false, lastChat = -1e9, lastSent = null, lastSentAt = 0, lastArea = null;
let events = [], cloud = null, lookAt = 0;
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
  infoEl.textContent = extra || (net ? `${net.online} 人在線` : '單機模式（登入後才看得到別人）');
}
function refreshHud() {
  if (!farm) return;
  hud.inventory(farm.inv); hud.gold(farm.gold); hud.seed(farm.seedSel, farm.seeds[farm.seedSel] || 0);
}
const saveFarm = () => { farm.at = Date.now(); store.saveFarm(myId, farm); refreshHud(); if (cloud) cloud.changed('farm'); };
const saveDecor = () => { decor.at = Date.now(); store.saveDecor(myId, decor); if (cloud) cloud.changed('decor'); };
const cloudEl = $('cloud');
const cloudStatus = (t) => { if (cloudEl) cloudEl.textContent = t ? `☁ ${t}` : ''; };

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
function prepNpcs(m) {
  for (const n of m.npcs) {
    n.npc = true; n.moving = false; n.home = n.home || { x: n.x, y: n.y };
    n.next = n.next || performance.now() + 1000 + Math.random() * 3000;
  }
}
function toolAllowed(t) {
  if (!map) return false;
  if (map.farm) return t !== 'hammer';
  if (map.id === 'plaza') return t === 'rod';
  return map.id === personal('house') && t === 'hammer';
}
function loadArea(a, entry) {
  const m = getMap(a, { decor });
  if (!m) { sys(`找不到地區：${a}`); return false; }
  if (!m.shared) m.version = Date.now();
  if (m.farm) syncFarm(m, farm);
  prepNpcs(m);
  applyEvents(m);
  const moved = a !== area;
  map = m; area = a;
  const e = (entry && m.entries[entry]) || Object.values(m.entries)[0];
  me.x = e.x; me.y = e.y; me.dir = e.dir; me.moving = false;
  target = null; warpLock = performance.now() + 400;
  stopFishing();
  if (edit && moved) stopEdit();
  hud.enable(toolAllowed);
  updateInfo();
  sendPose(undefined, true);
  return true;
}
async function warpTo(w) {
  if (warping) return;
  warping = true;
  audio.tool('door');
  $('fade').classList.add('on');
  await new Promise((r) => setTimeout(r, 180));
  loadArea(w.to === 'farm' ? personal('farm') : w.to, w.entry);
  $('fade').classList.remove('on');
  warping = false;
}
/** 小屋外觀或裝潢改了：重建目前地圖但保留位置。 */
function rebuildHere() {
  const keep = { x: me.x, y: me.y, dir: me.dir };
  loadArea(area, null);
  Object.assign(me, keep);
  if (map.blocked(me.x, me.y)) { const e = map.entries.door || Object.values(map.entries)[0]; me.x = e.x; me.y = e.y; }
}

// ---------- 工具與互動 ----------
function selectTool(i) {
  if (i < 0 || i >= TOOLS.length) return;
  tool = i; hud.select(i);
  if (TOOLS[i] === 'hammer' && map && map.id === personal('house')) startEdit();
  else if (edit) stopEdit();
}
const SOUND = { weed: 'swish', stone: 'pick', twig: 'chop', stump: 'chop' };
function act(tx, ty) {
  const t = TOOLS[tool];
  if (t === 'rod') { castRod(); return; }
  if (!map.farm) {
    if (t === 'hammer' && map.id === personal('house')) { startEdit(); return; }
    hud.toast(map.id === 'plaza' ? '在廣場只能釣魚（選 6 釣竿）' : '這裡不能用工具'); return;
  }
  me.acting = performance.now() + 220;
  const r = useTool(farm, t, tx, ty, Date.now());
  if (r.hit) audio.tool(SOUND[r.hit]);
  else if (r.cleared) audio.tool(r.cleared === 'stone' ? 'break' : SOUND[r.cleared]);
  else if (r.till) audio.tool('dig');
  else if (r.water) audio.tool('water');
  else if (r.plant) audio.tool('plant');
  else if (r.harvest) audio.tool('harvest');
  else if (!r.ok) audio.tool('nope');
  if (r.msg) hud.toast(r.msg);
  if (r.changed) {
    syncFarm(map, farm); saveFarm();
    if (r.cleared && debrisLeft(farm) === 0) hud.toast('田地清乾淨了！可以開始耕種了', 3000);
  }
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
function buyAt(k, n, price) {
  if (farm.gold < price * n) { hud.toast('金幣不夠'); audio.tool('nope'); return; }
  farm.gold -= price * n;
  farm.seeds[k] = (farm.seeds[k] || 0) + n;
  if (!farm.seeds[farm.seedSel]) farm.seedSel = k;
  audio.tool('harvest'); hud.toast(`買了 ${n} 包${CROPS[k].name}種子`); saveFarm();
}
function doAction(action) {
  if (!action) return;
  if (action === 'shop') openSeedShop('皮爺爺雜貨店', () => farm.gold, buyAt, 1);
  else if (action === 'market') openSeedShop('山姆的早市攤（八折）', () => farm.gold, buyAt, 0.8);
  else if (action === 'houseDesign') openDesign();
  else if (action === 'events') openEventBoard(Date.now());
  else if (action === 'ship') {
    const r = shipAll(farm, SELL);
    if (!r.total) { hud.toast('背包裡沒有可以出貨的作物或魚'); return; }
    audio.tool('harvest'); sys(`出貨 ${r.sold.map(([k, n]) => `${k.startsWith('fish_') ? fishName(k.slice(5)) : CROPS[k].name}×${n}`).join('、')}，得到 ${r.total} G`);
    hud.toast(`+${r.total} G`, 2500); saveFarm();
  }
}
function openDesign() {
  openHouseDesign(decor, (p) => {
    if (p.style) decor.style = p.style;
    if (p.roof != null) decor.ext.roof = p.roof;
    if (p.wall != null) decor.ext.wall = p.wall;
    if (p.yard) decor.ext.yard[p.yard[0]] = p.yard[1];
    saveDecor();
    if (map.farm) rebuildHere(); else hud.toast('改好了，回農場看看吧！');
  }, null);
}

// ---------- 釣魚 ----------
function castRod() {
  const where = map.id === 'plaza' ? 'sea' : map.farm ? 'pond' : null;
  if (!where) { hud.toast('這裡沒有地方釣魚'); return; }
  if (fishing) return;
  const { tx, ty } = tileOf(me.x, me.y - 2), [dx, dy] = DIR_VEC[me.dir];
  for (let k = 1; k <= 3; k++) {
    if (map.grid.get(tx + dx * k, ty + dy * k) === KIND.WATER) {
      fishing = { phase: 'wait', where, x: (tx + dx * k) * TILE + 8, y: (ty + dy * k) * TILE + 9, until: performance.now() + 1500 + Math.random() * 4500, sx: me.x, sy: me.y };
      me.acting = performance.now() + 300; audio.tool('swish');
      return;
    }
  }
  hud.toast('面向水邊才能釣魚'); audio.tool('nope');
}
function stopFishing() { fishing = null; hideFishing(); }
function hookFish() {
  const contest = isOn('fishing') && map.id === 'plaza';
  const fish = rollFish(fishing.where, taipei().h, contest);
  fishing = { ...fishing, phase: 'game', fish, contest, game: newMinigame(fish) };
  showFishing();
}
function landFish(f, contest) {
  if (f.junk) { hud.toast('釣到一隻舊靴子……'); audio.tool('nope'); return; }
  const size = fishSize(f);
  const k = `fish_${f.id}`;
  farm.inv[k] = (farm.inv[k] || 0) + 1; saveFarm();
  audio.tool('harvest'); hud.toast(`釣到 ${f.name}（${size} 公分）！`, 2500);
  if (contest) {
    sys(`🎣 你釣到了 ${f.name}（${size} 公分）`);
    if (net) net.send({ k: 'f', f: f.id, s: size });
  }
}
function updateFishing(now, dt) {
  if (!fishing) return;
  if (Math.hypot(me.x - fishing.sx, me.y - fishing.sy) > 2) { stopFishing(); return; }
  if (fishing.phase === 'wait' && now > fishing.until) { fishing.phase = 'bite'; fishing.biteUntil = now + 1000; audio.tool('pick'); }
  else if (fishing.phase === 'bite' && now > fishing.biteUntil) { hud.toast('魚跑掉了，再試一次'); stopFishing(); }
  else if (fishing.phase === 'game') {
    const g = stepMinigame(fishing.game, dt, holding);
    drawFishing(g);
    if (g.done) {
      const f = fishing.fish, contest = fishing.contest;
      stopFishing();
      if (g.done === 'caught') landFish(f, contest); else { hud.toast(`${f.name}溜走了…`); audio.tool('nope'); }
    }
  }
}
/** 空白鍵／點擊：咬鉤時提竿，小遊戲中當作按住。 */
function fishingPress() {
  if (!fishing) return false;
  if (fishing.phase === 'bite') { hookFish(); return true; }
  if (fishing.phase === 'wait') { stopFishing(); return true; }
  return fishing.phase === 'game';
}

// ---------- 裝潢 ----------
function startEdit() {
  if (edit) return;
  edit = { sel: 'remove' };
  openDecor(decor, {
    pickItem: (k) => { edit && (edit.sel = k); },
    pickFloor: (k) => { decor.floor = k; saveDecor(); rebuildHere(); },
    pickWall: (k) => { decor.wall = k; saveDecor(); rebuildHere(); },
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
  saveDecor();
  rebuildHere();
}

// ---------- 捏臉 ----------
function openLook(first) {
  openCreator(scene, me.look || defaultLook(myId), (l) => {
    me.look = l; lookAt = Date.now(); store.saveLook(myId, l, lookAt);
    if (cloud) cloud.changed('look');
    if (net) net.send({ k: 'l', l });
    hud.toast(first ? '歡迎來到派派鎮！' : '換好造型了！');
  }, { first });
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
      other(id, d) {
        const p = person(id);
        if (d.k === 'l') { const l = sanitizeLook(d.l); if (l) p.look = l; }
        else if (d.k === 'f' && isOn('fishing')) {
          const f = FISH.find((x) => x.id === d.f);
          if (f && !f.junk && Number.isInteger(d.s) && d.s > 0 && d.s < 300) sys(`🎣 ${p.name} 釣到了 ${f.name}（${d.s} 公分）`);
        }
      },
      status(t) { updateInfo(t || undefined); if (!t && cloud) cloud.resume(); },
    });
    if (net.offline) { sys(net.reason); net = null; updateInfo(); cloudStatus('本機（未登入）'); return; }
    myId = net.me.id; myName = net.me.name; me.id = myId;
    farm = store.loadFarm(myId); decor = store.loadDecor(myId);
    const le = store.loadLookEntry(myId); me.look = le && sanitizeLook(le.l); lookAt = le ? le.at : 0;
    refreshHud();
    if (area.startsWith('farm:') || area.startsWith('house:')) loadArea(personal(area.split(':')[0]), null);
    updateInfo();
    await startCloud();
    if (!me.look && !creatorOpen()) openLook(true); else sendLook();
    setInterval(() => sendPose(), POS_TICK_MS);
  } catch (err) { net = null; updateInfo(`連線失敗：${errText(err)}（單機模式）`); }
}
/** 雲端存檔：登入後比對雲端與本機，之後的修改自動上傳。 */
async function startCloud() {
  const here = () => area.startsWith('farm:') || area.startsWith('house:');
  cloud = createCloud(net.storage, {
    farm: {
      local: () => farm, at: (f) => f.at || 0, pack: packFarm, unpack: (v) => unpackFarm(v, myId),
      apply(f, src) {
        farm = f; store.saveFarm(myId, farm); refreshHud();
        if (map && map.farm) syncFarm(map, farm);
        if (src === 'conflict') hud.toast('已載入另一台裝置較新的農場進度', 3000);
      },
    },
    decor: {
      local: () => decor, at: (d) => d.at || 0, pack: store.decorData, unpack: (v) => sanitizeDecor(v),
      apply(d) { decor = d; store.saveDecor(myId, decor); if (here()) rebuildHere(); },
    },
    look: {
      local: () => (me.look ? { l: me.look, at: lookAt } : null), at: (e) => e.at || 0, pack: (e) => e,
      unpack: (v) => { const l = v && sanitizeLook(v.l); return l ? { l, at: Number(v.at) || 0 } : null; },
      apply(e) { me.look = e.l; lookAt = e.at; store.saveLook(myId, e.l, e.at); sendLook(); },
    },
  }, cloudStatus);
  try {
    const r = await cloud.start();
    if (r.farm === 'cloud' || r.decor === 'cloud') sys('☁ 已從雲端載入你的農場與小屋。');
    if (Object.values(r).includes('error')) sys('☁ 雲端存檔暫時連不上，先用本機進度，稍後會自動補傳。');
  } catch (_e) { cloudStatus('本機'); }
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
  if (e.target && e.target.tagName === 'SELECT') return;
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
  if (k === 'q' && farm) { nextSeed(farm); refreshHud(); hud.toast(`種子：${CROPS[farm.seedSel].name}`); return; }
  if (k === 'e' || k === 'x') { e.preventDefault(); interact(); return; }
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
  // 點到附近的 NPC 或告示牌：轉身對話
  const near = [...map.npcs, ...map.signs].find((o) => Math.hypot(o.x - w.x, o.y - 8 - w.y) < 14);
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
let prev = performance.now(), lastClock = 0, lastGrow = 0, lastEvents = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - prev) / 1000); prev = now;
  if (map && scene) {
    const lock = dialog.open || warping || creatorOpen() || (fishing && fishing.phase !== 'wait');
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
    else if (map.farm && !dialog.open && TOOLS[tool] !== 'rod') {
      const mine = tileOf(me.x, me.y - 2);
      const h = hover && Math.max(Math.abs(hover.tx - mine.tx), Math.abs(hover.ty - mine.ty)) === 1 ? hover : facingTile(me);
      opts.cursor = { ...h, ok: true };
    }
    if (!dialog.open && !edit && !fishing) {
      const t = map.interactAt(me);
      if (t) opts.hint = { x: t.x, y: t.y - (t.npc ? 22 : 18), text: t.npc ? 'E 對話' : 'E 查看' };
      else { const w = map.warps.find((x) => Math.hypot((x.x0 + x.x1) / 2 - me.x, (x.y0 + x.y1) / 2 - me.y) < 26 && x.label); if (w) opts.hint = { x: (w.x0 + w.x1) / 2, y: w.y0 - 2, text: w.label }; }
    }
    if (fishing && fishing.phase === 'bite') opts.hint = { x: me.x, y: me.y - 26, text: '空白鍵 提竿！' };
    if (!canvas.width) fit();
    drawWorld(ctx, scene, map, list, cameraFor(me.x, me.y, map.pw, map.ph), now, BUBBLE_MS, opts);
    if (now - lastClock > 10000) { hud.clock(); lastClock = now; }
    if (now - lastEvents > 5000) { checkEvents(false); lastEvents = now; }
    if (farm && now - lastGrow > 1000) {
      lastGrow = now;
      if (grow(farm, Date.now())) { saveFarm(); if (map.farm) syncFarm(map, farm); }
    }
  }
  requestAnimationFrame(frame);
}

// ---------- 開始 ----------
async function start() {
  try { scene = await loadImages(); } catch (err) { updateInfo(`素材載入失敗：${err.message}`); return; }
  farm = store.loadFarm(myId); decor = store.loadDecor(myId);
  refreshHud(); hud.clock(); selectTool(0);
  checkEvents(true);
  loadArea('plaza', 'center');
  sys('歡迎來到派派鎮！WASD 或點地面走路，E 對話，Enter 聊天，左下角可以捏臉、看活動。');
  sys('西橋通往你的農場（1–8 選工具、空白鍵使用、Q 換種子），東橋是商店街。廣場海邊可以釣魚。');
  fit();
  requestAnimationFrame(frame);
  connect();
}
start();
// 測試用：讓瀏覽器測試能讀到目前狀態
window.__plaza = {
  get area() { return area; }, get me() { return me; }, get farm() { return farm; }, get decor() { return decor; }, get map() { return map; },
  get fishing() { return fishing; }, get events() { return events; }, get cloud() { return cloud; }, people,
  warp: (to, entry) => loadArea(to === 'farm' || to === 'house' ? personal(to) : to, entry),
  setEvents: (ids) => { events = ids; applyEvents(map); },
  touch: () => saveFarm(),
};
