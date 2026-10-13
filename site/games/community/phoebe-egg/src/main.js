import * as T from '../../pie-phoebe/vendor/three.module.js';
import PieGame from '../../../../sdk/pie-game-sdk.js';
import {makePhoebe,makeReggie,makeEgg} from './models.js';
import {buildWorld} from './world.js';
import {Game,ATTACKS} from './game.js';
import {CAMP,NEST,PLATFORM,RAMP,ROCKS,CLIMBS,ground} from './rules.js';
import * as audio from './audio.js';

const $=id=>document.getElementById(id),app=$('app'),canvas=$('world');
const game=new Game(()=>{},audio.play),keys=new Set();
let yaw=0,pitch=.51,zoom=10,drag=null,stick={id:null,x:0,z:0},touchUse=false,touchRun=false;
let renderer,scene,camera,phoebe,reggie,world,dropped,telegraph,sweepArea,chargeLine,shock;
let last=performance.now(),accumulator=0,visualTime=0,lastMode='',minimapClock=0;
let best=0;try{best=Number(localStorage.getItem('pg-phoebe-egg-best'))||0;}catch{}
const readInput=()=>{
  let x=(keys.has('d')||keys.has('arrowright')?1:0)-(keys.has('a')||keys.has('arrowleft')?1:0)+stick.x;
  let z=(keys.has('s')||keys.has('arrowdown')?1:0)-(keys.has('w')||keys.has('arrowup')?1:0)+stick.z;
  return {x:x*Math.cos(yaw)+z*Math.sin(yaw),z:-x*Math.sin(yaw)+z*Math.cos(yaw),run:keys.has('shift')||touchRun,use:keys.has('e')||touchUse};
};
function clearInput(){keys.clear();stick={id:null,x:0,z:0};touchUse=false;touchRun=false;drag=null;$('joystick').firstElementChild.style.transform='';$('touch-run').classList.remove('active');}
function start(){audio.unlock();clearInput();game.reset();yaw=0;pitch=.51;camera.position.set(0,7,31);lastMode='';app.focus();game.message('沿路前往蛋巢；左側岩台有攀爬梯，右側是平緩河谷');}
function pause(){if(game.mode==='play'){game.mode='pause';clearInput();}else if(game.mode==='pause'){game.mode='play';app.focus();}}
$('start').onclick=start;$('restart').onclick=start;$('resume').onclick=pause;$('pause').onclick=pause;
$('home').onclick=()=>{clearInput();game.reset();game.mode='title';};
$('mute').onclick=()=>{audio.unlock();$('mute').textContent=`音效 ${audio.toggle()?'關':'開'}`;};
window.addEventListener('keydown',event=>{
  const k=event.key.toLowerCase();
  if([' ','arrowup','arrowdown','arrowleft','arrowright'].includes(k))event.preventDefault();
  if(event.target.closest('button'))return;
  keys.add(k);if(event.repeat)return;audio.unlock();
  if(k==='escape'||k==='p'){pause();return;}
  if(game.mode==='title'){if(k==='enter')start();return;}
  if(game.mode!=='play')return;
  if(k===' ')game.roll(readInput());if(k==='e')game.interact();
});
window.addEventListener('keyup',event=>keys.delete(event.key.toLowerCase()));
window.addEventListener('blur',()=>{clearInput();if(game.mode==='play')game.mode='pause';});
document.addEventListener('visibilitychange',()=>{if(document.hidden){clearInput();if(game.mode==='play')game.mode='pause';}});
canvas.addEventListener('contextmenu',e=>e.preventDefault());
canvas.addEventListener('pointerdown',e=>{if(e.button===2||e.pointerType==='touch'){drag={id:e.pointerId,x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId);}});
canvas.addEventListener('pointermove',e=>{if(drag?.id===e.pointerId){yaw-=(e.clientX-drag.x)*.006;pitch=T.MathUtils.clamp(pitch+(e.clientY-drag.y)*.004,.16,.95);drag.x=e.clientX;drag.y=e.clientY;}});
for(const name of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(name,()=>drag=null);
canvas.addEventListener('wheel',e=>{e.preventDefault();zoom=T.MathUtils.clamp(zoom+e.deltaY*.008,6,15);},{passive:false});
const joystick=$('joystick');
joystick.addEventListener('pointerdown',e=>{e.preventDefault();audio.unlock();stick.id=e.pointerId;joystick.setPointerCapture(e.pointerId);});
joystick.addEventListener('pointermove',e=>{if(e.pointerId!==stick.id)return;const r=joystick.getBoundingClientRect(),dx=e.clientX-r.left-r.width/2,dz=e.clientY-r.top-r.height/2,l=Math.max(38,Math.hypot(dx,dz));stick.x=dx/l;stick.z=dz/l;joystick.firstElementChild.style.transform=`translate(${stick.x*30}px,${stick.z*30}px)`;});
for(const name of ['pointerup','pointercancel','lostpointercapture'])joystick.addEventListener(name,()=>{stick={id:null,x:0,z:0};joystick.firstElementChild.style.transform='';});
$('touch-roll').onpointerdown=e=>{e.preventDefault();audio.unlock();game.roll(readInput());};
$('touch-run').onclick=()=>{touchRun=!touchRun;$('touch-run').classList.toggle('active',touchRun);};
$('touch-use').onpointerdown=e=>{e.preventDefault();audio.unlock();touchUse=true;$('touch-use').setPointerCapture(e.pointerId);game.interact();};
for(const name of ['pointerup','pointercancel','lostpointercapture'])$('touch-use').addEventListener(name,()=>touchUse=false);

function updateUI(){
  const p=game.player,e=game.enemy;
  if(lastMode!==game.mode){
    lastMode=game.mode;$('menu').hidden=game.mode!=='title';$('hud').hidden=game.mode==='title';
    $('modal').hidden=['title','play'].includes(game.mode);$('resume').hidden=game.mode!=='pause';
    if(game.mode==='pause'){$('modal-title').textContent='喘口氣，再出發';$('modal-copy').textContent='任務已暫停，時間不會流逝。';}
    if(game.mode==='won'||game.mode==='lost'){
      if(game.mode==='won'&&(!best||game.elapsed<best)){best=game.elapsed;try{localStorage.setItem('pg-phoebe-egg-best',String(best));}catch{}}
      $('modal-title').textContent=game.mode==='won'?'委託完成！':'下次一定可以';
      $('modal-copy').textContent=`${game.result}\n交付 ${game.delivered} / 3 · 用時 ${formatTime(game.elapsed)}\n破蛋 ${game.broken} 次 · 成功閃避 ${game.dodges} 次`;
    }
    $('best').textContent=best?`最佳完成時間 ${formatTime(best)}`:'';
  }
  $('hp').value=p.hp;$('stamina').value=p.stamina;$('deliveries').textContent=`${game.delivered} / 3`;$('timer').textContent=formatTime(360-game.elapsed);
  $('egg-status').textContent=p.egg?`搬運中 · ${['','危險裂痕','輕微裂痕','蛋殼完整'][p.egg.hp]}`:game.dropped?'蛋在地上 · 金色標記可找回':'空手 · 前往蛋巢';
  $('hint').textContent=game.context().text;$('deposit').hidden=game.deposit<=0;$('deposit').value=game.deposit;
  $('toast').textContent=game.toast;
  let warning=e.state==='windup'?ATTACKS[e.attack]:e.state==='charge'?'瑞吉衝過來了！':e.state==='chase'&&p.egg?'瑞吉正在追你！善用岩石與高台':'';
  if(warning){const a=Math.atan2(e.x-p.x,e.z-p.z)-yaw;warning=`${Math.sin(a)>.35?'右側 ↗ ':Math.sin(a)<-.35?'↖ 左側 ':Math.cos(a)>0?'身後 ↓ ':'前方 ↑ '}${warning}`;}
  $('alert').textContent=warning;
}
function formatTime(s){const n=Math.max(0,Math.floor(s));return `${Math.floor(n/60).toString().padStart(2,'0')}:${(n%60).toString().padStart(2,'0')}`;}

const map=$('map').getContext('2d');
function drawMap(){
  const p=game.player,scale=4.2,c=150;
  const pos=(x,z)=>[c+(x-p.x)*scale,c+(z-p.z)*scale];
  map.clearRect(0,0,300,300);map.save();map.beginPath();map.arc(c,c,148,0,Math.PI*2);map.clip();
  map.fillStyle='#244f48';map.fillRect(0,0,300,300);
  const [ox,oz]=pos(-29,-29);map.fillStyle='#8caa79';map.fillRect(ox,oz,58*scale,58*scale);
  const rect=(b,color)=>{const [x,z]=pos(b.x1,b.z1);map.fillStyle=color;map.fillRect(x,z,(b.x2-b.x1)*scale,(b.z2-b.z1)*scale);};
  rect(PLATFORM,'#d3c692');rect(RAMP,'#b8b98d');
  for(const r of ROCKS){const [x,z]=pos(r.x,r.z);map.beginPath();map.arc(x,z,r.r*scale,0,Math.PI*2);map.fillStyle='#4e6960';map.fill();}
  for(const cl of CLIMBS){const [x,z]=pos(cl.x,cl.z);map.fillStyle='#fff4c6';map.fillRect(x-3,z-5,6,10);}
  function dot(target,color,label){
    let [x,z]=pos(target.x,target.z),d=Math.hypot(x-c,z-c);const outside=d>125;
    if(outside){x=c+(x-c)/d*125;z=c+(z-c)/d*125;}
    map.fillStyle=color;map.strokeStyle='#173b36';map.lineWidth=2;
    map.beginPath();map.arc(x,z,label==='瑞'?7:6,0,Math.PI*2);map.fill();map.stroke();
    const height=(target.y??0)-p.y;map.fillStyle='#fffbe6';map.font='bold 13px sans-serif';map.textAlign='center';map.fillText(`${label}${height>1?'↑':height<-1?'↓':''}${outside?'›':''}`,x,z-12);
  }
  dot(CAMP,'#8fffac','營');dot(game.dropped||NEST,'#ffe09a','蛋');dot(game.enemy,'#ef7860','瑞');
  map.save();map.translate(c,c);map.rotate(-p.angle);map.beginPath();map.moveTo(0,10);map.lineTo(-6,-6);map.lineTo(0,-3);map.lineTo(6,-6);map.closePath();map.fillStyle='#ffffff';map.fill();map.restore();
  map.fillStyle='#f6e8be';map.font='bold 13px sans-serif';map.textAlign='center';map.fillText('N',150,22);map.restore();
}

function visual(dt){
  if(game.mode==='play'||game.mode==='title')visualTime+=dt;
  const p=game.player,e=game.enemy;
  phoebe.root.position.set(p.x,p.y,p.z);phoebe.root.rotation.y=p.angle;phoebe.animate(p,visualTime);
  reggie.root.position.set(e.x,e.y,e.z);reggie.root.rotation.y=e.angle;reggie.animate(e,visualTime);
  dropped.visible=!!game.dropped;if(game.dropped){dropped.position.set(game.dropped.x,game.dropped.y,game.dropped.z);dropped.userData.cracks.visible=game.dropped.hp<3;}
  world.nestEggs.forEach((egg,i)=>egg.visible=i<3-game.delivered-(p.egg||game.dropped?1:0));
  const warning=e.state==='windup',active=e.state==='active';
  telegraph.visible=(warning||active)&&['roar','slam'].includes(e.attack);sweepArea.visible=(warning||active)&&e.attack==='sweep';chargeLine.visible=warning&&e.attack==='charge';shock.visible=active;
  if(telegraph.visible){const radius=e.attack==='roar'?6:e.attack==='slam'?4.8:3.8;telegraph.position.set(e.x,e.y+.055,e.z);telegraph.scale.setScalar(radius);telegraph.material.opacity=.14+Math.min(1,e.clock)*.22;}
  if(sweepArea.visible){sweepArea.position.set(e.x,e.y+.06,e.z);sweepArea.rotation.set(-Math.PI/2,0,-e.angle);sweepArea.material.opacity=.14+Math.min(1,e.clock)*.22;}
  if(chargeLine.visible){chargeLine.position.set(e.x+e.direction.x*8,e.y+.06,e.z+e.direction.z*8);chargeLine.rotation.set(-Math.PI/2,0,-e.angle);chargeLine.material.opacity=.2+e.clock*.25;}
  if(shock.visible){shock.position.set(e.x,e.y+.18,e.z);shock.scale.setScalar(1+e.clock*10);shock.material.opacity=Math.max(0,.65-e.clock);}
  const target=new T.Vector3(p.x,p.y+1.35,p.z),desired=new T.Vector3();
  if(game.mode==='title'){
    target.set(-3,1,-7);desired.set(25,23,35);
  }else{
    const back=new T.Vector3(Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch));
    let distance=zoom;
    // Camera boom collision: stop before rock volumes and elevated terrain.
    for(let d=.6;d<zoom;d+=.2){
      const test=target.clone().addScaledVector(back,d);
      if(test.y<ground(test.x,test.z)+.25||ROCKS.some(r=>Math.hypot(test.x-r.x,test.z-r.z)<r.r+.35&&test.y<r.h+.4)){distance=Math.max(.7,d-.3);break;}
    }
    desired.copy(target).addScaledVector(back,distance);
  }
  camera.position.lerp(desired,1-Math.exp(-dt*10));camera.lookAt(target);
  renderer.render(scene,camera);
}
function resize(){const w=app.clientWidth,h=app.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();}
function frame(now){
  const dt=Math.min(.08,(now-last)/1000);last=now;accumulator+=dt;
  while(accumulator>=1/60){game.update(1/60,readInput());accumulator-=1/60;}
  updateUI();visual(dt);minimapClock+=dt;if(minimapClock>.09){drawMap();minimapClock=0;}
  requestAnimationFrame(frame);
}
try{
  renderer=new T.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.7));renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.1;
  scene=new T.Scene();camera=new T.PerspectiveCamera(48,1,.1,250);camera.position.set(25,23,35);
  world=buildWorld(scene);phoebe=makePhoebe(scene);reggie=makeReggie(scene);dropped=makeEgg(scene,1.12);
  const markerMaterial=new T.MeshBasicMaterial({color:0xf04f37,transparent:true,opacity:.3,side:T.DoubleSide,depthWrite:false});
  telegraph=new T.Mesh(new T.CircleGeometry(1,64),markerMaterial);telegraph.rotation.x=-Math.PI/2;scene.add(telegraph);
  const halfSweep=Math.acos(-.25);
  sweepArea=new T.Mesh(new T.CircleGeometry(3.8,48,-Math.PI/2-halfSweep,halfSweep*2),markerMaterial.clone());scene.add(sweepArea);
  chargeLine=new T.Mesh(new T.PlaneGeometry(4,17),markerMaterial.clone());scene.add(chargeLine);
  shock=new T.Mesh(new T.RingGeometry(.93,1,64),new T.MeshBasicMaterial({color:0xffd491,transparent:true,side:T.DoubleSide,depthWrite:false}));shock.rotation.x=-Math.PI/2;scene.add(shock);
  new ResizeObserver(resize).observe(app);resize();$('loading').hidden=true;
  window.__egg={game,scene,camera,renderer,start,readInput};
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();game.mode='pause';$('loading').hidden=false;$('loading').textContent='繪圖連線已中斷，請重新整理頁面後再開始。';});
  requestAnimationFrame(frame);
}catch(error){$('loading').textContent=`無法啟動 3D 場景：${error.message}。請使用支援 WebGL 2 的瀏覽器並開啟硬體加速。`;console.error(error);}
PieGame.ready().then(()=>PieGame.setHeight()).catch(()=>{});
