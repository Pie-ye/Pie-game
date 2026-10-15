import * as T from '../../pie-phoebe/vendor/three.module.js';
import PieGame from '../../../../sdk/pie-game-sdk.js';
import {Game} from './game.js';
import {buildScene} from './scene.js';
import {makeHud} from './hud.js';
import * as audio from './audio.js';
import {ASCENTS,ITEMS,ZONES} from './data.js';
import {daySeed} from './rng.js';
import {ATTACK_INFO} from './rules.js';

const $=id=>document.getElementById(id),app=$('app'),canvas=$('world');
const SAVE='pg-phoebe-peak';
let save={unlocked:0,best:{}};try{save={...save,...JSON.parse(localStorage.getItem(SAVE)||'{}')};}catch{}
const persist=()=>{try{localStorage.setItem(SAVE,JSON.stringify(save));}catch{}};
const params=new URLSearchParams(location.search);
const seed=Number(params.get('seed'))||daySeed();
let ascent=Math.min(Number(params.get('ascent'))||0,save.unlocked);
const game=new Game({seed,ascent}),keys=new Set(),view={yaw:0,pitch:.34,dist:6.4,autoAlign:true,hurt:0};
let renderer,sc,hud,last=performance.now(),acc=0,drag=null,lastDrag=0,stick={x:0,z:0,id:null},touch={run:false,grab:false};
const edge={jump:false,interact:false,use:false,drop:false,release:false,slot:null,step:0};

function buildMenu(){
  const box=$('ascents');box.innerHTML='';
  ASCENTS.forEach((a,i)=>{const b=document.createElement('button');b.className='asc'+(i===ascent?' on':'');b.textContent=a.name;b.disabled=i>save.unlocked;b.onclick=()=>{ascent=i;buildMenu();};box.append(b);});
  const gl=game.world.gloom?` · 今日變體：幽暗的${ZONES.find(z=>z.id===game.world.gloom).name}區`:'';$('daily').textContent=`今日山脈 #${seed}${gl}（每 24 小時更換）${save.best[ascent]?` · 本階最佳 ${Math.floor(save.best[ascent]/60)}分${Math.round(save.best[ascent]%60)}秒`:''}`;
}
function clearInput(){keys.clear();stick={x:0,z:0,id:null};touch={run:false,grab:false};drag=null;const j=$('joystick').firstElementChild;if(j)j.style.transform='';}
function start(){
  audio.unlock();clearInput();game.reset({seed,ascent});game.mode='play';view.yaw=0;view.pitch=.34;view.dist=6.4;
  hud=hud||makeHud(game);$('menu').hidden=true;$('modal').hidden=true;$('hud').hidden=false;app.focus();
  game.toast('走向前方岩壁開始攀爬。靠近物品按 E 撿起',4200);
}
function pause(){if(game.mode==='play'){game.mode='pause';clearInput();$('modal-title').textContent='暫停';$('modal-copy').textContent='放鬆一下，山不會跑掉。';$('modal-stats').textContent='';$('resume').hidden=false;$('modal').hidden=false;}
  else if(game.mode==='pause'){game.mode='play';$('modal').hidden=true;app.focus();}}
$('start').onclick=start;$('resume').onclick=pause;$('pause').onclick=pause;$('restart').onclick=()=>{$('modal').hidden=true;$('menu').hidden=false;game.mode='title';buildMenu();};
$('mute').onclick=()=>{$('mute').textContent=audio.toggle()?'音效 關':'音效 開';};
window.addEventListener('blur',()=>{if(game.mode==='play')pause();});

