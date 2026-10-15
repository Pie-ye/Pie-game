import * as T from '../../pie-phoebe/vendor/three.module.js';
import {loadModel} from './assets.js';
import {CELL,ZONES,ITEMS} from './data.js';
import {loadPhoebeRig} from './rig.js';
import {makeAnimator} from './pose.js';
import {rayCast} from './physics.js';
import {ATTACK_INFO} from './rules.js';

const V=(x=0,y=0,z=0)=>new T.Vector3(x,y,z);
const PROP_HEIGHT={palm_tree:5.6,berry_bush:1.7,mushroom_cluster:1.5,thorn_bush:1.6,snow_pine:5.2,ice_spike:2.6,lava_rock:2.1,geyser:1.7,furnace:3.2,anvil_gear:2.6,ruin_pillar:4.2,torch_stand:2.5,boulder:1.9};
const ITEM_HEIGHT=.5;
const RIM_TINT={beach:0xe3c9a0,jungle:0xffffff,alpine:0xcfe2f4,caldera:0x6a5a55,forge:0x8a7a72,citadel:0xe0d6c6};
const WALL_NAMES=ZONES.map(z=>z.wall),LEDGE_NAMES=ZONES.map(z=>z.ledge);

// Instanced copies of one baked module (cliff tiles, ledge tops, rim boulders). Only instances near the player are drawn.
class Field{
  constructor(scene,template,capacity,shadow=false){
    this.template=template;const mesh=template.children.find(c=>c.isMesh);this.size=template.userData.size;
    this.mesh=new T.InstancedMesh(mesh.geometry,mesh.material,capacity);this.mesh.frustumCulled=false;this.mesh.castShadow=shadow;this.mesh.receiveShadow=true;
    this.mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);this.mesh.setColorAt(0,new T.Color(1,1,1));this.mesh.count=0;scene.add(this.mesh);this.items=[];this.capacity=capacity;
  }
  add(item){this.items.push(item);}
  refresh(px,py,pz,vert,horiz,cx=px,cz=pz){
    const col=new T.Color(),m=new T.Matrix4(),q=new T.Quaternion(),e=new T.Euler(),pos=new T.Vector3(),sc=new T.Vector3();let n=0;
    for(const it of this.items){
      if(Math.abs(it.y-py)>vert||Math.abs(it.x-px)>horiz||Math.abs(it.z-pz)>horiz)continue;
      if(it.nx!==undefined&&((cx-it.x)*it.nx+(cz-it.z)*it.nz)<-3)continue;   // faces pointing away from the camera are hidden behind the tower anyway
      if(n>=this.capacity)break;
      e.set(0,it.rot,0);q.setFromEuler(e);pos.set(it.x,it.y,it.z);sc.set(it.sx,it.sy,it.sz);m.compose(pos,q,sc);col.setHex(it.tint??0xffffff);this.mesh.setColorAt(n,col);this.mesh.setMatrixAt(n++,m);
    }
    this.mesh.count=n;this.mesh.instanceMatrix.needsUpdate=true;if(this.mesh.instanceColor)this.mesh.instanceColor.needsUpdate=true;
  }
}
const flat=(w,h,color,opacity)=>{const m=new T.Mesh(new T.PlaneGeometry(w,h),new T.MeshBasicMaterial({color,transparent:true,opacity,depthWrite:false,side:T.DoubleSide}));return m;};
function softTexture(){const c=document.createElement('canvas');c.width=c.height=64;const g=c.getContext('2d'),r=g.createRadialGradient(32,32,2,32,32,30);r.addColorStop(0,'rgba(255,255,255,1)');r.addColorStop(.5,'rgba(255,255,255,.45)');r.addColorStop(1,'rgba(255,255,255,0)');g.fillStyle=r;g.fillRect(0,0,64,64);const t=new T.CanvasTexture(c);t.colorSpace=T.SRGBColorSpace;return t;}

