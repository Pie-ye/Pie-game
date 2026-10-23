import * as THREE from '../../pie-phoebe/vendor/three.module.js';

// 日式動漫薄塗畫風（美術聖經 tools/pie-island/art/island/ART-BIBLE.md）：
// 三階卡通著色、暖褐描邊（畫面空間的深度邊緣）、抬亮暗部的調色。

// ---------- 三階明暗 ----------
// three 的卡通材質用 dot(N,L)*0.5+0.5 查表。聖經的階：N·L 0–0.42 影、0.42–0.72 中、0.72–1 亮，
// 階之間約 0.04 的軟邊。查表寬 256，線性取樣。
function makeRamp(t1 = 0.42, t2 = 0.72, w = 0.02, lo = 0.36, mid = 0.66) {
  const N = 256, data = new Uint8Array(N * 4);
  const step = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
  for (let i = 0; i < N; i++) {
    const nl = (i / (N - 1)) * 2 - 1;
    const v = lo + (mid - lo) * step(t1 - w, t1 + w, nl) + (1 - mid) * step(t2 - w, t2 + w, nl);
    const c = Math.round(v * 255);
    data.set([c, c, c, 255], i * 4);
  }
  const t = new THREE.DataTexture(data, N, 1, THREE.RGBAFormat);
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}
export const RAMP = makeRamp();
// 角色用高一階的同一套三階（審稿二）：影 0–0.30、中 0.30–0.66、亮 0.66–1，平滑半寬 0.045，影階亮一點
export const RAMP_CHAR = makeRamp(0.3, 0.66, 0.045, 0.5, 0.78);

// ---------- 依零件影色（審稿三）：影階是固有色往指定色混，不是乘暗 ----------
// 換掉 three 的 lights_toon_pars_fragment；階的位置 t1／t2 可調（角色 0.30／0.66、場景 0.42／0.72）
const toonPars = (t1, t2, soft) => /* glsl */`
  uniform vec3 uShadow; uniform float uShadowT; uniform float uDarkMul;
  uniform vec3 uLit; uniform float uLitT; uniform float uRim;
  uniform vec3 uSun; uniform float uLotus;
  varying vec3 vViewPosition;
  struct ToonMaterial { vec3 diffuseColor; };
  void RE_Direct_Toon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
    float ndl = dot(geometryNormal, directLight.direction);
    float w = ${soft.toFixed(3)};
    float shadowW = 1.0 - smoothstep(${t1.toFixed(3)} - w, ${t1.toFixed(3)} + w, ndl);
    float litW = smoothstep(${t2.toFixed(3)} - w, ${t2.toFixed(3)} + w, ndl);
    vec3 albedo = material.diffuseColor;
    vec3 shadowCol = uDarkMul > 0.0 ? albedo * uDarkMul : mix(albedo, uShadow * dot(albedo, vec3(0.333)) * 1.4, uShadowT);
    vec3 litCol = mix(albedo, uLit, uLitT);
    vec3 tone = mix(albedo, shadowCol, shadowW);
    tone = mix(tone, litCol, litW);
    // 影子貼圖在進這裡之前已經把 directLight.color 乘掉。用沒被乘過的 uSun 算三階，影子只再往影色拉一點。
    float occ = clamp(length(directLight.color) / max(length(uSun), 0.001), 0.0, 1.0);
    tone = mix(tone, shadowCol, (1.0 - occ) * 0.45);
    reflectedLight.directDiffuse += tone * uSun * RECIPROCAL_PI * 0.9;
    float rim = smoothstep(0.65, 0.85, 1.0 - dot(geometryNormal, geometryViewDir));
    reflectedLight.directDiffuse += uLit * rim * step(ndl, 0.50) * uRim * uSun * occ * RECIPROCAL_PI;
  }
  void RE_IndirectDiffuse_Toon( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
    vec3 albedo = material.diffuseColor;
    vec3 shadowCol = uDarkMul > 0.0 ? albedo * uDarkMul : mix(albedo, uShadow * dot(albedo, vec3(0.333)) * 1.4, uShadowT);
    reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert(mix(shadowCol, albedo, 0.35));
  }
  #define RE_Direct RE_Direct_Toon
  #define RE_IndirectDiffuse RE_IndirectDiffuse_Toon
`;
/**
 * 讓卡通材質的影階往 color 混 t（darkMul>0 時改成乘這個倍數，給很深的頭髮用）。
 * 保留材質原本的 onBeforeCompile（地形的貼圖混合）。
 */
