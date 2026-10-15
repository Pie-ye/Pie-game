import * as T from '../../pie-phoebe/vendor/three.module.js';
import {loadAnime} from './loader.js';

const V=()=>new T.Vector3(),Q=()=>new T.Quaternion();
// Phoebe's skinned mesh: bones and weights come from tools/phoebe-peak/build-rig.py (assets/phoebe.rig.json).
export async function loadPhoebeRig(height=1.5){
  const [rig,asset]=await Promise.all([
    fetch(new URL('../assets/phoebe.rig.json',import.meta.url)).then(r=>r.json()),
    loadAnime(new URL('../assets/models/phoebe.glb',import.meta.url),{style:'painted'})]);
  asset.updateMatrixWorld(true);
  const box=new T.Box3().setFromObject(asset),size=box.getSize(new T.Vector3()),center=box.getCenter(new T.Vector3());
  const k=height/size.y;
  const xf=p=>new T.Vector3((p[0]-center.x)*k,(p[1]-box.min.y)*k,(p[2]-center.z)*k);
  let source;asset.traverse(o=>{if(o.isMesh&&!source)source=o;});
  const geometry=source.geometry.clone().applyMatrix4(source.matrixWorld);geometry.translate(-center.x,-box.min.y,-center.z);geometry.scale(k,k,k);
  if(geometry.attributes.position.count!==rig.vertices)throw Error('rig does not match model');
  const b64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
  const ids=b64(rig.skinIndex),ws=b64(rig.skinWeight),n=rig.vertices;
  const skinIndex=new Uint16Array(n*4),skinWeight=new Float32Array(n*4);
  for(let i=0;i<n*4;i++){skinIndex[i]=ids[i];skinWeight[i]=ws[i]/255;}
  geometry.setAttribute('skinIndex',new T.Uint16BufferAttribute(skinIndex,4));geometry.setAttribute('skinWeight',new T.Float32BufferAttribute(skinWeight,4));
  const bones=[],byName={},rest={};
  for(const b of rig.bones){
    const bone=new T.Bone();bone.name=b.name;bones.push(bone);byName[b.name]=bone;
    rest[b.name]={head:xf(b.head),tail:xf(b.tail)};
  }
  rig.bones.forEach((b,i)=>{
    const bone=bones[i];
    if(b.parent){byName[b.parent].add(bone);bone.position.copy(rest[b.name].head).sub(rest[b.parent].head);}
    else bone.position.copy(rest[b.name].head);
  });
  const root=new T.Group();root.add(bones[0]);root.updateMatrixWorld(true);
  const skeleton=new T.Skeleton(bones);   // inverses are taken from the rest pose, so matrices must be current
  const mesh=new T.SkinnedMesh(geometry,source.material);mesh.castShadow=true;mesh.frustumCulled=false;mesh.name='phoebe';
  root.add(mesh);mesh.bind(skeleton,new T.Matrix4());
  const lengths={};for(const s of ['L','R']){lengths['arm'+s]=[rest['upperArm'+s].head.distanceTo(rest['foreArm'+s].head),rest['foreArm'+s].head.distanceTo(rest['hand'+s].head)];
    lengths['leg'+s]=[rest['thigh'+s].head.distanceTo(rest['shin'+s].head),rest['shin'+s].head.distanceTo(rest['foot'+s].head)];}
  const restQ=bones.map(b=>b.quaternion.clone()),restP=bones.map(b=>b.position.clone());
  const api={root,mesh,bones:byName,list:bones,rest,lengths,height,
    reset(){bones.forEach((b,i)=>{b.quaternion.copy(restQ[i]);b.position.copy(restP[i]);});},
    asset:{vertices:n,bones:bones.length,source:'Hunyuan3D-2 mesh · distance/segmentation skin weights',height}};
  return api;
}
// ---- IK helpers (world space; bones in the rig have identity rest rotation) ----------------------------------------------
const _a=V(),_b=V(),_c=V(),_q1=Q(),_q2=Q(),_q3=Q();
export function aimBone(bone,child,target){
  bone.updateWorldMatrix(true,false);child.updateWorldMatrix(true,false);
  _a.setFromMatrixPosition(bone.matrixWorld);_b.setFromMatrixPosition(child.matrixWorld);
  const cur=_b.sub(_a).normalize(),des=_c.copy(target).sub(_a).normalize();
  if(cur.lengthSq()<1e-8||des.lengthSq()<1e-8)return;
  _q1.setFromUnitVectors(cur,des);bone.getWorldQuaternion(_q2);_q1.multiply(_q2);
  bone.parent.getWorldQuaternion(_q3);bone.quaternion.copy(_q3.invert().multiply(_q1));bone.updateMatrixWorld(true);
}
const _s=V(),_e=V(),_d=V(),_pp=V();
// Two-bone IK: place the end of upper->fore->hand at target; pole is a world-space hint for the elbow/knee direction.
export function twoBone(upper,fore,end,l1,l2,target,pole){
  upper.updateWorldMatrix(true,false);_s.setFromMatrixPosition(upper.matrixWorld);
  const toT=_d.copy(target).sub(_s);let dist=toT.length();const maxR=(l1+l2)*.999,minR=Math.abs(l1-l2)*1.001+1e-4;
  dist=Math.min(maxR,Math.max(minR,dist));toT.setLength(dist);
  const dir=toT.clone().normalize(),a=(l1*l1-l2*l2+dist*dist)/(2*dist),h=Math.sqrt(Math.max(0,l1*l1-a*a));
  _pp.copy(pole).sub(_s);_pp.addScaledVector(dir,-_pp.dot(dir));if(_pp.lengthSq()<1e-8)_pp.set(0,0,1);_pp.normalize();
  _e.copy(_s).addScaledVector(dir,a).addScaledVector(_pp,h);
  const tgt=_s.clone().add(toT);
  aimBone(upper,fore,_e.clone());aimBone(fore,end,tgt);
}
