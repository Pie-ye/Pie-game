import {CELL,GRID,ZONES,GLOOM_ZONES,LOOT,ASCENTS,ROUTES} from './data.js';
import {mulberry32,pick,range,weighted,shuffle} from './rng.js';

// The mountain is a square spiral of nine stages. Every stage is a strip of three parallel lanes (a trail, a direct wall
// and a risky path) that runs between two camps. A camp is a flat 3x3 block where the lanes meet again. The lanes are
// real columns side by side, so you can walk or climb from one lane to the next wherever their heights allow it.
// The seed also rotates and mirrors the whole layout, shuffles which lane is which and re-rolls every hazard.
const CAMPS=[[1,1],[15,1],[15,15],[1,15],[1,4],[12,4],[12,12],[4,12],[4,7],[9,7]];   // camp centres in cell units; camp 0 is the start beach
const STAGE_ZONE=[0,1,2,3,3,4,4,5,5];
const DIRS=[[1,0],[-1,0],[0,1],[0,-1]];
const LANES=3,MAX_STEP=18,MIN_STEP=2.5;
export const cellCenter=(i,j)=>({x:(i-(GRID-1)/2)*CELL,z:(j-(GRID-1)/2)*CELL});
const box=(o)=>({y1:0,climb:true,...o});
const half=v=>Math.round(v*2)/2;
const okRise=v=>v===0||(v>=MIN_STEP-.01&&v<=MAX_STEP+.01);

// Heights of one lane: `steps` rises that add up to S. Trails are even, risky lanes are uneven, direct lanes mix flat stretches with tall walls.
function laneRises(style,steps,S,rand){
  let w=[];
  for(let n=0;n<steps;n++)w.push(style==='trail'?1+(rand()-.5)*.4:style==='risk'?1+(rand()-.5)*1.1:(n===steps-1||rand()>.42)?1.9+rand()*.5:0);
  const solve=()=>{const t=w.reduce((a,b)=>a+b,0);return w.map(v=>S*v/t);};
  for(let guard=0;guard<40;guard++){
    const r=solve(),big=r.findIndex(v=>v>MAX_STEP),small=r.findIndex(v=>v>0&&v<MIN_STEP);
    if(big>=0){const zero=w.map((v,i)=>v===0?i:-1).filter(i=>i>=0);if(zero.length)w[pick(rand,zero)]=1.9;else{w=w.map(v=>v?1+(v-1)*.5:0);if(w.every(v=>v===1))break;}}
    else if(small>=0)w[small]=0;else break;
  }
  const r=solve().map(half);
  let diff=half(S-r.reduce((a,b)=>a+b,0));
  const order=r.map((v,i)=>[v,i]).filter(([v])=>v>0).sort((a,b)=>b[0]-a[0]);
  for(const [,i] of order){if(!diff)break;const v=r[i]+diff;if(okRise(v)&&v>0){r[i]=v;diff=0;}}
  if(diff){r[r.length-1]=half(r.at(-1)+diff);}
  return r;
}

// One of the eight symmetries of the square: rotations and a mirror.
const transform=(sym)=>([i,j])=>{let a=i,b=j;for(let n=0;n<(sym&3);n++){[a,b]=[GRID-1-b,a];}if(sym&4)a=GRID-1-a;return [a,b];};