const LEAF_MAP = /* glsl */`
  #include <map_fragment>
  float leafL = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
  vec3 leafCol = mix(vec3(0.227, 0.361, 0.306), vec3(0.345, 0.467, 0.376), smoothstep(0.15, 0.45, leafL));
  vec3 leafHi = uLotus > 0.5 ? vec3(0.906, 0.714, 0.784) : vec3(0.776, 0.808, 0.420);
  leafCol = mix(leafCol, leafHi, smoothstep(0.55, 0.85, leafL));
  diffuseColor.rgb = mix(diffuseColor.rgb, leafCol, 0.75);`;

export function applyShadow(material, { color = '#C3C7D3', t = 0.28, darkMul = 0, rim = 0, steps = [0.3, 0.66], soft = 0.045 } = {}) {
  const prev = material.onBeforeCompile;
  const pars = toonPars(steps[0], steps[1], soft);
  const leaf = material.userData.leaf || '';
  material.onBeforeCompile = (shader, r) => {
    if (prev) prev.call(material, shader, r);
    Object.assign(shader.uniforms, {
      uShadow: { value: new THREE.Color(color) }, uShadowT: { value: t }, uDarkMul: { value: darkMul },
      uLit: { value: new THREE.Color('#F6E2C4') }, uLitT: { value: 0.14 }, uRim: { value: rim },
      uSun: { value: new THREE.Color('#FFF4E0').multiplyScalar(1.15) },
      uLotus: { value: leaf === 'lotus' ? 1 : 0 },
    });
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_toon_pars_fragment>', pars);
    if (leaf) shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', LEAF_MAP);
  };
  const base = material.customProgramCacheKey ? material.customProgramCacheKey() : '';
  const key = `sh|${color}|${t}|${darkMul}|${rim}|${steps}|${soft}|${leaf}|${base}`;
  material.customProgramCacheKey = () => key;
  material.needsUpdate = true;
  return material;
}
export const SCENE_STEPS = [0.42, 0.72];

/** 場景網格的影色：葉子、木頭、石頭各自一套，其餘（牆、雲）偏雲底紫灰 */
function sceneShadow(name = '') {
  if (/leafsGreen|leafsDark|^grass$/.test(name)) return { color: '#3A5C4E', t: 0.45 };
  if (/woodBark|^wood$|^roof$/.test(name)) return { color: '#A8743E', t: 0.35 };
  if (/^stone$|^dirt$/.test(name)) return { color: '#9D836A', t: 0.30 };
  return { color: '#C3C7D3', t: 0.25 };
}

/** 把一個標準材質轉成卡通材質（保留顏色、貼圖、頂點色、透明度） */
const converted = new WeakMap();
export function toToon(m) {
  if (!m || m.isMeshToonMaterial || m.isShaderMaterial || m.isMeshBasicMaterial || m.isSpriteMaterial) return m;
  if (converted.has(m)) return converted.get(m);
  const t = new THREE.MeshToonMaterial({
    color: m.color ? m.color.clone() : 0xffffff,
    map: m.map || null,
    emissive: m.emissive ? m.emissive.clone() : 0x000000,
    emissiveMap: m.emissiveMap || null,
    emissiveIntensity: m.emissiveIntensity ?? 1,
    vertexColors: m.vertexColors,
    transparent: m.transparent, opacity: m.opacity, alphaTest: m.alphaTest,
    side: m.side, depthWrite: m.depthWrite,
    polygonOffset: m.polygonOffset, polygonOffsetFactor: m.polygonOffsetFactor, polygonOffsetUnits: m.polygonOffsetUnits,
    gradientMap: RAMP,
  });
  t.name = m.name;
  t.userData.leaf = m.userData.leaf || '';
  applyShadow(t, { ...sceneShadow(m.name), steps: SCENE_STEPS, soft: 0.04 });
  converted.set(m, t);
  return t;
}
export function toonify(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.material = Array.isArray(o.material) ? o.material.map(toToon) : toToon(o.material);
  });
  return root;
}

