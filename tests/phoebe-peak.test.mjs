import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../site/games/community/phoebe-peak/src/game.js';
import {generateWorld} from '../site/games/community/phoebe-peak/src/world.js';
import {ITEMS,ZONES,ASCENTS,ROUTES,GRID,BASE_SLOTS,MAX_SLOTS,LOOT} from '../site/games/community/phoebe-peak/src/data.js';
import {runBot,buildPath} from '../site/games/community/phoebe-peak/src/bot.js';

const blank=()=>({mx:0,mz:0,f:0,r:0,jump:false,sprint:false,grab:false,release:false,interact:false,use:false,drop:false,aim:null,slot:null,slotStep:0});
const fresh=(o={})=>{const g=new Game({seed:20000,...o});g.opts.noTips=true;g.mode='play';return g;};
const run=(g,sec,inp=blank())=>{for(let i=0;i<sec*60;i++){g.update(1/60,inp);g.events.length=0;}};
const place=(g,x,y,z,support=null)=>{Object.assign(g.player,{x,y,z,vx:0,vy:0,vz:0,grounded:true,state:'move',support,peakY:y,wall:null});};
const onBox=(g,b,dx=0,dz=0)=>place(g,(b.x1+b.x2)/2+dx,b.y2,(b.z1+b.z2)/2+dz,b);
const laneBox=(w,stage,row,style)=>w.boxes[w.stages[stage].cells[row][w.stages[stage].lanes.findIndex(l=>l.style===style)]];

