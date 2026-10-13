import * as T from '../../pie-phoebe/vendor/three.module.js';
import {mesh,sphere,group,makeEgg,material} from './models.js';
import {CAMP,NEST,PLATFORM,RAMP,ROCKS,CLIMBS,ground} from './rules.js';

export function buildWorld(scene) {
  scene.background=new T.Color(0xa9d8dc);scene.fog=new T.Fog(0xa9d8dc,43,110);
  scene.add(new T.HemisphereLight(0xd2f1ff,0x9b9566,2.4));
  const sun=new T.DirectionalLight(0xffe5ba,3.1);sun.position.set(-18,35,18);sun.castShadow=true;
  sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-36,right:36,top:36,bottom:-36,near:1,far:100});sun.shadow.bias=-.0006;sun.shadow.normalBias=.06;scene.add(sun);
  const land=mesh(scene,new T.CylinderGeometry(43,46,4,64),0xb6c78b,0,-2.06,0);land.receiveShadow=true;
  const sea=mesh(scene,new T.PlaneGeometry(500,500),new T.MeshStandardMaterial({color:0x65b8be,roughness:.33}),0,-2.5,0);sea.rotation.x=-Math.PI/2;sea.castShadow=false;
  // Sand trail, broad enough to read from the follow camera.
  for(let i=0;i<29;i++) {
    const z=-26+i*1.8,x=9+Math.sin(z*.15)*3;
    mesh(scene,new T.CylinderGeometry(3.1,3.1,.018,16),0xdfd3a0,x,.005,z);
  }
  for(const target of [CAMP,NEST]) mesh(scene,new T.CylinderGeometry(5.2,5.4,.04,32),0xdfd3a0,target.x,.015,target.z);
  const p=PLATFORM;
  mesh(scene,new T.BoxGeometry(p.x2-p.x1,p.y,p.z2-p.z1),0x8d9b7a,(p.x1+p.x2)/2,p.y/2,(p.z1+p.z2)/2);
  mesh(scene,new T.BoxGeometry(p.x2-p.x1,.16,p.z2-p.z1),0xabc477,(p.x1+p.x2)/2,p.y-.05,(p.z1+p.z2)/2);
  // Closed wedge for a continuous traversable ramp.
  const r=RAMP, points=[r.x1,0,r.z1,r.x2,0,r.z1,r.x1,r.y,r.z2,r.x2,r.y,r.z2,r.x1,0,r.z2,r.x2,0,r.z2];
  const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(points,3));geo.setIndex([0,2,1,1,2,3,0,4,2,1,3,5,2,4,3,3,4,5,0,1,4,1,5,4]);geo.computeVertexNormals();mesh(scene,geo,0xa9bd80);
  for(const rock of ROCKS) {
    const b=mesh(scene,new T.DodecahedronGeometry(1,0),0x829687,rock.x,rock.h*.44,rock.z,[rock.r,rock.h*.65,rock.r]);b.rotation.y=rock.x;
    sphere(scene,0xa6b77c,rock.x-.2,rock.h*.72,rock.z-.15,rock.r*.64,.23,rock.r*.62);
  }
  // Climb markers are actual ladders, with matching gameplay entry points.
  for(const c of CLIMBS) {
    const ladder=group(scene,c.x,0,c.z);ladder.rotation.y=Math.atan2(c.topX-c.x,c.topZ-c.z);
    for(const side of [-1,1]) mesh(ladder,new T.CylinderGeometry(.065,.065,c.y+.2,8),0xa7784c,side*.55,c.y/2,.55);
    for(let i=0;i<9;i++) mesh(ladder,new T.BoxGeometry(1.2,.08,.1),0xe2c799,0,.22+i*.35,.55);
    const marker=mesh(ladder,new T.ConeGeometry(.18,.35,3),0xf0d68c,0,c.y+.75,.55);marker.rotation.z=Math.PI;
  }
  // Camp: canvas tent, supply crate and a tall delivery pennant.
  const tent=group(scene,-3.2,0,24.5);
  const tg=new T.BufferGeometry();tg.setAttribute('position',new T.Float32BufferAttribute([-2,0,-1.5,2,0,-1.5,0,2.5,-1.5,-2,0,1.5,2,0,1.5,0,2.5,1.5],3));tg.setIndex([0,2,3,3,2,5,1,4,2,4,5,2,0,1,2]);tg.computeVertexNormals();
  mesh(tent,tg,new T.MeshStandardMaterial({color:0xf2d6a0,roughness:1,side:T.DoubleSide}));
  for(const z of [-1.55,1.55])mesh(tent,new T.CylinderGeometry(.05,.05,2.7,8),0x6b5540,0,1.3,z);
  mesh(scene,new T.BoxGeometry(1.5,.9,1.2),0x8f6741,2.5,.45,24.6);
  mesh(scene,new T.CylinderGeometry(.055,.075,5,8),0x6c5843,2.8,2.5,22);
  mesh(scene,new T.BoxGeometry(1.5,.8,.035),0x508c69,3.5,4.35,22);
  const ring=mesh(scene,new T.RingGeometry(2.15,2.4,64),new T.MeshBasicMaterial({color:0xbdf8b1,side:T.DoubleSide}),CAMP.x,.07,CAMP.z);ring.rotation.x=-Math.PI/2;ring.castShadow=false;
  // Nest: interwoven sticks and three physical eggs.
  for(let i=0;i<28;i++){
    const a=i/28*Math.PI*2;
    const stick=mesh(scene,new T.CylinderGeometry(.07,.12,1.7,6),i%2?0x987148:0xb89460,Math.cos(a)*1.65,.16+(i%3)*.08,NEST.z+Math.sin(a)*1.65);
    stick.rotation.set(Math.cos(a)*.2,0,Math.PI/2);stick.rotation.y=-a;
  }
  const nestEggs=[];
  for(let i=0;i<3;i++){const e=makeEgg(scene,1.2);e.position.set((i-1)*.8,.1,NEST.z+(i%2)*.65);nestEggs.push(e);}
  // Deterministic foliage avoids changing collision or routes between runs.
  let seed=41;const rand=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  const leaves=[0x4f8866,0x659b6e,0x78a570];
  for(let i=0;i<48;i++) {
    const a=rand()*Math.PI*2,dist=30+rand()*7,x=Math.cos(a)*dist,z=Math.sin(a)*dist;
    const tree=group(scene,x,0,z),h=2.4+rand()*2;
    mesh(tree,new T.CylinderGeometry(.13,.25,h,7),0x806448,0,h/2,0);
    for(let j=0;j<3;j++)mesh(tree,new T.ConeGeometry(1.7-j*.32,2.6,7),leaves[i%3],0,h+j*.7,0);
  }
  for(let i=0;i<110;i++) {
    const x=rand()*55-27.5,z=rand()*55-27.5;
    if(Math.abs(x)<4||(x>5&&x<14)||Math.abs(z)>21)continue;
    const y=ground(x,z);
    mesh(scene,new T.ConeGeometry(.14,.45+rand()*.3,4),0x709e68,x,y+.18,z);
    if(i%4===0)sphere(scene,0xf4e2a4,x,y+.5,z,.095,.065,.095);
  }
  for(let i=0;i<12;i++) {
    const a=i/12*Math.PI*2;
    const b=mesh(scene,new T.DodecahedronGeometry(1,0),0x779b95,Math.sin(a)*75,-2,Math.cos(a)*75,[9,7+i%4*3,9]);b.rotation.y=a;
  }
  batchStatic(scene,[...nestEggs,ring,sea]);
  return {nestEggs,ring,sea};
}

