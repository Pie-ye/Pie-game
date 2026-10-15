import {PLAYER} from './data.js';
// Axis-aligned collision against the world's solids. The player is a box of radius r and height h standing at (x,y,z).
const EPS=1e-3;
export const overlaps=(p,b,r=PLAYER.radius,h=PLAYER.height)=>p.x+r>b.x1+EPS&&p.x-r<b.x2-EPS&&p.z+r>b.z1+EPS&&p.z-r<b.z2-EPS&&p.y+h>b.y1+EPS&&p.y<b.y2-EPS;
export const inside=(x,y,z,b)=>x>b.x1&&x<b.x2&&y>b.y1&&y<b.y2&&z>b.z1&&z<b.z2;
export const GRAVITY=-24;

// Move the player by (dx,dy,dz), resolving each axis separately. Returns contact info.
export function moveBody(world,p,dx,dy,dz){
  const r=PLAYER.radius,h=PLAYER.height,hit={x:null,z:null,landed:null,ceiling:null};
  const solids=world.solids,steps=Math.max(1,Math.ceil(Math.max(Math.abs(dx),Math.abs(dy),Math.abs(dz))/.2));
  const sx=dx/steps,sy=dy/steps,sz=dz/steps;
  for(let s=0;s<steps;s++){
    if(sx){p.x+=sx;for(const b of solids){if(b.oneway||!overlaps(p,b))continue;
      if(p.y+.34>=b.y2&&!hit.stepFail&&!blockedAbove(world,p,b)){p.y=b.y2;continue;}   // step up small lips
      p.x=sx>0?b.x1-r-EPS:b.x2+r+EPS;hit.x={box:b,nx:sx>0?-1:1};}}
    if(sz){p.z+=sz;for(const b of solids){if(b.oneway||!overlaps(p,b))continue;
      if(p.y+.34>=b.y2&&!blockedAbove(world,p,b)){p.y=b.y2;continue;}
      p.z=sz>0?b.z1-r-EPS:b.z2+r+EPS;hit.z={box:b,nz:sz>0?-1:1};}}
    if(sy){const prev=p.y;p.y+=sy;
      for(const b of solids){
        if(b.oneway){if(sy<0&&prev>=b.y2-.02&&p.x+r>b.x1&&p.x-r<b.x2&&p.z+r>b.z1&&p.z-r<b.z2&&p.y<b.y2){p.y=b.y2;hit.landed=b;}continue;}
        if(!overlaps(p,b))continue;
        if(sy<0){p.y=b.y2;hit.landed=b;}else{p.y=b.y1-h-EPS;hit.ceiling=b;}}}
  }
  return hit;
}
function blockedAbove(world,p,under){const q={x:p.x,y:under.y2,z:p.z};return world.solids.some(b=>b!==under&&!b.oneway&&overlaps(q,b));}
// Highest solid top beneath (x,z) that is at or below yMax (+ tolerance).
export function supportAt(world,x,z,yMax,r=PLAYER.radius*.8){
  let best=-Infinity,box=null;
  for(const b of world.solids)if(x+r>b.x1&&x-r<b.x2&&z+r>b.z1&&z-r<b.z2&&b.y2<=yMax+.06&&b.y2>best){best=b.y2;box=b;}
  return {y:best,box};
}
export function pointSolid(world,x,y,z,climbOnly=false){for(const b of world.solids){if(b.oneway)continue;if(climbOnly&&!b.climb)continue;if(inside(x,y,z,b))return b;}return null;}
// Slab ray test against solid AABBs. Returns nearest {t,point,normal,box} or null.
export function rayCast(world,o,d,maxT){
  let best=null;
  for(const b of world.solids){
    if(b.oneway&&false)continue;
    let tmin=0,tmax=maxT,nx=0,ny=0,nz=0;
    for(const [ax,lo,hi] of [['x',b.x1,b.x2],['y',b.y1,b.y2],['z',b.z1,b.z2]]){
      const oa=o[ax],da=d[ax];
      if(Math.abs(da)<1e-9){if(oa<lo||oa>hi){tmin=Infinity;break;}continue;}
      let t1=(lo-oa)/da,t2=(hi-oa)/da,n=-1;if(t1>t2){[t1,t2]=[t2,t1];n=1;}
      if(t1>tmin){tmin=t1;nx=ax==='x'?n:0;ny=ax==='y'?n:0;nz=ax==='z'?n:0;}
      tmax=Math.min(tmax,t2);if(tmin>tmax){tmin=Infinity;break;}
    }
    if(tmin!==Infinity&&tmin>0&&tmin<=maxT&&(!best||tmin<best.t))best={t:tmin,point:{x:o.x+d.x*tmin,y:o.y+d.y*tmin,z:o.z+d.z*tmin},normal:{x:nx,y:ny,z:nz},box:b};
  }
  return best;
}
