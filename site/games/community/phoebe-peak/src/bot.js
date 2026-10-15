// A scripted climber used by tests and balance checks: walks to each climb face, climbs, rests on ledges.
import {Game} from './game.js';
const blank=()=>({mx:0,mz:0,f:0,r:0,jump:false,sprint:false,grab:false,release:false,interact:false,use:false,drop:false,aim:null,slot:null,slotStep:0});
export function runBot(opts={}){
  const g=new Game({seed:opts.seed??20000,ascent:opts.ascent??0});g.mode='play';
  const w=g.world,dt=1/60,log=[];let target=0,restUntilFull=true,frames=0,stuck=0,lastY=0;
  const maxFrames=opts.maxFrames??60*60*40;
  const useKinds=(kinds)=>{const i=g.inv.findIndex(it=>it&&kinds.includes(it.kind));if(i>=0){g.sel=i;return true;}return false;};
  const eat=()=>{const p=g.player;if(g.aff.hunger>.5&&p.grounded){const i=g.inv.findIndex(it=>it&&['snack','coconut'].includes(it.kind));if(i>=0){g.sel=i;return true;}}return false;};
  while(frames++<maxFrames&&g.mode==='play'){
    const p=g.player,inp=blank();
    if(opts.cheat){g.stamina=g.maxStamina();Object.assign(g.aff,{hunger:.05,injury:0,poison:0,cold:0,hot:0});}
    if(p.state==='faint'){g.update(dt,inp);continue;}
    if(p.grounded&&p.state==='move'&&p.support&&p.support.kind==='column'&&p.support.id+1!==target)target=Math.min(w.boxes.length-1,p.support.id+1);
    if(p.grounded&&p.state==='move'&&p.y<.1&&p.support&&p.support.kind==='ground')target=0;
    const box=w.boxes[target];if(!box){break;}
    if(p.grounded&&p.state==='move'&&p.support===w.boxes[w.boxes.length-1]){const dx=w.summit.x-p.x,dz=w.summit.z-p.z,l=Math.hypot(dx,dz);inp.mx=dx/(l||1);inp.mz=dz/(l||1);g.update(dt,inp);continue;}
    // rest on ledge until stamina is nearly full before every climb
    const faceB=target===0?box:box,f=box.climbFace;
    let tx,tz;
    const laneFor=(bx)=>{ // pick a lane across the face that avoids thorns and, if possible, slippery or hot patches
      const f=bx.climbFace;if(!f)return null;const alongX=!!f.dz,c=alongX?(bx.x1+bx.x2)/2:(bx.z1+bx.z2)/2;let best=null;
      for(const off of [0,-1,1,-2,2,-3,3,-4,4]){const lane=c+off;let score=0;
        for(const h of w.hazards){if(h.box!==bx.id)continue;const lo=alongX?h.x1:h.z1,hi=alongX?h.x2:h.z2;if(lane>lo-.9&&lane<hi+.9){score+=h.type==='thorn'?100:h.type==='hot'?20:h.type==='slip'?8:0;}}
        score+=Math.abs(off)*.1;if(!best||score<best.score)best={lane,score};}
      return best.lane;};
    const lane=target===0?null:laneFor(box);
    if(target===0){tx=(box.x1+box.x2)/2;tz=box.z2-1;}
    else{const lat={x:(box.x1+box.x2)/2,z:(box.z1+box.z2)/2};tx=f.dx?f.x-f.dx*1.2:lane;tz=f.dz?f.z-f.dz*1.2:lane;if(f.dx)tz=lane;if(f.dz)tx=lane;}
    if(p.state==='move'){
      if(p.grounded){
        if(g.stamina<g.maxStamina()*.97&&restUntilFull&&Math.hypot(p.x-tx,p.z-tz)<4){/* rest */}
        else if(g.aff.injury>.1&&useKinds(['medkit','bandage'])){inp.use=true;}
        else if(g.aff.poison>.05&&useKinds(['antidote'])){inp.use=true;}
        else if(g.aff.cold>.1&&useKinds(['hot_tea'])){inp.use=true;}
        else if(g.aff.hot>.1&&useKinds(['ice_pack'])){inp.use=true;}
        else if(g.aff.hunger>.35&&useKinds(['snack','coconut'])){inp.use=true;}
        else if(g.aff.hunger>.75&&useKinds(['berry_red','berry_blue','mushroom_item'])){inp.use=true;}
        else{const dx=tx-p.x,dz=tz-p.z,l=Math.hypot(dx,dz);if(l>.2){inp.mx=dx/l;inp.mz=dz/l;}inp.sprint=false;
          // pick up items we walk past
          const near=g.interactables()[0];if(near&&near.type==='item'&&near.d<1.4&&frames%30===0)inp.interact=true;
        }
      }else{ /* airborne: keep pushing toward the wall */ const dx=tx-p.x,dz=tz-p.z,l=Math.hypot(dx,dz);if(l>.2){inp.mx=dx/l;inp.mz=dz/l;} }
    }else if(p.state==='wall'||p.state==='rope'){inp.f=1;
      if(p.state==='wall'&&lane!==null){const w2=p.wall,rx=w2.nz,rz=-w2.nx,err=((lane-(w2.nx?p.z:p.x)));const along=(rx?rx:rz);const need=(w2.nx?err*rz:err*rx);if(Math.abs(err)>.35)inp.r=Math.sign(need);}if(p.state==='wall'&&g.slipAt(p)&&g.stamina>30&&p.lunge<=0&&frames%20===0)inp.jump=true;
      // rest on mid-wall ledges happen automatically (they are standing spots)
    }
    // dodge Reggie: jump just before slam/sweep/roar land, sidestep charges, shoot a dart when armed
    for(const r of [...g.reggies,...g.scouts]){
      const dx=r.x-p.x,dz=r.z-p.z,d=Math.hypot(dx,dz);if(d>12||Math.abs(r.y-p.y)>3||r.state==='sleep')continue;
      const dartSlot=g.inv.findIndex(it=>it&&it.kind==='blowdart');
      if(dartSlot>=0&&r.state==='windup'&&d<12){g.sel=dartSlot;inp.use=true;inp.aim={x:dx,y:0,z:dz};}
      if(p.state==='move'&&p.grounded){
        if(r.state==='windup'&&r.attack==='charge'){const px=-r.direction.z,pz=r.direction.x;inp.mx=px;inp.mz=pz;inp.sprint=true;}
        if(r.state==='windup'&&r.attack!=='charge'&&r.clock>.88&&d<7)inp.jump=true;
        if(r.state==='charge'&&d<3.2)inp.jump=true;
      }
    }
    const prevState=p.state,prevY=p.y;
    g.update(dt,inp);
    // advance target when we stand on the box top
    for(const e of g.events){if(e.type==='faint')log.push({faint:e.reason,t:g.time,y:p.y,target});if(e.type==='landed')log.push({landed:+e.drop.toFixed(1),t:+g.time.toFixed(0),y:+p.y.toFixed(1),target});if(e.type==='hurt')log.push({hurt:e.injury,t:+g.time.toFixed(0),y:+p.y.toFixed(1),target});}g.events.length=0;
    if(p.state==='move'&&p.grounded&&p.support===w.boxes[target]&&target<w.boxes.length-1){log.push({box:target,t:g.time,stamina:g.stamina,hunger:g.aff.hunger});target++;}
    if(frames%3600===0){const key=Math.round(p.y*2);if(key===(log._lastKey??-1)&&p.state!=='faint'){log.push({noprogress:target,t:g.time,state:p.state,x:+p.x.toFixed(1),y:+p.y.toFixed(1),z:+p.z.toFixed(1),stam:+g.stamina.toFixed(0),max:+g.maxStamina().toFixed(0),slip:!!g.slipAt(p),thorn:g.hazardNear('thorn',p),hot:g.hazardNear('hot',p),hazards:w.hazards.filter(h=>h.box===target).map(h=>h.type),caps:g.caps(),inv:g.inv.map(i=>i&&i.kind),falls:g.falls});log._stuckN=(log._stuckN||0)+1;if(log._stuckN>=2)break;}log._lastKey=key;}
    if(frames%600===0){if(Math.abs(p.y-lastY)<.2&&p.state==='move'&&p.grounded&&g.stamina>g.maxStamina()*.9){stuck++;if(stuck>20){log.push({stuck:target,x:p.x,y:p.y,z:p.z});break;}}else stuck=0;lastY=p.y;}
  }
  return {g,log,frames,reached:g.player.y,won:g.won,target};
}
