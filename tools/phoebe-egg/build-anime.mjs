// Reproducible offline authoring → standard GLB 2.0 assets with embedded face texture.
import {writeFile,readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {phoebe,reggie} from './characters.mjs';
const output=new URL('../../site/games/community/phoebe-egg/assets/anime/',import.meta.url);
await mkdir(output,{recursive:true});
async function exportGLB(root,filename){
  const doc={asset:{version:'2.0',generator:'Pie Game anime mesh authoring v2'},scene:0,scenes:[{nodes:[0]}],nodes:[],meshes:[],materials:[],accessors:[],bufferViews:[],buffers:[{byteLength:0}],images:[],textures:[],samplers:[{magFilter:9729,minFilter:9987,wrapS:33071,wrapT:33071}]};
  const chunks=[],materialIndices=new Map(),textureIndices=new Map();let bytes=0,vertices=0;
  function bufferView(data,target){
    const padding=(4-bytes%4)%4;if(padding){chunks.push(Buffer.alloc(padding));bytes+=padding;}
    const buffer=Buffer.from(data.buffer,data.byteOffset,data.byteLength),index=doc.bufferViews.length;
    doc.bufferViews.push({buffer:0,byteOffset:bytes,byteLength:buffer.length,...(target?{target}:{})});chunks.push(buffer);bytes+=buffer.length;return index;
  }
  function accessor(attribute,target){
    const index=doc.accessors.length,types={1:'SCALAR',2:'VEC2',3:'VEC3',4:'VEC4'},a=attribute.array;
    if(a.some(value=>!Number.isFinite(value)))throw Error('Invalid non-finite vertex attribute');
    const value={bufferView:bufferView(a,target),componentType:a instanceof Float32Array?5126:a instanceof Uint32Array?5125:5123,count:attribute.count,type:types[attribute.itemSize]};
    if(target===34962&&attribute.itemSize===3){value.min=[Infinity,Infinity,Infinity];value.max=[-Infinity,-Infinity,-Infinity];for(let i=0;i<a.length;i++){value.min[i%3]=Math.min(value.min[i%3],a[i]);value.max[i%3]=Math.max(value.max[i%3],a[i]);}}
    doc.accessors.push(value);return index;
  }
  async function material(m){
    if(materialIndices.has(m.uuid))return materialIndices.get(m.uuid);
    const index=doc.materials.length;materialIndices.set(m.uuid,index);
    const value={name:m.name,pbrMetallicRoughness:{baseColorFactor:[m.color.r,m.color.g,m.color.b,1],metallicFactor:0,roughnessFactor:1},doubleSided:true};
    doc.materials.push(value);
    if(m.userData.unlit){value.extensions={KHR_materials_unlit:{}};doc.extensionsUsed=['KHR_materials_unlit'];}
    if(m.userData.texture){
      if(!textureIndices.has(m.userData.texture)){
        const png=await readFile(new URL(m.userData.texture,output));
        const image=doc.images.length;doc.images.push({bufferView:bufferView(png),mimeType:'image/png'});
        const texture=doc.textures.length;doc.textures.push({source:image,sampler:0});textureIndices.set(m.userData.texture,texture);
      }
      value.pbrMetallicRoughness.baseColorTexture={index:textureIndices.get(m.userData.texture)};
    }
    return index;
  }
  async function visit(object){
    const index=doc.nodes.length,n={name:object.name,translation:object.position.toArray(),rotation:object.quaternion.toArray(),scale:object.scale.toArray()};doc.nodes.push(n);
    if(object.isMesh){
      const g=object.geometry;vertices+=g.attributes.position.count;
      const attributes={POSITION:accessor(g.attributes.position,34962),NORMAL:accessor(g.attributes.normal,34962)};
      if(g.attributes.uv){const uv=g.attributes.uv.clone();for(let i=0;i<uv.count;i++)uv.setY(i,1-uv.getY(i));attributes.TEXCOORD_0=accessor(uv,34962);}
      const primitive={attributes,material:await material(object.material)};
      if(g.index)primitive.indices=accessor(g.index,34963);
      n.mesh=doc.meshes.length;doc.meshes.push({name:object.name,primitives:[primitive]});
    }
    if(object.children.length){n.children=[];for(const child of object.children){if(child.visible)n.children.push(await visit(child));}}
    return index;
  }
  await visit(root);doc.buffers[0].byteLength=bytes;
  if(!doc.images.length){delete doc.images;delete doc.textures;delete doc.samplers;}
  let json=Buffer.from(JSON.stringify(doc));json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,0x20)]);
  let binary=Buffer.concat(chunks);binary=Buffer.concat([binary,Buffer.alloc((4-binary.length%4)%4)]);
  const header=Buffer.alloc(20);header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);header.writeUInt32LE(28+json.length+binary.length,8);header.writeUInt32LE(json.length,12);header.writeUInt32LE(0x4e4f534a,16);
  const binHeader=Buffer.alloc(8);binHeader.writeUInt32LE(binary.length,0);binHeader.writeUInt32LE(0x004e4942,4);
  await writeFile(new URL(filename,output),Buffer.concat([header,json,binHeader,binary]));
  console.log(`${filename}: ${vertices.toLocaleString()} vertices, ${doc.meshes.length} meshes, ${(28+json.length+binary.length).toLocaleString()} bytes`);
}
await exportGLB(phoebe(),'phoebe.glb');await exportGLB(reggie(),'reggie.glb');
