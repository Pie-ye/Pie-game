// Minimal GLB 2.0 writer for offline-baked scenery (indexed meshes + embedded PNG textures).
import fs from 'node:fs';
export function writeGLB(file,parts){
  const chunks=[],views=[],accessors=[],images=[],textures=[],materials=[],meshes=[],nodes=[];
  const push=(buffer,target)=>{
    while(chunks.reduce((n,c)=>n+c.length,0)%4)chunks.push(Buffer.alloc(1));
    const offset=chunks.reduce((n,c)=>n+c.length,0);chunks.push(Buffer.from(buffer.buffer?new Uint8Array(buffer.buffer,buffer.byteOffset,buffer.byteLength):buffer));
    views.push({buffer:0,byteOffset:offset,byteLength:buffer.byteLength,...(target?{target}:{})});return views.length-1;
  };
  for(const part of parts){
    const positions=new Float32Array(part.positions),normals=new Float32Array(part.normals),uv=new Float32Array(part.uv),indices=new Uint32Array(part.indices);
    const min=[1e9,1e9,1e9],max=[-1e9,-1e9,-1e9];
    for(let i=0;i<positions.length;i+=3)for(let k=0;k<3;k++){min[k]=Math.min(min[k],positions[i+k]);max[k]=Math.max(max[k],positions[i+k]);}
    const acc=(array,type,componentType,target,extra={})=>{accessors.push({bufferView:push(array,target),componentType,count:array.length/{SCALAR:1,VEC2:2,VEC3:3}[type],type,...extra});return accessors.length-1;};
    const attributes={POSITION:acc(positions,'VEC3',5126,34962,{min,max}),NORMAL:acc(normals,'VEC3',5126,34962),TEXCOORD_0:acc(uv,'VEC2',5126,34962)};
    const index=acc(indices,'SCALAR',5125,34963);
    const image=images.push({bufferView:push(fs.readFileSync(part.texture)),mimeType:/\.jpe?g$/i.test(part.texture)?'image/jpeg':'image/png'})-1;
    textures.push({source:image,sampler:0});
    materials.push({name:part.name,doubleSided:!!part.doubleSided,pbrMetallicRoughness:{baseColorTexture:{index:textures.length-1},metallicFactor:0,roughnessFactor:1},
      ...(part.unlit?{extensions:{KHR_materials_unlit:{}}}:{})});
    meshes.push({name:part.name,primitives:[{attributes,indices:index,material:materials.length-1}]});
    nodes.push({name:part.name,mesh:meshes.length-1});
  }
  const json={asset:{version:'2.0',generator:'phoebe-egg terrain baker'},scene:0,scenes:[{nodes:nodes.map((_,i)=>i)}],nodes,meshes,materials,textures,images,
    samplers:[{magFilter:9729,minFilter:9987,wrapS:10497,wrapT:10497}],accessors,bufferViews:views,buffers:[{byteLength:0}],extensionsUsed:parts.some(p=>p.unlit)?['KHR_materials_unlit']:undefined};
  const bin=Buffer.concat(chunks);json.buffers[0].byteLength=bin.length+((4-bin.length%4)%4);
  let j=Buffer.from(JSON.stringify(json));j=Buffer.concat([j,Buffer.alloc((4-j.length%4)%4,0x20)]);
  const b=Buffer.concat([bin,Buffer.alloc((4-bin.length%4)%4)]);
  const header=Buffer.alloc(12);header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);header.writeUInt32LE(12+8+j.length+8+b.length,8);
  const h1=Buffer.alloc(8);h1.writeUInt32LE(j.length,0);h1.writeUInt32LE(0x4e4f534a,4);const h2=Buffer.alloc(8);h2.writeUInt32LE(b.length,0);h2.writeUInt32LE(0x004e4942,4);
  fs.writeFileSync(file,Buffer.concat([header,h1,j,h2,b]));
}
