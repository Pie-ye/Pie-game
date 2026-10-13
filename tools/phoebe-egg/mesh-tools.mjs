// Offline mesh authoring utilities. Outputs indexed surfaces, not runtime primitives.
import * as T from '../../site/games/community/pie-phoebe/vendor/three.module.js';
export {T};
export const vec=p=>new T.Vector3(...p);
const palette=new Map();
export function mat(name,color,extra={}){
  if(!palette.has(name)){const m=new T.MeshStandardMaterial({color,roughness:1,side:T.DoubleSide,...extra});m.name=name;palette.set(name,m);}
  return palette.get(name);
}
export function node(parent,name,x=0,y=0,z=0){const n=new T.Group();n.name=name;n.position.set(x,y,z);parent?.add(n);return n;}
export function surface(parent,name,nu,nv,fn,material,uvFn=null){
  const positions=[],uv=[],indices=[];
  for(let j=0;j<=nv;j++)for(let i=0;i<=nu;i++){
    const u=i/nu,v=j/nv,p=fn(u,v);positions.push(...p);uv.push(...(uvFn?uvFn(u,v,p):[u,v]));
  }
  for(let j=0;j<nv;j++)for(let i=0;i<nu;i++){
    const a=j*(nu+1)+i,b=a+1,c=a+nu+1,d=c+1;indices.push(a,b,c,b,d,c);
  }
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();
  const m=new T.Mesh(g,material);m.name=name;parent.add(m);return m;
}
export function profile(rows,t){
  const k=t*(rows.length-1),i=Math.min(rows.length-2,Math.floor(k)),f=k-i;
  // Catmull-Rom interpolation through authored silhouette sections.
  return rows[0].map((_,c)=>{
    const a=rows[Math.max(0,i-1)][c]??0,b=rows[i][c]??0,d=rows[i+1][c]??0,e=rows[Math.min(rows.length-1,i+2)][c]??0;
    return .5*((2*b)+(-a+d)*f+(2*a-5*b+4*d-e)*f*f+(-a+3*b-3*d+e)*f*f*f);
  });
}
export function loft(parent,name,rows,material,options={}){
  if(rows[0][0]>rows.at(-1)[0])rows=[...rows].reverse();
  const {segments=48,rings=48,start=-Math.PI,end=Math.PI,pleat=0,uv=null,flatten=1}=options;
  return surface(parent,name,segments,rings,(u,v)=>{
    const [y,rx,rz,cx=0,cz=0]=profile(rows,v),a=start+(end-start)*u;
    const fold=1+pleat*Math.cos(a*14),cos=Math.cos(a);
    return [cx+Math.sin(a)*Math.max(.001,rx)*fold,y,cz+Math.sign(cos)*Math.pow(Math.abs(cos),cos>0?flatten:1)*Math.max(.001,rz)*fold];
  },material,uv);
}
export function strand(parent,name,points,width,depth,material,options={}){
  const curve=new T.CatmullRomCurve3(points.map(vec)),axis=vec(options.axis||[1,0,0]);
  return surface(parent,name,options.sides||12,options.steps||28,(u,t)=>{
    const p=curve.getPoint(t),tangent=curve.getTangent(t).normalize();
    const side=axis.clone().addScaledVector(tangent,-axis.dot(tangent)).normalize(),normal=new T.Vector3().crossVectors(tangent,side).normalize();
    const taper=options.blunt?Math.pow(Math.sin(Math.PI*t),.3):Math.pow(Math.sin(Math.PI*(.18+.82*t)),.65);
    const a=u*Math.PI*2;
    return p.addScaledVector(side,Math.cos(a)*width*Math.max(.008,taper)).addScaledVector(normal,Math.sin(a)*depth*Math.max(.008,taper)).toArray();
  },material);
}
export function piping(parent,name,points,radius,material){
  const curve=new T.CatmullRomCurve3(points.map(vec));
  const m=new T.Mesh(new T.TubeGeometry(curve,Math.max(16,points.length*6),radius,6,false),material);m.name=name;parent.add(m);return m;
}
export function badge(parent,name,points,depth,material,x=0,y=0,z=0){
  const shape=new T.Shape();points.forEach(([px,py],i)=>i?shape.lineTo(px,py):shape.moveTo(px,py));shape.closePath();
  const mesh=new T.Mesh(new T.ExtrudeGeometry(shape,{depth,bevelEnabled:true,bevelThickness:.008,bevelSize:.008,bevelSegments:2,steps:1,curveSegments:12}),material);
  mesh.name=name;mesh.position.set(x,y,z);parent.add(mesh);return mesh;
}
