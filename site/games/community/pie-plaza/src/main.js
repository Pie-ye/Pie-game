// 派派鎮：大廳（廣場）＋商店街＋個人農場與小屋。負責輸入、區域切換、主迴圈，其餘交給各模組。
import {
  TILE, VIEW, LOG_MAX, HEAR_DIST, cleanText, canSend, stepMove, stepToward, dirOf, facingTile, tileOf, cameraFor,
} from './logic.js';
import { getMap, AREA_NAMES } from './maps/index.js';
import { syncFarm } from './maps/farm.js';
import { loadImages } from './engine/sprites.js';
import { drawWorld, setScale, getScale } from './engine/render.js';
import { createAudio } from './audio.js';
import { connectPlaza, errText } from './net.js';
import { createDialog } from './ui/dialog.js';
import { createHud } from './ui/hud.js';
import { openHouseStyles, openDecor, closePanel, panelOpen } from './ui/panels.js';
import { TOOLS, useTool, grow, debrisLeft } from './farm/state.js';
import { furniture, canPlace, placeAt, itemAt } from './house/catalog.js';
import * as store from './store.js';

const $ = (id) => document.getElementById(id);
const infoEl = $('room-info'), titleEl = $('room-title'), logEl = $('log'), canvas = $('world'), ctx = canvas.getContext('2d');
const BUBBLE_MS = 6000, POS_TICK_MS = 100, POS_IDLE_MS = 1000, MOVING_MS = 260, NPC_SPEED = 26;
const VW = VIEW.w * TILE, VH = VIEW.h * TILE;

const audio = createAudio();
const dialog = createDialog();
const hud = createHud({ onSelect: (i) => selectTool(i) });

let scene = null, net = null, myId = 'guest', myName = '我';
let map = null, area = 'plaza';
const me = { id: 'guest', x: 240, y: 150, dir: 0, moving: false, bubble: '', bubbleAt: 0, acting: 0 };
let farm = null, decor = null;
let tool = 0, edit = null, hover = null;
let target = null, warpLock = 0, warping = false, lastChat = -1e9, lastSent = null, lastSentAt = 0, lastArea = null;
const people = new Map();      // 其他玩家：id -> { id, name, x, y, tx, ty, area, dir, moving, movedAt, bubble, bubbleAt, seen, lastStep }

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

// ---------- 區域 ----------
const personal = (kind) => `${kind}:${myId}`;
function prepNpcs(m) {
  for (const n of m.npcs) {
    n.npc = true; n.moving = false; n.home = n.home || { x: n.x, y: n.y };
    n.next = n.next || performance.now() + 1000 + Math.random() * 3000;
  }
}
function loadArea(a, entry) {
  const m = getMap(a, { decor });
  if (!m) { sys(`找不到地區：${a}`); return false; }
  if (!m.shared) m.version = Date.now();
  if (m.farm) syncFarm(m, farm);
  prepNpcs(m);
  const moved = a !== area;
  map = m; area = a;
  const e = (entry && m.entries[entry]) || Object.values(m.entries)[0];
  me.x = e.x; me.y = e.y; me.dir = e.dir; me.moving = false;
  target = null; warpLock = performance.now() + 400;
  if (edit && moved) stopEdit();
  hud.enable((t) => (m.farm ? t !== 'hammer' : m.id === personal('house') ? t === 'hammer' : false));
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
  const to = w.to === 'farm' ? personal('farm') : w.to;
  loadArea(to, w.entry);
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
  if (!map.farm) {
    if (t === 'hammer' && map.id === personal('house')) { startEdit(); return; }
    hud.toast('這裡不能用工具'); return;
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
    syncFarm(map, farm); store.saveFarm(myId, farm); hud.inventory(farm.inv);
    if (r.cleared && debrisLeft(farm) === 0) hud.toast('田地清乾淨了！可以開始耕種了', 3000);
  }
}
function interact() {
  if (dialog.open) { dialog.next(); return true; }
  const t = map.interactAt(me);
  if (!t) return false;
  audio.tool('talk');
  if (t.npc) {
    t.dir = [1, 0, 3, 2][me.dir]; t.talking = true; t.moving = false; t.goal = null;
    dialog.show({ name: t.name, sprite: t.sprite }, t.lines, () => { t.talking = false; });
  } else {
    dialog.show({ name: t.title }, t.lines, () => { if (t.action === 'houseStyle') openStyle(); });
  }
  return true;
}
function openStyle() {
  openHouseStyles(decor.style, (k) => { decor.style = k; store.saveDecor(myId, decor); rebuildHere(); hud.toast('小屋換新樣子了！'); }, null);
}

