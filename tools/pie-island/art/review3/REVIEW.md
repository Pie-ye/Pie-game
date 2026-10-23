# 審稿三：暖蘋果

2.4 m 鏡頭下，六個人的顏色、短脖子、三頭身、草帽丸子、毛帽白球、花冠、帽 T 白繩都留對了。剩下的差距集中在兩件事：影階還是固有色乘暗，所以下巴、髮底、袖口是一圈灰褐；身體和瀏海仍是球、膠囊、圓環硬拼，每顆零件自己跑一條明暗，剪影是一串珠子。

`MeshToonMaterial` 不吃 roughness／metalness。`MAT` 那張表和頭髮的 `metalness: 0.02` 現在沒有作用，不必再調。

頭的座標仍是頭心本地，原點在世界 y=1.15。`+Y` 朝上，`+Z` 朝前。

三處 three.js 的極限，下面每項都會碰到，先記在這裡：

- 分開的 mesh 不能共用法線。每顆 `SphereGeometry` 的法線從自己的球心射出，卡通材質就各自畫出一顆球的高光。要合成一個零件，就得合併成一個幾何，再把法線改成這個零件的方向，而不是球的方向。
- `SphereGeometry`、`CapsuleGeometry` 的輪廓只有橢球和膠囊。連指手套的拇指、靴子的鞋頭做不出來。改用 `LatheGeometry` 或 `ExtrudeGeometry`。
- `LatheGeometry` 是繞一根軸轉出來的。它做不出兩個袖窿，也做不出帽簷。`headShell` 只是頭形沿法線加厚，加不出跟頭形不一樣的瀏海、帽冠、後頸。那些要另建 mesh。

全畫面深度邊緣這版可以留。閾值 `smoothstep(0.035, 0.09, rel)` 在 2.4 m 處約要 8 cm 的深度落差才出線，零件之間 2–5 cm 的接縫不會被描上。不要把閾值調低，也不要改回倒殼。

## 前 8 個問題

### 1. 影階仍是固有色乘暗

`RAMP_CHAR` 是 `makeRamp(0.3, 0.66, 0.045, 0.5, 0.78)`。`getGradientIrradiance` 只取 ramp 的 `.r`，再乘燈光、再乘固有色。影階是固有色的 0.50，中間階是 0.78，亮階是 1.0。蜜桃膚 `#F3C6A8` 的影變成大約 `#7A6354`，焦糖髮的下緣變成一條深褐。六張正面的下巴、袖口、髮底都是這一圈。

這不是階的位置錯了。0.30／0.66、半寬 0.045 留著。錯的是 ramp 被當成亮度。具體改法在下面「依零件影色」一節，這裡只定顏色，跟審稿二相同：

| 零件 | 影階 |
| --- | --- |
| 皮膚、臉片、手套 | 固有色往 `#D7C2B8` 混 16% |
| 布 | 固有色往 `#C3C7D3` 混 28% |
| 珊瑚 `#F08A86`、`#E25B45` | 只混 16% |
| 髮，明度 ≥ 0.25 | 往 `#C3C7D3` 混 22% |
| 髮，明度 < 0.25（墨棕、石板） | 固有色乘 0.75，不混灰 |
| 鞋 | 往 `#9D836A` 混 24% |
| 草帽 | 往 `#C4A574` 混 20% |
| 亮階（全部） | 固有色往 `#F6E2C4` 混 14% |

頭髮的 rim 仍沒做：`#F6E2C4`、強度 0.12，只加在 `1 - N·V > 0.65` 且 `N·L < 0.50` 的像素上。跟影色寫在同一個 shader 裡。

頭上的頂點遮蔽現在把下巴乘到 0.82，會把上面的混色又乘暗一次。下巴那項改成 0.94，腋下 0.90、腿內側 0.92、髮根 0.90。接縫壓得住就好。

### 2. 瀏海是五顆球，每顆自己有高光