// Bake immutable scenery by material: fewer draw calls on mobile, same geometry.
function batchStatic(scene,excluded){
  scene.updateMatrixWorld(true);
  const batches=new Map(),sources=[];
  scene.traverse(object=>{
    if(!object.isMesh)return;
    for(let p=object;p;p=p.parent)if(excluded.includes(p))return;
    const key=object.material.uuid;
    if(!batches.has(key))batches.set(key,{material:object.material,geometries:[]});
    const geometry=object.geometry.index?object.geometry.toNonIndexed():object.geometry.clone();
    geometry.applyMatrix4(object.matrixWorld);batches.get(key).geometries.push(geometry);sources.push(object);
  });
  for(const {material,geometries} of batches.values()){
    const geometry=new T.BufferGeometry();
    for(const name of ['position','normal']){
      const length=geometries.reduce((sum,g)=>sum+g.attributes[name].array.length,0),data=new Float32Array(length);
      let offset=0;for(const g of geometries){data.set(g.attributes[name].array,offset);offset+=g.attributes[name].array.length;}
      geometry.setAttribute(name,new T.BufferAttribute(data,3));
    }
    const combined=new T.Mesh(geometry,material);combined.castShadow=true;combined.receiveShadow=true;scene.add(combined);
    geometries.forEach(g=>g.dispose());
  }
  sources.forEach(object=>{object.removeFromParent();object.geometry.dispose();});
}
