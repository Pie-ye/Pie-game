import * as T from '../../pie-phoebe/vendor/three.module.js';

const materials = new Map();
export function material(color, roughness = .8) {
  const key = `${color}/${roughness}`;
  if (!materials.has(key)) materials.set(key, new T.MeshStandardMaterial({ color, roughness }));
  return materials.get(key);
}
export function mesh(parent, geometry, color, x=0, y=0, z=0, scale=null) {
  const m = new T.Mesh(geometry, typeof color === 'object' ? color : material(color));
  m.position.set(x,y,z); if (scale) m.scale.set(...scale);
  m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
}
export function sphere(parent,color,x,y,z,sx,sy,sz) {
  return mesh(parent,new T.SphereGeometry(1,20,14),color,x,y,z,[sx,sy,sz]);
}
export function group(parent,x=0,y=0,z=0) { const g=new T.Group();g.position.set(x,y,z);parent.add(g);return g; }
function line(parent, points, color, radius=.018) {
  const curve = new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p)));
  return mesh(parent,new T.TubeGeometry(curve,12,radius,5,false),color);
}
export function makeEgg(parent, scale=1) {
  const egg=group(parent);egg.scale.setScalar(scale);
  sphere(egg,0xffefd0,0,.45,0,.36,.48,.36);
  for(let i=0;i<6;i++){
    const a=i*2.4, y=.2+(i%3)*.17;
    sphere(egg,0xca9b61,Math.sin(a)*.337,y,Math.cos(a)*.337,.07,.09,.025).rotation.y=a;
  }
  const cracks=group(egg); cracks.visible=false;
  line(cracks,[[-.16,.61,.31],[.03,.49,.361],[-.08,.38,.35],[.13,.24,.3]],0x6d4835,.016);
  line(cracks,[[.32,.65,.04],[.35,.45,.09],[.3,.32,-.03]],0x6d4835,.015);
  egg.userData.cracks=cracks; return egg;
}

export function makePhoebe(parent) {
  const root=group(parent), rig=group(root), body=group(rig,0,.76,0);
  const navy=0x243653, gold=0xf2d18f, white=0xfff6dd, blue=0x528fc0, skin=0xffdbb5;
  // Articulated hierarchy: hips → torso/head/shoulders; limbs rotate around joints.
  mesh(body,new T.CylinderGeometry(.3,.55,.65,12),white,0,.29,0);
  mesh(body,new T.CylinderGeometry(.26,.46,.6,12,1,true,0,Math.PI*1.4),navy,0,.31,-.035).rotation.y=.3*Math.PI;
  mesh(body,new T.BoxGeometry(.23,.46,.055),blue,0,.37,.33);
  mesh(body,new T.BoxGeometry(.07,.24,.04),gold,0,.43,.37);
  mesh(body,new T.BoxGeometry(.2,.065,.045),gold,0,.47,.38);
  mesh(body,new T.TorusGeometry(.46,.035,5,24),gold,0,.035,0).rotation.x=Math.PI/2;
  const head=group(body,0,1.05,0);
  sphere(head,gold,0,0,-.04,.58,.63,.5);
  sphere(head,skin,0,-.02,.17,.51,.5,.4);
  // Hair has volume all around, including the back and side locks.
  for(let i=0;i<9;i++) {
    const a=.85+i/8*(Math.PI*2-1.7);
    const lock=sphere(head,gold,Math.sin(a)*.46,-.37,Math.cos(a)*.39,.17,.53,.18);
    lock.rotation.z=-Math.sin(a)*.14;
  }
  for(let i=-2;i<=2;i++) sphere(head,gold,i*.18,.28,.49,.12,.25,.1).rotation.z=-i*.12;
  for(const side of [-1,1]) {
    sphere(head,0xffffff,side*.205,-.005,.52,.13,.175,.04);
    sphere(head,0x76618f,side*.205,-.005,.553,.098,.135,.025);
    sphere(head,0x252c43,side*.205,.025,.575,.065,.09,.012);
    sphere(head,0xffffff,side*.18,.076,.592,.035,.043,.01);
    sphere(head,0xf2a398,side*.34,-.18,.49,.09,.035,.018);
    line(head,[[side*.08,.17,.55],[side*.19,.2,.56],[side*.31,.16,.53]],navy,.025);
  }
  line(head,[[-.07,-.23,.548],[0,-.26,.564],[.07,-.23,.548]],0x975c58,.014);
  // Broad navy-and-ivory hat from the supplied reference.
  const hat=group(head,0,.47,-.035);
  mesh(hat,new T.CylinderGeometry(.94,.95,.09,40),white,0,.02,0);
  mesh(hat,new T.CylinderGeometry(.94,.94,.035,40),navy,0,.063,0);
  mesh(hat,new T.CylinderGeometry(.34,.63,.62,32),navy,0,.34,0);
  mesh(hat,new T.CylinderGeometry(.56,.62,.15,32),white,0,.14,0);
  mesh(hat,new T.CylinderGeometry(.34,.41,.13,32),white,0,.59,0);
  for(let i=0;i<10;i++) {
    const a=i*Math.PI/5;
    const star=mesh(hat,new T.OctahedronGeometry(.065),gold,Math.sin(a)*.49,.36,Math.cos(a)*.49);
    star.scale.set(.65,1,.35);star.rotation.y=a;
  }
  const clip=group(head,.37,.24,.53);clip.rotation.z=.35;
  mesh(clip,new T.BoxGeometry(.21,.075,.065),navy);
  mesh(clip,new T.BoxGeometry(.07,.22,.065),navy);
  const arms=[],legs=[];
  for(const side of [-1,1]) {
    const arm=group(body,side*.34,.54,0);arms.push(arm);
    sphere(arm,white,side*.055,-.16,0,.16,.25,.16);
    mesh(arm,new T.CylinderGeometry(.115,.12,.12,12),navy,side*.08,-.34,0);
    sphere(arm,skin,side*.08,-.44,.01,.105,.12,.1);
    const leg=group(rig,side*.2,.77,0);legs.push(leg);
    mesh(leg,new T.CylinderGeometry(.11,.12,.5,12),white,0,-.25,0);
    mesh(leg,new T.CylinderGeometry(.116,.116,.05,12),navy,0,-.26,0);
    sphere(leg,navy,0,-.62,.08,.16,.13,.24);
  }
  const carry=group(body,0,.0,.69),egg=makeEgg(carry,1.12);egg.visible=false;
  return {root,rig,body,head,arms,legs,egg,carry,
    animate(p,time) {
      const moving=p.speed>.1, phase=time*(p.sprinting?15:10), stride=moving?Math.sin(phase)*.65:0;
      rig.position.set(0,moving?Math.abs(Math.sin(phase))*.055:Math.sin(time*2)*.018,0);
      rig.rotation.set(0,0,0);body.rotation.x=0;
      legs[0].rotation.x=stride;legs[1].rotation.x=-stride;
      arms[0].rotation.x=p.egg?-1.05:-stride*.7;arms[1].rotation.x=p.egg?-1.05:stride*.7;
      arms[0].rotation.z=p.egg?-.22:.08;arms[1].rotation.z=p.egg?.22:-.08;
      carry.position.set(0,.0,.69);carry.rotation.x=0;
      if(p.climb) {
        arms[0].rotation.x=-2.6+Math.sin(time*13)*.3;arms[1].rotation.x=-2.6-Math.sin(time*13)*.3;
        legs[0].rotation.x=Math.sin(time*13)*.6;legs[1].rotation.x=-Math.sin(time*13)*.6;
        carry.position.set(0,.24,-.48); body.rotation.x=-.18;
      }
      if(p.roll>0) {
        const angle=-(1-p.roll/.62)*Math.PI*2;
        rig.rotation.x=angle;
        // Rotate around the character's middle instead of the foot origin.
        rig.position.set(0,1.4-1.3*Math.cos(angle),-1.3*Math.sin(angle));
      }
      if(p.hurt>0) body.rotation.z=Math.sin(time*36)*.06;else body.rotation.z=0;
      egg.visible=!!p.egg;egg.userData.cracks.visible=!!p.egg&&p.egg.hp<3;
      head.rotation.y=Math.sin(time*1.2)*.035;
    }
  };
}