// ---------- 後製：描邊＋調色 ----------
// 場景先畫到帶深度貼圖的離屏目標，再用一個全畫面著色器：
// 依線性深度的相對落差找輪廓（草、小花這種小落差不畫線），線色 #6A5A4E，
// 抬暗部 0.04、高光略暖、飽和 1.04。
export function createPost(renderer) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { samples: 4, type: THREE.HalfFloatType });
  rt.depthTexture = new THREE.DepthTexture(size.x, size.y);
  rt.depthTexture.type = THREE.UnsignedIntType;
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      tColor: { value: rt.texture }, tDepth: { value: rt.depthTexture },
      uTexel: { value: new THREE.Vector2(1 / size.x, 1 / size.y) },
      uNear: { value: 0.1 }, uFar: { value: 900 },
      uLine: { value: new THREE.Color('#6A5A4E') },
      uLineOn: { value: 1 }, uPx: { value: 1 },
    },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: /* glsl */`
      uniform sampler2D tColor; uniform sampler2D tDepth; uniform vec2 uTexel;
      uniform float uNear; uniform float uFar; uniform vec3 uLine; uniform float uLineOn; uniform float uPx;
      varying vec2 vUv;
      float lin(vec2 uv) {
        float z = texture2D(tDepth, uv).x * 2.0 - 1.0;
        return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear));
      }
      void main() {
        vec4 c = texture2D(tColor, vUv);
        vec3 col = c.rgb;
        if (uLineOn > 0.5) {
          float d = lin(vUv);
          vec2 o = uTexel * uPx;
          float dx = max(abs(lin(vUv + vec2(o.x, 0.0)) - d), abs(lin(vUv - vec2(o.x, 0.0)) - d));
          float dy = max(abs(lin(vUv + vec2(0.0, o.y)) - d), abs(lin(vUv - vec2(0.0, o.y)) - d));
          float rel = max(dx, dy) / max(d, 0.001);
          float edge = smoothstep(0.11, 0.20, rel) * (1.0 - smoothstep(18.0, 36.0, d));
          if (d > uFar * 0.9) edge = 0.0;
          float mx = max(col.r, max(col.g, col.b));
          float mn = min(col.r, min(col.g, col.b));
          if (col.g > col.r && col.b > col.r && (mx - mn) < 0.16) edge = 0.0;
          float br = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
          edge *= step(0.28, br);
          col = mix(col, uLine, edge * 0.45);
        }
        // 只有暗部抬一點，飽和幾乎不動。高光加一層很窄的 bloom。
        float l0 = dot(col, vec3(0.299, 0.587, 0.114));
        float sh = 1.0 - smoothstep(0.18, 0.42, l0);
        col = mix(col, col * 0.96 + vec3(0.04, 0.042, 0.048), sh);
        float l = dot(col, vec3(0.299, 0.587, 0.114));
        col = mix(vec3(l), col, 1.01);
        col += vec3(0.018, 0.010, 0.0) * smoothstep(0.84, 1.0, l);
        vec3 bloom = (
          texture2D(tColor, vUv + uTexel * 2.0).rgb +
          texture2D(tColor, vUv - uTexel * 2.0).rgb +
          texture2D(tColor, vUv + vec2(uTexel.x, -uTexel.y) * 2.0).rgb +
          texture2D(tColor, vUv + vec2(-uTexel.x, uTexel.y) * 2.0).rgb
        ) * 0.25;
        float bl = dot(bloom, vec3(0.299, 0.587, 0.114));
        col += bloom * smoothstep(0.92, 1.0, bl) * 0.18;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    depthTest: false, depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  return {
    enabled: true,
    set lines(on) { mat.uniforms.uLineOn.value = on ? 1 : 0; },
    setSize() {
      const s = renderer.getDrawingBufferSize(new THREE.Vector2());
      rt.setSize(s.x, s.y);
      mat.uniforms.uTexel.value.set(1 / s.x, 1 / s.y);
      mat.uniforms.uPx.value = Math.max(1, s.y / 900);
    },
    render(sceneIn, camera) {
      if (!this.enabled) { renderer.setRenderTarget(null); renderer.render(sceneIn, camera); return; }
      mat.uniforms.uNear.value = camera.near; mat.uniforms.uFar.value = camera.far;
      renderer.setRenderTarget(rt);
      renderer.render(sceneIn, camera);
      renderer.setRenderTarget(null);
      renderer.render(scene, cam);
    },
  };
}

const shellMat = new THREE.MeshBasicMaterial({ color: '#6A5A4E', side: THREE.BackSide, fog: false });
shellMat.onBeforeCompile = (sh) => {
  sh.vertexShader = sh.vertexShader.replace(
    '#include <begin_vertex>',
    '#include <begin_vertex>\ntransformed += normal * (0.018 / max(length(mat3(modelMatrix) * normal), 1e-4));',
  );
};
shellMat.customProgramCacheKey = () => 'ink-shell';
/** 房子和角色的暖褐倒殼。沿法線推出約 1.8 cm，草、水、樹不要呼叫。 */
export function addInkShell(mesh) {
  if (!mesh?.isMesh || mesh.userData.shell || !mesh.geometry?.attributes?.normal) return;
  if (mesh.material?.transparent) return;
  const shell = new THREE.Mesh(mesh.geometry, shellMat);
  shell.userData.shell = true;
  shell.castShadow = false;
  shell.receiveShadow = false;
  mesh.add(shell);
}

/** 全景只提供雲的明暗，顏色換成色票。載入失敗就維持漸層天空。 */
export function loadSkyPanorama(url, sky, clouds) {
  new THREE.TextureLoader().load(url, (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    const u = sky.material?.uniforms;
    if (!u?.uMap) return;
    u.uMap.value = t;
    u.uHasMap.value = 1;
    if (clouds) clouds.visible = false;
  }, undefined, () => {});
}
