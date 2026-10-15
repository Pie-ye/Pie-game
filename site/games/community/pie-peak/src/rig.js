// Procedural animation for the Colab-rigged characters (Phoebe, Fluorolo): idle / walk / jump / glide plus
// real hand-over-hand wall climbing with two-bone IK on arms and legs. Every rotation is expressed in the
// model's own frame (+Z forward, +X the character's left, +Y up) so bone roll in the GLB does not matter.
import * as THREE from '../vendor/three.module.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const clamp = THREE.MathUtils.clamp, lerp = THREE.MathUtils.lerp;

export class Rig {
  // holder: Object3D that carries position/yaw (the model's "character frame"); model: the loaded GLTF scene inside it.
  constructor(holder, model) {
    this.holder = holder; this.model = model;
    this.bones = {};
    model.traverse((o) => { if (o.isBone) this.bones[o.name] = o; });
    this.rest = {};
    for (const [n, b] of Object.entries(this.bones)) this.rest[n] = { q: b.quaternion.clone(), p: b.position.clone(), s: b.scale.clone() };
    this.t = 0; this.phase = 0;
    this.anchors = { handL: null, handR: null, footL: null, footR: null };
    this.nextHand = 'L'; this.nextFoot = 'L';
    this.armStretch = 1.15; this.legStretch = 1.0;
    this.hasFull = !!(this.bones.UpperArm_L && this.bones.UpperLeg_L);
  }
  reset() {
    for (const [n, b] of Object.entries(this.bones)) { const r = this.rest[n]; b.quaternion.copy(r.q); b.position.copy(r.p); b.scale.copy(r.s); }
    // chibi limbs are short: lengthen child offsets (skin stretches smoothly across the blended joint)
    for (const side of ['L', 'R']) {
      for (const n of ['LowerArm', 'Hand', 'Fingers']) { const b = this.bones[`${n}_${side}`]; if (b) b.position.copy(this.rest[`${n}_${side}`].p).multiplyScalar(this.armStretch); }
      for (const n of ['LowerLeg', 'Foot']) { const b = this.bones[`${n}_${side}`]; if (b) b.position.copy(this.rest[`${n}_${side}`].p).multiplyScalar(this.legStretch); }
    }
    this.model.updateMatrixWorld(true);
  }
  // Frame helpers ------------------------------------------------------
  frameQuat(out) { return this.holder.getWorldQuaternion(out); }
  worldAxis(local, out) { return out.copy(local).applyQuaternion(this.frameQuat(_q3)); }
  // Rotate a bone about a model-frame axis (about its own joint).
  rot(name, axis, angle) {
    const b = this.bones[name]; if (!b || !angle) return;
    const ax = this.worldAxis(axis, _a).normalize();
    b.getWorldQuaternion(_q1);
    _q2.setFromAxisAngle(ax, angle).multiply(_q1);
    b.parent.getWorldQuaternion(_q1).invert();
    b.quaternion.copy(_q1.multiply(_q2));
    b.updateMatrixWorld(true);
  }
  // Rotate bone so the vector to `child` points at the world point `target`.
  aim(name, childName, target, amount = 1) {
    const b = this.bones[name], c = this.bones[childName]; if (!b || !c) return;
    b.getWorldPosition(_a); c.getWorldPosition(_b);
    const cur = _c.copy(_b).sub(_a).normalize(), des = _d.copy(target).sub(_a).normalize();
    if (cur.lengthSq() < 1e-6 || des.lengthSq() < 1e-6) return;
    _q1.setFromUnitVectors(cur, des);
    if (amount < 1) _q1.slerp(_q3.identity(), 1 - amount);
    b.getWorldQuaternion(_q2); _q2.premultiply(_q1);
    b.parent.getWorldQuaternion(_q1).invert();
    b.quaternion.copy(_q1.multiply(_q2));
    b.updateMatrixWorld(true);
  }
  boneWorld(name, out = new THREE.Vector3()) { const b = this.bones[name]; return b ? b.getWorldPosition(out) : out.set(0, 0, 0); }
  // Analytic two-bone IK. pole: world-space direction the middle joint should bulge toward.
  ik(upper, lower, end, target, pole) {
    if (!this.bones[upper] || !this.bones[lower] || !this.bones[end]) return false;
    const A = this.boneWorld(upper, new THREE.Vector3()), B = this.boneWorld(lower, new THREE.Vector3()), C = this.boneWorld(end, new THREE.Vector3());
    const l1 = A.distanceTo(B), l2 = B.distanceTo(C);
    const toT = new THREE.Vector3().subVectors(target, A);
    let d = toT.length(); const dir = toT.clone().normalize();
    d = clamp(d, Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3);
    const x = (d * d + l1 * l1 - l2 * l2) / (2 * d), h = Math.sqrt(Math.max(l1 * l1 - x * x, 0));
    const pn = pole.clone().addScaledVector(dir, -pole.dot(dir)); if (pn.lengthSq() < 1e-6) pn.set(0, 0, 1); pn.normalize();
    const E = A.clone().addScaledVector(dir, x).addScaledVector(pn, h);
    this.aim(upper, lower, E);
    const T = A.clone().addScaledVector(dir, d);
    this.aim(lower, end, T);
    return toT.length() <= l1 + l2 + 0.02;
  }
  limbReach(upper, lower, end) {
    return this.boneWorld(upper).distanceTo(this.boneWorld(lower)) + this.boneWorld(lower).distanceTo(this.boneWorld(end));
  }

