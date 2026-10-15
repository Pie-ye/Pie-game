// Start island, sea and cliff skirt for the climbing game (sand + grass + sea textures from Grok, see ../phoebe-egg/grok-textures.md).
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {writeGLB} from './glb-writer.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)),tex=n=>path.join(here,'textures',n),out=n=>path.join(here,'../../site/games/community/phoebe-peak/assets/models',n);
const R=88,SEG=96,REP=16;
function disc(){
  const positions=[],uv=[],normals=[],indices=[],rows=[];
  const add=(x,y,z,u,v)=>{positions.push(x,y,z);normals.push(0,1,0);uv.push(u,v);return positions.length/3-1;};
  for(const f of [0,.3,.6,.85,1]){rows.push([]);const r=f*R;for(let i=0;i<=SEG;i++){const a=i/SEG*Math.PI*2,x=Math.cos(a)*r,z=Math.sin(a)*r;rows.at(-1).push(add(x,0,z,x/(2*R)*REP,z/(2*R)*REP));}}
  for(let j=0;j<rows.length-1;j++)for(let i=0;i<SEG;i++){const a=rows[j][i],b=rows[j][i+1],c=rows[j+1][i],d=rows[j+1][i+1];indices.push(a,b,c,b,d,c);}
  return {name:'island-top',positions,normals,uv,indices,texture:tex('sand.jpg')};
}
function cliff(){
  const positions=[],uv=[],normals=[],indices=[];
  for(let i=0;i<=SEG;i++){const a=i/SEG*Math.PI*2,c=Math.cos(a),s=Math.sin(a);
    for(const [y,k] of [[0,0],[-6,1]]){positions.push(c*R,y,s*R);normals.push(c,0,s);uv.push(i/SEG*24,k*1.5);}}
  for(let i=0;i<SEG;i++){const a=i*2,b=a+1,c=a+2,d=a+3;indices.push(a,c,b,b,c,d);}
  return {name:'island-cliff',positions,normals,uv,indices,texture:tex('cliff.jpg'),doubleSided:true};
}
function sea(){const s=900,rep=170;return {name:'sea',positions:[-s,0,-s,s,0,-s,-s,0,s,s,0,s],normals:[0,1,0,0,1,0,0,1,0,0,1,0],uv:[0,0,rep,0,0,rep,rep,rep],indices:[0,2,1,1,2,3],texture:tex('water.jpg')};}
writeGLB(out('island.glb'),[disc(),cliff()]);writeGLB(out('sea.glb'),[sea()]);console.log('island + sea written');