// ---------- 裝潢 ----------
function startEdit() {
  if (edit) return;
  edit = { sel: 'remove' };
  openDecor(decor, {
    pickItem: (k) => { edit && (edit.sel = k); },
    pickFloor: (k) => { decor.floor = k; store.saveDecor(myId, decor); rebuildHere(); },
    pickWall: (k) => { decor.wall = k; store.saveDecor(myId, decor); rebuildHere(); },
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
  store.saveDecor(myId, decor);
  rebuildHere();
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
  if (!people.has(id)) people.set(id, { id, name: name || (net && net.nameOf(id)) || '訪客', x: 0, y: 0, tx: 0, ty: 0, area: '', dir: 0, moving: false, movedAt: 0, bubble: '', bubbleAt: 0, seen: false, lastStep: 0 });
  return people.get(id);
}
async function connect() {
  try {
    net = await connectPlaza({
      joined(list) { people.clear(); for (const p of list) person(p.id, p.name); updateInfo(); sendPose(undefined, true); },
      playerJoined(p) { person(p.id, p.name).name = p.name; sys(`${p.name} 來到了派派鎮`); updateInfo(); audio.joined(); sendPose(p.id, true); },
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
      status(t) { updateInfo(t || undefined); },
    });
    if (net.offline) { sys(net.reason); net = null; updateInfo(); return; }
    myId = net.me.id; myName = net.me.name; me.id = myId;
    farm = store.loadFarm(myId); decor = store.loadDecor(myId); hud.inventory(farm.inv);
    if (area.startsWith('farm:') || area.startsWith('house:')) loadArea(personal(area.split(':')[0]), null);
    updateInfo();
    setInterval(() => sendPose(), POS_TICK_MS);
  } catch (err) { net = null; updateInfo(`連線失敗：${errText(err)}（單機模式）`); }
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
$('chat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('chat-input');
  if (sendChat(input.value)) input.value = '';
  input.blur();
});
addEventListener('keydown', (e) => {
  audio.unlock();
  if (!map) return;
  if (typing()) { if (e.key === 'Escape') $('chat-input').blur(); return; }
  const k = e.key.toLowerCase();
  if (e.key === 'Escape') { if (dialog.open) dialog.close(); else if (edit || panelOpen()) stopEdit(); return; }
  if (dialog.open) { if (['enter', ' ', 'e', 'x'].includes(k)) { e.preventDefault(); dialog.next(); } return; }
  if (e.key === 'Enter') { e.preventDefault(); $('chat-input').focus(); return; }
  if (/^[1-8]$/.test(e.key)) { selectTool(Number(e.key) - 1); return; }
  if (k === 'e' || k === 'x') { e.preventDefault(); interact(); return; }
  if (k === ' ' || k === 'c') {
    e.preventDefault();
    if (!interact()) { const f = facingTile(me); act(f.tx, f.ty); }
    return;
  }
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) { keys.add(k); target = null; e.preventDefault(); }
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());

function worldAt(e) {
  const r = canvas.getBoundingClientRect();
  const cam = cameraFor(me.x, me.y, map.pw, map.ph);
  return { x: (e.clientX - r.left) / r.width * VW + cam.x, y: (e.clientY - r.top) / r.height * VH + cam.y };
}
canvas.addEventListener('pointermove', (e) => { if (map) { const w = worldAt(e); hover = tileOf(w.x, w.y); } });
canvas.addEventListener('pointerleave', () => { hover = null; });
canvas.addEventListener('pointerdown', (e) => {
  audio.unlock();
  if (!map) return;
  if (dialog.open) { dialog.next(); return; }
  const w = worldAt(e), t = tileOf(w.x, w.y);
  if (edit) { editClick(t.tx, t.ty); return; }
  // 點到附近的 NPC 或告示牌：轉身對話
  const near = [...map.npcs, ...map.signs].find((o) => Math.hypot(o.x - w.x, o.y - 8 - w.y) < 14);
  if (near && Math.hypot(near.x - me.x, near.y - me.y) < 34) { me.dir = dirOf(near.x - me.x, near.y - me.y, me.dir); interact(); return; }
  // 農場：點自己旁邊的格子就用工具
  const mine = tileOf(me.x, me.y - 2);
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
let prev = performance.now(), lastClock = 0, lastGrow = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - prev) / 1000); prev = now;
  if (map && scene) {
    const lock = dialog.open || warping;
    const dx = lock ? 0 : (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
    const dy = lock ? 0 : (keys.has('s') || keys.has('arrowdown') ? 1 : 0) - (keys.has('w') || keys.has('arrowup') ? 1 : 0);
    const bx = me.x, by = me.y;
    if (dx || dy) { Object.assign(me, stepMove(me, dx, dy, dt, map.blocked)); me.dir = dirOf(dx, dy, me.dir); }
    else if (target && !lock) { const s = stepToward(me, target.x, target.y, dt, map.blocked); me.x = s.x; me.y = s.y; if (s.arrived) target = null; if (Math.hypot(me.x - bx, me.y - by) > 0.01) me.dir = dirOf(me.x - bx, me.y - by, me.dir); }
    me.moving = Math.hypot(me.x - bx, me.y - by) > 0.01;
    if (me.moving && audio.stepDue(now)) audio.step(now, 0, 0);
    if (now > warpLock && !warping) { const w = map.warpAt(me); if (w) warpTo(w); }
    updateNpcs(dt, now);
    const list = [{ ...me, name: myName, self: true }];
    for (const p of people.values()) {
      const k = 1 - Math.exp(-dt * 12); p.x += (p.tx - p.x) * k; p.y += (p.ty - p.y) * k;
      p.moving = now - p.movedAt < MOVING_MS;
      if (p.area !== area) continue;
      if (p.moving && now - p.lastStep > 300) { p.lastStep = now; audio.step(now, Math.hypot(p.x - me.x, p.y - me.y), (p.x - me.x) / HEAR_DIST); }
      list.push(p);
    }
    for (const n of map.npcs) { n.near = Math.hypot(n.x - me.x, n.y - me.y) < 56; list.push(n); }
    const opts = {};
    if (edit && hover && edit.sel !== 'remove') {
      const f = furniture(edit.sel), ox = hover.tx - Math.floor((f.w - 1) / 2), oy = hover.ty - (f.h - 1);
      const pl = placeAt(f, ox, oy);
      opts.ghost = { k: f.k, x: pl.x, y: pl.y, ok: canPlace(decor.items, f.k, ox, oy) };
    } else if (edit && hover) opts.cursor = { ...hover, ok: !!itemAt(decor.items, hover.tx, hover.ty) };
    else if (map.farm && !dialog.open) {
      const mine = tileOf(me.x, me.y - 2);
      const h = hover && Math.max(Math.abs(hover.tx - mine.tx), Math.abs(hover.ty - mine.ty)) === 1 ? hover : facingTile(me);
      opts.cursor = { ...h, ok: true };
    }
    if (!dialog.open && !edit) {
      const t = map.interactAt(me);
      if (t) opts.hint = { x: t.x, y: t.y - (t.npc ? 22 : 18), text: t.npc ? 'E 對話' : 'E 查看' };
      else { const w = map.warps.find((x) => Math.hypot((x.x0 + x.x1) / 2 - me.x, (x.y0 + x.y1) / 2 - me.y) < 26 && x.label); if (w) opts.hint = { x: (w.x0 + w.x1) / 2, y: w.y0 - 2, text: w.label }; }
    }
    if (!canvas.width) fit();
    drawWorld(ctx, scene, map, list, cameraFor(me.x, me.y, map.pw, map.ph), now, BUBBLE_MS, opts);
    if (now - lastClock > 10000) { hud.clock(); lastClock = now; }
    if (farm && now - lastGrow > 1000) {
      lastGrow = now;
      if (grow(farm, Date.now())) { store.saveFarm(myId, farm); if (map.farm) syncFarm(map, farm); }
    }
  }
  requestAnimationFrame(frame);
}

// ---------- 開始 ----------
async function start() {
  try { scene = await loadImages(); } catch (err) { updateInfo(`素材載入失敗：${err.message}`); return; }
  farm = store.loadFarm(myId); decor = store.loadDecor(myId);
  hud.inventory(farm.inv); hud.clock(); selectTool(0);
  loadArea('plaza', 'center');
  sys('歡迎來到派派鎮！WASD 或點地面走路，E 對話，Enter 聊天。');
  sys('西邊的橋通往你的農場（數字鍵選工具、空白鍵使用），東邊是商店街。');
  fit();
  requestAnimationFrame(frame);
  connect();
}
start();
// 測試用：讓瀏覽器測試能讀到目前狀態
window.__plaza = { get area() { return area; }, get me() { return me; }, get farm() { return farm; }, get decor() { return decor; }, get map() { return map; }, warp: (to, entry) => loadArea(to === 'farm' || to === 'house' ? personal(to) : to, entry) };
