import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import {ZONES,ITEMS} from '../site/games/community/phoebe-peak/src/data.js';

const base=new URL('../site/games/community/phoebe-peak/',import.meta.url);
const PROPS=['palm_tree','thorn_bush','berry_bush','mushroom_cluster','snow_pine','ice_spike','geyser','lava_rock','furnace','anvil_gear','ruin_pillar','torch_stand','summit_flag','altar','campfire','boulder','hanging_vine','crystal_cluster'];
const MODELS=[...ZONES.flatMap(z=>[z.wall,z.ledge]),...PROPS,...Object.keys(ITEMS),'phoebe','reggie','reggie_roar','reggie_slam','reggie_charge','reggie_sweep','crate','island','sea'];
const BUDGET=name=>name.endsWith('_wall')?2500:name.startsWith('phoebe')?60000:name.startsWith('reggie')?60000:name in ITEMS?4000:name==='island'||name==='sea'?4000:12000;

async function parse(path){
  const file=await readFile(new URL(path,base));
  assert.equal(file.readUInt32LE(0),0x46546c67);assert.equal(file.readUInt32LE(4),2);assert.equal(file.readUInt32LE(8),file.length);
  const jl=file.readUInt32LE(12),doc=JSON.parse(file.subarray(20,20+jl).toString()),bin=28+jl;
  const read=id=>{const a=doc.accessors[id],v=doc.bufferViews[a.bufferView],size={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[a.type],C={5126:Float32Array,5125:Uint32Array,5123:Uint16Array}[a.componentType];
    const at=bin+(v.byteOffset||0)+(a.byteOffset||0);return new C(file.buffer.slice(file.byteOffset+at,file.byteOffset+at+a.count*size*C.BYTES_PER_ELEMENT));};
  return {file,doc,bin,read};
}
for(const name of MODELS)test(`peak model ${name}.glb: finite indexed geometry with UVs and an embedded texture inside its face budget`,async()=>{
  const {file,doc,bin,read}=await parse(`assets/models/${name}.glb`);let faces=0;
  assert.ok((doc.images||[]).length>=1);
  for(const mesh of doc.meshes)for(const p of mesh.primitives){
    const pos=read(p.attributes.POSITION),idx=read(p.indices);assert.ok(pos.every(Number.isFinite));let max=0;for(const i of idx)if(i>max)max=i;assert.ok(max<pos.length/3);assert.ok(p.attributes.TEXCOORD_0!==undefined);faces+=idx.length/3;}
  assert.ok(faces<=BUDGET(name),`${name} has ${faces} faces`);
  for(const image of doc.images){const v=doc.bufferViews[image.bufferView],o=bin+(v.byteOffset||0);assert.ok(image.mimeType==='image/jpeg'?file[o]===0xff&&file[o+1]===0xd8:file[o]===0x89&&file[o+1]===0x50);}
});
test('Phoebe rig: 21 bones, valid hierarchy, weights sum to 255 per vertex, matches the model',async()=>{
  const rig=JSON.parse(await readFile(new URL('assets/phoebe.rig.json',base))),{read,doc}=await parse('assets/models/phoebe.glb');
  assert.equal(rig.vertices,doc.accessors[doc.meshes[0].primitives[0].attributes.POSITION].count);
  const names=new Set(rig.bones.map(b=>b.name));assert.equal(rig.bones.length,21);
  for(const need of ['root','hips','spine','chest','neck','head','upperArmL','foreArmL','handL','upperArmR','foreArmR','handR','thighL','shinL','footL','thighR','shinR','footR'])assert.ok(names.has(need),need);
  rig.bones.forEach((b,i)=>{if(b.parent)assert.ok(rig.bones.findIndex(x=>x.name===b.parent)<i,`parent of ${b.name} comes first`);});
  const w=Buffer.from(rig.skinWeight,'base64'),ids=Buffer.from(rig.skinIndex,'base64');
  for(let i=0;i<rig.vertices;i++){let sum=0;for(let k=0;k<4;k++){sum+=w[i*4+k];assert.ok(ids[i*4+k]<rig.bones.length);}assert.equal(sum,255,`vertex ${i}`);}
});
test('HUD icons, sky panoramas and manifest exist',async()=>{
  for(const k of Object.keys(ITEMS))assert.ok((await stat(new URL(`assets/icons/${k}.png`,base))).size>500,k);
  for(const z of ZONES)assert.ok((await stat(new URL(`assets/sky/${z.sky}.jpg`,base))).size>20000,z.sky);
  const game=JSON.parse(await readFile(new URL('game.json',base)));assert.equal(game.id,'phoebe-peak');assert.equal(game.entry,'index.html');
});