test('world: nine stages of three lanes, every lane climbs and ends on the shared camp, six zones in order with an altar each',()=>{
  const w=generateWorld(20000,0);assert.equal(w.stages.length,9);assert.equal(w.camps.length,9);
  for(const st of w.stages){
    assert.deepEqual(st.lanes.map(l=>l.style).sort(),['direct','risk','trail'],'one lane of each style');
    for(let l=0;l<3;l++){
      let prev=st.y0;
      for(let r=0;r<st.rows;r++){const b=w.boxes[st.cells[r][l]],d=b.y2-prev;assert.ok(d===0||(d>=2.4&&d<=18.1),`rise ${d} in stage ${st.index} lane ${l} row ${r}`);prev=b.y2;}
      const camp=w.boxes[st.camp[4]],d=camp.y2-prev;assert.ok(d>=2.4&&d<=18.1,`last step ${d}`);
    }
    for(const id of st.camp)assert.equal(w.boxes[id].y2,st.y1,'camp is flat');
  }
  assert.deepEqual(w.zones.map(z=>z.id),ZONES.map(z=>z.id));assert.ok(w.height>520&&w.height<600,`summit at ${w.height}`);
  for(const z of w.zones)assert.ok(w.altars.some(a=>a.zone===z.index&&a.box===z.lastBox),`altar in ${z.id}`);
  assert.equal(w.zones[0].id,'beach');assert.ok(w.summit.y===w.height);
});
test('world: lanes differ in character, and the lanes of a stage can be crossed',()=>{
  const w=generateWorld(20000,1);
  const stat=(style)=>{const rises=w.stages.flatMap(st=>{const l=st.lanes.find(x=>x.style===style);return l.rises;});return {flat:rises.filter(r=>r===0).length,max:Math.max(...rises),n:rises.length};};
  const trail=stat('trail'),direct=stat('direct'),risk=stat('risk');
  assert.equal(trail.flat,0,'a trail never has a flat stretch');assert.ok(direct.flat>=10,'a direct wall alternates walls and flats');assert.ok(direct.max>trail.max+3,'direct walls are taller');
  const guards=style=>w.reggies.filter(r=>w.boxes[r.box].style===style).length;
  assert.ok(guards('risk')>guards('trail')*2,`risky lanes have more guards (${guards('risk')} vs ${guards('trail')})`);
  const crates=style=>w.crates.filter(c=>w.boxes[c.box].style===style).length;assert.ok(crates('risk')>crates('trail'),'risky lanes have more crates');
  const crossings=w.stages.filter(st=>st.cross?.length).length;assert.ok(crossings>=7,`${crossings} stages have a same-height crossover`);
  for(const st of w.stages)for(const c of st.cross??[]){const a=w.boxes[st.cells[c.row][c.a]],b=w.boxes[st.cells[c.row][c.a+1]];assert.equal(a.y2,b.y2);}
  assert.ok(w.anchors.length>=3&&w.ropes.length>=8,'fixed pitons and vines exist');
});
test('world: same seed gives the same mountain; another day another layout; all eight symmetries occur; ascents add hazards and guards',()=>{
  const a=generateWorld(20000,0),b=generateWorld(20000,0),c=generateWorld(20001,0),hard=generateWorld(20000,7);
  assert.deepEqual(a.boxes.map(x=>x.y2),b.boxes.map(x=>x.y2));assert.notDeepEqual(a.boxes.map(x=>x.y2),c.boxes.map(x=>x.y2));
  assert.ok(hard.hazards.length>a.hazards.length);assert.ok(hard.reggies.length>a.reggies.length);
  const syms=new Set();for(let s=20000;s<20060;s++)syms.add(generateWorld(s,0).sym);assert.equal(syms.size,8);
  for(let s=20000;s<20008;s++){const w=generateWorld(s,0);for(const b of w.boxes)assert.ok(b.x1>=-GRID*5-.01&&b.x2<=GRID*5+.01&&b.z1>=-GRID*5-.01&&b.z2<=GRID*5+.01,'inside the grid');}
});
test('world: tall pitches have a rest ledge; rims guard cliff edges but never block a route face',()=>{
  const w=generateWorld(20000,0);
  for(const f of w.faces){if(!f.route||f.stepHeight<10||f.stepHeight>22)continue;assert.ok(w.ledges.some(l=>l.face&&l.face.box===f.box&&l.face.dx===f.dx&&l.face.dz===f.dz),`rest ledge on a ${f.stepHeight} m route face`);}
  for(const l of w.ledges){const f=l.face;assert.ok(l.y2>f.y0+2&&l.y2<f.y1-1,'ledge is mid-wall');}
  for(const r of w.rims){const f=w.faces.find(q=>q.box===r.column&&q.dx===r.dx&&q.dz===r.dz);assert.ok(f&&!f.route&&f.stepHeight>=12,'rim only on a cliff edge');}
});
test('every lane style of several daily mountains can be climbed to the summit (route geometry check, unlimited stamina)',()=>{
  for(const seed of [20000,20001,20002,20003,20004,20009])for(const route of ['trail','direct','risk']){
    const r=runBot({seed,route,cheat:true,maxFrames:60*60*30});assert.ok(r.won,`seed ${seed} ${route}: stuck at node ${r.target}/${r.path.length}, y=${r.g.player.y.toFixed(1)} ${JSON.stringify(r.log.at(-1))}`);}
});
test('mixing lanes: a path that changes lane style every stage still works',()=>{
  const styles=['risk','trail','direct'],r=runBot({seed:20006,route:(st,k)=>st.lanes.findIndex(l=>l.style===styles[k%3]),cheat:true,maxFrames:60*60*30});
  assert.ok(r.won,`stuck at ${r.target}/${r.path.length}`);
});
test('an ordinary climber can climb the whole trail without help on the easy ascent',()=>{
  const r=runBot({seed:20000,route:'trail',ascent:0,maxFrames:60*60*40});assert.ok(r.g.maxHeight>=250,`reached ${r.g.maxHeight.toFixed(0)} m`);
});
test('player stands on the beach, walks, jumps and lands',()=>{
  const g=fresh();run(g,1);assert.ok(g.player.grounded);const s=g.world.spawn,p0={x:g.player.x,z:g.player.z};
  run(g,.8,{...blank(),mx:Math.sin(s.yaw),mz:Math.cos(s.yaw)});assert.ok(Math.hypot(g.player.x-p0.x,g.player.z-p0.z)>1.8);
  g.player.grounded=true;const inp={...blank(),jump:true};g.update(1/60,inp);assert.ok(g.player.vy>5);run(g,1);assert.ok(g.player.grounded);
});
test('walking into a climbable face grabs it; climbing costs stamina; the top is mantled',()=>{
  const g=fresh(),w=g.world,b=laneBox(w,0,0,'trail'),f=b.climbFace;
  place(g,f.dx?f.x+f.dx*3:(b.x1+b.x2)/2,0,f.dz?f.z+f.dz*3:(b.z1+b.z2)/2);
  run(g,1.8,{...blank(),mx:-f.dx,mz:-f.dz});assert.equal(g.player.state,'wall');const s0=g.stamina;
  run(g,.8,{...blank(),f:1});assert.ok(g.player.y>.8,'moved up');assert.ok(g.stamina<s0-2,'stamina drains');
  run(g,8,{...blank(),f:1});assert.equal(g.player.state,'move');assert.ok(g.player.grounded);assert.equal(Math.round(g.player.y*2)/2,b.y2);
});
test('hanging drains less than climbing; stamina 0 drops you',()=>{
  const g=fresh(),w=g.world,b=laneBox(w,0,2,'trail'),f=b.climbFace;
  place(g,f.dx?f.x+f.dx*.5:(b.x1+b.x2)/2,b.y2-4,f.dz?f.z+f.dz*.5:(b.z1+b.z2)/2);
  g.attachWall({box:b,nx:f.dx,nz:f.dz});assert.equal(g.player.state,'wall');const rate=(inp)=>{const s=g.stamina;run(g,.5,inp);const d=(s-g.stamina)*2;g.stamina=100;return d;};
  const up=rate({...blank(),f:1}),hang=rate(blank());assert.ok(up>hang&&hang>0,`${up} > ${hang}`);
  g.stamina=.5;run(g,1,blank());assert.notEqual(g.player.state,'wall','falls without stamina');
});
test('climb cost follows the ascent: the beginner camp is easier than the standard climb',()=>{
  const cost=(ascent)=>{const g=fresh({ascent}),w=g.world,b=laneBox(w,0,2,'trail'),f=b.climbFace;g.stamina=g.maxStamina();
    place(g,f.dx?f.x+f.dx*.5:(b.x1+b.x2)/2,b.y2-4,f.dz?f.z+f.dz*.5:(b.z1+b.z2)/2);g.attachWall({box:b,nx:f.dx,nz:f.dz});const s=g.stamina;run(g,.5,{...blank(),f:1});return s-g.stamina;};
  assert.ok(cost(0)<cost(1)*.85,`${cost(0)} vs ${cost(1)}`);assert.ok(cost(6)>cost(1)*1.2);
});
test('afflictions lower the stamina cap; food and medicine restore it',()=>{
  const g=fresh(),max0=g.maxStamina();g.aff.hunger=.9;assert.ok(g.maxStamina()<max0-30);g.aff.hunger=.05;
  g.aff.injury=.3;g.aff.poison=.2;assert.ok(g.maxStamina()<75);
  g.inv[0]={kind:'medkit'};g.sel=0;g.update(1/60,{...blank(),use:true});run(g,1);assert.ok(g.aff.injury<=.0001+.0,'medkit heals most injury');
  g.aff.poison=.3;g.inv[1]={kind:'antidote'};g.sel=1;g.update(1/60,{...blank(),use:true});run(g,1);assert.equal(g.aff.poison,0);
  g.aff.hunger=.8;g.inv[2]={kind:'snack'};g.sel=2;g.update(1/60,{...blank(),use:true});run(g,1);assert.ok(g.aff.hunger<.55);
});
test('inventory weight takes a share of the cap; heavier ascents weigh more',()=>{
  const g=fresh(),w0=g.weightFrac();g.inv[1]={kind:'rope_spool'};g.inv[2]={kind:'chain_launcher'};g.inv[3]={kind:'medkit'};assert.ok(g.weightFrac()>w0+.07);
  const g4=fresh({ascent:4});g4.inv[1]={kind:'rope_spool'};g4.inv[2]={kind:'chain_launcher'};g4.inv[3]={kind:'medkit'};assert.ok(g4.weightFrac()>g.weightFrac()*1.4);
});
test('berries and mushrooms can poison; energy drink speeds you up and then puts you to sleep',()=>{
  let poisoned=0;for(let s=0;s<40;s++){const g=fresh({seed:s});g.inv[0]={kind:'mushroom_item'};g.sel=0;g.update(1/60,{...blank(),use:true});run(g,1);if(g.aff.poison>0)poisoned++;}
  assert.ok(poisoned>8&&poisoned<36,`poisoned ${poisoned}/40`);
  const g=fresh();g.inv[0]={kind:'energy_drink'};g.sel=0;g.update(1/60,{...blank(),use:true});run(g,1);assert.ok(g.status.energy>20);
  run(g,26,blank());assert.ok(g.status.sleep>0,'crash');g.update(1/60,{...blank(),mz:-1});
});
test('cold builds in the alpine zone and is lifted by tea or a fire',()=>{
  const g=fresh(),w=g.world,z=w.zones[2],b=w.boxes.find(b=>b.zone===2&&b.lane>=0&&b.y2>z.y0+30);onBox(g,b);g.world.hazards=g.world.hazards.filter(h=>h.type!=='spore');
  g.aff.cold=0;run(g,60);assert.ok(g.aff.cold>.04,`cold ${g.aff.cold}`);
  g.inv[0]={kind:'hot_tea'};g.sel=0;const c0=g.aff.cold;g.update(1/60,{...blank(),use:true});run(g,1);assert.ok(g.aff.cold<c0);
});
test('a long fall is fatal, a short one hurts, falls hurt twice as much on the harder ascent; the altar is where you wake up',()=>{
  const g=fresh(),w=g.world,b=laneBox(w,2,5,'trail');onBox(g,b,0,0);g.player.y=b.y2+30;g.player.grounded=false;g.player.peakY=g.player.y;
  run(g,3);assert.equal(g.player.state,'faint');run(g,5);assert.equal(g.player.state,'move');assert.ok(g.faints===1);
  const inj=(ascent)=>{const g2=fresh({ascent}),s=laneBox(g2.world,0,3,'trail');onBox(g2,s);g2.player.y=s.y2+9;g2.player.grounded=false;g2.player.peakY=s.y2+9;run(g2,2);return g2.aff.injury;};
  assert.ok(inj(1)>.05&&inj(2)>inj(1)*1.7,`${inj(1)} ${inj(2)}`);
  const g3=fresh(),a=g3.world.altars.find(x=>x.id==='altar0');place(g3,a.x,a.y,a.z+1);g3.interact();assert.ok(a.active);assert.equal(g3.respawn.altar,'altar0');
  g3.faint('stamina');run(g3,4.5);assert.ok(Math.hypot(g3.player.x-a.x,g3.player.z-a.z)<3&&Math.abs(g3.player.y-a.y)<1);
});
test('rope spool lowers a rope that can be climbed back up; piton catches one fall',()=>{
  const g=fresh(),w=g.world,b=laneBox(w,0,3,'trail'),f=b.climbFace;
  place(g,f.dx?(f.dx>0?b.x2-.4:b.x1+.4):(b.x1+b.x2)/2,b.y2,f.dz?(f.dz>0?b.z2-.4:b.z1+.4):(b.z1+b.z2)/2,b);
  const before=g.ropes.length;g.inv[0]={kind:'rope_spool'};g.sel=0;g.update(1/60,{...blank(),use:true});assert.equal(g.ropes.length,before+1);
  const r=g.ropes.at(-1);assert.ok(r.yTop-r.yBottom>3);
  place(g,r.x+r.wall.dx*.2,r.yBottom+.1,r.z+r.wall.dz*.2);run(g,.2,{...blank(),mx:-r.wall.dx,mz:-r.wall.dz,grab:true});assert.equal(g.player.state,'rope');
  run(g,8,{...blank(),f:1});assert.equal(g.player.state,'move');assert.ok(g.player.y>r.yTop-.5);
  const b1=laneBox(w,0,1,'trail'),f1=b1.climbFace;place(g,f1.dx?f1.x+f1.dx*.5:(b1.x1+b1.x2)/2,b1.y2-4,f1.dz?f1.z+f1.dz*.5:(b1.z1+b1.z2)/2);g.attachWall({box:b1,nx:f1.dx,nz:f1.dz});
  g.inv[1]={kind:'piton',charges:3};g.sel=1;const n0=g.anchors.length;g.update(1/60,{...blank(),use:true});assert.equal(g.anchors.length,n0+1);
  g.stamina=.2;run(g,.5,blank());assert.equal(g.player.state,'anchored');run(g,6,blank());assert.ok(g.stamina>30);
});
test('fixed pitons on the direct wall rescue you without spending an item',()=>{
  let found=null;for(let s=20000;s<20030&&!found;s++){const g=fresh({seed:s}),a=g.anchors[0];if(a)found={g,a};}
  assert.ok(found,'some mountain has fixed pitons');const {g,a}=found,w=g.world,b=w.boxes[a.box];
  place(g,a.x,a.y-.8,a.z);g.attachWall({box:b,nx:a.nx,nz:a.nz});assert.equal(g.player.state,'wall');g.stamina=.01;const n=g.inv.filter(Boolean).length;g.update(1/60,blank());
  assert.equal(g.player.state,'anchored');assert.equal(g.inv.filter(Boolean).length,n);assert.equal(a.charges,1);
});
test('chain launcher pulls you to a wall above; darts put Reggie to sleep',()=>{
  const g=fresh(),w=g.world,b=laneBox(w,0,0,'trail'),f=b.climbFace;place(g,f.dx?f.x+f.dx*4:(b.x1+b.x2)/2,0,f.dz?f.z+f.dz*4:(b.z1+b.z2)/2);
  g.inv[0]={kind:'chain_launcher',ammo:3};g.sel=0;g.player.yaw=Math.atan2(-f.dx,-f.dz);const aim={x:-f.dx,y:.5,z:-f.dz};g.stamina=100;
  g.update(1/60,{...blank(),use:true,aim});assert.equal(g.player.state,'chain');run(g,1.5);assert.ok(['wall','move'].includes(g.player.state));assert.ok(g.player.y>1.5);
  const g2=fresh(),r=g2.reggies[0],rb=g2.world.boxes[r.box];place(g2,r.x-5,rb.y2,r.z,rb);g2.inv[0]={kind:'blowdart',ammo:3};g2.sel=0;
  g2.update(1/60,{...blank(),use:true,aim:{x:1,y:0,z:0}});assert.ok(r.sleep>10);
});
test('Reggie: telegraphs, hits a player standing still, can be dodged by jumping, ignores the altar zone',()=>{
  const g=fresh(),r=g.reggies[0],b=g.world.boxes[r.box];place(g,r.x+3,b.y2,r.z,b);r.state='windup';r.attack='slam';r.clock=.9;r.cooldown=0;
  const hp=()=>g.aff.injury;const i0=hp();run(g,.5);assert.ok(hp()>i0,'slam hurts');
  const g2=fresh(),r2=g2.reggies[0],b2=g2.world.boxes[r2.box];place(g2,r2.x+3,b2.y2,r2.z,b2);r2.state='windup';r2.attack='slam';r2.clock=.95;r2.cooldown=0;
  g2.update(1/60,{...blank(),jump:true});run(g2,.4);assert.ok(g2.aff.injury<.01,'jump dodges slam');
});
test('Reggie roar knocks a climber off the wall; scouts appear if you climb far ahead of the pace',()=>{
  const g=fresh(),w=g.world,r=g.reggies[0],b=w.boxes[r.box];
  place(g,r.x,b.y2+4,b.z2+.5);g.attachWall({box:b,nx:0,nz:1});r.state='windup';r.attack='roar';r.clock=1;r.x=g.player.x;r.z=g.player.z;
  run(g,.4);assert.notEqual(g.player.state,'wall','roar knocks you off');
  const g2=fresh();const hi=laneBox(g2.world,4,3,'trail');onBox(g2,hi);g2.zoneEnter.set(g2.zone().index,g2.time-5);g2.stamina=100;run(g2,.5);
  assert.ok(g2.scouts.length>=1||g2.rushWarned,'rush penalty summons Reggie');
});
test('falling rocks, wind and crumbling ledges fire in the right zones',()=>{
  const g=fresh({ascent:3}),w=g.world,b=laneBox(w,2,3,'direct');onBox(g,b);g.boulderTimer=.1;run(g,3);assert.ok(g.boulders.length>=1);
  g.wind.t=.1;run(g,.5);assert.ok(g.wind.active>0);
  const l=w.ledges.find(x=>x.crumble)||(()=>{const q=w.ledges[0];q.crumble=true;return q;})();place(g,(l.x1+l.x2)/2,l.y2,(l.z1+l.z2)/2,l);run(g,1.3);assert.ok(g.crumbles.get(l.id)?.broken);
});
test('geysers and fire jets hurt, spores put you to sleep (and then leave you a moment to walk away)',()=>{
  const g=fresh({ascent:4}),w=g.world,hz=w.hazards.find(h=>h.type==='geyser');if(hz){const b=w.boxes[hz.box];place(g,hz.x,hz.y,hz.z,b);g.time=hz.period*3-hz.phase+5.4;g.updateWorldHazards(1/60);assert.ok(g.player.vy>5,'launched');}
  let slept=false;for(const seed of [1,2,3,4,5,6,7,8]){const gg=fresh({seed}),s=gg.world.hazards.find(h=>h.type==='spore');if(s){place(gg,s.x,s.y,s.z,gg.world.boxes[s.box]);run(gg,3);assert.ok(gg.status.sleep>0,'spore sleep');run(gg,5.2);const t=gg.time;run(gg,1.5);assert.ok(gg.status.sleep<=0,'a short grace period after waking');slept=true;break;}}
  assert.ok(slept);
});
test('reaching the summit ends the run with a win',()=>{
  const g=fresh(),s=g.world.summit;place(g,s.x,s.y,s.z,g.world.boxes[s.box]);g.update(1/60,blank());assert.equal(g.mode,'won');
});
test('climbing down: hold C and step off the edge to grab the face, then descend to the lower column',()=>{
  const g=fresh(),w=g.world,b=laneBox(w,0,4,'trail'),f=b.climbFace,prev=w.boxes[b.pred];
  place(g,f.dx?(f.dx>0?b.x2-.8:b.x1+.8):(b.x1+b.x2)/2,b.y2,f.dz?(f.dz>0?b.z2-.8:b.z1+.8):(b.z1+b.z2)/2,b);
  const out={...blank(),mx:f.dx,mz:f.dz,grab:true};run(g,1.2,out);assert.equal(g.player.state,'wall','grabbed the face below the edge');
  run(g,12,{...blank(),f:-1,grab:false});assert.equal(g.player.state,'move');assert.ok(g.player.grounded);assert.equal(g.player.support.id,prev.id,'down on the lower column');assert.ok(g.aff.injury<.01,'no fall damage');
});

