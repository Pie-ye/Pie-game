import * as T from '../../pie-phoebe/vendor/three.module.js';

// Fixed-size pool: no mesh/material allocation while playing.
export function makeEffects(scene){
  const geometries={spark:new T.OctahedronGeometry(1),dust:new T.IcosahedronGeometry(1,0),
    ring:new T.RingGeometry(.88,1,48),arc:new T.RingGeometry(.82,1,32,0,Math.PI*1.35)};
  const pool=Array.from({length:144},()=>{
    const material=new T.MeshBasicMaterial({transparent:true,depthWrite:false,side:T.DoubleSide});
    const mesh=new T.Mesh(geometries.spark,material);mesh.visible=false;mesh.castShadow=false;scene.add(mesh);
    return {mesh,life:0,max:1,vx:0,vy:0,vz:0,size:1,growth:0,spin:0};
  });
  let cursor=0,clock=0,previousState='',previousRoll=false,lastElapsed=0;
  function emit(kind,color,x,y,z,size,life,vx=0,vy=0,vz=0,growth=0){
    const p=pool[cursor++%pool.length];Object.assign(p,{life,max:life,vx,vy,vz,size,growth,spin:kind==='spark'?5:1});
    p.mesh.geometry=geometries[kind];p.mesh.material.color.setHex(color);p.mesh.material.opacity=1;
    p.mesh.position.set(x,y,z);p.mesh.rotation.set(kind==='ring'?-Math.PI/2:0,0,Math.random()*6.28);
    p.mesh.scale.setScalar(size);p.mesh.visible=true;return p.mesh;
  }
  function burst(e,kind){
    const slam=kind==='slam',roar=kind==='roar';
    for(let i=0;i<(slam?28:16);i++){
      const a=i*Math.PI*2/(slam?28:16),speed=slam?5:3;
      emit(slam?'dust':'spark',slam?0xffd6a1:0xffae79,e.x,e.y+.35,e.z,.12+Math.random()*.18,.65,
        Math.sin(a)*speed,1+Math.random()*2,Math.cos(a)*speed,.4);
    }
    if(roar){
      for(let i=0;i<3;i++){
        const m=emit('ring',0xffdfa1,e.x+Math.sin(e.angle)*(1+i*.5),e.y+1.6,e.z+Math.cos(e.angle)*(1+i*.5),.5+i*.3,.6,Math.sin(e.angle)*3,0,Math.cos(e.angle)*3,6);
        m.rotation.set(0,e.angle,0);
      }
    }else if(slam)emit('ring',0xffeac1,e.x,e.y+.12,e.z,.4,.55,0,0,0,8);
    else{
      const m=emit('arc',0xffe0ac,e.x,e.y+.7,e.z,3.6,.5,0,0,0,1);
      m.rotation.set(-Math.PI/2,0,-e.angle); 
    }
  }
  function clear(){pool.forEach(p=>{p.life=0;p.mesh.visible=false;});previousState='';previousRoll=false;clock=0;}
  return {pool,clear,update(dt,game){
    if(game.elapsed<lastElapsed||game.mode==='title')clear();lastElapsed=game.elapsed;
    if(game.mode!=='play')return;
    const p=game.player,e=game.enemy;clock+=dt;
    for(const item of pool){
      if(item.life<=0)continue;item.life-=dt;item.mesh.visible=item.life>0;
      item.mesh.position.x+=item.vx*dt;item.mesh.position.y+=item.vy*dt;item.mesh.position.z+=item.vz*dt;
      item.mesh.material.opacity=Math.max(0,item.life/item.max)*.8;
      item.mesh.scale.setScalar(item.size+(item.max-item.life)*item.growth);item.mesh.rotation.z+=item.spin*dt;
    }
    if(e.state==='active'&&previousState!=='active')burst(e,e.attack);
    if(p.roll>0&&!previousRoll){
      emit('ring',0xd9c0ff,p.x,p.y+.12,p.z,.3,.5,0,0,0,4);
      const m=emit('arc',0xc3edff,p.x,p.y+.95,p.z,1.3,.5,0,0,0,1);m.rotation.set(0,p.angle,0);
    }
    if(clock>.055){
      clock=0;
      if(p.speed>.2&&!p.climb){
        const rolling=p.roll>0;
        for(let i=0;i<(rolling?4:2);i++)emit(rolling||p.sprinting?'spark':'dust',rolling?0xd9bdff:p.sprinting?0xffefb7:0xffeed3,
          p.x-Math.sin(p.angle)*.35+(Math.random()-.5)*.6,p.y+.15+Math.random()*.35,p.z-Math.cos(p.angle)*.35,
          rolling?.11:.07,.4,(Math.random()-.5)*.8,.4,(Math.random()-.5)*.8,.13);
      }
      if(['chase','patrol','charge'].includes(e.state)){
        const charging=e.state==='charge';
        for(let i=0;i<(charging?5:1);i++)emit('dust',charging?0xffd29c:0xf1deba,
          e.x-Math.sin(e.angle)*1.1+(Math.random()-.5)*1.8,e.y+.15,e.z-Math.cos(e.angle)*1.1,
          charging?.22:.13,.55,(Math.random()-.5)*2,.7,(Math.random()-.5)*2,.9);
        if(charging){const m=emit('arc',0xfff0ca,e.x,e.y+.45,e.z,1.8,.25,0,0,0,2);m.rotation.set(-Math.PI/2,0,-e.angle);}
      }
    }
    previousState=e.state;previousRoll=p.roll>0;
  }};
}
