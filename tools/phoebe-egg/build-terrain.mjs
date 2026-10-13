// Bake island ground, sea and sky into GLBs. Textures come from tools/phoebe-egg/textures (Grok art +
// compose-ground.py). Gameplay collision stays in src/rules.js; the flat top is y=0.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {writeGLB} from './glb-writer.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)),tex=n=>path.join(here,'textures',n),out=n=>path.join(here,'../../site/games/community/phoebe-egg/assets/models',n);
const R_TOP=43,R_BEACH=47,SPAN=96;   // composite ground map covers x,z in [-SPAN/2,SPAN/2]
function disc(){
  const positions=[],uv=[],normals=[],indices=[],rings=[0,.25,.5,.75,.9,1],seg=96;
  const add=(x,y,z,nx,ny,nz,u,v)=>{positions.push(x,y,z);normals.push(nx,ny,nz);uv.push(u,v);return positions.length/3-1;};
  const yAt=r=>r<=R_TOP?0:-0.5*((r-R_TOP)/(R_BEACH-R_TOP))**1.5;
  const rows=[];
  for(const f of rings){rows.push([]);const r=f*R_TOP;for(let i=0;i<=seg;i++){const a=i/seg*Math.PI*2,x=Math.cos(a)*r,z=Math.sin(a)*r;rows.at(-1).push(add(x,0,z,0,1,0,x/SPAN+.5,z/SPAN+.5));}}
  for(const r of [R_TOP+1.5,R_BEACH]){rows.push([]);for(let i=0;i<=seg;i++){const a=i/seg*Math.PI*2,x=Math.cos(a)*r,z=Math.sin(a)*r;rows.at(-1).push(add(x,yAt(r),z,0,1,0,x/SPAN+.5,z/SPAN+.5));}}
  for(let j=0;j<rows.length-1;j++)for(let i=0;i<seg;i++){const a=rows[j][i],b=rows[j][i+1],c=rows[j+1][i],d=rows[j+1][i+1];indices.push(a,b,c,b,d,c);}
  return {name:'ground-top',positions,normals,uv,indices,texture:tex('ground-composite.jpg')};
}
function cliff(){
  const positions=[],uv=[],normals=[],indices=[],seg=96,r=R_BEACH;
  for(let i=0;i<=seg;i++){const a=i/seg*Math.PI*2,c=Math.cos(a),s=Math.sin(a),wobble=1-.025*Math.sin(a*7);
    for(const [y,k] of [[-.5,0],[-4.5,1]]){positions.push(c*r*wobble,y,s*r*wobble);normals.push(c,0,s);uv.push(i/seg*14,k*1.1);}}
  for(let i=0;i<seg;i++){const a=i*2,b=a+1,c=a+2,d=a+3;indices.push(a,c,b,b,c,d);}
  return {name:'ground-cliff',positions,normals,uv,indices,texture:tex('cliff.jpg'),doubleSided:true};
}
function sea(){
  const s=260,rep=52;
  return {name:'sea',positions:[-s,0,-s,s,0,-s,-s,0,s,s,0,s],normals:[0,1,0,0,1,0,0,1,0,0,1,0],uv:[0,0,rep,0,0,rep,rep,rep],indices:[0,2,1,1,2,3],texture:tex('water.jpg')};
}
function sky(){
  const positions=[],uv=[],normals=[],indices=[],W=64,H=32,r=230;
  for(let j=0;j<=H;j++)for(let i=0;i<=W;i++){const th=j/H*Math.PI,a=i/W*Math.PI*2;
    positions.push(Math.cos(a)*Math.sin(th)*r,Math.cos(th)*r,Math.sin(a)*Math.sin(th)*r);normals.push(0,-1,0);uv.push(i/W,j/H);}
  for(let j=0;j<H;j++)for(let i=0;i<W;i++){const a=j*(W+1)+i,b=a+1,c=a+W+1,d=c+1;indices.push(a,b,c,b,d,c);}
  return {name:'sky',positions,normals,uv,indices,texture:tex('sky.jpg'),doubleSided:true,unlit:true};
}
writeGLB(out('ground.glb'),[disc(),cliff()]);writeGLB(out('sea.glb'),[sea()]);writeGLB(out('sky.glb'),[sky()]);
console.log('terrain GLBs written');
