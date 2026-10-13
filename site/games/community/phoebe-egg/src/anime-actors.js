import {loadAnime} from './anime-loader.js';
import {makeEgg} from './models.js';

export async function makeAnimePhoebe(parent){
  const root=await loadAnime(new URL('../assets/anime/phoebe.glb',import.meta.url));root.scale.setScalar(.9);parent.add(root);
  const get=name=>root.getObjectByName(name),rig=get('rig'),body=get('body'),head=get('head'),hair=get('hair'),arms=[get('armL'),get('armR')],legs=[get('legL'),get('legR')],carry=get('carry'),egg=makeEgg(carry,.95);
  return {root,rig,body,head,arms,legs,egg,carry,animate(p,time){
    const moving=p.speed>.1,phase=time*(p.sprinting?14:9),stride=moving?Math.sin(phase)*.5:0;
    rig.position.set(0,moving?Math.abs(Math.sin(phase))*.035:Math.sin(time*2)*.012,0);rig.rotation.set(0,0,0);
    body.rotation.set(p.sprinting?.08:0,0,p.hurt>0?Math.sin(time*36)*.06:0);
    legs[0].rotation.x=stride;legs[1].rotation.x=-stride;
    arms.forEach((arm,i)=>{arm.rotation.x=p.egg?-1.04:(i===0?-stride:stride)*.65;arm.rotation.z=(i===0?1:-1)*(p.egg?.18:-.32);});
    carry.position.set(0,-.02,.63);carry.rotation.set(0,0,0);
    if(p.climb){
      arms[0].rotation.x=-2.7+Math.sin(time*12)*.3;arms[1].rotation.x=-2.7-Math.sin(time*12)*.3;
      legs[0].rotation.x=Math.sin(time*12)*.55;legs[1].rotation.x=-Math.sin(time*12)*.55;
      carry.position.set(0,.08,-.73);body.rotation.x=-.15;
    }
    if(p.roll>0){const a=-(1-p.roll/.62)*Math.PI*2;rig.rotation.x=a;rig.position.set(0,1.6-1.55*Math.cos(a),-1.55*Math.sin(a));}
    hair.rotation.x=moving?Math.sin(phase*.5)*.035+.045:Math.sin(time*1.8)*.009;hair.rotation.z=Math.sin(time*2)*.012;
    head.rotation.y=Math.sin(time*1.3)*.025;
    egg.visible=!!p.egg;egg.userData.cracks.visible=!!p.egg&&p.egg.hp<3;
  }};
}
export async function makeAnimeReggie(parent){
  const root=await loadAnime(new URL('../assets/anime/reggie.glb',import.meta.url));parent.add(root);
  const body=root.getObjectByName('body'),head=root.getObjectByName('head'),jaw=root.getObjectByName('jaw'),flippers=[root.getObjectByName('flipperL'),root.getObjectByName('flipperR')];
  return {root,body,head,jaw,animate(e,time){
    body.rotation.x=e.state==='charge'?.14:0;body.rotation.z=e.attack==='sweep'&&e.state==='active'?Math.sin(e.clock*11)*.1:0;
    body.position.y=e.state==='windup'&&e.attack==='slam'?Math.sin(e.clock*2)*.38:Math.sin(time*3)*.018;
    const shouting=['windup','active'].includes(e.state)&&e.attack==='roar';jaw.scale.y=shouting?1:.36+Math.sin(time*2)*.025;jaw.position.y=shouting?-.34:-.10;
    head.rotation.x=e.state==='windup'?-.08:0;
    flippers.forEach((f,i)=>f.rotation.z=e.state==='chase'?Math.sin(time*7+i*Math.PI)*.12:0);
  }};
}
