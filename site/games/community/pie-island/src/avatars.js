import * as THREE from '../../pie-phoebe/vendor/three.module.js';
import { createCharacter, EMOTE_IDS } from './character.js';
import { DEFAULT_LOOK, decode, sameLook } from './look.js';
import { groundAt } from './layout.js';

// 其他玩家：用對方捏好的外觀組角色，位置用約 120 ms 的延遲內插，網路抖動時走路依然平順。
const DELAY = 0.12;
const STALE = 8;                        // 這麼久沒收到任何訊息就移除（秒）
const FADE_NEAR = 22, FADE_FAR = 40;    // 名牌淡出距離

function nameTexture(text) {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 64;
  const g = cv.getContext('2d');
  g.font = '700 28px "Noto Sans TC", system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const label = text.length > 12 ? `${text.slice(0, 11)}…` : text;
  const w = Math.min(240, g.measureText(label).width + 34);
  g.fillStyle = 'rgba(255,250,236,.94)';
  g.beginPath(); g.roundRect(128 - w / 2, 8, w, 46, 23); g.fill();
  g.strokeStyle = '#c9a979'; g.lineWidth = 3; g.stroke();
  g.fillStyle = '#6b4f2a';
  g.fillText(label, 128, 32);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createAvatars(scene) {
  const peers = new Map();

  function ensure(id, name) {
    let p = peers.get(id);
    if (!p) {
      const char = createCharacter(DEFAULT_LOOK);
      char.root.visible = false;
      const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: nameTexture(name), transparent: true, depthWrite: false, fog: false }));
      tag.scale.set(1.5, 0.375, 1); tag.position.y = 1.9;
      char.root.add(tag);
      scene.add(char.root);
      p = { id, name, char, tag, buf: [], seen: performance.now() / 1000, pos: null, speed: 0, lookKnown: false, emote: null, emoteAt: 0, asked: 0 };
      peers.set(id, p);
    }
    return p;
  }

  function dispose(p) {
    scene.remove(p.char.root);
    p.char.dispose();
    p.tag.material.map.dispose();
    p.tag.material.dispose();
  }

  return {
    get count() { return peers.size; },
    has: (id) => peers.has(id),
    get: (id) => peers.get(id),
    add(id, name) { ensure(id, name); },
    rename(id, name) {
      const p = peers.get(id);
      if (!p || p.name === name) return;
      p.name = name;
      p.tag.material.map.dispose();
      p.tag.material.map = nameTexture(name);
    },
    remove(id) { const p = peers.get(id); if (p) { dispose(p); peers.delete(id); } },
    clear() { for (const p of peers.values()) dispose(p); peers.clear(); },
    positions() {
      return [...peers.values()].map((p) => ({ id: p.id, name: p.name, x: p.char.root.position.x, z: p.char.root.position.z, visible: p.char.root.visible, look: p.char.look, lookKnown: p.lookKnown, emote: p.emote }));
    },
    /** 收到位置 [x, y, z, yaw] */
    push(id, name, s) {
      const p = ensure(id, name);
      const now = performance.now() / 1000;
      p.seen = now;
      p.buf.push({ t: now, x: s[0], y: s[1], z: s[2], yaw: s[3] });
      if (p.buf.length > 24) p.buf.shift();
      return p;
    },
    /** 收到外觀；回傳是否真的換了 */
    setLook(id, name, arr) {
      const p = ensure(id, name);
      p.seen = performance.now() / 1000;
      const look = decode(arr);
      const changed = !p.lookKnown || !sameLook(look, p.char.look);
      p.lookKnown = true;
      if (changed) p.char.setLook(look);
      return changed;
    },
    emote(id, name, e) {
      if (!EMOTE_IDS.includes(e)) return;
      const p = ensure(id, name);
      p.seen = performance.now() / 1000;
      p.emote = e; p.emoteAt = p.seen;
    },
    update(dt, camPos) {
      const now = performance.now() / 1000;
      const rt = now - DELAY;
      for (const [id, p] of peers) {
        if (now - p.seen > STALE) { dispose(p); peers.delete(id); continue; }
        const b = p.buf;
        if (!b.length) continue;
        let a = b[0], c = b[b.length - 1];
        for (let i = 0; i < b.length - 1; i++) if (b[i].t <= rt && b[i + 1].t >= rt) { a = b[i]; c = b[i + 1]; break; }
        if (rt >= b[b.length - 1].t) a = c = b[b.length - 1];
        else if (rt <= b[0].t) a = c = b[0];
        const k = c.t > a.t ? (rt - a.t) / (c.t - a.t) : 1;
        let dy = c.yaw - a.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        const x = a.x + (c.x - a.x) * k, y = a.y + (c.y - a.y) * k, z = a.z + (c.z - a.z) * k;
        const air = y - groundAt(x, z) > 0.12;
        if (p.pos) {
          const sp = Math.hypot(x - p.pos.x, z - p.pos.z) / Math.max(dt, 1e-3);
          p.speed += (Math.min(sp, 8) - p.speed) * Math.min(1, dt * 8);
          p.pos.x = x; p.pos.z = z;
        } else p.pos = { x, z };
        const root = p.char.root;
        root.position.set(x, y, z);
        root.rotation.y = a.yaw + dy * k;
        root.visible = true;
        const et = now - p.emoteAt;
        if (p.emote && et > 2.6) p.emote = null;
        p.char.animate(dt, { speed: p.speed, air, emote: p.emote, emoteT: et });
        if (camPos) {
          const d = Math.hypot(camPos.x - x, camPos.z - z);
          p.tag.material.opacity = d < FADE_NEAR ? 1 : Math.max(0, 1 - (d - FADE_NEAR) / (FADE_FAR - FADE_NEAR));
          p.tag.visible = p.tag.material.opacity > 0.02;
        }
      }
    },
  };
}