export function makeReggie(parent) {
  const root=group(parent),body=group(root),brown=0x795748,dark=0x513c35,cream=0xddbb85;
  sphere(body,brown,0,1.05,-.35,1.15,1.05,1.75);
  sphere(body,brown,0,1.65,.78,.94,1.27,.91);
  sphere(body,cream,0,1.03,1.42,.65,.95,.17);
  const head=group(body,0,2.27,1.09);
  sphere(head,brown,0,0,0,.79,.7,.66);
  const jaw=group(head,0,-.17,.22);
  sphere(jaw,dark,0,-.14,.24,.51,.3,.33);
  sphere(jaw,0x812f42,0,-.08,.46,.39,.18,.08);
  sphere(jaw,cream,0,-.27,.29,.52,.15,.29);
  for(const side of [-1,1]) {
    sphere(head,cream,side*.23,-.05,.54,.3,.23,.18);
    sphere(head,0x151e24,side*.36,.24,.49,.16,.19,.085);
    sphere(head,0xffffff,side*.33,.29,.57,.06,.075,.02);
    for(let i=0;i<3;i++) line(head,[[side*.25,-.08,.68],[side*.65,-.04-i*.08,.72],[side*(1.03+i*.06),.02-i*.14,.55]],0xffecd2,.013);
    mesh(head,new T.ConeGeometry(.07,.16,8),0xfff4d8,side*.28,-.22,.57).rotation.x=Math.PI;
  }
  sphere(head,0x263033,0,.045,.72,.18,.12,.11);
  const flippers=[];
  for(const side of [-1,1]) {
    const f=group(body,side*.87,.48,.32);flippers.push(f);
    sphere(f,dark,side*.35,-.14,.15,.58,.16,.68).rotation.y=-side*.5;
    sphere(body,dark,side*.4,.3,-1.83,.48,.16,.64).rotation.y=side*.4;
  }
  return {root,body,head,jaw,animate(e,time){
    body.rotation.x=e.state==='charge'?.17:0;
    body.position.y=e.state==='windup'&&e.attack==='slam'?Math.sin(e.clock*2)*.45:Math.sin(time*4)*.025;
    jaw.rotation.x=(e.state==='windup'||e.state==='active')&&e.attack==='roar'?.8:.06;
    head.rotation.x=e.state==='windup'?-.15:0;
    flippers.forEach((f,i)=>f.rotation.z=e.state==='chase'?Math.sin(time*9+i*Math.PI)*.23:0);
  }};
}
