// 細節層：把 Poly Haven（CC0）的 PBR 材質依「世界座標」平鋪到場景表面。
//
// 為什麼不直接用 glTF 的貼圖：整條大道是一張 76 公尺長的手繪圖，每公尺只有幾十個像素，
// 再怎麼放大解析度也撐不出柏油的顆粒或混凝土的紋理。所以手繪圖只負責「圖案」
// （標線、窗戶、霓虹、色調），質感交給短小可平鋪的實拍材質：
//   最終反照率 = 手繪底色 × 細節倍率（每個色版平均為 1，不改變色相與亮度）
//   最終粗糙度 = 手繪粗糙度 × 細節相對粗糙度
//   法線       = 世界座標平鋪的法線貼圖
// 手繪粗糙度很低的地方（水窪、玻璃）自動把細節淡出，水面與玻璃才會是平的。
//
// 材質怎麼配由 Blender 決定：材質的自訂屬性 detail / detail2 會跟著 GLB 的 extras 進來。
// detail 是主材質；有 detail2 時，貼圖遮罩的 R 色版決定混合（0＝detail，1＝detail2）。
import * as THREE from '../../pie-phoebe/vendor/three.module.js';

const BASE = new URL('../assets/pbr/', import.meta.url);
const texCache = new Map();
let META = null;

export async function loadDetailLibrary(renderer) {
  META = await (await fetch(new URL('pbr.json', BASE))).json();
  return META;
}

function loadTex(name, kind, renderer) {
  const key = name + kind;
  if (!texCache.has(key)) {
    texCache.set(key, new THREE.TextureLoader().loadAsync(new URL(`${name}_${kind}.jpg`, BASE).href).then((t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = kind === 'c' ? THREE.SRGBColorSpace : THREE.NoColorSpace;   // c 是倍率的 sRGB 編碼；n 是資料
      t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      return t;
    }));
  }
  return texCache.get(key);
}
const tex = (name, kind) => texCache.get(name + kind);   // 只在 preloadDetail 完成後使用

// 先把場景用到的細節層全部載好，免得頭幾個影格因為貼圖還沒到而整片變黑
export async function preloadDetail(materials, renderer) {
  const jobs = [];
  for (const m of materials) {
    for (const k of ['detail', 'detail2']) {
      const n = m.userData && m.userData[k];
      if (n && META && META[n]) jobs.push(loadTex(n, 'c', renderer), loadTex(n, 'n', renderer));
    }
  }
  await Promise.all(jobs);
  // 快取裡的 Promise 換成貼圖本身，之後 tex() 同步取用
  for (const [k, v] of [...texCache]) texCache.set(k, await v);
}

const DECL = /* glsl */`
varying vec3 vDWP;
varying vec3 vDWN;
`;

const VERT_BODY = /* glsl */`
  vDWP = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
  vDWN = normalize( mat3( modelMatrix ) * objectNormal );
`;

// 在世界座標上取一組材質（兩次不同縮放與旋轉取樣，打散重複感）。回傳：rgb＝反照率倍率，a＝相對粗糙度；slope＝法線斜率
const FRAG_FUNCS = /* glsl */`
varying vec3 vDWP;
varying vec3 vDWN;
uniform sampler2D dC1, dN1;
uniform vec3 dP1;               // x＝材質實際尺寸（公尺），y＝法線強度, z＝保留
#ifdef DETAIL2
uniform sampler2D dC2, dN2;
uniform vec3 dP2;
#endif

vec3 dSlope( vec3 n ) {
  vec2 xy = n.xy * 2.0 - 1.0;
  float z = sqrt( max( 1.0 - dot( xy, xy ), 0.04 ) );
  return vec3( xy / z, 1.0 );
}

void dSample( sampler2D cT, sampler2D nT, vec3 P, vec2 uv, out vec3 mult, out float rough, out vec2 slope ) {
  vec2 uv1 = uv / P.x;
  vec2 uv2 = mat2( 0.8, -0.6, 0.6, 0.8 ) * uv / ( P.x * 2.37 ) + vec2( 0.37, 0.61 );
  vec3 c1 = texture2D( cT, uv1 ).rgb * 2.0;
  vec3 c2 = texture2D( cT, uv2 ).rgb * 2.0;
  vec3 n1 = texture2D( nT, uv1 ).rgb;
  vec3 n2 = texture2D( nT, uv2 ).rgb;
  mult = c1 * mix( vec3( 1.0 ), c2, 0.55 );
  rough = ( n1.b * 2.0 ) * mix( 1.0, n2.b * 2.0, 0.5 );
  vec2 s2 = dSlope( n2 ).xy;
  // 第二層取樣時 uv 轉了一個角度，斜率要轉回世界方向（旋轉矩陣的轉置）
  s2 = vec2( 0.8 * s2.x - 0.6 * s2.y, 0.6 * s2.x + 0.8 * s2.y );
  slope = dSlope( n1 ).xy + 0.6 * s2;
}
`;

