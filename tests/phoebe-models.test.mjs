import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const dir=new URL('../site/games/community/phoebe-egg/assets/models/',import.meta.url);
const BUDGET={phoebe:60000,reggie:60000,reggie_roar:32000,reggie_slam:32000,reggie_charge:32000,reggie_sweep:32000,sakura_tree:20000,plateau:16000,ground:12000,sea:10,sky:6000};
const MODELS=['phoebe','reggie','plateau','ramp','rock','sakura_tree','torii','lantern','nest','tent','crate','flag','ladder','egg','cloud','reggie_roar','reggie_slam','reggie_charge','reggie_sweep','ground','sea','sky'];

async function parse(name){
  const file=await readFile(new URL(`${name}.glb`,dir));
  assert.equal(file.readUInt32LE(0),0x46546c67,'glTF magic');assert.equal(file.readUInt32LE(4),2);assert.equal(file.readUInt32LE(8),file.length,'declared length');
  const jsonLength=file.readUInt32LE(12),doc=JSON.parse(file.subarray(20,20+jsonLength).toString()),bin=28+jsonLength;
  assert.equal(file.readUInt32LE(16),0x4e4f534a);assert.equal(file.readUInt32LE(24+jsonLength),0x004e4942);
  const read=id=>{
    const a=doc.accessors[id],v=doc.bufferViews[a.bufferView],size={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[a.type],C={5126:Float32Array,5125:Uint32Array,5123:Uint16Array}[a.componentType];
    const at=bin+(v.byteOffset||0)+(a.byteOffset||0);assert.equal(at%C.BYTES_PER_ELEMENT,0,'aligned accessor');
    return new C(file.buffer.slice(file.byteOffset+at,file.byteOffset+at+a.count*size*C.BYTES_PER_ELEMENT));
  };
  return {file,doc,bin,read};
}

for(const name of MODELS)test(`${name}.glb: finite indexed geometry, UVs, embedded texture, face budget`,async()=>{
  const {file,doc,bin,read}=await parse(name);
  assert.ok(doc.meshes.length>=1);assert.ok((doc.images||[]).length>=1,'texture embedded');
  let faces=0;
  for(const mesh of doc.meshes)for(const p of mesh.primitives){
    const positions=read(p.attributes.POSITION),indices=read(p.indices);
    assert.ok(positions.every(Number.isFinite),'finite positions');assert.ok(indices.length%3===0);
    let max=0;for(const i of indices)if(i>max)max=i;assert.ok(max<positions.length/3,'index bounds');
    assert.ok(p.attributes.TEXCOORD_0!==undefined,'UVs present');
    const uv=read(p.attributes.TEXCOORD_0);assert.ok(uv.every(Number.isFinite));
    faces+=indices.length/3;
  }
  assert.ok(faces<=(BUDGET[name]??16000),`${name} has ${faces} faces`);
  for(const image of doc.images){
    const v=doc.bufferViews[image.bufferView],o=bin+(v.byteOffset||0),head=[...file.subarray(o,o+4)];
    assert.ok(image.mimeType==='image/jpeg'?head[0]===0xff&&head[1]===0xd8:head[0]===0x89&&head[1]===0x50,`${image.mimeType} signature`);
  }
});

test('Hunyuan-generated actors and props record the Colab provenance manifest',async()=>{
  const manifest=JSON.parse(await readFile(new URL('textured.json',dir)));
  assert.match(manifest.model,/Hunyuan3D/);
  for(const name of MODELS.slice(0,19))assert.ok(manifest.assets[name],`${name} generation recorded`);
});

test('characters are standing-height meshes; terrain matches gameplay extents',async()=>{
  for(const name of ['phoebe','reggie']){
    const {doc}=await parse(name),acc=doc.accessors[doc.meshes[0].primitives[0].attributes.POSITION];
    const size=acc.max.map((m,i)=>m-acc.min[i]);assert.ok(size.every(s=>s>.05),`${name} has volume in all axes`);
  }
  const {doc}=await parse('ground'),top=doc.accessors[doc.meshes[0].primitives[0].attributes.POSITION];
  assert.ok(top.max[1]===0&&top.min[0]<-42&&top.max[0]>42,'ground top is flat y=0 covering the 29-unit play area');
});
