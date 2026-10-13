import * as T from '../../pie-phoebe/vendor/three.module.js';

const materials = new Map();
export function material(color, roughness = .8) {
  const key = `${color}/${roughness}`;
  if (!materials.has(key)) materials.set(key, new T.MeshStandardMaterial({ color, roughness }));
  return materials.get(key);
}
export function mesh(parent, geometry, color, x=0, y=0, z=0, scale=null) {
  const m = new T.Mesh(geometry, typeof color === 'object' ? color : material(color));
  m.position.set(x,y,z); if (scale) m.scale.set(...scale);
  m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
}
export function sphere(parent,color,x,y,z,sx,sy,sz) {
  return mesh(parent,new T.SphereGeometry(1,20,14),color,x,y,z,[sx,sy,sz]);
}
export function group(parent,x=0,y=0,z=0) { const g=new T.Group();g.position.set(x,y,z);parent.add(g);return g; }
function line(parent, points, color, radius=.018) {
  const curve = new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p)));
  return mesh(parent,new T.TubeGeometry(curve,12,radius,5,false),color);
}
export function makeEgg(parent, scale=1) {
  const egg=group(parent);egg.scale.setScalar(scale);
  sphere(egg,0xffefd0,0,.45,0,.36,.48,.36);
  for(let i=0;i<6;i++){
    const a=i*2.4, y=.2+(i%3)*.17;
    sphere(egg,0xca9b61,Math.sin(a)*.337,y,Math.cos(a)*.337,.07,.09,.025).rotation.y=a;
  }
  const cracks=group(egg); cracks.visible=false;
  line(cracks,[[-.16,.61,.31],[.03,.49,.361],[-.08,.38,.35],[.13,.24,.3]],0x6d4835,.016);
  line(cracks,[[.32,.65,.04],[.35,.45,.09],[.3,.32,-.03]],0x6d4835,.015);
  egg.userData.cracks=cracks; return egg;
}