const FRAG_A = /* glsl */`
  // ── 細節層：世界座標投影 ──
  vec3 dN = normalize( vDWN );
  vec3 dT, dB;
  vec2 dUV;
  if ( abs( dN.y ) > 0.72 ) {                       // 地面、屋頂
    float s = dN.y > 0.0 ? 1.0 : -1.0;
    dT = vec3( 1.0, 0.0, 0.0 );
    dB = vec3( 0.0, 0.0, -s );
    dUV = vec2( vDWP.x, -s * vDWP.z );
  } else {                                           // 牆面：水平方向沿牆、垂直向上
    vec3 nh = normalize( vec3( dN.x, 0.0, dN.z ) );
    dB = vec3( 0.0, 1.0, 0.0 );
    dT = cross( dB, nh );
    dUV = vec2( dot( vDWP, dT ), vDWP.y );
  }
  #ifdef USE_ROUGHNESSMAP
    float dBase = roughnessFactor;
    float dLayer = texelRoughness.r;
  #else
    float dBase = 1.0;
    float dLayer = 0.0;
  #endif
  float dStr = smoothstep( 0.09, 0.32, dBase );     // 水窪與玻璃（粗糙度很低）不加顆粒
  vec3 dM; float dR; vec2 dS;
  dSample( dC1, dN1, dP1, dUV, dM, dR, dS );
  float dNs = dP1.y;
  #ifdef DETAIL2
    vec3 dM2; float dR2; vec2 dS2;
    dSample( dC2, dN2, dP2, dUV, dM2, dR2, dS2 );
    float dK = smoothstep( 0.35, 0.65, dLayer );
    dM = mix( dM, dM2, dK ); dR = mix( dR, dR2, dK ); dS = mix( dS, dS2, dK ); dNs = mix( dNs, dP2.y, dK );
  #endif
  diffuseColor.rgb *= mix( vec3( 1.0 ), dM, dStr );
  roughnessFactor = clamp( roughnessFactor * mix( 1.0, dR, dStr ), 0.04, 1.0 );
`;

const FRAG_B = /* glsl */`
  {
    vec3 nW = normalize( dN + dT * ( dS.x * dNs * dStr ) + dB * ( dS.y * dNs * dStr ) );
    #ifdef DOUBLE_SIDED
      nW *= faceDirection;
    #endif
    normal = normalize( ( viewMatrix * vec4( nW, 0.0 ) ).xyz );
  }
`;

export function applyDetail(mat) {
  const ud = mat.userData || {};
  if (!ud.detail || !META || !META[ud.detail]) return false;
  const a = META[ud.detail];
  const b = ud.detail2 && META[ud.detail2] ? META[ud.detail2] : null;
  const ns = ud.dnormal !== undefined ? Number(ud.dnormal) : 1.0;
  const uni = {
    dC1: { value: tex(ud.detail, 'c') },
    dN1: { value: tex(ud.detail, 'n') },
    dP1: { value: new THREE.Vector3(a.tile, ns, 0) },
  };
  if (b) {
    uni.dC2 = { value: tex(ud.detail2, 'c') };
    uni.dN2 = { value: tex(ud.detail2, 'n') };
    uni.dP2 = { value: new THREE.Vector3(b.tile, ns, 0) };
  }
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uni);
    sh.vertexShader = sh.vertexShader
      .replace('void main() {', DECL + '\nvoid main() {')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_BODY);
    sh.fragmentShader = (b ? '#define DETAIL2\n' : '') + sh.fragmentShader
      .replace('void main() {', FRAG_FUNCS + '\nvoid main() {')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + FRAG_A)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + FRAG_B);
  };
  mat.customProgramCacheKey = () => (b ? 'pgdetail2' : 'pgdetail1') + (mat.roughnessMap ? 'm' : 'n');
  mat.needsUpdate = true;
  return true;
}
