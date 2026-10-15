import {CELL,ZONES,GLOOM_ZONES,LOOT,ASCENTS} from './data.js';
import {mulberry32,pick,range,weighted} from './rng.js';

// The mountain is a 7x7 grid of solid columns. A clockwise spiral visits the outer ring (24 cells), the middle ring (16),
// the inner ring (8) and the centre (1): each column is one pitch, taller than the one before. You climb the face that
// column k shares with column k-1, walk across its top (a ledge), and climb the next face.
export const GRID=7;
export function spiralCells(){
  const out=[];
  for(const lo of [0,1,2]){
    const hi=6-lo;
    for(let j=hi;j>=lo;j--)out.push([lo,j]);
    for(let i=lo+1;i<=hi;i++)out.push([i,lo]);
    for(let j=lo+1;j<=hi;j++)out.push([hi,j]);
    for(let i=hi-1;i>lo;i--)out.push([i,hi]);
  }
  out.push([3,3]);return out;
}
export const cellCenter=(i,j)=>({x:(i-3)*CELL,z:(j-3)*CELL});
const DIRS=[[1,0],[-1,0],[0,1],[0,-1]];
const box=(o)=>({y1:0,climb:true,...o});

export function generateWorld(seed,ascentLevel=0,rng=mulberry32(seed*2654435761>>>0)){
  const asc=ASCENTS[Math.min(ascentLevel,ASCENTS.length-1)];
  const rand=rng;
  const cells=spiralCells();
  const zoneOf=[];ZONES.forEach((z,zi)=>{for(let n=0;n<z.boxes;n++)zoneOf.push(zi);});
  const gloom=pick(rand,[null,...GLOOM_ZONES]);
  const boxes=[],tops=[],topAt=new Map();
  let T=0;
  cells.forEach(([i,j],k)=>{
    const zone=ZONES[zoneOf[k]];
    const rise=k===0?4:Math.round(range(rand,zone.rise[0],zone.rise[1])*2)/2;
    T+=rise;tops.push(T);
    const {x,z}=cellCenter(i,j);
    boxes.push(box({id:k,i,j,x1:x-CELL/2,x2:x+CELL/2,z1:z-CELL/2,z2:z+CELL/2,y2:T,zone:zoneOf[k],rise,kind:'column'}));
    topAt.set(i+','+j,T);
  });
  const topOfCell=(i,j)=>(i<0||j<0||i>=GRID||j>=GRID)?0:topAt.get(i+','+j);
  // zone altitude spans
  const zones=[];let y0=0;
  ZONES.forEach((z,zi)=>{const last=boxes.filter(b=>b.zone===zi).at(-1);zones.push({...z,index:zi,y0,y1:last.y2,lastBox:last.id,firstBox:boxes.find(b=>b.zone===zi).id});y0=last.y2;});
  const zoneAt=y=>zones.find(z=>y<z.y1)??zones.at(-1);
  // ---- climb faces, mid-wall ledges, rims, exposed faces for rendering ------------------------------------------------
  const ledges=[],rims=[],faces=[],hazards=[],ropes=[];
  boxes.forEach(b=>{
    for(const [dx,dz] of DIRS){
      const nt=topOfCell(b.i+dx,b.j+dz);
      if(b.y2>nt)faces.push({box:b.id,dx,dz,y0:nt,y1:b.y2,zone:b.zone});
    }
    if(b.id===0)return;
    const prev=boxes[b.id-1],dx=Math.sign(prev.i-b.i),dz=Math.sign(prev.j-b.j);   // face towards the previous column
    b.climbFace={dx,dz,y0:prev.y2,y1:b.y2,
      x:dx?(dx>0?b.x2:b.x1):0,z:dz?(dz>0?b.z2:b.z1):0};
    // rest ledges on tall faces
    const rise=b.rise,count=rise>=13?2:rise>=10?1:0;
    for(let n=0;n<count;n++){
      const frac=count===1?range(rand,.42,.58):(n?range(rand,.62,.72):range(rand,.28,.38));
      const y=Math.round((prev.y2+rise*frac)*2)/2,w=3.6,d=1.9,lat=range(rand,-CELL/2+2.4,CELL/2-2.4);
      const along=dx?'z':'x';
      const cx=dx?(dx>0?b.x2+d/2:b.x1-d/2):b.x1+CELL/2+lat,cz=dz?(dz>0?b.z2+d/2:b.z1-d/2):b.z1+CELL/2+lat;
      const hx=dx?d/2:w/2,hz=dz?d/2:w/2;
      // keep ledges out of the previous column's footprint only when they would intersect it (they sit above its top)
      ledges.push(box({id:'l'+b.id+'_'+n,x1:cx-hx,x2:cx+hx,z1:cz-hz,z2:cz+hz,y1:y-.5,y2:y,oneway:true,climb:false,kind:'ledge',zone:b.zone,
        crumble:rand()<(.12+b.zone*.04)*asc.hazards&&b.zone>=1,column:b.id,along}));
    }
  });
  // rims: low stone walls on edges that drop 12 m or more, so a stray step never ends a run
  boxes.forEach(b=>{
    for(const [dx,dz] of DIRS){
      const nt=topOfCell(b.i+dx,b.j+dz);
      const toPrev=b.id>0&&boxes[b.id-1].i===b.i+dx&&boxes[b.id-1].j===b.j+dz;
      const toNext=b.id<boxes.length-1&&boxes[b.id+1].i===b.i+dx&&boxes[b.id+1].j===b.j+dz;
      if(toPrev||toNext||b.y2-nt<12)continue;
      const t=.5,inset=.35,h=1.35;
      const r={id:'r'+b.id+'_'+dx+dz,y1:b.y2,y2:b.y2+h,climb:false,kind:'rim',zone:b.zone,column:b.id,dx,dz};
      if(dx){const x=dx>0?b.x2-inset:b.x1+inset;Object.assign(r,{x1:x-t/2,x2:x+t/2,z1:b.z1+inset,z2:b.z2-inset});}
      else{const z=dz>0?b.z2-inset:b.z1+inset;Object.assign(r,{z1:z-t/2,z2:z+t/2,x1:b.x1+inset,x2:b.x2-inset});}
      rims.push(r);
    }
  });
  // ---- items, crates, altars, crystals, campfires, decor, hazards, reggies ----------------------------------------------
  const items=[],crates=[],altars=[],crystals=[],campfires=[],decor=[],reggies=[];
  const inner=(b,m=1.8)=>({x:range(rand,b.x1+m,b.x2-m),z:range(rand,b.z1+m,b.z2-m)});
  const awayFromFace=(b,m=1.8)=>{ // pick a spot that is not inside the walk-in strip in front of the next climb face
    for(let n=0;n<12;n++){const p=inner(b,m);const nx=boxes[b.id+1];if(!nx||!(nx.climbFace))return p;
      const f=nx.climbFace,d=f.dx?Math.abs(p.x-f.x):Math.abs(p.z-f.z);if(d>2.2)return p;}
    return inner(b,m);};
  // start camp
  const start0=boxes[0];
  const spawn={x:start0.x1+CELL/2,y:0,z:start0.z2+6,yaw:Math.PI};
  campfires.push({x:spawn.x+3,y:0,z:spawn.z,zone:0});
  altars.push({id:'start',x:spawn.x-3,y:0,z:spawn.z,zone:0,box:-1,active:true});
  items.push({kind:'snack',x:spawn.x+1.2,y:0,z:spawn.z-2.6,taken:false},{kind:'bandage',x:spawn.x-1,y:0,z:spawn.z-3,taken:false});
  boxes.forEach(b=>{
    const zone=ZONES[b.zone];
    if(b.id>0){
      const n=Math.round(rand()*1.4*asc.loot+.35);
      for(let q=0;q<n;q++){const p=awayFromFace(b);items.push({kind:weighted(rand,LOOT[zone.id]),x:p.x,y:b.y2,z:p.z,taken:false,box:b.id});}
      if(rand()<.26){const p=awayFromFace(b,2.4);crates.push({x:p.x,y:b.y2,z:p.z,box:b.id,opened:false,loot:[weighted(rand,LOOT[zone.id]),weighted(rand,LOOT[zone.id])]});}
      if(b.zone>=2&&rand()<.22){const p=awayFromFace(b,2.4);crystals.push({x:p.x,y:b.y2,z:p.z,box:b.id,used:false});}
    }
    // altar at the end of every zone (checkpoint, heal, warmth)
    const zinfo=zones[b.zone];
    if(b.id===zinfo.lastBox){
      const c={x:(b.x1+b.x2)/2,z:(b.z1+b.z2)/2};
      altars.push({id:'altar'+b.zone,x:c.x,y:b.y2,z:c.z,zone:b.zone,box:b.id,active:false});
      campfires.push({x:c.x+2.6,y:b.y2,z:c.z+1,zone:b.zone});
    }
    // decor by zone
    const props={beach:['palm_tree','palm_tree','boulder'],jungle:['palm_tree','berry_bush','mushroom_cluster','thorn_bush'],alpine:['snow_pine','ice_spike','boulder'],
      caldera:['lava_rock','geyser','boulder'],forge:['furnace','anvil_gear','lava_rock'],citadel:['ruin_pillar','torch_stand','boulder']}[zone.id];
    const nd=2+Math.floor(rand()*3);
    for(let q=0;q<nd;q++){const p=awayFromFace(b,1.4);decor.push({kind:pick(rand,props),x:p.x,y:b.y2,z:p.z,rot:rand()*6.28,scale:range(rand,.85,1.25),zone:b.zone,box:b.id});}
    // hazards
    if(b.id===0)return;
    const hz=asc.hazards,f=b.climbFace;
    const faceVol=(w,h,depth,yy,lat)=>{
      const cx=f.dx?f.x+f.dx*depth/2:b.x1+CELL/2+lat,cz=f.dz?f.z+f.dz*depth/2:b.z1+CELL/2+lat;
      const hx=f.dx?depth/2:w/2,hz2=f.dz?depth/2:w/2;
      return {x1:cx-hx,x2:cx+hx,z1:cz-hz2,z2:cz+hz2,y1:yy,y2:yy+h};};
    const y=()=>range(rand,f.y0+2.5,f.y1-3.5),lat=()=>range(rand,-CELL/2+2.2,CELL/2-2.2);
    const zid=zone.id;
    if(zid==='jungle'&&rand()<.55*hz)hazards.push({type:'thorn',zone:b.zone,box:b.id,...faceVol(2.6,1.5,.9,y(),lat())});
    if(zid==='jungle'&&rand()<.4*hz)hazards.push({type:'slip',zone:b.zone,box:b.id,...faceVol(3.6,4,1.4,y(),lat())});
    if(zid==='beach'&&b.id>3&&rand()<.2*hz)hazards.push({type:'slip',zone:b.zone,box:b.id,...faceVol(3.2,3,1.4,y(),lat())});
    if(zid==='alpine'&&rand()<.65*hz)hazards.push({type:'slip',zone:b.zone,box:b.id,ice:true,...faceVol(4,4.5,1.4,y(),lat())});
    if((zid==='caldera'||zid==='forge')&&rand()<.6*hz)hazards.push({type:'hot',zone:b.zone,box:b.id,...faceVol(3.4,3.4,1.2,y(),lat())});
    if(zid==='citadel'&&rand()<.45*hz)hazards.push({type:'thorn',zone:b.zone,box:b.id,...faceVol(2.4,1.4,.9,y(),lat())});
    if((zid==='caldera')&&rand()<.7*hz){const p=awayFromFace(b,2.2);hazards.push({type:'geyser',zone:b.zone,box:b.id,x:p.x,z:p.z,y:b.y2,r:1.3,phase:rand()*7,period:7});}
    if(zid==='forge'&&rand()<.7*hz){const p=awayFromFace(b,2.2);hazards.push({type:'firejet',zone:b.zone,box:b.id,x:p.x,z:p.z,y:b.y2,r:1.5,phase:rand()*5,period:5});}
    if(gloom&&gloom===zid&&rand()<.7){const p=awayFromFace(b,3);hazards.push({type:'spore',zone:b.zone,box:b.id,x:p.x,z:p.z,y:b.y2,r:2.8});}
    if((zid==='jungle'||zid==='beach')&&b.rise>=9&&rand()<.5){ // hanging vine along the face: a gentler way up
      const lt=lat(),px=f.dx?f.x+f.dx*.45:b.x1+CELL/2+lt,pz=f.dz?f.z+f.dz*.45:b.z1+CELL/2+lt;
      ropes.push({id:'vine'+b.id,vine:true,x:px,z:pz,yTop:f.y1,yBottom:f.y0+.2,box:b.id,placed:false,wall:{dx:f.dx,dz:f.dz}});
    }
  });
  // Reggie guards: spread evenly through each zone; count grows with ascent
  zones.forEach((z,zi)=>{
    const ids=boxes.filter(b=>b.zone===zi&&b.id>0).map(b=>b.id),n=Math.max(1,Math.round(z.reggie*asc.reggie));
    for(let q=0;q<n&&ids.length;q++){
      const id=ids[Math.min(ids.length-1,Math.floor((q+.6)/n*ids.length))],b=boxes[id];
      reggies.push({id:reggies.length,box:id,zone:zi,home:{x:(b.x1+b.x2)/2,z:(b.z1+b.z2)/2},y:b.y2});
    }
  });
  const summitBox=boxes.at(-1);
  const summit={x:(summitBox.x1+summitBox.x2)/2,y:summitBox.y2,z:(summitBox.z1+summitBox.z2)/2,box:summitBox.id};
  const ground=box({id:'ground',x1:-90,x2:90,z1:-90,z2:90,y1:-10,y2:0,kind:'ground',climb:false});
  const solids=[ground,...boxes,...ledges,...rims];
  return {seed,ascent:ascentLevel,asc,gloom,boxes,ledges,rims,faces,solids,zones,zoneAt,tops,items,crates,altars,crystals,campfires,decor,hazards,ropes,reggies,spawn,summit,height:T,topOfCell};
}