`bangs5` 的五顆橢球，半徑約 `(0.040, 0.026, 0.018)`，球心間距 0.056，幾何上有重疊，但法線不連。`look0` 額前是一排豆，`look2` 的粉瀏海是一條毛毛蟲。`04-hairstyles.png` 的瀏海是一整片，下緣一條淺弧，貼在眉上。

極限就是上面說的：分開的球不能共用法線。不要再加橢球。改成一片網格，法線全部朝臉的前方：

```js
function bangStrip(H, which = [0, 1, 2, 3, 4]) {
  const xs = [-0.112, -0.056, 0, 0.056, 0.112];
  const pos = [], nrm = [], idx = [];
  const push = (x, y, z, nx, ny, nz) => { pos.push(x, y, z); nrm.push(nx, ny, nz); return (pos.length / 3) - 1; };
  const cols = which.map((i) => xs[i]);
  for (let i = 0; i < cols.length; i++) {
    const x = cols[i];
    const y0 = 0.060, y1 = x === 0 ? 0.100 : 0.112;
    const z0 = H.frontZ(x, 0.09) + 0.006;
    const fwd = new THREE.Vector3(0, -0.18, 1).normalize();
    const a = push(x, y0, z0, fwd.x, fwd.y, fwd.z);
    const b = push(x, y1, z0 - 0.006, fwd.x, fwd.y, fwd.z);
    const c = push(x, y0, z0 - 0.016, 0, 0, -1);
    const d = push(x, y1, z0 - 0.020, 0, 0, -1);
    if (i) {
      const p = (i - 1) * 4;
      idx.push(p, a, p + 1, p + 1, a, b, p + 2, p, a, a, p + 2, c, p + 3, d, b, p + 1, p + 3, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}
```

中間那排矮 1.2 cm，額中留一條淺弧，不要留 1 cm 的空洞。旁分只用 `which = [0, 1, 2]`，鮑伯和長髮用 `[0, 1, 3, 4]`。下緣仍是 y=0.062。整片只有一條明暗，不會再出現五顆高光。

### 3. 手臂是膠囊、肘是球、手是橢球

上臂 `CapsuleGeometry(0.05, 0.115)`、肘球半徑 0.047、前臂半徑 0.044，三段粗細幾乎一樣，肘球從管子兩側凸出來。手套是縮放 `(0.058, 0.036, 0.024)` 的球，拇指再一顆更小的球。2.4 m 下六個人的手都是腕子末端的圓頭，肘是一顆珠。設計稿的前臂往手腕收，連指手套比手腕寬，拇指在內側。

極限：膠囊不能一頭粗一頭細，球縮放永遠是橢球，拇指只能再疊一顆球。肘球刪掉。上臂和前臂各用一段旋轉體，在關節重疊 1.5 cm，關節就不用珠子去填：

```js
// 肩關節本地，+Y 朝肩、手臂沿 -Y 長出去
upperArm: lathe([[0.02, 0.056], [-0.02, 0.050], [-0.10, 0.046], [-0.155, 0.044], [-0.170, 0]], 0.92),
// 肘關節本地。肘在上臂 y=-0.165，這段從 y=+0.02 開始，埋進上臂 1.5 cm
foreArm:  lathe([[0.02, 0.044], [-0.03, 0.040], [-0.09, 0.034], [-0.132, 0.030], [-0.145, 0]], 0.90),
```

手套不要用球。用擠出，輪廓先畫出拇指：

```js
function mittenShape() {
  const s = new THREE.Shape();
  s.moveTo(-0.028, -0.006);
  s.lineTo(-0.030, -0.055);
  s.quadraticCurveTo(-0.020, -0.086, 0.010, -0.082);
  s.quadraticCurveTo(0.048, -0.074, 0.050, -0.040);
  s.lineTo(0.042, -0.006);
  s.quadraticCurveTo(0.006, 0.010, -0.028, -0.006);
  return s;
}
// 厚度 0.048，倒角 0.006。掛在手關節，本地 Y 仍朝下
new THREE.ExtrudeGeometry(mittenShape(), { depth: 0.048, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2, curveSegments: 8 });
```

