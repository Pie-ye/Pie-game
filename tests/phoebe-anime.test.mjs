import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

for(const name of ['phoebe','reggie'])test(`${name} GLB: complete finite 3D geometry, valid indices and embedded textures`,async()=>{
  const file=await readFile(new URL(`../site/games/community/phoebe-egg/assets/anime/${name}.glb`,import.meta.url));
  assert.equal(file.readUInt32LE(0),0x46546c67);assert.equal(file.readUInt32LE(4),2);assert.equal(file.readUInt32LE(8),file.length);
  const jsonLength=file.readUInt32LE(12),doc=JSON.parse(file.subarray(20,20+jsonLength).toString()),bin=28+jsonLength;
  assert.equal(file.readUInt32LE(16),0x4e4f534a);assert.equal(file.readUInt32LE(24+jsonLength),0x004e4942);
  assert.ok(doc.meshes.length>20);
  function data(id){const a=doc.accessors[id],v=doc.bufferViews[a.bufferView],length=a.count*({SCALAR:1,VEC2:2,VEC3:3}[a.type]);const C={5126:Float32Array,5125:Uint32Array,5123:Uint16Array}[a.componentType];return new C(file.buffer,file.byteOffset+bin+(v.byteOffset||0)+(a.byteOffset||0),length);}
  for(const mesh of doc.meshes)for(const p of mesh.primitives){
    const positions=data(p.attributes.POSITION),normals=data(p.attributes.NORMAL),indices=p.indices==null?null:data(p.indices);
    assert.ok(positions.every(Number.isFinite),`${mesh.name} has finite positions`);assert.ok(normals.every(Number.isFinite),`${mesh.name} has finite normals`);
    const count=indices?indices.length:positions.length/3;
    if(indices)assert.ok(indices.every(i=>i<positions.length/3),`${mesh.name} index bounds`);
    assert.equal(count%3,0,`${mesh.name} triangle count`);
  }
  for(const image of doc.images||[]){const v=doc.bufferViews[image.bufferView],offset=bin+(v.byteOffset||0);assert.deepEqual([...file.subarray(offset,offset+8)],[137,80,78,71,13,10,26,10]);}
  if(name==='phoebe'){
    assert.equal(doc.images.length,2,'face and hair texture embedded exactly once');
    const n=doc.nodes.find(n=>n.name==='sculpted-face'),p=doc.meshes[n.mesh].primitives[0],a=doc.accessors[p.attributes.POSITION];
    assert.ok(a.max[2]-a.min[2]>.6,'head has real depth, not a face billboard');
    for(const joint of ['armL','armR','legL','legR','head','hair','carry'])assert.ok(doc.nodes.some(n=>n.name===joint));
  }
});
