import * as T from '../../pie-phoebe/vendor/three.module.js';
import {makeGeneratedPhoebe as makeAnimePhoebe,makeGeneratedReggie as makeAnimeReggie} from './model-actors.js';
const canvas=document.getElementById('preview'),scene=new T.Scene();scene.background=new T.Color(0xf3eee7);
const renderer=new T.WebGLRenderer({canvas,antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;renderer.toneMapping=T.NoToneMapping;
const camera=new T.PerspectiveCamera(32,1,.05,80);scene.add(new T.HemisphereLight(0xffffff,0xc5bdcf,1.1));
const light=new T.DirectionalLight(0xfff5e8,1.1);light.position.set(-4,8,6);light.castShadow=true;light.shadow.mapSize.set(2048,2048);Object.assign(light.shadow.camera,{left:-5,right:5,top:5,bottom:-5});light.shadow.normalBias=.035;scene.add(light);
const floor=new T.Mesh(new T.PlaneGeometry(40,40),new T.ShadowMaterial({color:0x766879,opacity:.16}));floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;scene.add(floor);
let selected='phoebe',angle=.1,tilt=.04,distance=7.8,drag=null,time=0,last=performance.now();
try{
const [phoebe,reggie]=await Promise.all([makeAnimePhoebe(scene),makeAnimeReggie(scene)]);reggie.root.visible=false;
const actors={phoebe,reggie};
function select(name){selected=name;phoebe.root.visible=name==='phoebe';reggie.root.visible=name==='reggie';distance=name==='phoebe'?5.6:6.4;angle=name==='phoebe'?.1:.55;document.getElementById('reference').src=`../pie-phoebe/assets/${name==='phoebe'?'phoebe':'reggie_open'}.png`;document.getElementById('download').href=`./assets/models/${name}.glb`;document.getElementById('download').textContent=`下載${name==='phoebe'?'菲比':'瑞吉'} GLB 模型`;for(const key of Object.keys(actors))document.getElementById(`select-${key}`).classList.toggle('selected',key===name);}
function selectAsset(name){
  select(name);
  const info=actors[name].root.userData.asset;
  document.getElementById('download').href=`./assets/models/${name}.glb`;
  document.getElementById('asset-info').textContent=`${info.vertices.toLocaleString()} 頂點 · Hunyuan3D-2 貼圖\n骨架：${info.rig}`;
}
document.getElementById('select-phoebe').onclick=()=>selectAsset('phoebe');document.getElementById('select-reggie').onclick=()=>selectAsset('reggie');
document.querySelectorAll('[data-angle]').forEach(button=>button.onclick=()=>{angle=Number(button.dataset.angle);tilt=.04;document.getElementById('rotate').checked=false;});
document.getElementById('wireframe').onchange=e=>{for(const a of Object.values(actors))a.root.traverse(o=>{if(o.isMesh&&o.name!=='ink-outline')o.material.wireframe=e.target.checked;});};
canvas.onpointerdown=e=>{drag={x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId);};canvas.onpointermove=e=>{if(!drag)return;angle-=(e.clientX-drag.x)*.008;tilt=T.MathUtils.clamp(tilt+(e.clientY-drag.y)*.003,-.3,.8);drag={x:e.clientX,y:e.clientY};};canvas.onpointerup=canvas.onpointercancel=()=>drag=null;
canvas.addEventListener('wheel',e=>{e.preventDefault();distance=T.MathUtils.clamp(distance+e.deltaY*.008,3,10);},{passive:false});
new ResizeObserver(()=>{renderer.setSize(canvas.clientWidth,canvas.clientHeight,false);camera.aspect=canvas.clientWidth/canvas.clientHeight;camera.updateProjectionMatrix();}).observe(canvas.parentElement);
function frame(now){const dt=Math.min(.05,(now-last)/1000);last=now;time+=dt;const pose=document.getElementById('pose').value;
phoebe.animate({speed:pose==='walk'?4:0,sprinting:false,hurt:0,egg:pose==='carry'?{hp:3}:null,climb:pose==='climb'?{}:null,roll:0},time);
reggie.animate({state:pose==='attack'?'windup':pose==='walk'?'chase':'patrol',attack:'roar',clock:time%1},time);
if(document.getElementById('rotate').checked)angle+=dt*.35;
const target=new T.Vector3(0,selected==='phoebe'?1.0:.95,0);camera.position.set(Math.sin(angle)*distance,1.2+Math.sin(tilt)*distance,Math.cos(angle)*distance);camera.lookAt(target);renderer.render(scene,camera);requestAnimationFrame(frame);}
selectAsset('phoebe');document.getElementById('loading').style.display='none';window.__models={actors,scene,camera,renderer,select:selectAsset};requestAnimationFrame(frame);
}catch(error){document.getElementById('loading').textContent=`模型載入失敗：${error.message}`;console.error(error);}