  // Main entry ---------------------------------------------------------
  update(dt, c) {
    this.t += dt;
    const climbing = c.state === 'climb' || c.state === 'pole' || c.state === 'ceiling' || c.state === 'mantle';
    this.armStretch += ((climbing ? 1.6 : 1.15) - this.armStretch) * Math.min(1, dt * 10);
    this.legStretch += ((climbing ? 1.25 : 1.0) - this.legStretch) * Math.min(1, dt * 10);
    this.reset();
    if (!this.hasFull) return;
    switch (c.state) {
      case 'climb': this.poseClimb(dt, c); break;
      case 'pole': this.posePole(dt, c); break;
      case 'ceiling': this.poseCeiling(dt, c); break;
      case 'mantle': this.poseMantle(dt, c); break;
      case 'glide': this.poseGlide(dt, c); break;
      case 'pull': this.posePull(dt, c); break;
      case 'faint': this.poseFaint(dt, c); break;
      case 'sleep': this.poseSleep(dt, c); break;
      case 'air': this.poseAir(dt, c); break;
      default: this.poseGround(dt, c);
    }
    this.sway(dt, c);
    if (c.state !== 'climb' && c.state !== 'pole' && c.state !== 'ceiling') { this.anchors.handL = this.anchors.handR = this.anchors.footL = this.anchors.footR = null; }
    this.model.updateMatrixWorld(true);
  }

