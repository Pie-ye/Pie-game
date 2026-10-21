import * as THREE from '../../pie-phoebe/vendor/three.module.js';

// 其他玩家的化身：程式組出的賽博龐克路人（外套、面罩、背包燈條），顏色由玩家 id 的雜湊決定。
// 位置用接收時間做約 120 ms 的內插，網路抖動時走路依然平順。
const DELAY = 0.12;            // 內插延遲（秒）
const STALE = 7;               // 超過這麼久沒收到任何更新就移除（秒）
const FADE_NEAR = 26, FADE_FAR = 46;   // 名牌淡出距離（公尺）

const PALETTE = [0xff8a3d, 0x29e6ff, 0x46ff9a, 0xffd84a, 0xff4d6d, 0xb48cff, 0x5ae8ff, 0xff9f1c];

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const geo = {
  torso: new THREE.BoxGeometry(0.46, 0.62, 0.26),
  head: new THREE.BoxGeometry(0.26, 0.28, 0.28),
  visor: new THREE.BoxGeometry(0.22, 0.07, 0.04),
  limb: new THREE.BoxGeometry(0.15, 0.62, 0.15),
  pack: new THREE.BoxGeometry(0.34, 0.44, 0.14),
  strip: new THREE.BoxGeometry(0.05, 0.38, 0.03),
  shadow: new THREE.CircleGeometry(0.42, 16),
};
const mats = {
  pants: new THREE.MeshStandardMaterial({ color: 0x1b2328, roughness: 0.85, metalness: 0.1 }),
  skin: new THREE.MeshStandardMaterial({ color: 0x2a2f33, roughness: 0.6, metalness: 0.5 }),
  pack: new THREE.MeshStandardMaterial({ color: 0x15191c, roughness: 0.7, metalness: 0.3 }),
  shadow: new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }),
};
const tinted = new Map();   // 顏色 → { jacket, glow }
function matsFor(color) {
  if (!tinted.has(color)) {
    const c = new THREE.Color(color);
    tinted.set(color, {
      jacket: new THREE.MeshStandardMaterial({ color: c.clone().multiplyScalar(0.28), roughness: 0.65, metalness: 0.25, emissive: c, emissiveIntensity: 0.12 }),
      glow: new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(2.4), toneMapped: false }),
    });
  }
  return tinted.get(color);
}

function nameTexture(text, color) {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 64;
  const g = cv.getContext('2d');
  g.font = '600 30px "Noto Sans TC", system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const label = text.length > 12 ? `${text.slice(0, 11)}…` : text;
  const w = Math.min(244, g.measureText(label).width + 28);
  g.fillStyle = 'rgba(4,10,14,.72)';
  g.beginPath(); g.roundRect(128 - w / 2, 8, w, 48, 24); g.fill();
  g.strokeStyle = `#${new THREE.Color(color).getHexString()}`; g.lineWidth = 2; g.stroke();
  g.fillStyle = '#e6f1f3';
  g.fillText(label, 128, 33);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function buildAvatar(id, name) {
  const color = PALETTE[hash(String(id)) % PALETTE.length];
  const m = matsFor(color);
  const root = new THREE.Group();
  const body = new THREE.Group();     // 只轉身體，名牌與陰影不跟著轉
  root.add(body);
  const mk = (g, mat, x, y, z) => { const o = new THREE.Mesh(g, mat); o.position.set(x, y, z); body.add(o); return o; };
  // 腿與手臂掛在髖／肩的樞軸上，擺動時才像走路
  const pivot = (x, y, mesh, mat) => {
    const p = new THREE.Group(); p.position.set(x, y, 0);
    const o = new THREE.Mesh(mesh, mat); o.position.y = -0.31; p.add(o); body.add(p); return p;
  };
  const legL = pivot(-0.12, 0.8, geo.limb, mats.pants);
  const legR = pivot(0.12, 0.8, geo.limb, mats.pants);
  mk(geo.torso, m.jacket, 0, 1.1, 0);
  const armL = pivot(-0.31, 1.38, geo.limb, m.jacket);
  const armR = pivot(0.31, 1.38, geo.limb, m.jacket);
  mk(geo.head, mats.skin, 0, 1.6, 0);
  mk(geo.visor, m.glow, 0, 1.62, -0.145);                 // 面罩朝 −Z（遊戲裡 yaw=0 朝北 −Z）
  mk(geo.pack, mats.pack, 0, 1.12, 0.2);
  mk(geo.strip, m.glow, 0, 1.12, 0.275);
  const shadow = new THREE.Mesh(geo.shadow, mats.shadow);
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.03;
  root.add(shadow);
  const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: nameTexture(name, color), transparent: true, depthWrite: false, fog: false, toneMapped: false }));
  tag.scale.set(1.5, 0.375, 1); tag.position.y = 2.07;
  root.add(tag);
  return { root, body, legL, legR, armL, armR, tag, color };
}