擠出之後 `rotation.x = π/2`，讓厚度朝前，再往掌心收 0.012，讓腕口埋進前臂末端。左右手各做一份，拇指在 −X 的那一側靠身體中線（右手鏡射這張 shape）。顏色仍是膚色往 `#E07860` 混 20%。腕口的圓環刪掉，前臂旋轉體的末端就是袖口。

### 4. 靴子是球加方盒，鞋底四個角伸出來

鞋身是球縮放 `(0.056, 0.090, 0.082)`，高 18 cm、頂在世界 y=0.220。鞋底是 `0.116 × 0.024 × 0.170` 的盒子，比球寬 4 mm、長 6 mm，方角會從圓頭下面露出來。靴口再加一圈管徑 0.014 的圓環，自己有一圈高光。`01-turnaround.png` 的鞋是一隻圓頭、鞋底略寬、靴口一個軟的翻邊，不是三個零件。

球做不出鞋頭比跟高這件事，盒子做不出圓角鞋底。改成一隻旋轉體，再把 Z 拉長，鞋底用頂點色，不要另加盒子和圓環：

```js
// 腳踝本地。腳踝世界 y=0.165，所以本地 y = 世界 y − 0.165
// (y, r)：底、腰、踝、靴口
boot: lathe([
  [-0.165, 0.046], [-0.150, 0.058], [-0.130, 0.050],
  [-0.04, 0.048], [0.02, 0.054], [0.045, 0.060], [0.052, 0],
], 1),
```

建好之後 `scale.z = 1.28`，`position.z = 0.012`，鞋頭在前。世界高度：底在 y=0，靴口在 y=0.217，跟現在的高度一樣，小腿裸露仍是約 10 cm。鞋底著色：本地 y < −0.148 的頂點色設成 0.72，材質打開 `vertexColors`，影色仍走鞋的那條（往 `#9D836A` 混 24%）。

### 5. 袖子是肩上第二個旋轉體，袖口一圈甜甜圈

袖子剖面最大半徑 0.066，上臂半徑 0.050，肩線上多出 1.6 cm 的一圈布。袖口 `TorusGeometry(0.054, 0.008)` 在 y=−0.062，管面的法線轉一圈，卡通材質就畫出一條亮環。六個人的袖口都有這一條。設計稿的短袖是從肩收到袖口，袖口只是布的邊緣。

圓環刪掉。袖子留在肩關節上，末端收到跟手臂一樣粗，收口本身就是袖襬：

```js
sleeve: lathe([
  [0.015, 0.0], [0.012, 0.054], [-0.01, 0.052],
  [-0.045, 0.048], [-0.072, 0.046], [-0.080, 0],
], 0.92),
longSleeve: lathe([
  [0.015, 0.0], [0.012, 0.054], [-0.01, 0.052],
  [-0.08, 0.046], [-0.118, 0.044], [-0.126, 0],
], 0.92),
```

y=0.015 那一圈埋進軀幹。Z 縮到 0.92，袖子不要比手臂更圓。帽 T 用 `longSleeve`，末端在 y=−0.126。背心繼續不畫外袖，只留裡層米白的手臂。

背心的另一個極限：`vest` 用 `phiStart = 0.42`、`phiLength = 2π − 0.84`，缺口是繞身體的一塊扇形，不是左右兩個袖窿。`look3` 的薄荷綠因此變成胸前一條，兩側露出裡層白衣。旋轉體補不出兩個洞。改成整圈的殼（腰 y=0.64 到肩 y=0.93，外偏 0.014），再刪三角形：

- 袖窿：`|x| > 0.11 && y > 0.80`
- 領口：`y > 0.90 && |x| < 0.07 && z > 0`