// ---- input ----------------------------------------------------------------------------------------------------------------
const pressed=e=>{
  const k=e.key.toLowerCase();if(['arrowup','arrowdown','arrowleft','arrowright',' ','tab'].includes(k))e.preventDefault();
  if(e.repeat)return;keys.add(k);
  if(k===' ')edge.jump=true;if(k==='e')edge.interact=true;if(k==='f')edge.use=true;if(k==='g')edge.drop=true;if(k==='c')edge.release=true;
  if(k==='q'||k==='tab')edge.step=1;if(k==='z')edge.step=-1;if('1234'.includes(k)&&k.length===1)edge.slot=Number(k)-1;
  if(k==='escape'||k==='p')pause();
};
window.addEventListener('keydown',pressed);window.addEventListener('keyup',e=>keys.delete(e.key.toLowerCase()));
canvas.addEventListener('contextmenu',e=>e.preventDefault());
canvas.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse'){if(e.button===2||e.button===1){drag={x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId);}else if(e.button===0)edge.use=true;}
  else if(e.clientX>innerWidth*.4){drag={x:e.clientX,y:e.clientY,id:e.pointerId};canvas.setPointerCapture(e.pointerId);}});
canvas.addEventListener('pointermove',e=>{if(!drag)return;view.yaw-=(e.clientX-drag.x)*.006;view.pitch=Math.max(-.1,Math.min(1.2,view.pitch+(e.clientY-drag.y)*.004));drag.x=e.clientX;drag.y=e.clientY;lastDrag=performance.now();});
canvas.addEventListener('pointerup',()=>drag=null);canvas.addEventListener('pointercancel',()=>drag=null);
canvas.addEventListener('wheel',e=>{e.preventDefault();view.dist=Math.max(3,Math.min(12,view.dist+e.deltaY*.006));},{passive:false});
// touch controls
const joy=$('joystick');
joy.addEventListener('pointerdown',e=>{stick.id=e.pointerId;joy.setPointerCapture(e.pointerId);moveStick(e);});joy.addEventListener('pointermove',e=>{if(stick.id===e.pointerId)moveStick(e);});
const endStick=e=>{if(stick.id===e.pointerId){stick={x:0,z:0,id:null};joy.firstElementChild.style.transform='';}};joy.addEventListener('pointerup',endStick);joy.addEventListener('pointercancel',endStick);
function moveStick(e){const r=joy.getBoundingClientRect(),dx=(e.clientX-r.left-r.width/2)/(r.width/2),dy=(e.clientY-r.top-r.height/2)/(r.height/2),l=Math.min(1,Math.hypot(dx,dy)),a=Math.atan2(dy,dx);
  stick.x=Math.cos(a)*l;stick.z=Math.sin(a)*l;joy.firstElementChild.style.transform=`translate(${stick.x*34}px,${stick.z*34}px)`;}
const hold=(id,fn)=>{const b=$(id);b.addEventListener('pointerdown',e=>{e.preventDefault();fn(true);});b.addEventListener('pointerup',()=>fn(false));b.addEventListener('pointercancel',()=>fn(false));};
hold('t-jump',d=>{if(d)edge.jump=true;});hold('t-use',d=>{if(d)edge.use=true;});hold('t-act',d=>{if(d)edge.interact=true;});hold('t-grab',d=>{touch.grab=d;if(d)edge.release=true;});hold('t-run',d=>{touch.run=d;});