export function generateWorld(seed,ascentLevel=0,rng=mulberry32(seed*2654435761>>>0)){
  const asc=ASCENTS[Math.min(ascentLevel,ASCENTS.length-1)];
  const rand=rng,sym=Math.floor(rand()*8),T=transform(sym);
  const camps=CAMPS.map(T);
  const gloom=pick(rand,[null,...GLOOM_ZONES]);
  // ---- stage geometry and altitudes ---------------------------------------------------------------------------------------
  const campTop=[0];
  const stages=[];
  for(let k=0;k<9;k++){
    const A=camps[k],B=camps[k+1],dx=Math.sign(B[0]-A[0]),dz=Math.sign(B[1]-A[1]),dist=Math.abs(B[0]-A[0])+Math.abs(B[1]-A[1]),rows=dist-3,steps=rows+1;
    const zone=STAGE_ZONE[k],S=half(steps*ZONES[zone].rise*(.94+rand()*.12));
    campTop.push(campTop[k]+S);
    const styles=shuffle(rand,['trail','direct','risk']);
    const lanes=styles.map((style)=>{const rises=laneRises(style,steps,S,rand);
      if(k===0&&rises[0]===0){const j=rises.findIndex(v=>v>0);[rises[0],rises[j]]=[rises[j],rises[0]];}   // the first wall rises out of the beach
      return {style,rises};});
    stages.push({index:k,zone,dir:{dx,dz},perp:{dx:-dz,dz:dx},from:A,to:B,rows,steps,S,y0:campTop[k],y1:campTop[k+1],lanes});
  }
  // lane heights h[l][r] (top of row r), then a few crossovers where two neighbouring lanes meet at the same height
  for(const st of stages){
    st.h=st.lanes.map(l=>{let y=st.y0;return l.rises.slice(0,st.rows).map(r=>(y=half(y+r)));});
    for(let n=0,tries=0;n<(st.rows>=4?2:1)&&tries<24&&st.rows>=2;tries++){
      const r=st.rows>2?1+Math.floor(rand()*(st.rows-2)):Math.floor(rand()*st.rows),a=Math.floor(rand()*(LANES-1)),m=half((st.h[a][r]+st.h[a+1][r])/2);
      if(st.cross?.some(c=>c.row===r))continue;
      const test=(l)=>{const prev=r?st.h[l][r-1]:st.y0,next=r+1<st.rows?st.h[l][r+1]:st.y1;return okRise(half(m-prev))&&okRise(half(next-m));};
      if(test(a)&&test(a+1)){st.h[a][r]=m;st.h[a+1][r]=m;st.cross=[...(st.cross||[]),{row:r,a}];n++;}
    }
  }
  // ---- boxes -------------------------------------------------------------------------------------------------------------
  const boxes=[],topAt=new Map(),idAt=new Map(),key=(i,j)=>i+','+j;
  const topOfCell=(i,j)=>topAt.get(key(i,j))??0;
  const boxAtCell=(i,j)=>{const id=idAt.get(key(i,j));return id===undefined?null:boxes[id];};
  const campBlocks=[];
  const make=(i,j,y2,extra)=>{const {x,z}=cellCenter(i,j),b=box({id:boxes.length,i,j,x1:x-CELL/2,x2:x+CELL/2,z1:z-CELL/2,z2:z+CELL/2,y2,kind:'column',rise:0,pred:-1,...extra});boxes.push(b);topAt.set(key(i,j),y2);idAt.set(key(i,j),b.id);return b;};
  const start=camps[0];
  const startBlock=new Set();for(let a=-1;a<=1;a++)for(let c=-1;c<=1;c++)startBlock.add(key(start[0]+a,start[1]+c));
  for(const st of stages){
    const {dx,dz}=st.dir,{dx:px,dz:pz}=st.perp;
    st.cells=[];
    for(let r=0;r<st.rows;r++){
      const row=[];
      for(let l=0;l<LANES;l++){
        const i=st.from[0]+dx*(2+r)+px*(l-1),j=st.from[1]+dz*(2+r)+pz*(l-1);
        const rise=half(st.h[l][r]-(r?st.h[l][r-1]:st.y0));
        const b=make(i,j,st.h[l][r],{zone:st.zone,stage:st.index,row:r,lane:l,style:st.lanes[l].style,rise,camp:null});
        row.push(b.id);
      }
      st.cells.push(row);
    }
    // the camp at the end of the stage
    const [ci,cj]=st.to,block=[];
    for(let a=-1;a<=1;a++)for(let c=-1;c<=1;c++){
      // lane l meets the camp cell lateral offset (l-1) on the side facing the stage
      const b=make(ci+a,cj+c,st.y1,{zone:st.zone,stage:st.index,row:st.rows,lane:-1,style:'camp',camp:st.index+1});
      block.push(b.id);
    }
    st.camp=block;campBlocks.push(block);
    st.last=st.cells.at(-1);
  }
  // predecessors (the lower neighbour you climb from) along each lane
  for(const st of stages){
    const {dx,dz}=st.dir,{dx:px,dz:pz}=st.perp;
    for(let r=0;r<st.rows;r++)for(let l=0;l<LANES;l++){
      const b=boxes[st.cells[r][l]];
      if(r>0)b.pred=st.cells[r-1][l];
      else if(st.index>0){const i=st.from[0]+dx*1+px*(l-1),j=st.from[1]+dz*1+pz*(l-1);b.pred=idAt.get(key(i,j))??-1;}
    }
    // the camp cells facing the lanes are climbed from the last row of each lane
    for(let l=0;l<LANES;l++){const i=st.to[0]-dx+px*(l-1),j=st.to[1]-dz+pz*(l-1),c=boxAtCell(i,j);if(c)c.pred=st.cells.at(-1)[l];}
  }
  // filler columns for cells that nothing else uses (the summit yard), at the height of their lowest neighbour
  {
    for(let n=0;n<4;n++)for(let i=0;i<GRID;i++)for(let j=0;j<GRID;j++){
      if(topAt.has(key(i,j))||startBlock.has(key(i,j)))continue;
      const around=DIRS.map(([a,c])=>topAt.get(key(i+a,j+c))).filter(v=>v!==undefined);if(!around.length)continue;
      make(i,j,Math.min(...around),{zone:5,stage:8,row:-1,lane:-1,style:'filler',camp:null,filler:true});
    }
  }
  // ---- zones --------------------------------------------------------------------------------------------------------------
  const zones=[];
  ZONES.forEach((z,zi)=>{
    const ss=stages.filter(s=>s.zone===zi),y0=ss[0].y0,y1=ss.at(-1).y1,endCamp=ss.at(-1).camp,lastBox=endCamp[4];
    zones.push({...z,index:zi,y0,y1,lastBox,firstBox:ss[0].cells[0][0],stages:ss.map(s=>s.index)});
  });
  for(const b of boxes){const zi=zones.findIndex(z=>b.y2<=z.y1+.01);b.zone=zi<0?5:zi;}
  const zoneAt=y=>zones.find(z=>y<z.y1)??zones.at(-1);
  const height=campTop[9];
  // ---- faces: every exposed side of every column ---------------------------------------------------------------------------
  const faces=[];
  for(const b of boxes){
    b.risers=[];
    for(const [dx,dz] of DIRS){
      const ni=b.i+dx,nj=b.j+dz,nt=topOfCell(ni,nj),nb=boxAtCell(ni,nj);
      if(nb&&nb.y2>b.y2+MIN_STEP-.01)b.risers.push({dx,dz});
      if(b.y2>nt+.01){
        const f={box:b.id,dx,dz,y0:nt,y1:b.y2,zone:b.zone,nb:nb?nb.id:-1,x:dx?(dx>0?b.x2:b.x1):0,z:dz?(dz>0?b.z2:b.z1):0};
        f.route=!!nb&&nb.id===b.pred||(!nb&&b.stage===0&&b.row===0&&startBlock.has(key(ni,nj)));f.stepHeight=f.y1-f.y0;faces.push(f);
        if(f.route&&f.stepHeight>=MIN_STEP-.01)b.climbFace=f;
      }
    }
  }
  const faceOf=(b,dx,dz)=>faces.find(f=>f.box===b.id&&f.dx===dx&&f.dz===dz);
  // ---- rest ledges on tall faces, rims, hazards ------------------------------------------------------------------------------
  const ledges=[],rims=[],hazards=[],ropes=[],anchors=[],hives=[];
  const lateralRange=(m)=>range(rand,-CELL/2+m,CELL/2-m);
  const lateralOf=(b,f,lat)=>f.dx?{x:f.x,z:(b.z1+b.z2)/2+lat}:{x:(b.x1+b.x2)/2+lat,z:f.z};
  const routeFaces=faces.filter(f=>{const b=boxes[f.box];return (b.lane>=0||b.camp)&&(f.route||(f.nb>=0&&boxes[f.nb].stage===b.stage&&boxes[f.nb].lane>=0))&&f.stepHeight>=MIN_STEP-.01&&f.stepHeight<=22;});
  for(const f of routeFaces){
    const b=boxes[f.box],h=f.stepHeight,count=h>=13?2:h>=10?1:(h>=8&&ROUTES[b.style]?.bench&&rand()<.5)?1:0;
    for(let n=0;n<count;n++){
      const frac=count===1?range(rand,.42,.58):(n?range(rand,.62,.72):range(rand,.28,.38));
      const y=Math.round((f.y0+h*frac)*2)/2,w=3.6,d=1.9,lat=lateralRange(2.4),p=lateralOf(b,f,lat);
      const cx=f.dx?(f.dx>0?b.x2+d/2:b.x1-d/2):p.x,cz=f.dz?(f.dz>0?b.z2+d/2:b.z1-d/2):p.z;
      const hx=f.dx?d/2:w/2,hz=f.dz?d/2:w/2;
      ledges.push(box({id:'l'+b.id+'_'+f.dx+f.dz+'_'+n,x1:cx-hx,x2:cx+hx,z1:cz-hz,z2:cz+hz,y1:y-.5,y2:y,oneway:true,climb:false,kind:'ledge',zone:b.zone,
        crumble:rand()<(.12+b.zone*.04)*asc.hazards&&b.zone>=1&&b.style!=='trail',column:b.id,along:f.dx?'z':'x',face:f}));
    }
  }
  // rims: low stone walls on edges that drop 12 m or more, except where a lane or camp continues, so a stray step never ends a run
  for(const b of boxes){
    for(const [dx,dz] of DIRS){
      const f=faceOf(b,dx,dz);if(!f||f.stepHeight<12)continue;
      const nb=f.nb>=0?boxes[f.nb]:null;
      if(f.route||(nb&&nb.pred===b.id))continue;
      const t=.5,inset=.35,h=1.35;
      const r={id:'r'+b.id+'_'+dx+dz,y1:b.y2,y2:b.y2+h,climb:false,kind:'rim',zone:b.zone,column:b.id,dx,dz};
      if(dx){const x=dx>0?b.x2-inset:b.x1+inset;Object.assign(r,{x1:x-t/2,x2:x+t/2,z1:b.z1+inset,z2:b.z2-inset});}
      else{const z=dz>0?b.z2-inset:b.z1+inset;Object.assign(r,{z1:z-t/2,z2:z+t/2,x1:b.x1+inset,x2:b.x2-inset});}
      rims.push(r);
    }
  }
  // ---- items, crates, altars, crystals, campfires, decor, hazards, reggies ----------------------------------------------
  const items=[],crates=[],altars=[],crystals=[],campfires=[],decor=[],reggies=[],signs=[];
  const inner=(b,m=1.8)=>({x:range(rand,b.x1+m,b.x2-m),z:range(rand,b.z1+m,b.z2-m)});
  const spot=(b,m=1.8,clear=2.4)=>{ // a point that is not in the walk-in strip in front of a wall that rises beside this column
    for(let n=0;n<24;n++){const p=inner(b,m);
      if(b.risers.every(r=>(r.dx?Math.abs(p.x-(r.dx>0?b.x2:b.x1)):Math.abs(p.z-(r.dz>0?b.z2:b.z1)))>clear))return p;}
    return inner(b,m);};
  const lootFor=(b)=>LOOT[ZONES[b.zone].id];
  // start beach
  const sc=cellCenter(...start),sd=stages[0].dir;
  const spawn={x:sc.x,y:0,z:sc.z,yaw:Math.atan2(sd.dx,sd.dz)};
  const side={x:-sd.dz,z:sd.dx};
  campfires.push({x:spawn.x+side.x*3,y:0,z:spawn.z+side.z*3,zone:0});
  altars.push({id:'start',x:spawn.x-side.x*3,y:0,z:spawn.z-side.z*3,zone:0,box:-1,active:true});
  items.push({kind:'snack',x:spawn.x+sd.dx*2+side.x*1.2,y:0,z:spawn.z+sd.dz*2+side.z*1.2,taken:false},{kind:'bandage',x:spawn.x+sd.dx*2-side.x*1.2,y:0,z:spawn.z+sd.dz*2-side.z*1.2,taken:false});
  // camps
  const campInfo=[];
  stages.forEach(st=>{
    const centre=boxes[st.camp[4]],zi=st.zone,end=zones[zi].lastBox===centre.id;
    const info={index:st.index+1,box:centre.id,cells:st.camp,x:(centre.x1+centre.x2)/2,z:(centre.z1+centre.z2)/2,y:centre.y2,zone:zi,altar:end};campInfo.push(info);
    if(end)altars.push({id:'altar'+zi,x:info.x,y:info.y,z:info.z,zone:zi,box:centre.id,active:false});
    campfires.push({x:info.x+2.6,y:info.y,z:info.z+1.2,zone:zi});
    const loot=LOOT[ZONES[zi].id];
    for(let n=0;n<2;n++){const b=boxes[pick(rand,st.camp.filter(id=>id!==centre.id))],p=inner(b,2.2);items.push({kind:weighted(rand,loot),x:p.x,y:b.y2,z:p.z,taken:false,box:b.id});}
    for(let n=0;n<(end?2:1);n++){const b=boxes[pick(rand,st.camp.filter(id=>id!==centre.id))],p=inner(b,2.4);crates.push({x:p.x,y:b.y2,z:p.z,box:b.id,opened:false,loot:[weighted(rand,loot),weighted(rand,loot),...(end?[weighted(rand,loot)]:[])]});}
    // a little mountain village: cabin, tent, barrels and lamp posts on the cells that no lane touches
    const free=st.camp.filter(id=>id!==centre.id&&!DIRS.some(([dx,dz])=>{const nb=boxAtCell(boxes[id].i+dx,boxes[id].j+dz);return nb&&nb.lane>=0;}));
    ['cabin','tent','barrels','lamp_post','lamp_post'].forEach((kind,n)=>{
      const b=boxes[free[n%Math.max(1,free.length)]??centre.id];if(!b)return;
      const p=kind==='lamp_post'?{x:(b.x1+b.x2)/2+range(rand,-3,3),z:(b.z1+b.z2)/2+range(rand,-3,3)}:inner(b,kind==='cabin'?3.2:2.4);
      decor.push({kind,x:p.x,y:b.y2,z:p.z,rot:Math.atan2(info.x-p.x,info.z-p.z),scale:1,zone:zi,box:b.id});});
    for(let n=0;n<3;n++){const b=boxes[pick(rand,st.camp)],p=inner(b,1.4);decor.push({kind:'boulder',x:p.x,y:b.y2,z:p.z,rot:rand()*6.28,scale:range(rand,.85,1.2),zone:zi,box:b.id});}
  });
  // route signs at the foot of each stage: which lane is which
  stages.forEach(st=>{
    const entry=st.index?campInfo[st.index-1]:{x:spawn.x,z:spawn.z,y:0,zone:0};
    signs.push({stage:st.index,x:entry.x+st.dir.dx*(CELL*1.2)+st.perp.dx*5,z:entry.z+st.dir.dz*(CELL*1.2)+st.perp.dz*5,y:entry.y,dir:st.dir,perp:st.perp,lanes:st.lanes.map(l=>l.style),zone:st.zone});
  });
  // lane cells
  const propsFor={beach:['palm_tree','palm_tree','boulder'],jungle:['palm_tree','berry_bush','mushroom_cluster','thorn_bush'],alpine:['snow_pine','ice_spike','boulder'],
    caldera:['lava_rock','geyser','boulder'],forge:['furnace','anvil_gear','lava_rock'],citadel:['ruin_pillar','torch_stand','boulder']};
  const addVine=(b,f,lat)=>{const p=lateralOf(b,f,lat),px=f.dx?f.x+f.dx*.45:p.x,pz=f.dz?f.z+f.dz*.45:p.z;
    ropes.push({id:'vine'+b.id+'_'+ropes.length,vine:true,x:px,z:pz,yTop:f.y1,yBottom:f.y0+.2,box:b.id,placed:false,wall:{dx:f.dx,dz:f.dz}});};
  for(const b of boxes){
    const zone=ZONES[b.zone],zid=zone.id,style=ROUTES[b.style],laneCell=b.lane>=0;
    // decor
    const nd=b.camp?0:b.filler?1:laneCell?(b.style==='trail'?2:b.style==='risk'?1:1)+Math.floor(rand()*2):0;
    for(let q=0;q<nd;q++){const p=spot(b,1.4);decor.push({kind:pick(rand,propsFor[zid]),x:p.x,y:b.y2,z:p.z,rot:rand()*6.28,scale:range(rand,.85,1.25),zone:b.zone,box:b.id});}
    if(!laneCell)continue;
    // loose items, crates, crystals
    const n=Math.round(rand()*1.2*asc.loot*style.loot*1.5+.2);
    for(let q=0;q<n;q++){const p=spot(b);items.push({kind:weighted(rand,lootFor(b)),x:p.x,y:b.y2,z:p.z,taken:false,box:b.id});}
    if(rand()<style.crate*.8){const p=spot(b,2.4);crates.push({x:p.x,y:b.y2,z:p.z,box:b.id,opened:false,loot:[weighted(rand,lootFor(b)),weighted(rand,lootFor(b))]});}
    if(b.zone>=2&&b.style==='risk'&&rand()<.22){const p=spot(b,2.4);crystals.push({x:p.x,y:b.y2,z:p.z,box:b.id,used:false});}
    if(zid==='jungle'&&rand()<.1*(b.style==='risk'?2:1)){const p=spot(b,2.6);hives.push({x:p.x,y:b.y2,z:p.z,box:b.id,taken:false});decor.push({kind:'beehive',x:p.x,y:b.y2,z:p.z,rot:rand()*6.28,scale:1,zone:b.zone,box:b.id,hive:true});}
    // hazards sit on the face you climb to reach this column
    const f=b.climbFace;if(!f)continue;
    const hz=asc.hazards*style.hazard,depth=(w,hh,d,yy,lat)=>{const c=lateralOf(b,f,lat),cx=f.dx?f.x+f.dx*d/2:c.x,cz=f.dz?f.z+f.dz*d/2:c.z,hx=f.dx?d/2:w/2,hzz=f.dz?d/2:w/2;
      return {x1:cx-hx,x2:cx+hx,z1:cz-hzz,z2:cz+hzz,y1:yy,y2:yy+hh,face:{dx:f.dx,dz:f.dz,x:f.x,z:f.z}};};
    const y=()=>range(rand,f.y0+2.5,Math.max(f.y0+2.6,f.y1-3.5)),lat=()=>lateralRange(2.2);
    const H=(type,o)=>hazards.push({type,zone:b.zone,box:b.id,...o});
    if(zid==='jungle'&&rand()<.55*hz)H('thorn',depth(2.6,1.5,.9,y(),lat()));
    if(zid==='jungle'&&rand()<.4*hz)H('slip',depth(3.6,4,1.4,y(),lat()));
    if(zid==='beach'&&b.stage>0&&rand()<.2*hz)H('slip',depth(3.2,3,1.4,y(),lat()));
    if(zid==='alpine'&&rand()<.65*hz)H('slip',{ice:true,...depth(4,4.5,1.4,y(),lat())});
    if((zid==='caldera'||zid==='forge')&&rand()<.6*hz)H('hot',depth(3.4,3.4,1.2,y(),lat()));
    if(zid==='citadel'&&rand()<.45*hz)H('thorn',depth(2.4,1.4,.9,y(),lat()));
    if(zid==='caldera'&&rand()<.7*hz){const p=spot(b,2.2,3.9);H('geyser',{x:p.x,z:p.z,y:b.y2,r:1.3,phase:rand()*7,period:7});}
    if(zid==='forge'&&rand()<.7*hz){const p=spot(b,2.2,4.1);H('firejet',{x:p.x,z:p.z,y:b.y2,r:1.5,phase:rand()*5,period:5});}
    if(gloom&&gloom===zid&&rand()<.7*Math.max(.5,style.hazard)){const p=spot(b,3,5.6);H('spore',{x:p.x,z:p.z,y:b.y2,r:2.8});}
    // gentler ways up: hanging vines and fixed pitons, mostly on the direct wall
    if(f.stepHeight>=8&&rand()<style.vine&&(zid==='jungle'||zid==='beach'||b.style==='direct'))addVine(b,f,lateralRange(2.5));
    if(f.stepHeight>=12&&rand()<style.piton){const c=lateralOf(b,f,lateralRange(2.5));anchors.push({x:f.dx?f.x+f.dx*.5:c.x,y:f.y0+f.stepHeight*range(rand,.45,.6),z:f.dz?f.z+f.dz*.5:c.z,nx:f.dx,nz:f.dz,charges:2,fixed:true,box:b.id});}
  }
  // Reggie guards: more on risky lanes; the number grows with the zone and the ascent
  for(const st of stages){
    const z=ZONES[st.zone],stagesInZone=zones[st.zone].stages.length,per=z.reggie*asc.reggie/stagesInZone*.5;
    st.lanes.forEach((lane,l)=>{
      const n=Math.floor(per*ROUTES[lane.style].guard*(lane.style==='risk'?1.2:1)+rand());
      const rows=shuffle(rand,[...Array(Math.max(0,st.rows-1)).keys()].map(r=>r+1));
      for(let q=0;q<n&&q<rows.length;q++){const b=boxes[st.cells[rows[q]][l]];reggies.push({id:reggies.length,box:b.id,zone:b.zone,home:{x:(b.x1+b.x2)/2,z:(b.z1+b.z2)/2},y:b.y2});}
    });
  }
  const summitBox=boxes[stages.at(-1).camp[4]];
  const summit={x:(summitBox.x1+summitBox.x2)/2,y:summitBox.y2,z:(summitBox.z1+summitBox.z2)/2,box:summitBox.id};
  const half2=(GRID*CELL)/2+45;
  const ground=box({id:'ground',x1:-half2,x2:half2,z1:-half2,z2:half2,y1:-10,y2:0,kind:'ground',climb:false});
  const solids=[ground,...boxes,...ledges,...rims];
  const route=(style)=>stages.map(st=>st.cells.map(row=>row[st.lanes.findIndex(l=>l.style===style)]));
  return {seed,ascent:ascentLevel,asc,sym,gloom,boxes,ledges,rims,faces,solids,zones,zoneAt,stages,camps:campInfo,signs,topOfCell,boxAtCell,items,crates,altars,crystals,campfires,decor,hazards,ropes,anchors,hives,reggies,spawn,summit,
    height,limit:half2-5,route,start};
}