刪完之後沿邊界各補一圈管徑 0.008 的圓口，做法跟 `headShell` 的邊緣一樣。領口的那圈大圓環（`TorusGeometry(0.068, 0.013)`）拿掉，否則領子又是一條甜甜圈。

### 6. 雙馬尾的殼切掉半顆頭，頭皮露出來

`look.hair === 5` 的 `keep` 是 `y > 0.04 && z < 0.04`。殼只留頭頂靠後的一塊。太陽穴、後腦下半都不在殼裡。尾巴又放在 `(±0.18, −0.05, −0.09)`，從正面只在頰旁露出一截。所以 `look2` 的正面是光頭頂著一排粉瀏海，四分之三側看得到頭皮。`04-hairstyles.png` 的雙馬尾是滿頭的髮，從耳後垂到鎖骨，粉圈在起點。

`z < 0.04` 是審稿二為了拿掉頰上那片厚髮。頰側不要殼，頭的其餘部分要留：

```js
shell(0.04, 0.01, 'twin3', (x, y, z) => y > -0.04 && !FACE_WIN(x, y, z) && !NOTCH(x, y, z)
  && !(z > 0.02 && Math.abs(x) > 0.10 && y < 0.08));
```

`FACE_WIN` 繼續把臉讓出來。後面那項只挖掉頰前，後腦和頭頂留著。瀏海仍用第 2 項的一片。髮圈、尾巴、尾端的數字維持審稿二：圈在 `(±0.16, 0.05, −0.05)`，尾巴膠囊半徑 0.034、長 0.14，尾端球半徑 0.032 在 `(±0.21, −0.15, −0.10)`。

殼和髮圈之間加一截，否則耳後會斷：膠囊半徑 0.026、長 0.05，中心 `(±0.17, 0.02, −0.04)`。

### 7. 棒球帽用頭殼去長，帽冠是一顆頭，帽簷又往前推

審稿二的冠是 `keep: y > 0.10 && z < 0.02`，帽簷盒子中心 `(0, 0.10, 0.15)`。現在的 `keep` 寫成 `z < 0.02 + 0.12`，殼往前蓋到 z=0.14，額髮被吃掉。帽簷中心又加上 `style.outer * 0.6` 和 `style.outer * 0.4`，旁分的 `outer` 是 0.044，中心變成約 `(0, 0.126, 0.168)`。盒子深 0.09，前緣在 z≈0.21，四分之三視角切過眼睛。`look4` 的黃髮被冠切成一塊，帽子讀成貝雷帽。

極限：`headShell` 長出來的永遠是頭的形狀，不會有棒球帽那種平一點的前片和圓頂。冠不要用 `headShell`。

```js
const crown = new THREE.Group();
crown.add(mesh(new THREE.CylinderGeometry(0.150, 0.172, 0.07, 28), c, 0, hairTop - 0.02, -0.01));
crown.add(mesh(new THREE.SphereGeometry(0.150, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), c, 0, hairTop + 0.012, -0.01, 1, 0.55, 1));
crown.add(mesh(G.ball, c, 0, hairTop + 0.09, -0.01, 0.016));
head.add(crown);
const brim = mesh(new THREE.BoxGeometry(0.17, 0.010, 0.07), c, 0, hairTop - 0.05, 0.12);
brim.rotation.x = -deg(15);
head.add(brim);
```

`hairTop` 是 `H.top + outer`，旁分約 0.27，帽簷在 y≈0.22，眼睛在本地 y≈0。前緣 z = 0.12 + 0.035 = 0.155，對到額，不蓋過眼睛。瀏海和旁分的側髮留在帽簷下面。毛帽繼續用現在的薄殼（`y > 0.13 && z < 0.06`），那個是帽，用頭殼是對的。

### 8. 臉片整片同一個法線，五官浮在頭上