function readInput(){
  const k=s=>keys.has(s);
  const f=(k('w')||k('arrowup')?1:0)-(k('s')||k('arrowdown')?1:0)-stick.z,r=(k('d')||k('arrowright')?1:0)-(k('a')||k('arrowleft')?1:0)+stick.x;
  const fx=-Math.sin(view.yaw),fz=-Math.cos(view.yaw),rx=Math.cos(view.yaw),rz=-Math.sin(view.yaw);
  let mx=fx*f+rx*r,mz=fz*f+rz*r;const l=Math.hypot(mx,mz);if(l>1){mx/=l;mz/=l;}
  const dir=new T.Vector3();sc.camera.getWorldDirection(dir);
  const inp={mx,mz,f:Math.max(-1,Math.min(1,f)),r:Math.max(-1,Math.min(1,r)),sprint:k('shift')||touch.run,grab:k('c')||touch.grab,jump:edge.jump,interact:edge.interact,use:edge.use,drop:edge.drop,release:edge.release,slot:edge.slot,slotStep:edge.step,aim:{x:dir.x,y:dir.y,z:dir.z}};
  edge.jump=edge.interact=edge.use=edge.drop=edge.release=false;edge.slot=null;edge.step=0;return inp;
}
function route(events){
  const forward=[];
  for(const e of events){
    if(e.type==='toast')hud?.toast(e.text,e.ms);
    else if(e.type==='sound')audio.play(e.name);
    else if(e.type==='reggie'){audio.play(e.attack);}
    else if(e.type==='hurt'){view.hurt=1;}
    else if(e.type==='faint')audio.play('faint');else if(e.type==='wake')audio.play('wake');
    else if(e.type==='zone')audio.play('zone');else if(e.type==='wind'||e.type==='windWarn')audio.play('wind');
    else if(e.type==='rockWarn'||e.type==='rockHit')audio.play('rock');else if(e.type==='poison')audio.play('poison');
    else if(e.type==='won')finish();
    forward.push(e);
  }
  sc?.handleEvents(forward);
}
function finish(){
  audio.play('won');const t=game.time;
  const prev=save.best[ascent];if(!prev||t<prev)save.best[ascent]=t;
  const unlocked=Math.min(ASCENTS.length-1,ascent+1);const newly=unlocked>save.unlocked;if(newly)save.unlocked=unlocked;persist();
  $('modal-title').textContent='登頂成功！';
  $('modal-copy').textContent=newly?`山頂的風景很美。你解鎖了「${ASCENTS[unlocked].name}」。`:'山頂的風景很美。你可以回到山腳，挑戰更高的難度。';
  const m=Math.floor(t/60),s=Math.round(t%60);
  $('modal-stats').textContent=`用時 ${m} 分 ${s} 秒 · 昏迷 ${game.faints} 次 · 摔落 ${game.falls} 次 · 使用道具 ${game.itemsUsed} 件 · 啟動祭壇 ${game.stats.altars} 座`;
  $('resume').hidden=true;$('modal').hidden=false;
}
let hudClock=0;
function frame(now){
  const dt=Math.min(.08,(now-last)/1000);last=now;
  if(game.mode==='play'){acc+=dt;let n=0;while(acc>=1/60&&n++<5){game.update(1/60,readInput());acc-=1/60;route(game.events);game.events.length=0;}}
  else{route(game.events);game.events.length=0;acc=0;}
  view.autoAlign=performance.now()-lastDrag>2500;
  sc.update(dt,view);if(hud&&!$('hud').hidden)hud.update(dt,view);
  sc.renderer.render(sc.scene,sc.camera);
  requestAnimationFrame(frame);
}
async function boot(){
  try{
    renderer=new T.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
    renderer.setPixelRatio(Math.min(devicePixelRatio,1.6));renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
    sc=await buildScene(renderer,game,p=>{$('load-bar').value=p;$('load-text').textContent=`載入模型 ${Math.round(p*100)}%`;});sc.renderer=renderer;
    const resize=()=>sc.resize(app.clientWidth,app.clientHeight);new ResizeObserver(resize).observe(app);resize();
    $('loading').hidden=true;buildMenu();$('menu').hidden=false;
    window.__peak={game,sc,start,view,route,readInput};
    canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();game.mode='pause';$('loading').hidden=false;$('load-text').textContent='繪圖連線已中斷，請重新整理頁面。';});
    if(params.get('autostart')==='1')start();
    requestAnimationFrame(frame);
  }catch(error){$('load-text').textContent=`無法啟動 3D 場景：${error.message}`;console.error(error);}
}
boot();
PieGame.ready().then(()=>PieGame.setHeight()).catch(()=>{});