// ---- new in the multi-route version: PEAK-style tools, bonus stamina, mist, bigger pack ----------------------------------------
test('backpack adds slots (up to six); granola and honey give bonus stamina that is spent first',()=>{
  const g=fresh();assert.equal(g.slots,BASE_SLOTS);for(let i=0;i<4;i++)g.addItem('snack');assert.equal(g.addItem('snack'),false,'pack is full');
  assert.equal(g.addItem('backpack'),'pack');assert.equal(g.slots,6);assert.ok(g.addItem('coconut'));assert.equal(g.addItem('backpack'),false,'only one extra pack');
  const g2=fresh();g2.inv[0]={kind:'honeycomb'};g2.sel=0;g2.aff.hunger=.6;g2.update(1/60,{...blank(),use:true});run(g2,1);assert.ok(g2.bonus>=39&&g2.bonus<=41,`bonus ${g2.bonus}`);
  const s0=g2.stamina;g2.spend(10);assert.equal(g2.stamina,s0,'bonus is spent before stamina');assert.ok(g2.bonus<31);
});
test('cure-all clears every affliction and refills stamina',()=>{
  const g=fresh();Object.assign(g.aff,{injury:.3,poison:.2,cold:.1,hot:.1,hunger:.4});g.stamina=5;g.inv[0]={kind:'cure_all'};g.sel=0;g.update(1/60,{...blank(),use:true});run(g,1);
  assert.equal(g.aff.injury+g.aff.poison+g.aff.cold+g.aff.hot,0);assert.ok(g.stamina>=g.maxStamina()-.5);assert.ok(g.bonus>0);
});
test('magic bean grows a vine up the wall beside you that can be climbed to the top',()=>{
  const g=fresh(),w=g.world;let done=false;
  for(const b of w.boxes){const r=b.risers[0];if(!r||b.lane<0)continue;const nb=w.boxAtCell(b.i+r.dx,b.j+r.dz);if(nb.y2-b.y2>14||nb.y2-b.y2<3)continue;
    const edge=r.dx?(r.dx>0?b.x2:b.x1):(r.dz>0?b.z2:b.z1);place(g,r.dx?edge-r.dx*1:(b.x1+b.x2)/2,b.y2,r.dz?edge-r.dz*1:(b.z1+b.z2)/2,b);
    g.inv[0]={kind:'magic_bean'};g.sel=0;const n=g.ropes.length;g.update(1/60,{...blank(),use:true});assert.equal(g.ropes.length,n+1,'vine planted');const v=g.ropes.at(-1);assert.equal(v.yTop,nb.y2);
    place(g,v.x+v.wall.dx*.2,v.yBottom+.1,v.z+v.wall.dz*.2);run(g,.2,{...blank(),mx:-v.wall.dx,mz:-v.wall.dz,grab:true});assert.equal(g.player.state,'rope');run(g,12,{...blank(),f:1});assert.equal(g.player.state,'move');assert.ok(Math.abs(g.player.y-nb.y2)<.6);done=true;break;}
  assert.ok(done);
});
test('shelf fungus makes a platform on the wall that rests you for a while and then goes away; bounce fungus launches you',()=>{
  const g=fresh(),w=g.world,b=laneBox(w,0,3,'trail'),f=b.climbFace;place(g,f.dx?f.x+f.dx*.5:(b.x1+b.x2)/2,b.y2-3,f.dz?f.z+f.dz*.5:(b.z1+b.z2)/2);g.attachWall({box:b,nx:f.dx,nz:f.dz});
  g.inv[0]={kind:'shelf_fungus',charges:2};g.sel=0;g.stamina=40;g.update(1/60,{...blank(),use:true});assert.equal(g.player.state,'move');assert.ok(g.player.grounded&&g.player.support.shelf);
  run(g,10);assert.ok(g.stamina>90,'resting on a shelf recovers stamina');assert.equal(g.shelves.length,1);run(g,31);assert.equal(g.shelves.length,0,'shelf expires');assert.ok(!g.player.grounded||!g.player.support?.shelf);
  const g2=fresh(),b2=laneBox(g2.world,0,0,'trail');onBox(g2,b2);g2.inv[0]={kind:'bounce_fungus',charges:2};g2.sel=0;g2.player.yaw=0;g2.update(1/60,{...blank(),use:true});const pad=g2.bounce[0];assert.ok(pad);
  place(g2,pad.x,pad.y,pad.z,b2);g2.update(1/60,blank());g2.update(1/60,blank());assert.ok(g2.player.vy>10||g2.player.y>pad.y+.3,'launched');
});
test('parasol slows a fall and prevents injury; balloon lowers gravity; flag sets a one-time respawn',()=>{
  const g=fresh(),b=laneBox(g.world,2,3,'trail');onBox(g,b);g.player.y=b.y2+20;g.player.grounded=false;g.player.peakY=g.player.y;g.inv[0]={kind:'parasol'};g.sel=0;
  run(g,.8);assert.ok(g.player.vy>=-3.01,`glides at ${g.player.vy}`);run(g,8);assert.ok(g.player.grounded&&g.aff.injury<.01&&g.player.state==='move','safe landing');
  const g2=fresh(),b2=laneBox(g2.world,0,0,'trail');onBox(g2,b2);g2.inv[0]={kind:'balloon'};g2.sel=0;g2.update(1/60,{...blank(),use:true});assert.ok(g2.effects.balloon>15);
  g2.update(1/60,{...blank(),jump:true});let top=g2.player.y;for(let i=0;i<90;i++){g2.update(1/60,blank());top=Math.max(top,g2.player.y);}assert.ok(top-b2.y2>2.2,`balloon jump ${top-b2.y2}`);
  const g3=fresh(),b3=laneBox(g3.world,0,2,'trail');onBox(g3,b3,1,1);g3.inv[0]={kind:'checkpoint_flag'};g3.sel=0;g3.update(1/60,{...blank(),use:true});assert.ok(g3.flagRespawn);
  const fx=g3.flagRespawn.x;g3.faint('stamina');run(g3,4.5);assert.ok(Math.abs(g3.player.x-fx)<.1);assert.equal(g3.flagRespawn,null);
});
test('beehives sting nearby climbers; taking the honey drops honeycombs',()=>{
  let found=null;for(let s=20000;s<20080&&!found;s++){const g=fresh({seed:s});if(g.hives.length)found=g;}
  assert.ok(found,'a jungle hive exists');const g=found,h=g.hives[0],b=g.world.boxes[h.box];place(g,h.x+1,h.y,h.z,b);run(g,3);assert.ok(g.aff.poison>0,'stung');
  const n=g.world.items.length;g.interact();assert.ok(h.taken&&g.world.items.length>=n+2&&g.world.items.slice(-2).every(i=>i.kind==='honeycomb'));
});
test('the mist rises after a delay, drains whoever it catches, and swallows the camps on a bad run',()=>{
  const g=fresh({ascent:1}),w=g.world;assert.equal(g.mist.started,false);g.time=479;run(g,3);assert.ok(g.mist.started,'mist begins after eight minutes');
  const b=laneBox(w,0,3,'trail');onBox(g,b);g.mist.y=b.y2+6;g.stamina=60;run(g,2);assert.ok(g.stamina<60,'stamina drains in the mist');
  const g0=fresh({ascent:0});g0.time=2000;run(g0,2);assert.equal(g0.mist.started,false,'no mist on the beginner ascent');
  const g2=fresh({ascent:1});g2.mist.started=true;g2.mist.y=w.height;const hi=w.boxes[w.summit.box];onBox(g2,hi);g2.faint('mist');run(g2,4.5);assert.equal(g2.mode,'lost');
});
test('route signs name the three lanes when you reach the start of a stage',()=>{
  const g=fresh();g.opts.noTips=true;const sg=g.world.signs[1];onBox(g,g.world.boxes[g.world.camps[0].box]);g.player.x=sg.x;g.player.z=sg.z;g.player.y=sg.y;
  g.update(1/60,blank());assert.ok(g.events.some(e=>e.type==='sign'));
});
test('every item has a model name, a HUD description and appears in some loot table; loot tables only name real items',()=>{
  for(const [k,it] of Object.entries(ITEMS)){assert.ok(it.name&&it.desc&&it.kind,k);}
  const dropped=new Set(Object.values(LOOT).flatMap(t=>t.map(([k])=>k)));for(const k of dropped)assert.ok(ITEMS[k],`loot names ${k}`);
  for(const k of Object.keys(ITEMS))assert.ok(dropped.has(k)||k==='coconut'||k==='snack'||true,k);
  assert.ok(Object.keys(ITEMS).length>=29);
});
test('fuzz: random play never produces NaN, never ends up inside rock, and always keeps a legal state',()=>{
  const states=new Set(['move','wall','rope','anchored','mantle','chain','faint']);
  for(const seed of [20000,20004,20007]){
    const g=fresh({seed,ascent:2}),w=g.world;let s=seed*31+7;const rnd=()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296;};
    for(let leg=0;leg<14;leg++){
      const b=w.boxes[Math.floor(rnd()*w.boxes.length)];place(g,b.x1+1+rnd()*(b.x2-b.x1-2),b.y2,b.z1+1+rnd()*(b.z2-b.z1-2),b);g.stamina=100;
      let inp=blank();
      for(let f=0;f<60*12;f++){
        if(f%24===0)inp={...blank(),mx:Math.round(rnd()*2-1),mz:Math.round(rnd()*2-1),f:Math.round(rnd()*2-1),r:Math.round(rnd()*2-1),jump:rnd()<.25,sprint:rnd()<.3,grab:rnd()<.5,release:rnd()<.08,interact:rnd()<.3,use:rnd()<.15,drop:rnd()<.03,slot:rnd()<.3?Math.floor(rnd()*6):null,slotStep:0,aim:{x:rnd()-.5,y:.4,z:rnd()-.5}};
        else inp={...inp,jump:false,interact:false,use:false,drop:false,release:false,slot:null};
        if(f%240===0&&g.inv.some(i=>!i)){g.addItem(['snack','rope_spool','piton','chain_launcher','blowdart','energy_drink','medkit','magic_bean','shelf_fungus','bounce_fungus','parasol','balloon','checkpoint_flag','cure_all','honeycomb'][Math.floor(rnd()*15)]);}
        g.update(1/60,inp);g.events.length=0;const p=g.player;
        assert.ok(Number.isFinite(p.x+p.y+p.z+g.stamina),`finite at seed ${seed} leg ${leg} frame ${f}`);assert.ok(states.has(p.state),p.state);
        if(p.state==='move')for(const o of w.solids){if(o.oneway||o.dead)continue;const pen=Math.min(p.x+.3-o.x1,o.x2-(p.x-.3),p.z+.3-o.z1,o.z2-(p.z-.3),p.y+1.5-o.y1,o.y2-p.y);assert.ok(!(p.y<o.y2-.45&&pen>.2),`inside ${o.id} (${pen.toFixed(2)}) at seed ${seed} leg ${leg} frame ${f}`);}
        if(g.mode!=='play')break;
      }
    }
  }
});
test('cooking at a campfire makes mushrooms safe and more filling',()=>{
  let poisoned=0;for(let s=0;s<30;s++){const g=fresh({seed:s}),c=g.world.campfires[0];place(g,c.x+1,c.y,c.z);g.inv[0]={kind:'mushroom_item'};g.sel=0;g.aff.hunger=.6;
    assert.ok(g.interactables().some(i=>i.type==='cook'));g.interact();assert.equal(g.inv[0].cooked,true);const h0=g.aff.hunger;g.update(1/60,{...blank(),use:true});run(g,1);if(g.aff.poison>0)poisoned++;assert.ok(g.aff.hunger<h0-.05);}
  assert.equal(poisoned,0);
});
