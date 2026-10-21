import * as THREE from '../../pie-phoebe/vendor/three.module.js';

// 以相機為中心的雨絲：座標在著色器裡依「世界位置」循環，所以走動時雨不會跟著人飄。
const BOX = 44, HEIGHT = 32;

export function makeRain(count = 3200) {
  const pos = new Float32Array(count * 2 * 3), end = new Float32Array(count * 2), seed = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const x = Math.random() * BOX, y = Math.random() * HEIGHT, z = Math.random() * BOX, s = Math.random();
    for (let k = 0; k < 2; k++) {
      const j = i * 2 + k;
      pos.set([x, y, z], j * 3);
      end[j] = k; seed[j] = s;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uAlpha: { value: 1 } },
    vertexShader: /* glsl */`
      uniform float uTime; uniform vec3 uCam;
      attribute float aEnd; attribute float aSeed;
      varying float vA;
      void main(){
        vec3 p = position;
        float speed = 17.0 + aSeed * 8.0;
        p.y = mod(p.y - uTime * speed, ${HEIGHT.toFixed(1)});
        p.xz = mod(p.xz - uCam.xz + ${(BOX / 2).toFixed(1)}, ${BOX.toFixed(1)}) - ${(BOX / 2).toFixed(1)} + uCam.xz;
        p.y += max(0.0, uCam.y - 8.0);
        vec3 w = p + vec3(0.9, 0.0, 0.3) * 0.0;
        w += aEnd * vec3(0.10, 0.5 + aSeed * 0.25, 0.03);
        vec4 mv = viewMatrix * vec4(w, 1.0);
        gl_Position = projectionMatrix * mv;
        float dist = length(mv.xyz);
        vA = (1.0 - aEnd * 0.8) * smoothstep(${(BOX / 2).toFixed(1)}, 3.0, dist);
      }`,
    fragmentShader: /* glsl */`
      uniform float uAlpha; varying float vA;
      void main(){ gl_FragColor = vec4(vec3(0.55, 0.78, 1.0) * 0.9, vA * 0.26 * uAlpha); }`,
    transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, toneMapped: false,
  });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  lines.renderOrder = 5;
  return lines;
}
