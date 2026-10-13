import * as T from '../../pie-phoebe/vendor/three.module.js';
import {loadAnime} from './anime-loader.js';
import {makeEgg,preloadEgg} from './models.js';

const smooth=(a,b,v)=>T.MathUtils.smoothstep(v,a,b);

export async function makeGenerated(name,parent){
  await preloadEgg();
  const asset=await loadAnime(new URL(`../assets/models/${name}.glb`,import.meta.url),{style:'painted'});
  asset.updateMatrixWorld(true);
  const box=new T.Box3().setFromObject(asset),size=box.getSize(new T.Vector3()),center=box.getCenter(new T.Vector3());
  const height=name==='phoebe'?2.0:2.3,scale=height/size.y;
  const root=new T.Group(),rig=new T.Group();root.add(rig);parent.add(root);
  const bones={};
  function bone(name,parent,x,y,z){const b=new T.Bone();b.name=name;b.position.set(x,y,z);parent.add(b);bones[name]=b;return b;}
  const base=bone('root',rig,0,0,0),body=bone('body',base,0,height*.3,0);
  const head=bone('head',body,0,height*.28,0);
  const arms=[bone('armL',body,-height*.2,height*.13,.12),bone('armR',body,height*.2,height*.13,.12)];
  const legs=[bone('legL',base,-height*.09,height*.2,0),bone('legR',base,height*.09,height*.2,0)];
  const skeleton=new T.Skeleton([base,body,head,...arms,...legs]);
  const meshes=[];
  asset.traverse(object=>{
    if(!object.isMesh)return;
    const g=object.geometry.clone().applyMatrix4(object.matrixWorld);
    g.translate(-center.x,-box.min.y,-center.z);g.scale(scale,scale,scale);
    g.computeVertexNormals();
    const positions=g.attributes.position,indices=new Uint16Array(positions.count*4),weights=new Float32Array(positions.count*4);
    g.computeBoundingBox();const width=g.boundingBox.max.x-g.boundingBox.min.x;
    for(let i=0;i<positions.count;i++){
      const x=positions.getX(i),y=positions.getY(i)/height,z=positions.getZ(i),side=x<0?0:1;
      let limb=0,limbWeight=0,headWeight=smooth(.46,.63,y);
      if(name==='phoebe'){
        if(y<.23){limb=5+side;limbWeight=1-smooth(.15,.23,y);}
        else if(y<.48&&y>.22){limb=3+side;limbWeight=smooth(width*.15,width*.24,Math.abs(x))*(1-smooth(.4,.48,y))*smooth(-.1,.15,z);}
      }else{
        headWeight=smooth(.35,.7,y)*.85;
        if(y<.3){limb=3+side;limbWeight=smooth(width*.22,width*.38,Math.abs(x))*(1-smooth(.15,.3,y));}
      }
      indices.set([1,2,limb,0],i*4);weights.set([(1-headWeight)*(1-limbWeight),headWeight*(1-limbWeight),limbWeight,0],i*4);
    }
    g.setAttribute('skinIndex',new T.Uint16BufferAttribute(indices,4));g.setAttribute('skinWeight',new T.Float32BufferAttribute(weights,4));
    const mesh=new T.SkinnedMesh(g,object.material);mesh.name=`${name}-generated-skin`;mesh.castShadow=true;mesh.frustumCulled=false;
    rig.add(mesh);meshes.push(mesh);
  });
  root.updateMatrixWorld(true);meshes.forEach(mesh=>mesh.bind(skeleton));
  const carry=new T.Group();carry.name='carry';carry.position.set(0,height*.3,.5);body.add(carry);
  const egg=makeEgg(carry,.5);egg.visible=false;
  root.userData.asset={source:'Colab / Hunyuan3D-2 textured',url:`assets/models/${name}.glb`,
    vertices:meshes.reduce((n,m)=>n+m.geometry.attributes.position.count,0),rig:'7 bones; procedural blended weights',color:'Hunyuan3D-2 paint texture'};
  return {root,rig,body,head,arms,legs,egg,carry,skeleton,meshes,animate(state,time){
    rig.position.set(0,0,0);rig.rotation.set(0,0,0);body.rotation.set(0,0,0);body.scale.set(1,1,1);head.rotation.set(0,0,0);
    arms.forEach(b=>b.rotation.set(0,0,0));legs.forEach(b=>b.rotation.set(0,0,0));
    if(name==='phoebe'){
      const moving=state.speed>.1,phase=time*(state.sprinting?14:9),stride=moving?Math.sin(phase)*.45:0;
      rig.position.y=moving?Math.abs(Math.sin(phase))*.045:Math.sin(time*2)*.012;
      body.rotation.x=state.sprinting?.09:0;body.rotation.z=state.hurt>0?Math.sin(time*36)*.06:0;
      legs[0].rotation.x=stride;legs[1].rotation.x=-stride;
      arms.forEach((b,i)=>{b.rotation.x=state.egg?-.85:(i===0?-stride:stride)*.5;});
      carry.position.set(0,-.12,.5);
      if(state.climb){arms.forEach((b,i)=>b.rotation.x=-1.15+Math.sin(time*12+i*Math.PI)*.2);carry.position.set(0,0,-.5);legs.forEach((b,i)=>b.rotation.x=Math.sin(time*12+i*Math.PI)*.45);}
      if(state.roll>0){const a=-(1-state.roll/.62)*Math.PI*2;rig.rotation.x=a;rig.position.set(0,1-Math.cos(a),-Math.sin(a));}
      head.rotation.y=Math.sin(time*1.3)*.025;egg.visible=!!state.egg;egg.userData.cracks.visible=!!state.egg&&state.egg.hp<3;
    }else{
      const moving=['chase','patrol','charge'].includes(state.state),charging=state.state==='charge';
      rig.position.y=moving?Math.abs(Math.sin(time*(charging?13:7)))*.05:Math.sin(time*2)*.015;
      body.rotation.x=charging?.13:0;arms.forEach((b,i)=>b.rotation.z=moving?Math.sin(time*7+i*Math.PI)*.19:0);
      if(state.state==='windup'){head.rotation.x=-.13;if(state.attack==='slam')rig.position.y=Math.sin(Math.min(1,state.clock)*Math.PI/2)*.4;}
      if(state.state==='active'){
        if(state.attack==='roar'){head.rotation.x=Math.sin(state.clock*30)*.06-.12;body.scale.y=1+Math.sin(state.clock*20)*.04;}
        if(state.attack==='slam')body.scale.y=.9+Math.min(.1,state.clock*.2);
        if(state.attack==='sweep')rig.rotation.y=Math.sin(state.clock/.55*Math.PI)*Math.PI*1.2;
      }
    }
  }};
}
export const makeGeneratedPhoebe=parent=>makeGenerated('phoebe',parent);
export const makeGeneratedReggie=parent=>makeGenerated('reggie',parent);
