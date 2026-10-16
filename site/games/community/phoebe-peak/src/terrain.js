import * as T from '../../pie-phoebe/vendor/three.module.js';
import {CELL,ZONES} from './data.js';

// Rock, ledges and cliffs. Nothing here is a repeated baked model: every surface samples the zone's painted textures by
// WORLD position (so neighbouring patches always line up) and the relief is a noise function evaluated in the vertex shader.
const loader=new T.TextureLoader(),cache=new Map();
const ZONE_COLOR={beach:[0xd9c49a,0xf0e6c8],jungle:[0x7a5a3a,0x5f9a4a],alpine:[0x8f9db0,0xf2f6fa],caldera:[0x3b3433,0x2b2524],forge:[0x4a4a52,0x5a5560],citadel:[0xb9b3a8,0xc9c1b4]};
// Used when a painted texture is missing, so the game never shows a blank world.
function fallbackTexture(zone,kind){
  const c=document.createElement('canvas');c.width=c.height=256;const g=c.getContext('2d'),base=new T.Color(ZONE_COLOR[zone][kind==='wall'?0:1]);
  g.fillStyle='#'+base.getHexString();g.fillRect(0,0,256,256);
  for(let i=0;i<900;i++){const l=.82+Math.random()*.3;g.fillStyle=`rgba(${base.r*255*l|0},${base.g*255*l|0},${base.b*255*l|0},.55)`;g.fillRect(Math.random()*256,Math.random()*256,4+Math.random()*26,2+Math.random()*7);}
  const t=new T.CanvasTexture(c);t.colorSpace=T.SRGBColorSpace;t.wrapS=t.wrapT=T.MirroredRepeatWrapping;return t;
}
export function zoneTexture(zone,kind){
  const key=zone+kind;if(cache.has(key))return cache.get(key);
  const t=loader.load(new URL(`../assets/tex/${kind}_${zone}.jpg`,import.meta.url).href,undefined,undefined,()=>{const f=fallbackTexture(zone,kind);t.image=f.image;t.needsUpdate=true;});
  t.colorSpace=T.SRGBColorSpace;t.wrapS=t.wrapT=T.MirroredRepeatWrapping;t.anisotropy=4;cache.set(key,t);return t;
}
// Relief per zone: amplitude (m), noise frequency, strength of horizontal strata, texture size (m per repeat).
const RELIEF={beach:[.3,.2,.55,7],jungle:[.32,.22,.25,6.5],alpine:[.3,.2,.45,7],caldera:[.36,.24,.6,6],forge:[.24,.3,.15,6],citadel:[.2,.34,.1,5.5]};
const NOISE=`
float h31(vec3 p){p=fract(p*.3183099+.1);p*=17.0;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float vn(vec3 x){vec3 i=floor(x),f=fract(x);f=f*f*(3.0-2.0*f);
  return mix(mix(mix(h31(i),h31(i+vec3(1,0,0)),f.x),mix(h31(i+vec3(0,1,0)),h31(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(h31(i+vec3(0,0,1)),h31(i+vec3(1,0,1)),f.x),mix(h31(i+vec3(0,1,1)),h31(i+vec3(1,1,1)),f.x),f.y),f.z);}
// geometry relief: two low octaves only, so a 1 m vertex grid never aliases
float relief(vec3 p){float n=vn(p*uFreq)*.65+vn(p*uFreq*2.1+7.1)*.35;return (n-.5)*1.5;}
// shading detail: more octaves and horizontal strata, evaluated per pixel
float detail(vec3 p){
  float f=uFreq*3.0,n=vn(p*f)*.5+vn(p*f*2.3+7.1)*.3+vn(p*f*5.1+3.7)*.2;
  float s=vn(vec3(p.x*.15,p.y*uFreq*2.4,p.z*.15));
  float strata=smoothstep(.35,.65,fract(p.y*.55+s*1.3+n*.5));
  return (n-.5)*1.2+(strata-.5)*uStrata;
}`;
const matCache=new Map();
export function rockMaterial(zone,{relief=true}={}){
  const key=zone+relief;if(matCache.has(key))return matCache.get(key);
  const [amp,freq,strata,size]=RELIEF[zone];
  const m=new T.MeshLambertMaterial({map:zoneTexture(zone,'wall'),side:T.DoubleSide});
  m.onBeforeCompile=sh=>{
    sh.uniforms.mapTop={value:zoneTexture(zone,'ledge')};sh.uniforms.uAmp={value:relief?amp:0};sh.uniforms.uFreq={value:freq};sh.uniforms.uStrata={value:strata};sh.uniforms.uSize={value:1/size};sh.uniforms.uSizeTop={value:1/(size*2.2)};
    sh.vertexShader=sh.vertexShader.replace('#include <common>',`#include <common>
uniform float uAmp;uniform float uFreq;uniform float uStrata;
varying vec3 vWP;varying vec3 vWN;
${NOISE}`)
    .replace('#include <beginnormal_vertex>',`#include <beginnormal_vertex>
#ifdef USE_INSTANCING
mat4 rm=modelMatrix*instanceMatrix;
#else
mat4 rm=modelMatrix;
#endif
vec3 wp0=(rm*vec4(position,1.0)).xyz;
float h0=relief(wp0);
vec3 ax=normalize(mat3(rm)*vec3(1.,0.,0.)),ay=normalize(mat3(rm)*vec3(0.,1.,0.));
float hx=relief(wp0+ax*.25),hy=relief(wp0+ay*.25);
if(uAmp>0.0){objectNormal=normalize(vec3(-uAmp*(hx-h0)/.25,-uAmp*(hy-h0)/.25,1.0));}`)
    .replace('#include <begin_vertex>',`#include <begin_vertex>
transformed+=vec3(0.,0.,1.)*uAmp*h0;
vWP=(rm*vec4(transformed,1.0)).xyz;vWN=normalize(mat3(rm)*objectNormal);`);
    sh.fragmentShader=sh.fragmentShader.replace('#include <common>',`#include <common>
uniform sampler2D mapTop;uniform float uSize;uniform float uSizeTop;uniform float uAmp;uniform float uFreq;uniform float uStrata;varying vec3 vWP;varying vec3 vWN;
${NOISE}`)
    .replace('#include <map_fragment>',`
vec3 an=abs(normalize(vWN));
float lat=mix(vWP.z,vWP.x,an.z/(an.x+an.z+1e-4));
vec4 cs=texture2D(map,vec2(lat,vWP.y)*uSize);
vec4 ct=texture2D(mapTop,vWP.xz*uSizeTop);
diffuseColor*=mix(cs,ct,smoothstep(.5,.8,an.y));
diffuseColor.rgb*=mix(.62,1.12,smoothstep(0.,520.,vWP.y))*(.94+.12*vn(vWP*.045));`)
    .replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
{ // bend the shading normal with fine noise: far cliffs have no geometry relief at all, near ones only the coarse part
  vec3 an2=abs(normalize(vWN));vec3 g=vec3(0.);float e=.12,h0=detail(vWP);
  g.x=(detail(vWP+vec3(e,0.,0.))-h0)/e;g.y=(detail(vWP+vec3(0.,e,0.))-h0)/e;g.z=(detail(vWP+vec3(0.,0.,e))-h0)/e;
  vec3 gv=(viewMatrix*vec4(g,0.)).xyz;normal=normalize(normal-gv*.16*(1.-an2.y*.9));}`);

  };
  m.customProgramCacheKey=()=>'rock'+zone+relief;
  matCache.set(key,m);return m;
}
// A 10 m x 10 m wall patch, subdivided 1 m. Its local +z is the outward normal of the cliff face.
export function patchGeometry(){return new T.PlaneGeometry(CELL,CELL,CELL,CELL);}
export function slabGeometry(){const g=new T.BoxGeometry(1,1,1);g.translate(0,.5,0);return g;}

// Instanced collection with distance culling. Items are {x,y,z,rot,sx,sy,sz,nx,nz,tint}; y is the base of the object.
export class Field{
  constructor(scene,geometry,material,capacity,{shadow=false,receive=true}={}){
    this.mesh=new T.InstancedMesh(geometry,material,capacity);this.mesh.frustumCulled=false;this.mesh.castShadow=shadow;this.mesh.receiveShadow=receive;
    this.mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);this.mesh.count=0;scene.add(this.mesh);this.items=[];this.capacity=capacity;
    this._col=new T.Color();this._m=new T.Matrix4();this._q=new T.Quaternion();this._e=new T.Euler();this._p=new T.Vector3();this._s=new T.Vector3();
  }
  add(item){this.items.push(item);return item;}
  refresh(px,py,pz,vert,horiz,cx=px,cz=pz){
    const m=this._m,q=this._q,e=this._e,pos=this._p,sc=this._s;let n=0;
    for(const it of this.items){
      if(Math.abs(it.y+(it.sy??0)*.5-py)>vert+(it.sy??0)*.5||Math.abs(it.x-px)>horiz||Math.abs(it.z-pz)>horiz)continue;
      if(it.nx!==undefined&&((cx-it.x)*it.nx+(cz-it.z)*it.nz)<-3)continue;
      if(n>=this.capacity)break;
      e.set(0,it.rot,0);q.setFromEuler(e);pos.set(it.x,it.y,it.z);sc.set(it.sx,it.sy,it.sz);m.compose(pos,q,sc);this.mesh.setMatrixAt(n,m);
      if(it.tint!==undefined){this._col.setHex(it.tint);this.mesh.setColorAt(n,this._col);}n++;
    }
    this.mesh.count=n;this.mesh.instanceMatrix.needsUpdate=true;if(this.mesh.instanceColor)this.mesh.instanceColor.needsUpdate=true;
  }
}

// Builds every cliff patch, far-away backing quad, column slab and rest ledge for a world.
export function buildTerrain(scene,world){
  const out={fields:{},patchFields:[],ledgeVisuals:[]};
  const geo=patchGeometry(),slab=slabGeometry();
  const patchField=zi=>out.patchFields[zi]??(out.patchFields[zi]=new Field(scene,geo,rockMaterial(ZONES[zi].id),2600));
  const slabField=zi=>out.fields['slab'+zi]??(out.fields['slab'+zi]=new Field(scene,slab,rockMaterial(ZONES[zi].id,{relief:false}),420,{shadow:true}));
  // backing quads: one merged mesh per zone, flat, set .4 m behind the cliff plane so the relief patches never dip behind them
  const quads=ZONES.map(()=>({pos:[],uv:[],idx:[]}));
  for(const f of world.faces){
    const zi=world.zoneAt((f.y0+f.y1)/2).index,q=quads[zi],b=world.boxes[f.box],base=q.pos.length/3;
    const nx=f.dx,nz=f.dz,inset=.4,px=f.dx?f.x-f.dx*inset:0,pz=f.dz?f.z-f.dz*inset:0;
    const lat0=f.dx?b.z1:b.x1,lat1=lat0+CELL;
    const P=(l,y)=>f.dx?[px,y,l]:[l,y,pz];
    for(const [l,y] of [[lat0,f.y0],[lat1,f.y0],[lat1,f.y1],[lat0,f.y1]])q.pos.push(...P(l,y));
    q.idx.push(base,base+1,base+2,base,base+2,base+3);
  }
  out.quads=quads.map((q,zi)=>{
    if(!q.pos.length)return null;
    const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(q.pos,3));g.setIndex(q.idx);g.computeVertexNormals();
    const m=rockMaterial(ZONES[zi].id,{relief:false}),mesh=new T.Mesh(g,m);mesh.frustumCulled=false;mesh.receiveShadow=true;scene.add(mesh);return mesh;});
  // relief patches (near the player only)
  const SEG=CELL;
  for(const f of world.faces){
    const b=world.boxes[f.box],h=f.y1-f.y0,ny=Math.max(1,Math.ceil(h/SEG)),tileH=h/ny,rot=Math.atan2(f.dx,f.dz),lat0=f.dx?b.z1:b.x1;
    for(let j=0;j<ny;j++){
      const yy=f.y0+j*tileH,zi=world.zoneAt(yy+tileH/2).index,field=patchField(zi),c=lat0+CELL/2;
      field.add({x:f.dx?f.x:c,z:f.dz?f.z:c,y:yy+tileH/2,rot,sx:1,sy:tileH/SEG,sz:1,nx:f.dx,nz:f.dz,tileH});
    }
  }
  // columns: a slab under every top surface so the flat ground has the painted ledge texture
  const THICK=1.7;
  for(const b of world.boxes){
    const field=slabField(world.zoneAt(b.y2-.05).index);
    field.add({x:(b.x1+b.x2)/2,z:(b.z1+b.z2)/2,y:b.y2-THICK,rot:0,sx:CELL+.02,sy:THICK,sz:CELL+.02});
  }
  for(const l of world.ledges){
    const field=slabField(l.zone),w=l.x2-l.x1,d=l.z2-l.z1,thick=.8;
    l.visual={x:(l.x1+l.x2)/2,z:(l.z1+l.z2)/2,y:l.y2-thick,rot:0,sx:w+.3,sy:thick,sz:d+.3};field.add(l.visual);l.field=field;
  }
  return out;
}
// Patches are centred, so the generic vertical test uses their centre; slabs and ledges use their base.
export function refreshTerrain(t,px,py,pz,cx,cz){
  for(const f of t.patchFields)if(f){
    // patches: y is the centre, sy*CELL is the height
    const m=f.mesh,items=f.items;let n=0;const mat=f._m,q=f._q,e=f._e,pos=f._p,sc=f._s;
    for(const it of items){
      if(Math.abs(it.y-py)>52||Math.abs(it.x-px)>85||Math.abs(it.z-pz)>85)continue;
      if(((cx-it.x)*it.nx+(cz-it.z)*it.nz)<-4)continue;
      if(n>=f.capacity)break;
      e.set(0,it.rot,0);q.setFromEuler(e);pos.set(it.x,it.y,it.z);sc.set(it.sx,it.sy,it.sz);mat.compose(pos,q,sc);m.setMatrixAt(n++,mat);
    }
    m.count=n;m.instanceMatrix.needsUpdate=true;
  }
  for(const [k,f] of Object.entries(t.fields))f.refresh(px,py,pz,60,95);
}
