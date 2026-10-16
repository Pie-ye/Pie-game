// A scripted climber used by tests and balance checks. It follows one lane style per stage (or a chooser function), walks to the
// foot of each wall, rests, climbs, and crosses the camps in between.
import {Game} from './game.js';
const blank=()=>({mx:0,mz:0,f:0,r:0,jump:false,sprint:false,grab:false,release:false,interact:false,use:false,drop:false,aim:null,slot:null,slotStep:0});
const DIRS=[[1,0],[-1,0],[0,1],[0,-1]];
// List of boxes to visit, in order, for a given lane choice per stage.
export function buildPath(w,choose){
  const path=[];
  w.stages.forEach((st,k)=>{
    const lane=typeof choose==='function'?choose(st,k):st.lanes.findIndex(l=>l.style===choose);
    const li=lane<0?1:lane;
    for(let r=0;r<st.rows;r++)path.push(w.boxes[st.cells[r][li]]);
    // into the camp, then across it to the cell that the next stage's chosen lane starts from
    const camp=st.camp.map(id=>w.boxes[id]),entry=camp.find(c=>c.pred===st.cells.at(-1)[li]);
    path.push(entry);
    const next=w.stages[k+1];
    {
      const nl=next?(typeof choose==='function'?choose(next,k+1):next.lanes.findIndex(l=>l.style===choose)):0,exit=next?w.boxes[w.boxes[next.cells[0][nl<0?1:nl]].pred]:w.boxes[st.camp[4]];
      // BFS across the flat camp block
      const prev=new Map([[entry.id,null]]),queue=[entry];
      while(queue.length){const c=queue.shift();if(c.id===exit.id)break;for(const [dx,dz] of DIRS){const n=w.boxAtCell(c.i+dx,c.j+dz);if(n&&n.camp===c.camp&&!prev.has(n.id)){prev.set(n.id,c.id);queue.push(n);}}}
      const seg=[];for(let id=exit.id;id!==null&&id!==undefined;id=prev.get(id))seg.unshift(w.boxes[id]);
      path.push(...seg.slice(1));
    }
  });
  return path;
}
export function runBot(opts={}){
  const g=new Game({seed:opts.seed??20000,ascent:opts.ascent??0});g.mode='play';g.opts.noTips=true;
  const w=g.world,dt=1/60,log=[];let target=0,restUntilFull=true,frames=0,stuck=0,lastY=0;
  const path=buildPath(w,opts.route??'trail');
  const maxFrames=opts.maxFrames??60*60*40;
  const useKinds=(kinds)=>{const i=g.inv.findIndex(it=>it&&kinds.includes(it.kind));if(i>=0){g.sel=i;return true;}return false;};
  const nearestIndex=(p)=>{let best=0,bd=1e9;path.forEach((b,i)=>{if(b.y2<p.y-1)return;const d=Math.hypot((b.x1+b.x2)/2-p.x,(b.z1+b.z2)/2-p.z)+Math.abs(b.y2-p.y)*.5;if(d<bd){bd=d;best=i;}});return best;};
  while(frames++<maxFrames&&g.mode==='play'){
    const p=g.player,inp=blank();
    if(opts.cheat){g.stamina=g.maxStamina();Object.assign(g.aff,{hunger:.05,injury:0,poison:0,cold:0,hot:0});g.mist.y=-40;}
    if(p.state==='faint'){g.update(dt,inp);continue;}
    // where am I in the path?
    if(p.grounded&&p.state==='move'&&p.support){
      const col=p.support.kind==='ledge'?null:p.support,idx=col?path.indexOf(col):-1;
      if(idx>=0)target=Math.min(path.length-1,idx+1);
      else if(p.support.kind==='ground'||(col&&idx<0&&frames%120===0))target=p.support.kind==='ground'?0:nearestIndex(p);
    }
    const box=path[target];if(!box)break;
    if(p.grounded&&p.state==='move'&&p.support===path.at(-1)){const dx=w.summit.x-p.x,dz=w.summit.z-p.z,l=Math.hypot(dx,dz);inp.mx=dx/(l||1);inp.mz=dz/(l||1);g.update(dt,inp);continue;}
    const prevBox=target>0?path[target-1]:null,f=box.climbFace&&(prevBox?box.pred===prevBox.id:true)?box.climbFace:null;
    const needsClimb=box.y2>(prevBox?prevBox.y2:0)+.4;
    const laneFor=(bx,face)=>{ // pick a lane across the face that avoids thorns and, if possible, slippery or hot patches
      const alongX=!!face.dz,c=alongX?(bx.x1+bx.x2)/2:(bx.z1+bx.z2)/2;let best=null;
      for(const off of [0,-1,1,-2,2,-3,3,-4,4]){const lane=c+off;let score=0;
        for(const h of w.hazards){if(h.box!==bx.id)continue;const lo=alongX?h.x1:h.z1,hi=alongX?h.x2:h.z2;if(lane>lo-.9&&lane<hi+.9){score+=h.type==='thorn'?100:h.type==='hot'?20:h.type==='slip'?8:0;}}
        score+=Math.abs(off)*.1;if(!best||score<best.score)best={lane,score};}
      return best.lane;};
    let tx,tz,lane=null;
    if(needsClimb&&f){lane=laneFor(box,f);tx=f.dx?f.x-f.dx*1.2:lane;tz=f.dz?f.z-f.dz*1.2:lane;if(f.dx)tz=lane;if(f.dz)tx=lane;}
    else{tx=(box.x1+box.x2)/2;tz=(box.z1+box.z2)/2;}
    if(target===0&&!needsClimb){tx=(box.x1+box.x2)/2;tz=(box.z1+box.z2)/2;}
    if(p.state==='move'){
      if(p.grounded){
        if(g.stamina<g.maxStamina()*.97&&restUntilFull&&needsClimb&&Math.hypot(p.x-tx,p.z-tz)<6){/* rest */}
        else if(g.aff.injury>.1&&useKinds(['medkit','bandage'])){inp.use=true;}
        else if(g.aff.poison>.05&&useKinds(['antidote','cure_all'])){inp.use=true;}
        else if(g.aff.cold>.1&&useKinds(['hot_tea','winterberry'])){inp.use=true;}
        else if(g.aff.hot>.1&&useKinds(['ice_pack','aloe_vera'])){inp.use=true;}
        else if(g.aff.hunger>.35&&useKinds(['snack','coconut','granola_bar','honeycomb'])){inp.use=true;}
        else if(g.aff.hunger>.75&&useKinds(['berry_red','berry_blue','mushroom_item'])){inp.use=true;}
        else{const dx=tx-p.x,dz=tz-p.z,l=Math.hypot(dx,dz);if(l>.2){inp.mx=dx/l;inp.mz=dz/l;}inp.sprint=false;
          const near=g.interactables()[0];if(near&&near.type==='item'&&near.d<1.4&&frames%30===0)inp.interact=true;
        }
      }else{ const dx=tx-p.x,dz=tz-p.z,l=Math.hypot(dx,dz);if(l>.2){inp.mx=dx/l;inp.mz=dz/l;} }
    }else if(p.state==='wall'||p.state==='rope'){inp.f=1;
      if(p.state==='wall'&&lane!==null){const w2=p.wall,rx=w2.nz,rz=-w2.nx,err=((lane-(w2.nx?p.z:p.x)));const need=(w2.nx?err*rz:err*rx);if(Math.abs(err)>.35)inp.r=Math.sign(need);}
      if(p.state==='wall'&&g.slipAt(p)&&g.stamina>30&&p.lunge<=0&&frames%20===0)inp.jump=true;
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
    g.update(dt,inp);
    for(const e of g.events){if(e.type==='faint')log.push({faint:e.reason,t:g.time,y:p.y,target});if(e.type==='landed')log.push({landed:+e.drop.toFixed(1),t:+g.time.toFixed(0),y:+p.y.toFixed(1),target});if(e.type==='hurt')log.push({hurt:e.injury,t:+g.time.toFixed(0),y:+p.y.toFixed(1),target});}g.events.length=0;
    if(frames%600===0){if(Math.abs(p.y-lastY)<.2&&p.state==='move'&&p.grounded&&g.stamina>g.maxStamina()*.9){stuck++;if(stuck>12){log.push({stuck:target,x:p.x,y:p.y,z:p.z,box:box.id});break;}}else stuck=0;lastY=p.y;}
  }
  return {g,log,frames,reached:g.player.y,won:g.won,target,path};
}
