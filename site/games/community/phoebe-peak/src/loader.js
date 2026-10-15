// Narrow GLB 2.0 reader for our authored assets (indexed meshes, PNGs, hierarchy).
// No network dependencies; models remain importable by standard glTF tools.
import * as T from '../../pie-phoebe/vendor/three.module.js';
const gradient=new T.DataTexture(new Uint8Array([105,180,235,255]),4,1,T.RedFormat);
gradient.minFilter=T.NearestFilter;gradient.magFilter=T.NearestFilter;gradient.generateMipmaps=false;gradient.needsUpdate=true;

export async function loadAnime(url,options={}){
  const painted=options.style==='painted';
  const response=await fetch(url);if(!response.ok)throw Error(`模型載入失敗 ${response.status}: ${url}`);
  const buffer=await response.arrayBuffer(),view=new DataView(buffer);
  if(view.getUint32(0,true)!==0x46546c67||view.getUint32(4,true)!==2)throw Error('無效的 GLB 模型');
  const jsonLength=view.getUint32(12,true),doc=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,20,jsonLength))),binStart=28+jsonLength;
  const textures=await Promise.all((doc.images||[]).map(async image=>{
    const b=doc.bufferViews[image.bufferView],blob=new Blob([new Uint8Array(buffer,binStart+(b.byteOffset||0),b.byteLength)],{type:image.mimeType});
    const src=URL.createObjectURL(blob);
    try{const texture=await new T.TextureLoader().loadAsync(src);texture.colorSpace=T.SRGBColorSpace;texture.flipY=false;texture.anisotropy=4;return texture;}finally{URL.revokeObjectURL(src);}
  }));
  const materials=(doc.materials?.length?doc.materials:[{}]).map(m=>{
    const p=m.pbrMetallicRoughness||{},c=p.baseColorFactor||[1,1,1,1],unlit=!!m.extensions?.KHR_materials_unlit;
    const params={color:new T.Color().setRGB(c[0],c[1],c[2]),side:T.DoubleSide};
    if(p.baseColorTexture)params.map=textures[doc.textures[p.baseColorTexture.index].source];
    if(painted){params.side=m.doubleSided?T.DoubleSide:T.FrontSide;if(options.shading==='unlit')return Object.assign(new T.MeshBasicMaterial(params),{name:m.name});return Object.assign(new T.MeshLambertMaterial(params),{name:m.name});}
    const material=unlit?new T.MeshBasicMaterial(params):new T.MeshToonMaterial({...params,gradientMap:gradient});material.name=m.name;material.toneMapped=false;
    if(!unlit)material.onBeforeCompile=shader=>{
      shader.fragmentShader=shader.fragmentShader.replace('vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;',`float animeNdotL = dot(normal, normalize(mat3(viewMatrix) * vec3(-0.45,0.8,0.65)));
        float animeBand = animeNdotL > 0.55 ? 1.03 : (animeNdotL > -0.08 ? 0.88 : 0.65);
        vec3 outgoingLight = diffuseColor.rgb * animeBand;`);
    };return material;
  });
  function attribute(index){
    const a=doc.accessors[index],b=doc.bufferViews[a.bufferView],Ctor={5126:Float32Array,5125:Uint32Array,5123:Uint16Array,5121:Uint8Array}[a.componentType],size={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[a.type];
    if(!Ctor||!size)throw Error('不支援的模型資料格式');
    if(b.byteStride&&b.byteStride!==size*Ctor.BYTES_PER_ELEMENT)throw Error('不支援交錯模型資料');
    return new T.BufferAttribute(new Ctor(buffer,binStart+(b.byteOffset||0)+(a.byteOffset||0),a.count*size),size,!!a.normalized);
  }
  const nodes=doc.nodes.map(n=>{
    let object;
    if(n.mesh!==undefined){
      const primitive=doc.meshes[n.mesh].primitives[0],g=new T.BufferGeometry();
      for(const [key,value]of Object.entries(primitive.attributes)){
        const name={POSITION:'position',NORMAL:'normal',TEXCOORD_0:'uv',COLOR_0:'color'}[key];
        if(name)g.setAttribute(name,attribute(value));
      }
      if(primitive.indices!==undefined)g.setIndex(attribute(primitive.indices));
      if(!g.attributes.normal)g.computeVertexNormals();
      const material=materials[primitive.material??0].clone();
      material.onBeforeCompile=materials[primitive.material??0].onBeforeCompile;
      material.vertexColors=!!g.attributes.color;
      object=new T.Mesh(g,material);object.castShadow=true;object.receiveShadow=false;
    }else object=new T.Group();
    object.name=n.name||'';if(n.translation)object.position.fromArray(n.translation);if(n.rotation)object.quaternion.fromArray(n.rotation);if(n.scale)object.scale.fromArray(n.scale);if(n.matrix){object.matrix.fromArray(n.matrix);object.matrix.decompose(object.position,object.quaternion,object.scale);}return object;
  });
  doc.nodes.forEach((n,i)=>n.children?.forEach(child=>nodes[i].add(nodes[child])));
  const root=new T.Group();doc.scenes[doc.scene||0].nodes.forEach(index=>root.add(nodes[index]));
  root.userData.asset={url,meshes:doc.meshes.length,format:'glTF 2.0'};
  return root;
}

