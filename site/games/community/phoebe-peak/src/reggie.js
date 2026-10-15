import {ATTACK_INFO} from './rules.js';
// Reggie lives on one ledge. He patrols it, chases anyone standing on it, and roars at climbers who come close.
// Attacks use the same four telegraphed patterns as the delivery game, now in 3D.
const dist2=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
export function makeReggie(def,world){
  const b=world.boxes[def.box];
  return {id:def.id,box:def.box,zone:def.zone,scout:!!def.scout,x:def.home.x,y:b.y2,z:def.home.z,angle:0,state:'patrol',clock:0,attack:'charge',cooldown:2,direction:{x:0,z:1},target:null,hit:false,sequence:0,sleep:0,ttl:def.ttl??Infinity,roarCooldown:4};
}
const ledgeOf=(w,r)=>w.boxes[r.box];
const onLedge=(w,r,p,margin=1.2)=>{const b=ledgeOf(w,r);return p.x>b.x1-margin&&p.x<b.x2+margin&&p.z>b.z1-margin&&p.z<b.z2+margin&&Math.abs(p.y-b.y2)<1.6;};
export function updateReggie(g,r,dt){
  const w=g.world,p=g.player,b=ledgeOf(w,r);
  r.clock+=dt;r.cooldown=Math.max(0,r.cooldown-dt);r.roarCooldown=Math.max(0,r.roarCooldown-dt);
  if(r.ttl!==Infinity){r.ttl-=dt;if(r.ttl<=0)return false;}
  if(r.sleep>0){r.sleep-=dt;r.state='sleep';return true;}
  if(r.state==='sleep'){r.state='patrol';r.clock=0;}
  const alive=!(p.state==='faint');
  const safe=g.nearAltar(p,4.2);
  const d=dist2(r,p),here=alive&&!safe&&onLedge(w,r,p);
  const near3=Math.hypot(r.x-p.x,r.z-p.z,(r.y+.8)-(p.y+.8));
  const clamp=()=>{const m=.9;r.x=Math.min(b.x2-m,Math.max(b.x1+m,r.x));r.z=Math.min(b.z2-m,Math.max(b.z1+m,r.z));r.y=b.y2;};
  const walk=(tx,tz,speed)=>{const dx=tx-r.x,dz=tz-r.z,l=Math.hypot(dx,dz)||1;
    const al=g.nearAltar({x:r.x+dx/l*speed*dt,z:r.z+dz/l*speed*dt,y:r.y},4.4);
    if(!al){r.x+=dx/l*speed*dt;r.z+=dz/l*speed*dt;r.angle=Math.atan2(dx,dz);}clamp();};
  const speedBase=(2.1+g.world.asc.reggie*.4)*(1+r.zone*.05);
  if(r.state==='windup'){
    if(r.clock>=1.05){r.state=r.attack==='charge'?'charge':'active';r.clock=0;r.hit=false;g.emit('reggie',{attack:r.attack,r});}
    return true;
  }
  if(r.state==='charge'){
    const sp=11*dt,nx=r.x+r.direction.x*sp,nz=r.z+r.direction.z*sp;
    r.x=nx;r.z=nz;const cx=r.x,cz=r.z;clamp();const blocked=Math.abs(cx-r.x)+Math.abs(cz-r.z)>.01;
    if(!r.hit&&alive&&!safe&&Math.abs(p.y-r.y)<1.6&&dist2(r,p)<2.1){g.hurtPlayer(.1,22,r,{knock:3.2,dx:r.direction.x,dz:r.direction.z});r.hit=true;}
    if(blocked||r.clock>1.3||g.nearAltar(r,4.4)){r.state='recover';r.clock=0;}
    return true;
  }
  if(r.state==='active'){
    if(!r.hit&&r.clock>.12){
      r.hit=true;const flat=Math.abs(p.y-r.y)<1.6;
      if(alive&&!safe){
        if(r.attack==='roar'&&near3<ATTACK_INFO.roar.radius)g.hurtPlayer(.05,20,r,{knock:1.2,dx:p.x-r.x,dz:p.z-r.z,dropGrip:true});
        if(r.attack==='slam'&&flat&&dist2(r,p)<ATTACK_INFO.slam.radius)g.hurtPlayer(.09,24,r,{knock:2.4,dx:p.x-r.x,dz:p.z-r.z});
        if(r.attack==='sweep'&&flat&&dist2(r,p)<ATTACK_INFO.sweep.radius){
          const dx=p.x-r.x,dz=p.z-r.z,l=Math.hypot(dx,dz)||1;
          if((dx*r.direction.x+dz*r.direction.z)>-l*.25)g.hurtPlayer(.07,18,r,{knock:2.2,dx,dz});}
      }
    }
    if(r.clock>.55){r.state='recover';r.clock=0;}
    return true;
  }
  if(r.state==='recover'){if(r.clock>1.5){r.state='chase';r.clock=0;r.cooldown=1.3;}return true;}
  const aggro=here||r.scout||r.state==='chase'&&(near3<18&&alive&&!safe);
  const canRoarClimber=alive&&!safe&&near3<7.5&&(p.state==='wall'||p.state==='rope'||p.state==='anchored')&&r.roarCooldown===0&&dist2(r,p)<9;
  if(here&&r.cooldown===0&&d<12||canRoarClimber&&r.cooldown===0){
    r.attack=canRoarClimber&&!here?'roar':d>6.2?'charge':['roar','slam','sweep'][r.sequence++%3];
    if(r.attack==='sweep'&&d>3.6)r.attack='roar';if(r.attack==='slam'&&d>4.7)r.attack='charge';
    const l=d||1;r.direction={x:(p.x-r.x)/l,z:(p.z-r.z)/l};r.angle=Math.atan2(r.direction.x,r.direction.z);
    r.state='windup';r.clock=0;if(r.attack==='roar')r.roarCooldown=7;return true;
  }
  if(aggro&&here){r.state='chase';walk(p.x,p.z,speedBase*(1+(g.player.egg?0:0)));return true;}
  r.state='patrol';
  if(!r.target||dist2(r,r.target)<.8||r.clock>6){r.target={x:b.x1+1.5+g.rand()*(b.x2-b.x1-3),z:b.z1+1.5+g.rand()*(b.z2-b.z1-3)};r.clock=0;}
  walk(r.target.x,r.target.z,1.2);return true;
}
