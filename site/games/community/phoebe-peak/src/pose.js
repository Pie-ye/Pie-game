import * as T from '../../pie-phoebe/vendor/three.module.js';
import {twoBone} from './rig.js';

// Procedural animation for Phoebe: FK for locomotion, two-bone IK for hands on rock, rope, piton and mouth.
// state fields: mode, speed, sprint, vy, t (seconds), phase (climb), up, side, nx, nz (wall normal), lunge (0..1), mantle (0..1),
//               eat (0..1), tool (bool), hurt (0..1), energy (bool), held (Object3D|null)
const V=()=>new T.Vector3();
const sm=(a,b,v)=>{const t=Math.min(1,Math.max(0,(v-a)/(b-a)));return t*t*(3-2*t);};
const tmp={a:V(),b:V(),c:V(),d:V(),e:V()};
export function makeAnimator(R){
  const B=R.bones,root=R.root,H=R.height/1.5;
  root.rotation.order='YXZ';
  let walkPhase=0,hairL=0,hairR=0,hairB=0,lastSpeed=0,blink=0;
  const lw=(x,y,z)=>root.localToWorld(V().set(x*H,y*H,z*H));
  const arm=(side,target,pole)=>{const s=side>0?'L':'R';twoBone(B['upperArm'+s],B['foreArm'+s],B['hand'+s],R.lengths['arm'+s][0],R.lengths['arm'+s][1],target,pole);};
  const leg=(side,target,pole)=>{const s=side>0?'L':'R';twoBone(B['thigh'+s],B['shin'+s],B['foot'+s],R.lengths['leg'+s][0],R.lengths['leg'+s][1],target,pole);};
  function abduct(side,a){const s=side>0?'L':'R';B['upperArm'+s].rotation.z+=side*a;}
  function swing(bone,a){bone.rotation.x+=a;}
  function hair(dt,s,t,sway){
    const target=-Math.min(.9,s.speed*.07)+Math.sin(t*2.1)*.04*sway;
    hairB+=(target-hairB)*Math.min(1,dt*6);hairL+=(target*.7+Math.sin(t*2.6+1)*.05*sway-hairL)*Math.min(1,dt*6);hairR+=(target*.7+Math.sin(t*2.4+2)*.05*sway-hairR)*Math.min(1,dt*6);
    B.hairB.rotation.x+=hairB;B.hairL.rotation.x+=hairL;B.hairR.rotation.x+=hairR;
    B.hairL.rotation.z+=.06+Math.sin(t*1.7)*.03*sway;B.hairR.rotation.z-=.06+Math.sin(t*1.9)*.03*sway;
  }
  return function animate(s,dt){
    R.reset();root.rotation.x=0;root.rotation.z=0;
    const t=s.t,wp=V();
    const mode=s.mode;
    if(mode==='idle'||mode==='walk'||mode==='run'){
      const sp=s.speed;walkPhase+=sp*dt*(s.sprint?2.5:2.9);
      const A=Math.min(.85,sp*.2),ph=walkPhase;
      B.thighL.rotation.x=-Math.sin(ph)*A;B.thighR.rotation.x=Math.sin(ph)*A;
      B.shinL.rotation.x=Math.max(0,Math.sin(ph+1.2))*A*1.4;B.shinR.rotation.x=Math.max(0,-Math.sin(ph+1.2))*A*1.4;
      B.upperArmL.rotation.x=Math.sin(ph)*A*.9;B.upperArmR.rotation.x=-Math.sin(ph)*A*.9;
      B.foreArmL.rotation.x=-.2-A*.3;B.foreArmR.rotation.x=-.2-A*.3;
      abduct(1,-.8);abduct(-1,-.8);
      B.hips.position.y+=Math.abs(Math.sin(ph))*.035*Math.min(1,sp)*H+Math.sin(t*1.8)*.004*(sp<.3?1:0);
      B.spine.rotation.x+=(s.sprint?.16:Math.min(.07,sp*.02))+Math.sin(t*1.6)*.012;
      B.head.rotation.x-=(s.sprint?.1:.02);B.head.rotation.y=Math.sin(t*.7)*.05*(sp<.3?1:0);
      hair(dt,s,t,sp<.3?1:.5);
    }else if(mode==='air'){
      const rising=s.vy>0;
      B.thighL.rotation.x=-(rising?.5:.9);B.thighR.rotation.x=-(rising?.9:.4);B.shinL.rotation.x=rising?.9:.5;B.shinR.rotation.x=rising?.5:1.1;
      abduct(1,rising?.7:1.0);abduct(-1,rising?.7:1.0);B.upperArmL.rotation.x=-.4;B.upperArmR.rotation.x=-.4;B.foreArmL.rotation.x=-.3;B.foreArmR.rotation.x=-.3;
      B.spine.rotation.x+=rising?-.06:.08;hair(dt,{speed:rising?-8:9},t,1.5);
    }else if(mode==='wall'||mode==='chain'){
      const n=V().set(s.nx,0,s.nz),right=V().set(s.nz,0,-s.nx),ph=s.phase,hang=s.lunge>0?1:0;
      const up=V().set(0,1,0);
      // body leans into the rock
      B.spine.rotation.x+=.14;B.chest.rotation.x+=.06;B.head.rotation.x-=.38;
      const base=root.getWorldPosition(V());
      const handY=(k,o)=>.88+(hang?.1:.07)*Math.sin(ph+o);
      for(const [side,o] of [[1,0],[-1,Math.PI]]){
        const y=handY(side,o),tgt=base.clone().addScaledVector(n,-.27).addScaledVector(right,side*.13).addScaledVector(up,y*H);
        const pole=base.clone().addScaledVector(right,side*1).addScaledVector(up,.3).addScaledVector(n,.2);
        arm(side,tgt,pole);
      }
      // legs press against the wall and push
      for(const [side,o] of [[1,Math.PI/2],[-1,-Math.PI/2]]){
        const sw=Math.sin(ph+o);
        B[side>0?'thighL':'thighR'].rotation.x=-(.55+.3*sw);B[side>0?'shinL':'shinR'].rotation.x=.95+.25*sw;B[side>0?'thighL':'thighR'].rotation.z=side*.18;
      }
      B.hips.position.y+=Math.sin(ph*.5)*.01;
      hair(dt,{speed:2},t,.8);
      if(mode==='chain'){abduct(1,-.2);}
    }else if(mode==='rope'){
      const ph=s.phase,n=V().set(s.nx,0,s.nz),right=V().set(s.nz,0,-s.nx),base=root.getWorldPosition(V()),up=V().set(0,1,0);
      B.spine.rotation.x+=.08;B.head.rotation.x-=.3;
      for(const [side,o] of [[1,0],[-1,Math.PI]]){
        const y=.9+.07*Math.sin(ph+o),tgt=base.clone().addScaledVector(n,-.14).addScaledVector(right,side*.06).addScaledVector(up,y*H);
        arm(side,tgt,base.clone().addScaledVector(right,side*1).addScaledVector(n,.3));
      }
      B.thighL.rotation.x=-(.9+.1*Math.sin(ph));B.thighR.rotation.x=-(.9-.1*Math.sin(ph));B.shinL.rotation.x=1.4;B.shinR.rotation.x=1.4;
      hair(dt,{speed:1},t,.8);
    }else if(mode==='anchored'){
      const base=root.getWorldPosition(V()),up=V().set(0,1,0),right=V().set(s.nz,0,-s.nx),n=V().set(s.nx,0,s.nz);
      for(const side of [1,-1])arm(side,base.clone().addScaledVector(n,-.22).addScaledVector(right,side*.1).addScaledVector(up,.92*H),base.clone().addScaledVector(right,side*1));
      B.thighL.rotation.x=-.2+Math.sin(t*1.5)*.08;B.thighR.rotation.x=-.15+Math.sin(t*1.5+1)*.08;B.shinL.rotation.x=.35;B.shinR.rotation.x=.3;B.spine.rotation.x+=.1;B.head.rotation.x+=.2;
      hair(dt,{speed:0},t,1.2);
    }else if(mode==='mantle'){
      const m=s.mantle,e=Math.sin(m*Math.PI);
      B.spine.rotation.x+=.5*e;B.head.rotation.x-=.3;B.upperArmL.rotation.x=-1.3+.9*m;B.upperArmR.rotation.x=-1.3+.9*m;B.foreArmL.rotation.x=-.6;B.foreArmR.rotation.x=-.6;
      abduct(1,-.3);abduct(-1,-.3);B.thighL.rotation.x=-.9*e;B.thighR.rotation.x=-.5*e;B.shinL.rotation.x=1.1*e;B.shinR.rotation.x=.8*e;
      hair(dt,{speed:2},t,1);
    }else if(mode==='faint'||mode==='sleep'){
      root.rotation.x=mode==='faint'?-Math.PI/2:-Math.PI/2*.95;root.position.y+=.28*H;
      B.upperArmL.rotation.z=.5;B.upperArmR.rotation.z=-.5;B.head.rotation.z=.2;B.thighL.rotation.z=.15;B.thighR.rotation.z=-.15;
      B.chest.rotation.x+=Math.sin(t*1.3)*.02;hair(dt,{speed:0},t,.3);
    }
    // overlays
    if(s.eat>0&&mode!=='faint'){
      const e=sm(0,.25,s.eat)*(1-sm(.8,1,s.eat)),bite=Math.sin(s.eat*Math.PI*6)*.02;
      const mouth=lw(.0,.99,.2+bite),pole=lw(.4,.8,.2);arm(-1,tmp.a.copy(root.localToWorld(V().set(.0,.7*H,.22*H))).lerp(mouth,e),pole);
      B.head.rotation.x+=.08*e;
    }
    if(s.tool&&mode!=='faint'&&mode!=='wall'&&mode!=='rope')arm(-1,lw(.1,.82,.34),lw(.4,.7,.2));
    if(s.hurt>0){B.spine.rotation.x-=.35*s.hurt;B.head.rotation.x-=.25*s.hurt;B.spine.rotation.z+=Math.sin(s.t*40)*.06*s.hurt;}
    if(s.energy){B.head.rotation.z+=Math.sin(t*20)*.05;B.hips.position.y+=Math.sin(t*18)*.012;}
    // held item follows the right hand
    if(s.held){s.held.parent!==B.handR&&B.handR.add(s.held);s.held.visible=true;}
  };
}
