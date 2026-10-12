// three.js 繪圖層：所有角色與特效都是 InstancedMesh 的看板（面向鏡頭）或地面貼花（平貼地面）。
import * as THREE from '../vendor/three.module.js';

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qz = new THREE.Quaternion();
const _zAxis = new THREE.Vector3(0, 0, 1);
const FLAT_Q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);

export class Layer {
  /**
   * opts: additive 加亮混合；flat 平貼地面；center 以中心為錨點（預設看板以腳底為錨點）；
   *       alphaTest 用裁切代替半透明（角色用，可寫深度）；order 繪製順序
   */
  constructor(scene, texture, max, opts = {}) {
    this.max = max;
    this.flat = !!opts.flat;
    this.n = 0;
    const geo = new THREE.PlaneGeometry(1, 1);
    if (!opts.flat && !opts.center) geo.translate(0, 0.5, 0);
    const useTest = opts.alphaTest != null;
    const mat = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: !useTest,
      alphaTest: useTest ? opts.alphaTest : 0,
      depthWrite: useTest,
      blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
      fog: false,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = opts.order || 0;
    this.mesh.count = 0;
    scene.add(this.mesh);
    this.mat = mat;
  }

  begin() { this.n = 0; }

  /** 加一個實例。roll：繞視線（看板）或繞地面法線（貼花）的旋轉。r,g,b 可大於 1（過亮＝閃白）。 */
  add(x, y, z, w, h, roll = 0, r = 1, g = 1, b = 1, flip = false) {
    if (this.n >= this.max) return;
    _p.set(x, y, z);
    _s.set(flip ? -w : w, h, 1);
    if (this.flat) {
      if (roll) { _qz.setFromAxisAngle(_zAxis, roll); _q.copy(FLAT_Q).multiply(_qz); } else _q.copy(FLAT_Q);
    } else if (roll) {
      _qz.setFromAxisAngle(_zAxis, roll);
      _q.copy(Layer.camQuat).multiply(_qz);
    } else _q.copy(Layer.camQuat);
    _m.compose(_p, _q, _s);
    const i = this.n++;
    _m.toArray(this.mesh.instanceMatrix.array, i * 16);
    const c = this.mesh.instanceColor.array;
    c[i * 3] = r; c[i * 3 + 1] = g; c[i * 3 + 2] = b;
  }

  end() {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }
}
Layer.camQuat = new THREE.Quaternion();

export function makeTexture(canvas, { repeat = false, nearest = false } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (nearest) t.magFilter = THREE.NearestFilter;
  return t;
}

export { THREE };
