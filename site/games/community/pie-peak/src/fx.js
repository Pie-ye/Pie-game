// Small GPU particle pool (points with soft round sprites) for dust, sparks, steam, snow, embers, rain and bursts.
import * as THREE from 'three';

export class Particles {
  constructor(scene, max = 1400) {
    this.max = max; this.n = 0; this.cursor = 0;
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 4); this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.a0 = new Float32Array(max); this.grav = new Float32Array(max); this.grow = new Float32Array(max); this.base = new Float32Array(max); this.drag = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { scale: { value: 600 } },
      vertexShader: `attribute float size; attribute vec4 color; varying vec4 vC; uniform float scale;
        void main(){ vC=color; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=size*scale/max(0.1,-mv.z); gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `varying vec4 vC; void main(){ vec2 d=gl_PointCoord-0.5; float r=length(d); if(r>0.5) discard; gl_FragColor=vec4(vC.rgb, vC.a*smoothstep(0.5,0.1,r)); }`,
    });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false; this.points.renderOrder = 5;
    scene.add(this.points);
    for (let i = 0; i < max; i++) this.life[i] = 0;
  }
  emit({ x, y, z, vx = 0, vy = 0, vz = 0, life = 1, size = 0.2, color = [1, 1, 1], alpha = 1, gravity = 0, grow = 0, drag = 0 }) {
    const i = this.cursor; this.cursor = (this.cursor + 1) % this.max;
    this.pos.set([x, y, z], i * 3); this.vel.set([vx, vy, vz], i * 3);
    this.life[i] = this.maxLife[i] = life; this.base[i] = size; this.grav[i] = gravity; this.grow[i] = grow; this.drag[i] = drag;
    this.col.set([color[0], color[1], color[2], alpha], i * 4); this.a0[i] = alpha;
  }
  burst(x, y, z, n, o = {}) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * 6.283, e = (Math.random() - 0.3) * 1.2, s = (o.speed ?? 3) * (0.4 + Math.random() * 0.8);
      this.emit({ x, y, z, vx: Math.cos(a) * Math.cos(e) * s, vy: Math.sin(e) * s + (o.up ?? 1), vz: Math.sin(a) * Math.cos(e) * s,
        life: (o.life ?? 0.8) * (0.6 + Math.random() * 0.8), size: (o.size ?? 0.2) * (0.6 + Math.random() * 0.8), color: o.color ?? [1, 1, 1], alpha: o.alpha ?? 1, gravity: o.gravity ?? 9, grow: o.grow ?? 0, drag: o.drag ?? 1 });
    }
  }
  update(dt, camera) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.size[i] = 0; continue; }
      this.life[i] -= dt;
      const k = i * 3, drag = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[k] *= drag; this.vel[k + 1] = this.vel[k + 1] * drag - this.grav[i] * dt; this.vel[k + 2] *= drag;
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt;
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      this.size[i] = this.base[i] * (1 + this.grow[i] * (1 - t));
      this.col[i * 4 + 3] = this.a0[i] * Math.min(1, t * 2.5);
    }
    const a = this.geo.attributes; a.position.needsUpdate = a.color.needsUpdate = a.size.needsUpdate = true;
  }
}
