import * as THREE from 'three';

// 夜空穹頂：漸層、星空、彎月、極光帶。顏色以線性 HDR 輸出，月亮超過 1 會被泛光抓到。
const frag = /* glsl */`
uniform float uTime;
varying vec3 vDir;
float hash(vec3 p){ p = fract(p * 0.3183099 + .1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
void main(){
  vec3 d = normalize(vDir);
  float h = clamp(d.y, 0.0, 1.0);
  vec3 horizon = vec3(0.34, 0.07, 0.30);
  vec3 mid = vec3(0.035, 0.012, 0.10);
  vec3 zenith = vec3(0.004, 0.003, 0.028);
  vec3 col = mix(horizon, mid, pow(h, 0.32));
  col = mix(col, zenith, smoothstep(0.25, 1.0, h));
  col += vec3(0.5, 0.08, 0.35) * exp(-abs(d.y) * 14.0) * 0.35;
  // 星星
  vec3 g = d * 150.0; vec3 id = floor(g); vec3 f = fract(g) - 0.5;
  float s = hash(id);
  float tw = 0.6 + 0.4 * sin(uTime * (1.0 + s * 3.0) + s * 60.0);
  float star = step(0.986, s) * smoothstep(0.34, 0.0, length(f)) * tw;
  col += vec3(0.9, 0.85, 1.0) * star * 2.2 * smoothstep(0.03, 0.3, d.y);
  vec3 g2 = d * 60.0; vec3 id2 = floor(g2); vec3 f2 = fract(g2) - 0.5;
  float s2 = hash(id2 + 7.0);
  float big = step(0.992, s2) * smoothstep(0.3, 0.0, length(f2)) * (0.7 + 0.3 * sin(uTime * 2.0 + s2 * 90.0));
  col += mix(vec3(1.0, 0.6, 0.9), vec3(0.6, 0.9, 1.0), fract(s2 * 13.0)) * big * 3.0 * smoothstep(0.05, 0.3, d.y);
  // 極光
  float n = sin(d.x * 7.0 + uTime * 0.08) + sin(d.z * 5.0 - uTime * 0.05 + 1.3) + sin((d.x + d.z) * 11.0);
  float band = smoothstep(0.2, 1.4, n) * smoothstep(0.12, 0.45, d.y) * (1.0 - smoothstep(0.55, 0.95, d.y));
  col += mix(vec3(0.9, 0.15, 0.7), vec3(0.1, 0.8, 1.0), 0.5 + 0.5 * sin(d.x * 4.0 + uTime * 0.1)) * band * 0.10;
  // 彎月
  vec3 md = normalize(vec3(-0.32, 0.40, -0.86));
  vec3 md2 = normalize(md + vec3(0.075, 0.03, 0.0));
  float c1 = dot(d, md), c2 = dot(d, md2);
  float disc = smoothstep(cos(0.105), cos(0.098), c1);
  float cut = smoothstep(cos(0.095), cos(0.088), c2);
  float moon = clamp(disc - cut, 0.0, 1.0);
  col += vec3(1.0, 0.92, 0.62) * moon * 3.2;
  col += vec3(1.0, 0.45, 0.85) * exp(-(1.0 - c1) * 160.0) * 0.55;
  col += vec3(0.5, 0.4, 1.0) * exp(-(1.0 - c1) * 28.0) * 0.18;
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
