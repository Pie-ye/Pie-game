import * as T from '../../pie-phoebe/vendor/three.module.js';
import {loadPhoebeRig} from './rig.js';
import {makeAnimator} from './pose.js';
const canvas=document.getElementById('c'),renderer=new T.WebGLRenderer({canvas,antialias:true});renderer.setPixelRatio(1);renderer.shadowMap.enabled=true;
const scene=new T.Scene();scene.background=new T.Color(0xefe9df);
scene.add(new T.HemisphereLight(0xffffff,0xb9b3a8,1.7));const sun=new T.DirectionalLight(0xffffff,2);sun.position.set(-3,6,5);sun.castShadow=true;scene.add(sun);
const floor=new T.Mesh(new T.PlaneGeometry(20,20),new T.MeshStandardMaterial({color:0xd8d0c0}));floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;scene.add(floor);
const wall=new T.Mesh(new T.BoxGeometry(6,6,1),new T.MeshStandardMaterial({color:0x9aa1a8}));wall.position.set(0,3,-.5-.38);scene.add(wall);
const camera=new T.PerspectiveCamera(35,1,.1,50);
const R=await loadPhoebeRig(1.5);scene.add(R.root);const animate=makeAnimator(R);
const params=new URLSearchParams(location.search);
const modes=['idle','walk','run','air','wall','rope','anchored','mantle','faint','eat','tool','chain'];
let mode=params.get('pose')||'idle',view=params.get('view')||'front',t=0,phase=0;
const bar=document.getElementById('bar');for(const m of modes){const b=document.createElement('button');b.textContent=m;b.onclick=()=>{mode=m;};bar.append(b);}
function state(){
  const s={mode:'idle',speed:0,sprint:false,vy:0,t,phase,up:0,side:0,nx:0,nz:1,lunge:0,mantle:0,eat:0,tool:false,hurt:0,energy:false,held:null};
  if(mode==='walk'){s.mode='walk';s.speed=3.1;}else if(mode==='run'){s.mode='walk';s.speed=5.4;s.sprint=true;}
  else if(mode==='air'){s.mode='air';s.vy=3;}
  else if(mode==='wall'||mode==='chain'){s.mode=mode;s.nz=1;}
  else if(mode==='rope'||mode==='anchored'){s.mode=mode;}
  else if(mode==='mantle'){s.mode='mantle';s.mantle=(t*.5)%1;}
  else if(mode==='faint')s.mode='faint';
  else if(mode==='eat'){s.eat=(t*.6)%1;}else if(mode==='tool')s.tool=true;
  return s;
}
function frame(now){
  const dt=.016;t+=dt;phase+=dt*3;
  const climbing=['wall','chain','rope','anchored'].includes(mode);
  R.root.position.set(0,climbing?.05:0,climbing?-.12:0);R.root.rotation.y=0;R.root.rotation.x=0;R.root.updateMatrixWorld(true);
  animate(state(),dt);
  const w=canvas.clientWidth,h=canvas.clientHeight;if(canvas.width!==w||canvas.height!==h){renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();}
  const ang=view==='side'?Math.PI/2:view==='back'?Math.PI:view==='three'?.7:0;
  camera.position.set(Math.sin(ang)*3.2,1.0,Math.cos(ang)*3.2);camera.lookAt(0,.7,0);
  renderer.render(scene,camera);requestAnimationFrame(frame);
}
window.__rig={R,setMode:m=>{mode=m;},setView:v=>{view=v;}};
requestAnimationFrame(frame);