  // Fluorolo's braids: three-bone pendulums that lag behind motion.
  sway(dt, c) {
    if (!this.bones.Braid1_L) return;
    this.swayT = (this.swayT || 0) + dt;
    const sp = c.state === 'ground' ? c.speed : c.state === 'air' ? 3 : c.moveAmt * 2;
    const amp = 0.05 + Math.min(0.25, sp * 0.04);
    for (const side of ['L', 'R']) for (let i = 1; i <= 3; i++) {
      const ph = this.swayT * (2.2 + sp * 0.5) - i * 0.7 + (side === 'L' ? 0 : 0.6);
      this.rot(`Braid${i}_${side}`, X, Math.sin(ph) * amp * (0.6 + i * 0.3));
      this.rot(`Braid${i}_${side}`, Z, Math.sin(ph * 0.7 + 1) * amp * 0.5 * (side === 'L' ? 1 : -1));
    }
  }
  relaxArms(k = 0.35) {
    this.rot('UpperArm_L', Z, -k); this.rot('UpperArm_R', Z, k);
  }
  poseGround(dt, c) {
    const sp = c.speed, moving = sp > 0.3;
    if (moving) this.phase += dt * (4 + sp * 1.7); else this.phase += dt * 1.6;
    const swing = moving ? clamp(sp / 5.4, 0.25, 1) : 0;
    const s = Math.sin(this.phase), co = Math.cos(this.phase);
    this.relaxArms(0.45);
    if (moving) {
      const amp = 0.55 + swing * 0.5;
      this.rot('UpperLeg_L', X, -s * amp); this.rot('UpperLeg_R', X, s * amp);
      this.rot('LowerLeg_L', X, Math.max(0, s) * 0.9 * swing + 0.05); this.rot('LowerLeg_R', X, Math.max(0, -s) * 0.9 * swing + 0.05);
      this.rot('UpperArm_L', X, s * amp * 0.9); this.rot('UpperArm_R', X, -s * amp * 0.9);
      this.rot('LowerArm_L', X, -0.5 - Math.max(0, s) * 0.5 * swing); this.rot('LowerArm_R', X, -0.5 - Math.max(0, -s) * 0.5 * swing);
      this.rot('Spine', X, 0.1 + swing * 0.12); this.rot('Chest', Y, s * 0.12 * swing);
      this.rot('Head', X, -0.08);
      this.bob = Math.abs(co) * 0.045 * swing;
    } else {
      this.rot('Chest', X, Math.sin(this.phase) * 0.02); this.rot('Head', Z, Math.sin(this.phase * 0.5) * 0.03);
      this.rot('UpperArm_L', X, Math.sin(this.phase) * 0.04); this.rot('UpperArm_R', X, -Math.sin(this.phase) * 0.04);
      this.bob = 0;
    }
    if (c.running) { this.rot('Spine', X, 0.12); this.rot('LowerArm_L', X, -0.5); this.rot('LowerArm_R', X, -0.5); }
    if (c.stun > 0) { this.rot('Spine', X, 0.35); this.rot('Head', X, 0.25); }
  }
  poseAir(dt, c) {
    const up = c.vy > 0;
    const flail = Math.sin(this.t * 14) * 0.18;
    this.rot('UpperArm_L', Z, up ? 0.9 : 1.2 + flail); this.rot('UpperArm_R', Z, up ? -0.9 : -1.2 - flail);
    this.rot('UpperLeg_L', X, up ? 0.7 : 0.35); this.rot('LowerLeg_L', X, up ? 0.9 : 0.4);
    this.rot('UpperLeg_R', X, up ? -0.1 : 0.2); this.rot('LowerLeg_R', X, up ? 0.5 : 0.3);
    this.rot('Spine', X, up ? -0.05 : -0.12);
    this.bob = 0;
  }
  poseGlide(dt, c) {
    const grip = this.localToWorld(new THREE.Vector3(0, 1.0 * c.scale * 1.3, 0.05));
    this.reachArm('L', grip.clone().add(this.dirW(0.08, 0, 0)), 0.5);
    this.reachArm('R', grip.clone().add(this.dirW(-0.08, 0, 0)), 0.5);
    this.rot('UpperLeg_L', X, 0.25 + Math.sin(this.t * 3) * 0.08); this.rot('UpperLeg_R', X, 0.1 - Math.sin(this.t * 3) * 0.08);
    this.rot('LowerLeg_L', X, 0.5); this.rot('LowerLeg_R', X, 0.4);
    this.bob = 0;
  }
  posePull(dt, c) {
    if (c.pullTarget) this.reachArm('L', c.pullTarget.clone(), 0.0);
    this.rot('UpperLeg_L', X, 0.5); this.rot('LowerLeg_L', X, 0.7); this.rot('UpperLeg_R', X, 0.1); this.rot('LowerLeg_R', X, 0.4);
    this.relaxArms(0.5);
    this.bob = 0;
  }
  poseFaint(dt, c) {
    this.relaxArms(0.9);
    this.rot('UpperLeg_L', Z, -0.2); this.rot('UpperLeg_R', Z, 0.25);
    this.rot('Head', Z, 0.3); this.bob = 0;
  }
  poseSleep(dt, c) {
    this.relaxArms(0.6);
    this.rot('Spine', X, 0.35); this.rot('Head', X, 0.6 + Math.sin(this.t * 1.5) * 0.05);
    this.rot('UpperLeg_L', X, 0.3); this.rot('UpperLeg_R', X, 0.3);
    this.bob = 0;
  }
  poseMantle(dt, c) {
    const k = c.mantleT || 0;
    // push down on the ledge with both hands while the legs swing up
    const base = this.localToWorld(new THREE.Vector3(0, 0.5 * c.scale, 0.42 * c.scale));
    this.reachArm('L', base.clone().add(this.dirW(0.2, 0, 0)), 0.15);
    this.reachArm('R', base.clone().add(this.dirW(-0.2, 0, 0)), 0.15);
    this.rot('UpperLeg_L', X, 0.9 * (1 - k) + 0.2); this.rot('LowerLeg_L', X, 1.2 * (1 - k));
    this.rot('UpperLeg_R', X, 0.4 * (1 - k)); this.rot('LowerLeg_R', X, 0.8 * (1 - k));
    this.rot('Spine', X, 0.45 * (1 - k));
    this.bob = 0;
  }

