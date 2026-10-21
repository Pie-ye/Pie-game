import * as THREE from '../../pie-phoebe/vendor/three.module.js';

// 夜空穹頂：漸層、星空、彎月、極光帶。顏色以線性 HDR 輸出，月亮超過 1 會被泛光抓到。
const frag = /* glsl */`
uniform float uTime;
varying vec3 vDir;
float hash(vec3 p){ p = fract(p * 0.3183099 + .1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = hash(vec3(i, 1.0)), b = hash(vec3(i + vec2(1.0, 0.0), 1.0)), c = hash(vec3(i + vec2(0.0, 1.0), 1.0)), d = hash(vec3(i + 1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }
void main(){
  vec3 d = normalize(vDir);
  float h = clamp(d.y, 0.0, 1.0);
  // 工業煙霾：地平線帶橘褐，往上轉成冷青灰黑
  vec3 horizon = vec3(0.24, 0.12, 0.07);
  vec3 mid = vec3(0.015, 0.045, 0.058);
  vec3 zenith = vec3(0.004, 0.012, 0.02);
  vec3 col = mix(horizon, mid, pow(h, 0.32));
  col = mix(col, zenith, smoothstep(0.25, 1.0, h));
  col += vec3(0.5, 0.2, 0.06) * exp(-abs(d.y) * 12.0) * 0.28;
  // 低雲層：緩慢飄移，被城市光染成橘青
  vec2 cp = d.xz / (d.y + 0.35) * 1.6 + vec2(uTime * 0.01, uTime * 0.006);
  float cl = vn(cp) * 0.6 + vn(cp * 2.3 + 4.0) * 0.4;
  float cm = smoothstep(0.38, 0.8, cl) * smoothstep(0.02, 0.2, d.y) * (1.0 - smoothstep(0.5, 0.9, d.y));
  col += mix(vec3(0.16, 0.07, 0.03), vec3(0.03, 0.11, 0.13), smoothstep(0.1, 0.5, d.y)) * cm * 0.8;
  // 稀疏的星（霧霾裡只剩幾顆）
  vec3 g = d * 150.0; vec3 id = floor(g); vec3 f = fract(g) - 0.5;
  float s = hash(id);
  float tw = 0.6 + 0.4 * sin(uTime * (1.0 + s * 3.0) + s * 60.0);
  float star = step(0.992, s) * smoothstep(0.34, 0.0, length(f)) * tw;
  col += vec3(0.8, 0.9, 1.0) * star * 1.4 * smoothstep(0.1, 0.4, d.y) * (1.0 - cm);
  // 遠方空中航道：緩慢閃爍的紅色／青色警示燈
  vec3 g3 = d * 40.0; vec3 id3 = floor(g3); vec3 f3 = fract(g3) - 0.5;
  float s3 = hash(id3 + 19.0);
  float blink = step(0.5, fract(uTime * 0.5 + s3 * 7.0));
  float beacon = step(0.985, s3) * smoothstep(0.25, 0.0, length(f3)) * blink;
  col += mix(vec3(1.0, 0.15, 0.1), vec3(0.2, 0.9, 1.0), step(0.5, fract(s3 * 31.0))) * beacon * 1.6 * smoothstep(0.06, 0.2, d.y) * (1.0 - smoothstep(0.3, 0.5, d.y));
  gl_FragColor = vec4(col, 1.0);
}`;

export function makeSky() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: frag,
    side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(450, 48, 24), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}
