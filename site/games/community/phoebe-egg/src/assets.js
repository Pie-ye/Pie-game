import * as T from '../../pie-phoebe/vendor/three.module.js';
import {loadAnime} from './anime-loader.js';

// Every visible scene object is a baked GLB under assets/models. Templates are normalized once
// (centered on x/z, resting on y=0) and then cloned; clones share geometry and textures.
const cache=new Map();
// Hunyuan paint over-saturates large stone/grass surfaces; pull them toward the scene palette at load.
const SATURATION={plateau:.62,ramp:.7,rock:.82};
function mute(material,amount){
  const m=material.clone();
  m.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',
    `#include <map_fragment>\n float tone=dot(diffuseColor.rgb,vec3(.299,.587,.114)); diffuseColor.rgb=mix(vec3(tone),diffuseColor.rgb,${amount.toFixed(2)});`);};
  return m;
}
export function loadModel(name,options={}){
  const {raw=false,...loaderOptions}=options;
  if(!cache.has(name))cache.set(name,loadAnime(new URL(`../assets/models/${name}.glb`,import.meta.url),{style:'painted',...loaderOptions}).then(root=>{
    root.updateMatrixWorld(true);
    const meshes=[];root.traverse(o=>{if(o.isMesh)meshes.push(o);});
    const box=new T.Box3().setFromObject(root),center=box.getCenter(new T.Vector3()),size=box.getSize(new T.Vector3());
    const template=new T.Group();
    for(const m of meshes){
      const geometry=m.geometry.clone().applyMatrix4(m.matrixWorld);if(!raw)geometry.translate(-center.x,-box.min.y,-center.z);
      const copy=new T.Mesh(geometry,SATURATION[name]?mute(m.material,SATURATION[name]):m.material);copy.castShadow=true;copy.receiveShadow=true;template.add(copy);
    }
    template.userData.size=size;template.userData.source=root.userData.asset;
    return template;
  }));
  return cache.get(name);
}
// Fit a model into a box. Omitted dimensions follow the first given one uniformly.
export async function place(parent,name,{x=0,y=0,z=0,height,width,depth,scale,rotY=0,tilt=0}={}){
  const template=await loadModel(name),size=template.userData.size,node=new T.Group(),inner=template.clone();
  let sx,sy,sz;
  if(scale!==undefined)sx=sy=sz=scale;
  else{
    const uniform=height!==undefined?height/size.y:width!==undefined?width/size.x:depth/size.z;
    sx=width!==undefined?width/size.x:uniform;sy=height!==undefined?height/size.y:uniform;sz=depth!==undefined?depth/size.z:uniform;
  }
  inner.scale.set(sx,sy,sz);node.add(inner);node.position.set(x,y,z);node.rotation.set(tilt,rotY,0);parent.add(node);
  return node;
}
