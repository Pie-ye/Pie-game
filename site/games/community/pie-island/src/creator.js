import * as THREE from '../../pie-phoebe/vendor/three.module.js';
import { FIELDS, GROUPS, sanitize, randomLook, HAIR_COLORS } from './look.js';
import { drawFaceIcon } from './face.js';
import { createCharacter } from './character.js';

// 捏臉畫面：左邊 3D 預覽（拖曳旋轉），右邊分頁選項。
// 臉部五官的選項直接畫成小臉，顏色欄位是色票。
const FACE_KEYS = new Set(['eyes', 'eyeColor', 'brows', 'nose', 'mouth', 'blush']);

export function createCreator({ root, onDone, onCancel, onChange }) {
  const canvas = root.querySelector('#creator-canvas');
  const fieldsEl = root.querySelector('#creator-fields');
  const tabsEl = root.querySelector('#creator-tabs');
  let look = null, original = null, group = 'face', open = false, first = false;
  let renderer = null, scene, camera, char, raf = 0, spin = 0.3, drag = null, last = 0, emoteT = 99;

  function initGL() {
    if (renderer) return;
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    scene.add(new THREE.HemisphereLight('#fff6e8', '#9fd18a', 2.1));
    const key = new THREE.DirectionalLight('#ffffff', 2.2);
    key.position.set(1.5, 3, 2.5); scene.add(key);
    const rim = new THREE.DirectionalLight('#bfe6ff', 1.0);
    rim.position.set(-2, 2, -2); scene.add(rim);
    const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.82, 0.12, 40), new THREE.MeshStandardMaterial({ color: '#8fd47a', roughness: 0.9 }));
    pod.position.y = -0.06; scene.add(pod);
    const rimRing = new THREE.Mesh(new THREE.TorusGeometry(0.79, 0.03, 8, 48), new THREE.MeshStandardMaterial({ color: '#f6eacb' }));
    rimRing.rotation.x = Math.PI / 2; rimRing.position.y = 0.0; scene.add(rimRing);
    char = createCharacter(look);
    scene.add(char.root);
    canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, spin }; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', (e) => { if (drag) spin = drag.spin + (e.clientX - drag.x) * 0.012; });
    const end = () => { drag = null; };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  function resize() {
    if (!renderer) return;
    const r = canvas.getBoundingClientRect();
    const w = Math.max(120, Math.round(r.width)), h = Math.max(120, Math.round(r.height));
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // 讓整個人（約 1.9 m 高、1.3 m 寬，含帽子與台座）不論畫面比例都放得下
    const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const d = Math.max(1.0 / t, 0.7 / (t * camera.aspect)) + 0.4;
    camera.position.set(0, 0.95, d);
    camera.lookAt(0, 0.72, 0);
    camera.updateProjectionMatrix();
  }
  if (window.ResizeObserver) new ResizeObserver(() => { if (open) resize(); }).observe(canvas);

  function frame(now) {
    if (!open) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now;
    if (!drag) spin += Math.sin(now / 2400) * dt * 0.15;
    emoteT += dt;
    char.root.rotation.y = spin;
    char.animate(dt, { speed: 0, emote: emoteT < 1.6 ? 'happy' : null, emoteT });
    renderer.render(scene, camera);
  }

  function renderTabs() {
    tabsEl.innerHTML = '';
    for (const g of GROUPS) {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = g.label; b.dataset.group = g.id;
      b.className = g.id === group ? 'on' : '';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(g.id === group));
      b.addEventListener('click', () => { group = g.id; renderTabs(); renderFields(); });
      tabsEl.append(b);
    }
  }

  function renderFields() {
    fieldsEl.innerHTML = '';
    for (const f of FIELDS.filter((x) => x.group === group)) {
      const row = document.createElement('div');
      row.className = 'field';
      const h = document.createElement('h3');
      h.textContent = f.label;
      row.append(h);
      const list = document.createElement('div');
      list.className = f.colors ? 'swatches' : (FACE_KEYS.has(f.key) ? 'icons' : 'chips');
      list.setAttribute('role', 'radiogroup');
      list.setAttribute('aria-label', f.label);
      const n = (f.colors || f.options).length;
      for (let i = 0; i < n; i++) {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.key = f.key; b.dataset.value = String(i);
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(look[f.key] === i));
        if (look[f.key] === i) b.classList.add('on');
        if (f.colors) {
          b.style.setProperty('--sw', f.colors[i]);
          b.setAttribute('aria-label', `${f.label} ${i + 1}`);
        } else if (FACE_KEYS.has(f.key)) {
          const cv = document.createElement('canvas');
          cv.width = cv.height = 72;
          drawFaceIcon(cv, { ...look, [f.key]: i }, HAIR_COLORS[look.hairColor]);
          b.append(cv);
          const s = document.createElement('span'); s.textContent = f.options[i]; b.append(s);
          b.setAttribute('aria-label', f.options[i]);
        } else {
          b.textContent = f.options[i];
        }
        b.addEventListener('click', () => set(f.key, i));
        list.append(b);
      }
      row.append(list);
      fieldsEl.append(row);
    }
  }

  function set(key, value) {
    look = sanitize({ ...look, [key]: value });
    char.setLook(look);
    renderFields();
    onChange && onChange(look);
  }

  root.querySelector('#creator-random').addEventListener('click', () => {
    look = sanitize(randomLook());
    char.setLook(look); emoteT = 0;
    renderFields();
    onChange && onChange(look);
  });
  root.querySelector('#creator-done').addEventListener('click', () => { close(); onDone(look, first); });
  root.querySelector('#creator-cancel').addEventListener('click', () => {
    // 第一次進島時這顆是「先用這樣」：直接用目前的樣子
    if (first) { close(); onDone(look, true); return; }
    const was = original; close(); onCancel && onCancel(was);
  });
  window.addEventListener('resize', () => { if (open) resize(); });

  function close() {
    open = false;
    cancelAnimationFrame(raf);
    root.hidden = true;
    document.body.classList.remove('creating');
  }

  return {
    get open() { return open; },
    get look() { return look; },
    show(current, opts = {}) {
      look = sanitize(current); original = look; first = Boolean(opts.first);
      root.querySelector('#creator-cancel').textContent = first ? '先用這樣' : '取消';
      root.querySelector('#creator-title').textContent = first ? '歡迎來到小島！先捏一個自己吧' : '捏臉';
      initGL();
      char.setLook(look);
      root.hidden = false;
      document.body.classList.add('creating');
      open = true;
      group = 'face';
      renderTabs(); renderFields();
      resize();
      last = performance.now();
      emoteT = 0;
      raf = requestAnimationFrame(frame);
    },
    close,
    set,
  };
}