  // Direction/point helpers in the model frame -------------------------
  dirW(x, y, z) { return new THREE.Vector3(x, y, z).applyQuaternion(this.frameQuat(new THREE.Quaternion())); }
  localToWorld(v) { return this.holder.localToWorld(v.clone()); }
  reachArm(side, target, bend = 0.3) {
    const pole = this.dirW(side === 'L' ? 0.6 : -0.6, -0.3, -0.6);
    this.ik(`UpperArm_${side}`, `LowerArm_${side}`, `Hand_${side}`, target, pole);
  }
  reachLeg(side, target) {
    const pole = this.dirW(side === 'L' ? 0.3 : -0.3, 0.1, 1);
    this.ik(`UpperLeg_${side}`, `LowerLeg_${side}`, `Foot_${side}`, target, pole);
  }
  grip(side, normalW, amount) {
    const f = this.bones[`Fingers_${side}`]; if (!f) return;
    // curl the fingers toward the wall about the axis perpendicular to hand direction and wall normal
    const hand = this.boneWorld(`Hand_${side}`, new THREE.Vector3()), fing = this.boneWorld(`Fingers_${side}`, new THREE.Vector3());
    const dir = fing.sub(hand).normalize();
    const axis = new THREE.Vector3().crossVectors(dir, normalW).normalize();
    if (axis.lengthSq() < 1e-4) return;
    f.getWorldQuaternion(_q1); _q2.setFromAxisAngle(axis, amount).multiply(_q1);
    f.parent.getWorldQuaternion(_q1).invert(); f.quaternion.copy(_q1.multiply(_q2)); f.updateMatrixWorld(true);
  }