export async function buildScene(renderer,game,onProgress=()=>{}){
  const world=game.world,scene=new T.Scene(),camera=new T.PerspectiveCamera(50,1,.1,900);
  scene.background=new T.Color(0xcfe6f2);scene.fog=new T.Fog(0xcfe6f2,80,260);
  const hemi=new T.HemisphereLight(0xe8f4ff,0xb7b08a,1.55);scene.add(hemi);
  const sun=new T.DirectionalLight(0xfff0d6,2.2);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);
  Object.assign(sun.shadow.camera,{left:-22,right:22,top:22,bottom:-22,near:1,far:120});sun.shadow.bias=-.0006;sun.shadow.normalBias=.05;scene.add(sun,sun.target);
  const fireLight=new T.PointLight(0xffa550,0,14,1.6);scene.add(fireLight);
  const lantern=new T.PointLight(0xffe2a0,0,10,1.4);scene.add(lantern);
  // ---- sky dome ---------------------------------------------------------------------------------------------------------
  const loader=new T.TextureLoader(),skyTex={};
  const loadSky=name=>skyTex[name]??(skyTex[name]=loader.loadAsync(new URL(`../assets/sky/${name}.jpg`,import.meta.url)).then(t=>{t.colorSpace=T.SRGBColorSpace;return t;}).catch(()=>null));
  const skyMat=new T.MeshBasicMaterial({side:T.BackSide,fog:false,depthWrite:false});
  const sky=new T.Mesh(new T.SphereGeometry(520,48,24),skyMat);sky.renderOrder=-10;scene.add(sky);
  let skyName='';
  async function setSky(name){if(skyName===name)return;skyName=name;const t=await loadSky(name);if(t&&skyName===name){skyMat.map=t;skyMat.needsUpdate=true;}}
  // ---- load models ------------------------------------------------------------------------------------------------------
  const wanted=new Set(['island','sea',...WALL_NAMES,...LEDGE_NAMES,'crate','altar','campfire','crystal_cluster','hanging_vine','boulder','summit_flag','piton','thorn_bush',
    ...Object.keys(PROP_HEIGHT),...Object.keys(ITEMS),'reggie','reggie_roar','reggie_slam','reggie_charge','reggie_sweep']);
  const models={};let loaded=0;
  await Promise.all([...wanted].map(async name=>{
    try{models[name]=await loadModel(name,['island','sea'].includes(name)?{raw:true}:{});}catch(e){models[name]=null;console.warn('missing model',name);}
    onProgress(++loaded/wanted.size);
  }));
  const clone=(name,height,extra={})=>{const t=models[name];if(!t)return null;const g=new T.Group(),inner=t.clone();const s=height/t.userData.size.y;inner.scale.setScalar(s*(extra.stretch??1));if(extra.sy)inner.scale.y=s*extra.sy;g.add(inner);return g;};
  // ---- island and sea ---------------------------------------------------------------------------------------------------
  if(models.island)scene.add(models.island.clone());
  if(models.sea){const sea=models.sea.clone();sea.position.y=-.4;sea.traverse(o=>{if(o.isMesh){o.castShadow=false;o.material=o.material.clone();o.material.map.wrapS=o.material.map.wrapT=T.RepeatWrapping;}});scene.add(sea);}
  // ---- instanced cliff tiles / ledges / rims -----------------------------------------------------------------------------
  const fields={};
  const fieldFor=(name,cap,shadow)=>fields[name]??(fields[name]=models[name]?new Field(scene,models[name],cap,shadow):null);
  for(const f of world.faces){
    const b=world.boxes[f.box],zoneName=(y)=>ZONES[world.zoneAt(y).index].wall;
    const segH=f.y1-f.y0,ny=Math.max(1,Math.ceil(segH/9)),tileH=segH/ny,plane=f.dx?(f.dx>0?b.x2:b.x1):(f.dz>0?b.z2:b.z1);
    const hash=(a,b2,c)=>{const x=Math.sin(a*127.1+b2*311.7+c*74.7)*43758.5453;return x-Math.floor(x);};
    for(let j=0;j<ny;j++){
      const yy=f.y0+j*tileH,field=fieldFor(zoneName(yy+tileH/2),4200,false);if(!field)continue;
      const sz=field.size,s=tileH*1.08/sz.y,tileW=sz.x*s*1.45,sp=tileW*.55,nx=Math.ceil(CELL/sp)+1,sx=1.45*s/sz.x;
      for(let i=0;i<nx;i++){
        const r1=hash(f.box,i,j),r2=hash(f.box+7,i,j+3),lat=(f.dx?b.z1:b.x1)-sp/2+i*sp+(r1-.5)*sp*.25,off=-(sz.z*s*.5)/2+.1+(r2-.5)*.18;
        field.add({x:f.dx?plane+f.dx*off:lat,z:f.dz?plane+f.dz*off:lat,y:yy-.05+(r2-.5)*.5,rot:Math.atan2(f.dx,f.dz),sx,sy:s,sz:s*.5,nx:f.dx,nz:f.dz});
      }
    }
  }
  for(const b of world.boxes){
    const field=fieldFor(ZONES[b.zone].ledge,120,true);if(!field)continue;const sz=field.size,thick=1.7;
    field.add({x:(b.x1+b.x2)/2,z:(b.z1+b.z2)/2,y:b.y2-thick,rot:0,sx:(CELL+.8)/sz.x,sy:thick/sz.y,sz:(CELL+.8)/sz.z});
  }
  for(const l of world.ledges){
    const field=fieldFor(ZONES[l.zone].ledge,120,true);if(!field)continue;const sz=field.size,w=l.x2-l.x1,d=l.z2-l.z1,thick=.8;
    l.visual={x:(l.x1+l.x2)/2,z:(l.z1+l.z2)/2,y:l.y2-thick,rot:0,sx:(w+.5)/sz.x,sy:thick/sz.y,sz:(d+.5)/sz.z};field.add(l.visual);l.field=field;
  }
  if(models.boulder){
    const field=fieldFor('boulder',400,false),sz=field.size;
    for(const r of world.rims){
      const len=Math.max(r.x2-r.x1,r.z2-r.z1),n=Math.max(2,Math.round(len/2.3)),alongX=(r.x2-r.x1)>(r.z2-r.z1);
      for(let i=0;i<n;i++){const t=(i+.5)/n;field.add({tint:RIM_TINT[ZONES[r.zone].id],x:alongX?r.x1+(r.x2-r.x1)*t:(r.x1+r.x2)/2,z:alongX?(r.z1+r.z2)/2:r.z1+(r.z2-r.z1)*t,y:r.y1-.1,rot:i*1.7,sx:1.5/sz.x*1.35,sy:1.45/sz.y,sz:1.3/sz.z*1.35});}
    }
  }
  // ---- static props, grouped per column -------------------------------------------------------------------------------------
  const propGroups=new Map();
  for(const d of world.decor){
    const g=clone(d.kind,(PROP_HEIGHT[d.kind]??2)*d.scale);if(!g)continue;g.position.set(d.x,d.y,d.z);g.rotation.y=d.rot;
    g.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
    let grp=propGroups.get(d.box);if(!grp){grp=new T.Group();grp.userData.box=world.boxes[d.box];scene.add(grp);propGroups.set(d.box,grp);}grp.add(g);
  }
  for(const h of world.hazards){
    let g=null;
    if(h.type==='thorn'){g=clone('thorn_bush',1.5);if(g){const cx=(h.x1+h.x2)/2,cz=(h.z1+h.z2)/2;g.position.set(cx,(h.y1+h.y2)/2-.6,cz);const b=world.boxes[h.box],f=b.climbFace;g.rotation.y=Math.atan2(f.dx,f.dz);g.scale.multiplyScalar(1.1);}}
    else if(h.type==='slip'||h.type==='hot'){
      const b=world.boxes[h.box],f=b.climbFace,w=Math.max(h.x2-h.x1,h.z2-h.z1),hh=h.y2-h.y1;
      g=flat(w,hh,h.type==='hot'?0xff6a2b:h.ice?0xbfe9ff:0x59a65a,h.type==='hot'?.5:.42);g.userData.hazard=h.type;
      g.position.set(f.dx?f.x+f.dx*.06:(h.x1+h.x2)/2,(h.y1+h.y2)/2,f.dz?f.z+f.dz*.06:(h.z1+h.z2)/2);g.rotation.y=f.dx?Math.PI/2*(f.dx>0?1:-1):(f.dz>0?0:Math.PI);
    }else if(h.type==='geyser'){g=clone('geyser',1.7);if(g)g.position.set(h.x,h.y,h.z);}
    else if(h.type==='firejet'){g=clone('lava_rock',1.4);if(g)g.position.set(h.x,h.y,h.z);}
    if(g){h.visual=g;const b=world.boxes[h.box];let grp=propGroups.get(h.box);if(!grp){grp=new T.Group();grp.userData.box=b;scene.add(grp);propGroups.set(h.box,grp);}grp.add(g);}
  }
  const fixed=[];
  for(const a of world.altars){const g=clone('altar',2.4);if(g){g.position.set(a.x,a.y,a.z);scene.add(g);a.visual=g;fixed.push({g,y:a.y,x:a.x,z:a.z});}}
  for(const c of world.campfires){const g=clone('campfire',1.1);if(g){g.position.set(c.x,c.y,c.z);scene.add(g);c.visual=g;fixed.push({g,y:c.y,x:c.x,z:c.z});}}
  for(const c of world.crystals){const g=clone('crystal_cluster',1.5);if(g){g.position.set(c.x,c.y,c.z);scene.add(g);c.visual=g;fixed.push({g,y:c.y,x:c.x,z:c.z});}}
  for(const c of world.crates){const g=clone('crate',.95);if(g){g.position.set(c.x,c.y,c.z);g.rotation.y=c.x;scene.add(g);c.visual=g;fixed.push({g,y:c.y,x:c.x,z:c.z});}}
  {const g=clone('summit_flag',5.5);if(g){g.position.set(world.summit.x,world.summit.y,world.summit.z);scene.add(g);}}
  const ropeMeshes=new Map();
  function syncRopes(){
    for(const r of game.ropes){
      if(ropeMeshes.has(r)){continue;}
      const len=r.yTop-r.yBottom;let g;
      if(r.vine&&models.hanging_vine){g=clone('hanging_vine',len,{stretch:1});g.position.set(r.x,r.yBottom,r.z);g.rotation.y=Math.atan2(r.wall.dx,r.wall.dz);}
      else{g=new T.Group();const line=new T.Mesh(new T.CylinderGeometry(.045,.045,len,6),new T.MeshLambertMaterial({color:0xb08a58}));line.position.y=len/2;g.add(line);
        const knot=new T.Mesh(new T.SphereGeometry(.09,8,6),new T.MeshLambertMaterial({color:0x7d5f3b}));knot.position.y=len;g.add(knot);g.position.set(r.x,r.yBottom,r.z);}
      g.traverse(o=>{if(o.isMesh)o.castShadow=true;});scene.add(g);ropeMeshes.set(r,g);
    }
  }
  const anchorMeshes=new Map();
  function syncAnchors(){
    for(const a of game.anchors){if(anchorMeshes.has(a))continue;
      let g=clone('piton',.45);if(!g){g=new T.Mesh(new T.CylinderGeometry(.03,.03,.3,6),new T.MeshLambertMaterial({color:0x9aa2aa}));}
      g.position.set(a.x-a.nx*.45,a.y,a.z-a.nz*.45);g.rotation.y=Math.atan2(a.nx,a.nz);scene.add(g);anchorMeshes.set(a,g);}
  }
  // ---- pickups ----------------------------------------------------------------------------------------------------------
  const itemMeshes=new Map();
  function syncItems(time){
    for(const it of world.items){
      let m=itemMeshes.get(it);
      if(!m&&!it.taken){const g=clone(it.kind,ITEM_HEIGHT);if(g){const ring=new T.Mesh(new T.RingGeometry(.28,.34,24),new T.MeshBasicMaterial({color:0xffe9a0,transparent:true,opacity:.65,side:T.DoubleSide,depthWrite:false}));ring.rotation.x=-Math.PI/2;ring.position.y=.03;g.add(ring);g.traverse(o=>{if(o.isMesh&&o!==ring){o.castShadow=true;}});scene.add(g);m=g;m.userData.base=it.y;itemMeshes.set(it,m);}}
      if(m){if(it.taken){m.visible=false;continue;}m.position.set(it.x,it.y+.25+Math.sin(time*2+it.x)*.06,it.z);m.rotation.y=time*1.2+it.z;
        const near=Math.abs(it.y-game.player.y)<40&&Math.hypot(it.x-game.player.x,it.z-game.player.z)<60;m.visible=near;}
    }
  }
  // ---- Reggie and the character ---------------------------------------------------------------------------------------------
  const reggieActors=new Map();
  function reggieActor(r){
    let a=reggieActors.get(r);if(a)return a;
    const root=new T.Group(),poses={};
    for(const [key,name,h] of [['idle','reggie',2.1],['roar','reggie_roar',2.1],['slam','reggie_slam',2.1],['charge','reggie_charge',2.1],['sweep','reggie_sweep',2.1]]){
      const g=clone(name,h);if(!g)continue;g.traverse(o=>{if(o.isMesh)o.castShadow=true;});g.visible=false;root.add(g);poses[key]=g;
    }
    // match each pose's largest dimension to the idle pose
    const ref=models.reggie?Math.max(...models.reggie.userData.size.toArray())*(2.1/models.reggie.userData.size.y):2.1;
    for(const [key,name] of [['roar','reggie_roar'],['slam','reggie_slam'],['charge','reggie_charge'],['sweep','reggie_sweep']]){const m=models[name];if(m&&poses[key])poses[key].children[0].scale.setScalar(ref/Math.max(...m.userData.size.toArray()));}
    scene.add(root);a={root,poses};reggieActors.set(r,a);return a;
  }
  const markers=new T.Group();scene.add(markers);
  const mat=()=>new T.MeshBasicMaterial({color:0xf04f37,transparent:true,opacity:.3,side:T.DoubleSide,depthWrite:false});
  const telegraph=new T.Mesh(new T.CircleGeometry(1,48),mat());telegraph.rotation.x=-Math.PI/2;
  const halfSweep=Math.acos(-.25),sweepArea=new T.Mesh(new T.CircleGeometry(ATTACK_INFO.sweep.radius,40,-Math.PI/2-halfSweep,halfSweep*2),mat());
  const chargeLine=new T.Mesh(new T.PlaneGeometry(4,15),mat());
  const shock=new T.Mesh(new T.RingGeometry(.93,1,48),new T.MeshBasicMaterial({color:0xffd491,transparent:true,side:T.DoubleSide,depthWrite:false}));shock.rotation.x=-Math.PI/2;
  const roarRing=new T.Mesh(new T.SphereGeometry(1,24,16),new T.MeshBasicMaterial({color:0xffc27a,transparent:true,opacity:.14,wireframe:false,depthWrite:false,side:T.DoubleSide}));
  markers.add(telegraph,sweepArea,chargeLine,shock,roarRing);[telegraph,sweepArea,chargeLine,shock,roarRing].forEach(m=>m.visible=false);
  const rig=await loadPhoebeRig(1.5);scene.add(rig.root);const animate=makeAnimator(rig);
  rig.root.traverse(o=>{if(o.isMesh){o.castShadow=true;}});
  let heldItem=null,heldKind='';
  function setHeld(kind){
    if(kind===heldKind)return;heldKind=kind;if(heldItem){heldItem.removeFromParent();heldItem=null;}
    if(!kind)return;const g=clone(kind,.34);if(!g)return;g.position.set(0,-.05,.04);g.rotation.set(.3,0,0);heldItem=g;rig.bones.handR.add(g);
  }
  // ---- particles -----------------------------------------------------------------------------------------------------------
  const tex=softTexture(),pool=[],pf=new T.Group();scene.add(pf);
  for(let i=0;i<260;i++){const s=new T.Sprite(new T.SpriteMaterial({map:tex,transparent:true,depthWrite:false,color:0xffffff}));s.visible=false;pf.add(s);pool.push({s,life:0,max:1,v:V(),grow:0,size:.3,alpha:1});}
  let cursor=0;
  function puff(x,y,z,{color=0xffffff,size=.4,life=.8,vx=0,vy=.5,vz=0,grow=.5,alpha=.8,spread=.2}={}){
    const p=pool[cursor++%pool.length];p.life=p.max=life;p.v.set(vx+(Math.random()-.5)*spread*2,vy,vz+(Math.random()-.5)*spread*2);p.grow=grow;p.size=size;p.alpha=alpha;
    p.s.position.set(x,y,z);p.s.material.color.setHex(color);p.s.scale.setScalar(size);p.s.visible=true;
  }
  function updateParticles(dt){for(const p of pool){if(p.life<=0)continue;p.life-=dt;if(p.life<=0){p.s.visible=false;continue;}p.s.position.addScaledVector(p.v,dt);p.size+=p.grow*dt;p.s.scale.setScalar(p.size);p.s.material.opacity=p.alpha*Math.min(1,p.life/p.max*1.6);}}
  // chain / dart visuals
  const beam=new T.Line(new T.BufferGeometry().setFromPoints([V(),V(0,1,0)]),new T.LineBasicMaterial({color:0xdde6ee}));beam.visible=false;scene.add(beam);let beamT=0;
  const dart=new T.Mesh(new T.CylinderGeometry(.015,.015,.25,5),new T.MeshBasicMaterial({color:0xffe08a}));dart.visible=false;scene.add(dart);let dartT=0,dartFrom=V(),dartTo=V();
  // ---- camera --------------------------------------------------------------------------------------------------------------
  const cam={yaw:Math.PI,pitch:.32,dist:6.2,pos:V(0,3,5),look:V(),free:0};
  const gust=[];
  function handleEvents(events){
    const p=game.player;
    for(const e of events){
      if(e.type==='chain'){beam.geometry.setFromPoints([e.from,e.to]);beam.visible=true;beamT=.5;}
      if(e.type==='dart'){dartFrom.copy(e.from);dartTo.copy(e.to);dartT=.28;dart.visible=true;}
      if(e.type==='crate'&&e.crate.visual){e.crate.visual.visible=false;for(let i=0;i<10;i++)puff(e.crate.x,e.crate.y+.5,e.crate.z,{color:0xb99665,size:.3,vy:1.5,spread:1,grow:1});}
      if(e.type==='crystal'&&e.crystal.visual){e.crystal.visual.visible=false;for(let i=0;i<16;i++)puff(e.crystal.x,e.crystal.y+.8,e.crystal.z,{color:0x88e8ff,size:.25,vy:2,spread:1.2});}
      if(e.type==='altar'){for(let i=0;i<24;i++)puff(e.altar.x,e.altar.y+1.2,e.altar.z,{color:0xffe9a0,size:.3,vy:2.4,spread:1.4,life:1.2});}
      if(e.type==='landed'){for(let i=0;i<6;i++)puff(p.x,p.y+.1,p.z,{color:0xddd2bd,size:.35,vy:.7,spread:1,grow:1});}
      if(e.type==='jumped'){for(let i=0;i<4;i++)puff(p.x,p.y+.05,p.z,{color:0xddd2bd,size:.25,vy:.5,spread:.5,grow:.8});}
      if(e.type==='rockHit'){for(let i=0;i<14;i++)puff(e.b.x,e.b.y,e.b.z,{color:0x9a958d,size:.3,vy:1.2,spread:1.5,grow:1});}
      if(e.type==='ledge'){const l=world.ledges.find(x=>x.id===e.id);if(l&&l.visual){if(e.broken){l.visual.sy0=l.visual.sy;l.visual.sy=0.0001;for(let i=0;i<14;i++)puff((l.x1+l.x2)/2,l.y2,(l.z1+l.z2)/2,{color:0xb9ab92,size:.4,vy:-1,spread:1.6,grow:1.2});}else l.visual.sy=l.visual.sy0??l.visual.sy;}}
      if(e.type==='piton'){for(let i=0;i<5;i++)puff(e.anchor.x,e.anchor.y,e.anchor.z,{color:0xffe6a0,size:.12,vy:.6,spread:.4,life:.35});}
    }
  }
  // ---- per-frame update --------------------------------------------------------------------------------------------------------
  let t=0,fieldClock=0,lastZone=-1;
  const playerState={mode:'idle',speed:0,sprint:false,vy:0,t:0,phase:0,nx:0,nz:1,lunge:0,mantle:0,eat:0,tool:false,hurt:0,energy:false,held:null};
  let hurtFx=0;
  function update(dt,view){
    t+=dt;const p=game.player,info=game.info(),zone=info.zone;
    // atmosphere follows the zone (and the daily gloom variant)
    const zi=zone.index,zdef=ZONES[zi],gloomy=world.gloom&&world.gloom===zdef.id;
    const fogColor=new T.Color(zdef.fog);if(gloomy)fogColor.multiplyScalar(.62);
    scene.fog.color.lerp(fogColor,Math.min(1,dt*1.5));scene.background.copy(scene.fog.color);
    const lit=game.hasItem('lantern_item')>=0;
    scene.fog.near+=((gloomy?(lit?40:20):zdef.fogNear)-scene.fog.near)*Math.min(1,dt*1.5);scene.fog.far+=((gloomy?(lit?150:92):zdef.fogFar)-scene.fog.far)*Math.min(1,dt*1.5);
    hemi.intensity+=((gloomy?1.05:zi===3||zi===4?1.5:1.55)-hemi.intensity)*Math.min(1,dt);sun.intensity+=((gloomy?1.15:zi===3||zi===4?2:2.2)-sun.intensity)*Math.min(1,dt);
    if(zi!==lastZone){lastZone=zi;setSky(zdef.sky);}
    lantern.intensity=gloomy?(lit?3.2:1.4):0;lantern.distance=lit?16:9;lantern.position.set(p.x,p.y+2,p.z);
    sky.position.copy(camera.position);
    // sun and shadows follow the player
    sun.position.set(p.x-18,p.y+34,p.z+16);sun.target.position.set(p.x,p.y,p.z);sun.target.updateMatrixWorld();
    // streaming
    fieldClock-=dt;
    if(fieldClock<=0){fieldClock=.2;for(const f of Object.values(fields))f?.refresh(p.x,p.y,p.z,46,70,camera.position.x,camera.position.z);
      for(const [,g] of propGroups){const b=g.userData.box;g.visible=Math.abs(b.y2-p.y)<75&&Math.abs((b.x1+b.x2)/2-p.x)<110&&Math.abs((b.z1+b.z2)/2-p.z)<110;}
    }
    // reset flags for objects the logic consumed
    for(const c of world.crates)if(c.visual)c.visual.visible=!c.opened&&Math.abs(c.y-p.y)<80&&Math.hypot(c.x-p.x,c.z-p.z)<120;
    for(const c of world.crystals)if(c.visual)c.visual.visible=!c.used&&Math.abs(c.y-p.y)<80&&Math.hypot(c.x-p.x,c.z-p.z)<120;
    for(const a of world.altars)if(a.visual){a.visual.visible=Math.abs(a.y-p.y)<80&&Math.hypot(a.x-p.x,a.z-p.z)<120;a.visual.rotation.y=Math.sin(t*.3)*.1;}
    for(const c of world.campfires)if(c.visual)c.visual.visible=Math.abs(c.y-p.y)<80&&Math.hypot(c.x-p.x,c.z-p.z)<120;
    syncItems(t);syncRopes();syncAnchors();
    // fire light + flames at the nearest campfire / altar
    let bestFire=null,bd=1e9;for(const c of [...world.campfires,...world.altars]){const d=Math.hypot(c.x-p.x,c.y-p.y,c.z-p.z);if(d<bd){bd=d;bestFire=c;}}
    if(bestFire&&bd<40){fireLight.position.set(bestFire.x,bestFire.y+1.2,bestFire.z);fireLight.intensity=2.6+Math.sin(t*14)*.4;if(Math.random()<dt*14)puff(bestFire.x,bestFire.y+.6,bestFire.z,{color:0xffb050,size:.3,vy:1.2,spread:.2,life:.7,grow:-.2,alpha:.8});}
    else fireLight.intensity=0;
    // hazards: steam, flame jets, spores, pulses
    for(const h of world.hazards){
      if(Math.abs(h.y??h.y1??0-p.y)>90&&h.y!==undefined&&Math.abs(h.y-p.y)>60)continue;
      if(h.type==='geyser'){const ph=(game.time+h.phase)%h.period;if(ph>4.2&&ph<6.4&&Math.random()<dt*(ph>5.2?60:12))puff(h.x,h.y+.8,h.z,{color:0xf2f6f8,size:.5,vy:ph>5.2?9:2,spread:.25,life:ph>5.2?1:.7,grow:ph>5.2?1.5:.8,alpha:.7});}
      if(h.type==='firejet'){const ph=(game.time+h.phase)%h.period;if(ph>2.8&&ph<4.7&&Math.random()<dt*(ph>3.6?80:15))puff(h.x,h.y+.6,h.z,{color:ph>3.6?0xff7a28:0xffb35a,size:.55,vy:ph>3.6?6:1.5,spread:.35,life:.55,grow:.4,alpha:.85});}
      if(h.type==='spore'&&Math.abs(h.y-p.y)<20&&Math.random()<dt*16)puff(h.x+(Math.random()-.5)*h.r*2,h.y+.4+Math.random()*2,h.z+(Math.random()-.5)*h.r*2,{color:0xb48be8,size:.5,vy:.3,spread:.1,life:1.6,grow:.3,alpha:.5});
      if(h.visual&&h.userData===undefined&&h.visual.userData.hazard==='hot')h.visual.material.opacity=.35+Math.sin(t*3)*.15;
    }
    // falling rocks and their warning shadows
    if(!sync.boulders)sync.boulders=new Map();
    for(const b of game.boulders){let m=sync.boulders.get(b);if(!m){const g=clone('boulder',1.5)||new T.Mesh(new T.IcosahedronGeometry(.7,0),new T.MeshLambertMaterial({color:0x8a857d}));const ring=new T.Mesh(new T.RingGeometry(.6,1,24),new T.MeshBasicMaterial({color:0xf04f37,transparent:true,opacity:.5,side:T.DoubleSide,depthWrite:false}));ring.rotation.x=-Math.PI/2;scene.add(g,ring);m={g,ring};sync.boulders.set(b,m);}
      m.g.position.set(b.x,b.y,b.z);m.g.rotation.x+=dt*3;m.g.visible=b.t>=b.delay;const sy=game.player.y;m.ring.position.set(b.x,sy+.06,b.z);m.ring.visible=true;m.ring.material.opacity=.25+.3*Math.min(1,b.t/b.delay);}
    for(const [b,m] of sync.boulders)if(!game.boulders.includes(b)){scene.remove(m.g,m.ring);sync.boulders.delete(b);}
    // Reggie(s)
    markers.children.forEach(c=>c.visible=false);
    for(const r of [...game.reggies,...game.scouts]){
      const a=reggieActor(r),near=Math.abs(r.y-p.y)<60&&Math.hypot(r.x-p.x,r.z-p.z)<90;a.root.visible=near;if(!near)continue;
      a.root.position.set(r.x,r.y,r.z);a.root.rotation.y=r.angle;
      const attacking=['windup','active','charge'].includes(r.state)&&a.poses[r.attack];
      for(const [k,g] of Object.entries(a.poses))g.visible=attacking?k===r.attack:k==='idle';
      const clock=r.clock,ease=v=>{v=Math.min(1,Math.max(0,v));return v*v*(3-2*v);},body=a.root;let by=0,bx=0,bz=0,rotY=0,sc=1;
      const moving=['chase','patrol'].includes(r.state);by=moving?Math.abs(Math.sin(t*7))*.05:Math.sin(t*2)*.015;
      if(r.state==='sleep'){by-=.1;sc=.96;}
      if(r.state==='windup'){const e=ease(clock/1.05);if(r.attack==='roar'){sc=.94+e*.1;bx=Math.sin(clock*40)*.02*e;}if(r.attack==='slam')by=e*.45;if(r.attack==='sweep')rotY=-1.8*e;if(r.attack==='charge'){by=-.03*e;bz=-.35*e;}}
      if(r.state==='active'){if(r.attack==='roar'){sc=1.04+Math.sin(clock*30)*.03;bx=Math.sin(clock*60)*.03;}if(r.attack==='slam'){by=.45*Math.max(0,1-clock/.1);}if(r.attack==='sweep')rotY=-1.8+3.6*ease(clock/.4);}
      for(const g of Object.values(a.poses)){g.position.set(bx,by,bz);g.rotation.y=rotY;g.scale.setScalar(sc);}
      const warn=r.state==='windup',act=r.state==='active';
      if((warn||act)&&r.attack==='roar'){roarRing.visible=true;roarRing.position.set(r.x,r.y+.8,r.z);roarRing.scale.setScalar(ATTACK_INFO.roar.radius*(act?Math.min(1,clock/.3):.6+.4*Math.sin(t*10)*.1));roarRing.material.opacity=act?Math.max(0,.3-clock*.5):.1+Math.min(1,clock)*.12;}
      if((warn||act)&&r.attack==='slam'){telegraph.visible=true;telegraph.position.set(r.x,r.y+.07,r.z);telegraph.scale.setScalar(ATTACK_INFO.slam.radius);telegraph.material.opacity=.14+Math.min(1,clock)*.22;}
      if((warn||act)&&r.attack==='sweep'){sweepArea.visible=true;sweepArea.position.set(r.x,r.y+.07,r.z);sweepArea.rotation.set(-Math.PI/2,0,-r.angle);sweepArea.material.opacity=.14+Math.min(1,clock)*.22;}
      if(warn&&r.attack==='charge'){chargeLine.visible=true;chargeLine.position.set(r.x+r.direction.x*7,r.y+.07,r.z+r.direction.z*7);chargeLine.rotation.set(-Math.PI/2,0,-r.angle);chargeLine.material.opacity=.2+Math.min(1,clock)*.25;}
      if(act&&['slam'].includes(r.attack)){shock.visible=true;shock.position.set(r.x,r.y+.18,r.z);shock.scale.setScalar(ATTACK_INFO.slam.radius*Math.min(1,.15+clock/.4));shock.material.opacity=Math.max(0,.7-clock);}
    }
    // character
    const mode=p.state==='move'?(p.grounded?(p.speed>.4?'walk':'idle'):'air'):p.state;
    const s=playerState;s.mode=mode==='walk'||mode==='idle'||mode==='air'?mode:mode;s.speed=p.speed;s.sprint=p.sprinting;s.vy=p.vy;s.t=t;s.phase=p.climbPhase;
    const w=p.wall||{nx:0,nz:1};s.nx=w.nx;s.nz=w.nz;s.lunge=p.lunge>0?1:0;s.mantle=p.mantle?Math.min(1,p.mantle.t/p.mantle.dur):0;s.eat=p.eat>0?1-p.eat/.8:0;
    const sel=game.inv[game.sel],selSpec=sel&&ITEMS[sel.kind];s.tool=!!(selSpec&&['chain','dart'].includes(selSpec.kind)&&p.use>0.01);
    s.hurt=Math.max(0,p.hurtCd-.4)/.5;s.energy=game.status.energy>0;
    const climbing=['wall','rope','anchored','chain'].includes(p.state);
    rig.root.position.set(p.x+(climbing&&w?-w.nx*.12:0),p.y+(climbing?.03:0),p.z+(climbing&&w?-w.nz*.12:0));
    const yawTarget=p.yaw;let dy=yawTarget-rig.root.rotation.y;dy=Math.atan2(Math.sin(dy),Math.cos(dy));rig.root.rotation.y+=dy*Math.min(1,dt*(climbing?20:12));
    rig.root.updateMatrixWorld(true);
    s.mode=p.state==='move'?(p.grounded?(p.speed>.4?'walk':'idle'):'air'):p.state==='faint'?'faint':game.status.sleep>0?'sleep':p.state;
    if(game.status.sleep>0&&p.state==='move')s.mode='sleep';
    const using=sel&&['food','drink','heal','cure','warm','cool'].includes(selSpec?.kind)&&p.eat>0;setHeld(using?sel.kind:(selSpec&&['chain','dart','rope','piton'].includes(selSpec.kind)?sel.kind:''));
    s.held=heldItem;animate(s,dt);
    // trails
    if(p.state==='wall'&&p.speed>.3&&Math.random()<dt*10)puff(p.x-p.wall.nx*.4,p.y+.9,p.z-p.wall.nz*.4,{color:0xcfc6b4,size:.12,vy:-.5,spread:.1,life:.6,alpha:.6});
    if(p.sprinting&&p.grounded&&Math.random()<dt*14)puff(p.x,p.y+.05,p.z,{color:0xddd2bd,size:.18,vy:.3,spread:.2,life:.5,alpha:.6});
    if(game.wind.active>0&&Math.random()<dt*50){const wd=game.wind.dir;puff(p.x+(Math.random()-.5)*14-wd.x*8,p.y+Math.random()*6,p.z+(Math.random()-.5)*14-wd.z*8,{color:0xffffff,size:.08,vx:wd.x*22,vz:wd.z*22,vy:0,spread:0,life:.8,grow:0,alpha:.5});}
    updateParticles(dt);
    if(beamT>0){beamT-=dt;if(beamT<=0)beam.visible=false;}
    if(dartT>0){dartT-=dt;const k=1-dartT/.28;dart.position.lerpVectors(dartFrom,dartTo,k);dart.lookAt(dartTo);dart.visible=dartT>0;}
    // camera
    updateCamera(dt,view);
  }
  const sync={};
  function updateCamera(dt,view){
    const p=game.player,w=p.wall;
    if(view.autoAlign&&['wall','rope','anchored'].includes(p.state)&&w){let d=Math.atan2(w.nx,w.nz)-cam.yaw;d=Math.atan2(Math.sin(d),Math.cos(d));cam.yaw+=d*Math.min(1,dt*.9);}
    cam.yaw=view.yaw;
    const target=V(p.x,p.y+(p.state==='faint'?.4:1.0),p.z);
    const back=V(Math.sin(cam.yaw)*Math.cos(view.pitch),Math.sin(view.pitch),Math.cos(cam.yaw)*Math.cos(view.pitch));
    let dist=view.dist;
    const hit=rayCast(world,target,back,dist+.5);if(hit&&hit.t<dist+.4)dist=Math.max(1.2,hit.t-.4);
    const desired=target.clone().addScaledVector(back,dist);
    cam.pos.lerp(desired,Math.min(1,dt*(dist<view.dist?18:9)));
    camera.position.copy(cam.pos);camera.lookAt(target);
  }
  function resize(w,h){renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();}
  return {scene,camera,update,resize,handleEvents,rig,models,fields,setSky,cam,puff,get stats(){return {fields:Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,v?.mesh.count]))};}};
}
