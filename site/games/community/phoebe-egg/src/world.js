import * as T from '../../pie-phoebe/vendor/three.module.js';
import {place,loadModel} from './assets.js';
import {makeEgg} from './models.js';
import {CAMP,NEST,PLATFORM,RAMP,ROCKS,CLIMBS,ground} from './rules.js';

// Scenery is entirely baked GLB. The only runtime-built meshes are gameplay UI markers
// (delivery ring) and lights. Collision lives in rules.js; models are fitted to those volumes.
export async function buildWorld(scene) {
  scene.background=new T.Color(0xdcd6de);scene.fog=new T.Fog(0xdcd6de,60,175);
  scene.add(new T.HemisphereLight(0xe8f4ff,0xb7b08a,1.55));
  const sun=new T.DirectionalLight(0xfff0d6,2.1);sun.position.set(-18,35,18);sun.castShadow=true;
  sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-36,right:36,top:36,bottom:-36,near:1,far:100});sun.shadow.bias=-.0006;sun.shadow.normalBias=.06;scene.add(sun);
  let seed=41;const rand=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  const jobs=[];const add=(...args)=>{const p=place(scene,...args);jobs.push(p);return p;};
  // Terrain, sea and sky are baked from tools/phoebe-egg/build-terrain.mjs.
  const [groundModel,seaModel,skyModel]=await Promise.all([loadModel('ground',{raw:true}),loadModel('sea',{raw:true}),loadModel('sky',{raw:true})]);
  const land=groundModel.clone();land.traverse(o=>{if(o.isMesh)o.receiveShadow=true;});scene.add(land);
  const sea=seaModel.clone();sea.position.y=-2.7;sea.traverse(o=>{if(o.isMesh){o.castShadow=false;o.material=o.material.clone();o.material.map.wrapS=o.material.map.wrapT=T.RepeatWrapping;}});scene.add(sea);
  const sky=skyModel.clone();sky.traverse(o=>{if(o.isMesh){o.castShadow=o.receiveShadow=false;o.material=new T.MeshBasicMaterial({map:o.material.map,side:T.BackSide,fog:false,depthWrite:false});o.renderOrder=-1;}});scene.add(sky);
  const p=PLATFORM;
  add('plateau',{x:(p.x1+p.x2)/2,y:0,z:(p.z1+p.z2)/2,width:p.x2-p.x1,depth:p.z2-p.z1,height:p.y});
  add('ramp',{x:(RAMP.x1+RAMP.x2)/2,y:0,z:(RAMP.z1+RAMP.z2)/2,width:RAMP.x2-RAMP.x1,depth:RAMP.z2-RAMP.z1,height:RAMP.y});
  for(const rock of ROCKS)add('rock',{x:rock.x,z:rock.z,width:rock.r*2.15,depth:rock.r*2.15,height:rock.h,rotY:rock.x});
  for(const c of CLIMBS)add('ladder',{x:c.x,z:c.z,height:c.y+.4,width:1.4,depth:.35,rotY:Math.atan2(c.topX-c.x,c.topZ-c.z)});
  add('tent',{x:-4.2,z:25.2,width:4.2,rotY:.35});add('crate',{x:3.4,z:25.2,width:1.2,rotY:-.2});add('flag',{x:3.6,z:21.2,height:4.6});
  add('nest',{x:NEST.x,y:.02,z:NEST.z,width:4.6});
  for(let i=0;i<24;i++){
    const a=rand()*Math.PI*2,dist=31+rand()*8;
    add('sakura_tree',{x:Math.cos(a)*dist,z:Math.sin(a)*dist,height:5+rand()*2.6,rotY:rand()*6.28});
  }
  for(const z of [-28,28])add('torii',{x:z>0?18:0,z,width:11.5,rotY:z>0?Math.PI:0});
  for(const x of [-22,20])for(const z of [-19,-5,10,23])add('lantern',{x,y:ground(x,z),z,height:2.4,rotY:rand()*6.28});
  for(let i=0;i<14;i++)add('cloud',{x:(i-7)*17,y:24+(i%3)*4,z:-70-(i%2)*18,width:20+(i%4)*4});
  const placed=await Promise.all(jobs);
  const ring=new T.Mesh(new T.RingGeometry(2.15,2.4,64),new T.MeshBasicMaterial({color:0xbdf8b1,side:T.DoubleSide,transparent:true,opacity:.85}));
  ring.rotation.x=-Math.PI/2;ring.position.set(CAMP.x,.07,CAMP.z);scene.add(ring);
  const nestEggs=[];
  for(let i=0;i<3;i++){const e=makeEgg(scene,1.2);e.position.set((i-1)*.8,.12,NEST.z+(i%2)*.65);nestEggs.push(e);}
  return {nestEggs,ring,sea,placed};
}