臉片先鋪滿膚色再羽化 6%，材質是 `MeshToonMaterial`，`emissiveIntensity` 0.35。射線打到頭上之後又 `computeVertexNormals()`。臉被打平之後這片幾乎是平面，法線都朝 +Z，整張臉落在同一個階上。頭的頰已經進了影階，臉還是亮的，邊緣一圈羽化就看出是貼上去的。六張正面的眼睛都比頰亮一截。

法線跟頭頂點走，不要讓這片自己算：

```js
const fn = new Float32Array(fp.count * 3);
for (let i = 0; i < fp.count; i++) {
  const origin = new THREE.Vector3(fp.getX(i), fp.getY(i), 0.5);
  const h = hit(origin, back);
  fp.setZ(i, h && h.z > 0.02 ? h.z + 0.002 : 0);
  const n = h && h.face ? h.face.normal : new THREE.Vector3(0, 0, 1);
  fn[i * 3] = n.x * 0.65;
  fn[i * 3 + 1] = n.y * 0.65;
  fn[i * 3 + 2] = n.z * 0.65 + 0.35;
}
face.setAttribute('normal', new THREE.BufferAttribute(fn, 3));
face.normalizeNormals();
```

0.65 的頭法線讓明暗切過頰，0.35 的 +Z 讓臉的正面留在中間階，眼睛不會整顆掉進影子。設完不要再呼叫 `computeVertexNormals()`。

`emissiveIntensity` 從 0.35 降到 0.22。自發光仍只有五官那張圖，臉的膚色底要吃到和第 1 項一樣的影色。羽化 6% 留著。

## 依零件影色

這版 three（`pie-phoebe/vendor/three.module.js`）的卡通光照在 chunk `lights_toon_pars_fragment`。現在的函式是：

```glsl
vec3 irradiance = getGradientIrradiance(geometryNormal, directLight.direction) * directLight.color;
reflectedLight.directDiffuse += irradiance * BRDF_Lambert(material.diffuseColor);
```

`getGradientIrradiance` 在 `gradientmap_pars_fragment`，`USE_GRADIENTMAP` 時只回 `vec3(texture2D(gradientMap, coord).r)`。`coord.x = N·L * 0.5 + 0.5`。這個純量接著乘燈光、再乘固有色，所以影階一定是乘暗。把 ramp 畫成彩色也沒有用，因為這裡只取 `.r`。

改這一個 chunk。`material.diffuseColor` 這時候已經乘過貼圖和頂點色，條紋衫會逐像素混，不用另寫。`#include <lights_toon_pars_fragment>` 整段換掉，結構、兩個函式、兩個 `#define` 都要留，否則 `lights_fragment_begin` 呼叫 `RE_Direct` 會編不過。

```js
const TOON_PARS = /* glsl */`
  uniform vec3 uShadow;
  uniform float uShadowT;
  uniform float uDarkMul;
  uniform vec3 uLit;
  uniform float uLitT;
  uniform float uRim;
  varying vec3 vViewPosition;
  struct ToonMaterial { vec3 diffuseColor; };
  void RE_Direct_Toon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
    float ndl = dot(geometryNormal, directLight.direction);
    float w = 0.045;
    float shadowW = 1.0 - smoothstep(0.30 - w, 0.30 + w, ndl);
    float litW = smoothstep(0.66 - w, 0.66 + w, ndl);
    vec3 albedo = material.diffuseColor;
    vec3 shadowCol = uDarkMul > 0.0 ? albedo * uDarkMul : mix(albedo, uShadow, uShadowT);
    vec3 litCol = mix(albedo, uLit, uLitT);
    vec3 tone = mix(albedo, shadowCol, shadowW);
    tone = mix(tone, litCol, litW);
    reflectedLight.directDiffuse += tone * directLight.color * RECIPROCAL_PI;
    float rim = smoothstep(0.65, 0.85, 1.0 - dot(geometryNormal, geometryViewDir));
    reflectedLight.directDiffuse += uLit * rim * step(ndl, 0.50) * uRim * directLight.color;
  }
  void RE_IndirectDiffuse_Toon( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
    vec3 albedo = material.diffuseColor;
    vec3 shadowCol = uDarkMul > 0.0 ? albedo * uDarkMul : mix(albedo, uShadow, uShadowT);
    reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert(mix(shadowCol, albedo, 0.35));
  }
  #define RE_Direct RE_Direct_Toon
  #define RE_IndirectDiffuse RE_IndirectDiffuse_Toon