export function createAvatars(scene) {
  const peers = new Map();   // id → { view, buf:[{t,x,y,z,yaw}], seen, name, phase, last }

  function ensure(id, name) {
    let p = peers.get(id);
    if (!p) {
      const view = buildAvatar(id, name);
      view.root.visible = false;
      scene.add(view.root);
      p = { id, name, view, buf: [], seen: performance.now() / 1000, phase: 0, speed: 0, pos: null, yaw: 0 };
      peers.set(id, p);
    }
    return p;
  }

  function dispose(p) {
    scene.remove(p.view.root);
    p.view.tag.material.map.dispose();
    p.view.tag.material.dispose();
  }

  return {
    get count() { return peers.size; },
    positions() { return [...peers.values()].map((p) => ({ id: p.id, name: p.name, x: p.view.root.position.x, z: p.view.root.position.z, visible: p.view.root.visible })); },
    names() { return [...peers.values()].map((p) => p.name); },
    has: (id) => peers.has(id),
    add(id, name) { ensure(id, name); },
    remove(id) { const p = peers.get(id); if (p) { dispose(p); peers.delete(id); } },
    clear() { for (const p of peers.values()) dispose(p); peers.clear(); },
    /** 收到對方狀態：[x, y, z, yaw] */
    push(id, name, s, area = 'street') {
      const p = ensure(id, name);
      if (p.area !== area) { p.buf.length = 0; p.pos = null; p.speed = 0; p.view.root.visible = false; }
      p.area = area;
      const now = performance.now() / 1000;
      p.seen = now;
      p.buf.push({ t: now, x: s[0], y: s[1], z: s[2], yaw: s[3] });
      if (p.buf.length > 24) p.buf.shift();
    },
    update(dt, camPos, area = 'street') {
      const now = performance.now() / 1000;
      const rt = now - DELAY;
      for (const [id, p] of peers) {
        if (now - p.seen > STALE) { dispose(p); peers.delete(id); continue; }
        if (p.area !== area) { p.view.root.visible = false; continue; }
        const b = p.buf;
        if (!b.length) continue;
        let a = b[0], c = b[b.length - 1];
        for (let i = 0; i < b.length - 1; i++) if (b[i].t <= rt && b[i + 1].t >= rt) { a = b[i]; c = b[i + 1]; break; }
        if (rt >= b[b.length - 1].t) a = c = b[b.length - 1];
        else if (rt <= b[0].t) a = c = b[0];
        const k = c.t > a.t ? (rt - a.t) / (c.t - a.t) : 1;
        let dy = c.yaw - a.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        const x = a.x + (c.x - a.x) * k, y = a.y + (c.y - a.y) * k, z = a.z + (c.z - a.z) * k;
        const yaw = a.yaw + dy * k;
        const v = p.view;
        if (p.pos) {
          const sp = Math.hypot(x - p.pos.x, z - p.pos.z) / Math.max(dt, 1e-3);
          p.speed += (Math.min(sp, 9) - p.speed) * Math.min(1, dt * 8);
        } else p.pos = { x, z };
        p.pos.x = x; p.pos.z = z;
        v.root.position.set(x, y, z);
        v.root.visible = true;
        // 玩家 yaw=0 朝 −Z，與模型面向一致，直接套用
        v.body.rotation.y = yaw;
        p.phase += p.speed * dt * 1.7;
        const sw = Math.min(1, p.speed / 3) * 0.75, s = Math.sin(p.phase);
        v.legL.rotation.x = s * sw; v.legR.rotation.x = -s * sw;
        v.armL.rotation.x = -s * sw * 0.8; v.armR.rotation.x = s * sw * 0.8;
        v.body.position.y = Math.abs(Math.cos(p.phase)) * 0.025 * Math.min(1, p.speed / 3);
        if (camPos) {
          const d = Math.hypot(camPos.x - x, camPos.z - z);
          v.tag.material.opacity = d < FADE_NEAR ? 1 : Math.max(0, 1 - (d - FADE_NEAR) / (FADE_FAR - FADE_NEAR));
          v.tag.visible = v.tag.material.opacity > 0.02;
        }
      }
    },
  };
}