  // Wall climbing: alternating hand/foot anchors on the wall plane -------
  // c.pos: player feet (world), c.n: wall normal (horizontal, points to the player), c.tr: tangent right, c.scale: model scale
  poseClimb(dt, c) {
    const n = new THREE.Vector3(c.nx, 0, c.nz), tr = new THREE.Vector3(c.nz, 0, -c.nx), up = Y;
    const wallP = (side, up_, rIn) => new THREE.Vector3().copy(c.pos).addScaledVector(tr, side).addScaledVector(up, up_).addScaledVector(n, -c.wallDist + 0.01);
    this.stepAnchors(dt, c, wallP, 0.82, 0.12, 0.3, tr, up);
    this.applyLimbs(n, c, 0);
    // body: hug the wall, head tips up to look where the hands go
    this.rot('Spine', X, -0.05);
    this.rot('Head', X, -0.18);
    this.bob = 0;
  }
  posePole(dt, c) {
    const n = new THREE.Vector3(c.nx, 0, c.nz), tr = new THREE.Vector3(c.nz, 0, -c.nx);
    const wallP = (side, up_) => new THREE.Vector3().copy(c.pos).addScaledVector(tr, side * 0.8).addScaledVector(Y, up_).addScaledVector(n, -c.wallDist + 0.02);
    this.stepAnchors(dt, c, wallP, 0.85, 0.1, 0.3, tr, Y);
    this.applyLimbs(n, c, 0);
    this.rot('Head', X, -0.3);
    this.bob = 0;
  }
  poseCeiling(dt, c) {
    const top = c.pos.y + c.height + 0.12;
    const hand = (side) => new THREE.Vector3(c.pos.x, top, c.pos.z).addScaledVector(new THREE.Vector3(Math.cos(c.yaw), 0, -Math.sin(c.yaw)), side * 0.2).addScaledVector(new THREE.Vector3(Math.sin(c.yaw), 0, Math.cos(c.yaw)), 0.15 + Math.sin(this.t * 6 + (side > 0 ? 0 : 3)) * 0.08 * c.moveAmt);
    this.reachArm('L', hand(0.7), 0); this.reachArm('R', hand(-0.7), 0);
    this.grip('L', new THREE.Vector3(0, 1, 0), 1.2); this.grip('R', new THREE.Vector3(0, 1, 0), 1.2);
    const sw = Math.sin(this.t * 3) * 0.12;
    this.rot('UpperLeg_L', X, 0.25 + sw); this.rot('LowerLeg_L', X, 0.5); this.rot('UpperLeg_R', X, 0.1 - sw); this.rot('LowerLeg_R', X, 0.4);
    this.bob = 0;
  }
  stepAnchors(dt, c, wallP, handUp, handOut, stepDist, tr, up) {
    const mv = this.moveVec || (this.moveVec = new THREE.Vector3());
    mv.copy(tr).multiplyScalar(c.climbX).addScaledVector(up, c.climbY);
    const look = 0.3;
    for (const [key, ideal, adv] of [
      ['handL', wallP(-0.2 - handOut, handUp), 'hand'], ['handR', wallP(0.2 + handOut, handUp + 0.04), 'hand'],
      ['footL', wallP(-0.12, 0.08), 'foot'], ['footR', wallP(0.12, 0.2), 'foot'],
    ]) {
      let a = this.anchors[key];
      const target = ideal.clone().addScaledVector(mv, look);
      if (!a) { a = this.anchors[key] = { p: ideal.clone(), from: ideal.clone(), to: ideal.clone(), t: 1 }; }
      if (a.t < 1) {
        a.t = Math.min(1, a.t + dt / 0.18);
        const e = a.t * a.t * (3 - 2 * a.t);
        a.p.lerpVectors(a.from, a.to, e); a.p.y += Math.sin(a.t * Math.PI) * 0.06;
      } else if (a.p.distanceTo(ideal) > stepDist * (c.moveAmt > 0.1 ? 1 : 1.6) && !this.stepping(adv, key)) {
        a.from.copy(a.p); a.to.copy(target); a.t = 0;
      }
    }
  }
  stepping(kind, except) {
    for (const k of Object.keys(this.anchors)) { if (k === except) continue; const a = this.anchors[k]; if (a && a.t < 1 && k.startsWith(kind)) return true; }
    return false;
  }
  applyLimbs(n, c) {
    const a = this.anchors;
    // legs first (bottom), then arms
    this.reachLeg('L', a.footL.p); this.reachLeg('R', a.footR.p);
    this.reachArm('L', a.handL.p); this.reachArm('R', a.handR.p);
    this.grip('L', n, 1.1); this.grip('R', n, 1.1);
  }
}