`;

function applyShadow(material, { color = '#C3C7D3', t = 0.28, darkMul = 0, rim = 0 } = {}) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uShadow = { value: new THREE.Color(color) };
    shader.uniforms.uShadowT = { value: t };
    shader.uniforms.uDarkMul = { value: darkMul };
    shader.uniforms.uLit = { value: new THREE.Color('#F6E2C4') };
    shader.uniforms.uLitT = { value: 0.14 };
    shader.uniforms.uRim = { value: rim };
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_toon_pars_fragment>', TOON_PARS);
  };
  const key = `sh|${color}|${t}|${darkMul}|${rim}`;
  material.customProgramCacheKey = () => key;
  return material;
}
```

`mat()`、`clothMat()`、頭的 `headM`、臉的 `faceMat` 在 `new MeshToonMaterial` 之後都呼叫 `applyShadow`。`gradientMap: RAMP` 可以留著，這段 shader 不再讀它，階的位置改由 0.30／0.66 決定。快取鍵要算進影色參數，同一件 hex 的皮膚和布不能共用一個材質。

各零件傳入：

```js
applyShadow(skinM,  { color: '#D7C2B8', t: 0.16 });
applyShadow(headM,  { color: '#D7C2B8', t: 0.16 });
applyShadow(faceMat,{ color: '#D7C2B8', t: 0.16 });
applyShadow(mittenM,{ color: '#D7C2B8', t: 0.16 });
applyShadow(topM,   { color: '#C3C7D3', t: hot ? 0.16 : 0.28 });
applyShadow(shoeM,  { color: '#9D836A', t: 0.24 });
applyShadow(straw,  { color: '#C4A574', t: 0.20 });
applyShadow(hairM, hairLuma < 0.25
  ? { darkMul: 0.75, rim: 0.12 }
  : { color: '#C3C7D3', t: 0.22, rim: 0.12 });
```

`hot` 是上衣或裙子的 hex 為 `#F08A86` 或 `#E25B45`。`hairLuma` 用現在臉貼圖那個相對明度。

直接光每盞都會加一份 `tone`。主光強度 2.3 維持不動，中間階會比現在亮約四分之一（現在中間階先乘了 0.78）。這是要的，影階不該再比中間階暗一截。若角色整顆比草地還亮，把 `tone` 乘 0.9，不要乘回 0.5。捏臉場景另外有一盞強度 1.0 的冷色方向光，會再加一份固有色，把臉洗淡。那盞降到 0.25。

環境光走 `RE_IndirectDiffuse_Toon`，用影色和固有色各半，不再用半球光的灰去乘第二次。主光被投影貼圖乘掉的時候，留下的是這層，樹蔭下不會變黑。

## 這一版可以留著

額收窄 0.12／0.05／0.15、臉打平的 z 漸入、頭頂不再加厚 70%、短脖子、三頭身、長裙收到 y=0.18、草帽丸子抬到帽簷上、毛帽只包 y>0.13、花冠五朵在前半圈、帽 T 的白繩和肩後帽兜、連身裙同色袖、大條紋、圓框眼鏡的尺寸、眨眼和五個表情。這些都對。

改第 2 到第 7 項時，不要把瀏海改回第二層頭殼，不要把額收窄加回 0.24，也不要把袖子半徑加回 0.086。

`review3/target-lineup.png` 是這六個人站在 `island/concept/02-plaza.png` 那種廣場上的目標。頭身是暖蘋果的三頭身，明暗是軟的三階，沒有零件之間的線。
