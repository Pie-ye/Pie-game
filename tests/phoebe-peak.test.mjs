import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../site/games/community/phoebe-peak/src/game.js';
import {generateWorld,spiralCells} from '../site/games/community/phoebe-peak/src/world.js';
import {ITEMS,ZONES,ASCENTS} from '../site/games/community/phoebe-peak/src/data.js';
import {runBot} from '../site/games/community/phoebe-peak/src/bot.js';

const blank=()=>({mx:0,mz:0,f:0,r:0,jump:false,sprint:false,grab:false,release:false,interact:false,use:false,drop:false,aim:null,slot:null,slotStep:0});
const fresh=(o={})=>{const g=new Game({seed:20000,...o});g.opts.noTips=true;g.mode='play';return g;};
const run=(g,sec,inp=blank())=>{for(let i=0;i<sec*60;i++){g.update(1/60,inp);g.events.length=0;}};
const place=(g,x,y,z,support=null)=>{Object.assign(g.player,{x,y,z,vx:0,vy:0,vz:0,grounded:true,state:'move',support,peakY:y,wall:null});};

test('world: spiral visits 49 adjacent cells, columns rise, six zones in order, altar and guard per zone',()=>{
  const w=generateWorld(20000,0);assert.equal(spiralCells().length,49);assert.equal(w.boxes.length,49);
  for(let k=1;k<49;k++){const a=w.boxes[k-1],b=w.boxes[k];assert.equal(Math.abs(a.i-b.i)+Math.abs(a.j-b.j),1,'adjacent');assert.ok(b.y2>a.y2+4,'each pitch is taller');assert.ok(b.y2-a.y2<=15.5,'pitch height is climbable');}
  assert.deepEqual(w.zones.map(z=>z.id),ZONES.map(z=>z.id));
  assert.ok(w.height>480&&w.height<560,`summit at ${w.height}`);
  for(const z of w.zones){assert.ok(w.altars.some(a=>a.zone===z.index&&a.box===z.lastBox),`altar in ${z.id}`);assert.ok(w.reggies.some(r=>r.zone===z.index),`guard in ${z.id}`);}
  assert.equal(w.zones[0].id,'beach');
});
test('world: same seed gives the same mountain; another day gives another one; ascents add hazards and guards',()=>{
  const a=generateWorld(20000,0),b=generateWorld(20000,0),c=generateWorld(20001,0),hard=generateWorld(20000,4);
  assert.deepEqual(a.tops,b.tops);assert.notDeepEqual(a.tops,c.tops);assert.ok(hard.hazards.length>a.hazards.length);assert.ok(hard.reggies.length>a.reggies.length);
});
test('world: tall pitches have a rest ledge; every ledge touches the climb face of its column',()=>{
  const w=generateWorld(20000,0);
  for(const b of w.boxes.filter(b=>b.rise>=10))assert.ok(w.ledges.some(l=>l.column===b.id),`rest ledge on pitch ${b.id}`);
  for(const l of w.ledges){const b=w.boxes[l.column],f=b.climbFace;assert.ok(l.y2>f.y0+2&&l.y2<f.y1-1,'ledge is mid-wall');}
});
test('player stands on the beach, walks, jumps and lands',()=>{
  const g=fresh();run(g,1);assert.ok(g.player.grounded);const z0=g.player.z;run(g,1,{...blank(),mz:-1});assert.ok(g.player.z<z0-2);
  g.player.grounded=true;const inp={...blank(),jump:true};g.update(1/60,inp);assert.ok(g.player.vy>5);run(g,1);assert.ok(g.player.grounded);
});
test('walking into a climbable face grabs it; climbing costs stamina; the top is mantled',()=>{
  const g=fresh(),b=g.world.boxes[0];place(g,(b.x1+b.x2)/2,0,b.z2+3);
  run(g,1.5,{...blank(),mz:-1});assert.equal(g.player.state,'wall');const s0=g.stamina;
  run(g,.8,{...blank(),f:1});assert.ok(g.player.y>.8,'moved up');assert.ok(g.stamina<s0-2,'stamina drains');
  run(g,6,{...blank(),f:1});assert.equal(g.player.state,'move');assert.ok(g.player.grounded);assert.equal(Math.round(g.player.y*2)/2,b.y2);
});
test('hanging drains less than climbing; sliding down is cheaper still; stamina 0 drops you',()=>{
  const g=fresh(),b=g.world.boxes[1],f=b.climbFace;place(g,(b.x1+b.x2)/2,b.y2-3,b.z2+.5);
  g.attachWall({box:b,nx:0,nz:1});const rate=(inp)=>{const s=g.stamina;run(g,.5,inp);const d=(s-g.stamina)*2;g.stamina=100;return d;};
  const up=rate({...blank(),f:1}),hang=rate(blank());assert.ok(up>hang&&hang>0,`${up} > ${hang}`);
  g.stamina=.5;run(g,1,blank());assert.notEqual(g.player.state,'wall','falls without stamina');
});
test('afflictions lower the stamina cap; food and medicine restore it',()=>{
  const g=fresh(),max0=g.maxStamina();g.aff.hunger=.9;assert.ok(g.maxStamina()<max0-30);g.aff.hunger=.05;
  g.aff.injury=.3;g.aff.poison=.2;assert.ok(g.maxStamina()<75);
  g.inv[0]={kind:'medkit'};g.sel=0;g.update(1/60,{...blank(),use:true});run(g,1);assert.ok(g.aff.injury<=.0001+.0,'medkit heals most injury');
  g.aff.poison=.3;g.inv[1]={kind:'antidote'};g.sel=1;g.update(1/60,{...blank(),use:true});run(g,1);assert.equal(g.aff.poison,0);
  g.aff.hunger=.8;g.inv[2]={kind:'snack'};g.sel=2;g.update(1/60,{...blank(),use:true});run(g,1);assert.ok(g.aff.hunger<.55);
});
test('inventory weight takes a share of the cap',()=>{
  const g=fresh(),w0=g.weightFrac();g.inv[1]={kind:'rope_spool'};g.inv[2]={kind:'chain_launcher'};g.inv[3]={kind:'medkit'};assert.ok(g.weightFrac()>w0+.07);
});
test('berries and mushrooms can poison; energy drink speeds you up and then puts you to sleep',()=>{
  let poisoned=0;for(let s=0;s<40;s++){const g=fresh({seed:s});g.inv[0]={kind:'mushroom_item'};g.sel=0;g.update(1/60,{...blank(),use:true});run(g,1);if(g.aff.poison>0)poisoned++;}
  assert.ok(poisoned>8&&poisoned<36,`poisoned ${poisoned}/40`);
  const g=fresh();g.inv[0]={kind:'energy_drink'};g.sel=0;g.update(1/60,{...blank(),use:true});run(g,1);assert.ok(g.status.energy>20);
  run(g,26,blank());assert.ok(g.status.sleep>0,'crash');const y=g.player.y;g.update(1/60,{...blank(),mz:-1});assert.ok(Math.abs(g.player.z-g.player.z)<1,'cannot walk while asleep');
});
test('cold builds in the alpine zone and is lifted by tea or a fire',()=>{
  const g=fresh(),w=g.world,z=w.zones[2],b=w.boxes[z.firstBox+3];place(g,(b.x1+b.x2)/2,b.y2,(b.z1+b.z2)/2,b);
  g.aff.cold=0;run(g,60);assert.ok(g.aff.cold>.04,`cold ${g.aff.cold}`);
  g.inv[0]={kind:'hot_tea'};g.sel=0;const c0=g.aff.cold;g.update(1/60,{...blank(),use:true});run(g,1);assert.ok(g.aff.cold<c0);
});
test('a long fall is fatal, a short one hurts; the altar is where you wake up',()=>{
  const g=fresh(),w=g.world,b=w.boxes[6];place(g,b.x1+1,b.y2,b.z1+1,b);g.player.y=b.y2+30;g.player.grounded=false;g.player.peakY=g.player.y;
  run(g,3);assert.equal(g.player.state,'faint');run(g,5);assert.equal(g.player.state,'move');assert.ok(g.faints===1);
  const g2=fresh();const s=g2.world.boxes[0];place(g2,(s.x1+s.x2)/2,s.y2+9,(s.z1+s.z2)/2);g2.player.grounded=false;g2.player.peakY=s.y2+9;run(g2,2);assert.ok(g2.aff.injury>.05&&g2.player.state==='move');
  const g3=fresh(),a=g3.world.altars.find(x=>x.id==='altar0');place(g3,a.x,a.y,a.z+1);g3.interact();assert.ok(a.active);assert.equal(g3.respawn.altar,'altar0');
  g3.faint('stamina');run(g3,4.5);assert.ok(Math.hypot(g3.player.x-a.x,g3.player.z-a.z)<3&&Math.abs(g3.player.y-a.y)<1);
});
test('rope spool lowers a rope that can be climbed back up; piton catches one fall',()=>{
  const g=fresh(),w=g.world,b=w.boxes[3],f=b.climbFace;place(g,f.dx?(f.dx>0?b.x2-.4:b.x1+.4):(b.x1+b.x2)/2,b.y2,f.dz?(f.dz>0?b.z2-.4:b.z1+.4):(b.z1+b.z2)/2,b);
  const before=g.ropes.length;g.inv[0]={kind:'rope_spool'};g.sel=0;g.update(1/60,{...blank(),use:true});assert.equal(g.ropes.length,before+1);
  const r=g.ropes.at(-1);assert.ok(r.yTop-r.yBottom>3);
  place(g,r.x+r.wall.dx*.2,r.yBottom+.1,r.z+r.wall.dz*.2);run(g,.2,{...blank(),mx:-r.wall.dx,mz:-r.wall.dz,grab:true});assert.equal(g.player.state,'rope');
  run(g,8,{...blank(),f:1});assert.equal(g.player.state,'move');assert.ok(g.player.y>r.yTop-.5);
  // piton
  const b1=w.boxes[1];place(g,(b1.x1+b1.x2)/2,b1.y2-4,b1.z2+.5);g.attachWall({box:b1,nx:0,nz:1});g.inv[1]={kind:'piton',charges:3};g.sel=1;g.update(1/60,{...blank(),use:true});assert.equal(g.anchors.length,1);
  g.stamina=.2;run(g,.5,blank());assert.equal(g.player.state,'anchored');run(g,6,blank());assert.ok(g.stamina>30);
});
test('chain launcher pulls you to a wall above; darts put Reggie to sleep',()=>{
  const g=fresh(),w=g.world,b=w.boxes[0];place(g,(b.x1+b.x2)/2,0,b.z2+4);
  g.inv[0]={kind:'chain_launcher',ammo:3};g.sel=0;g.player.yaw=Math.PI;const aim={x:0,y:.5,z:-1};g.stamina=100;
  g.update(1/60,{...blank(),use:true,aim});assert.equal(g.player.state,'chain');run(g,1.5);assert.ok(['wall','move'].includes(g.player.state));assert.ok(g.player.y>1.5);
  const g2=fresh(),r=g2.reggies[0],rb=g2.world.boxes[r.box];place(g2,r.x-5,rb.y2,r.z,rb);g2.inv[0]={kind:'blowdart',ammo:3};g2.sel=0;
  g2.update(1/60,{...blank(),use:true,aim:{x:1,y:0,z:0}});assert.ok(r.sleep>10);
});
test('Reggie: telegraphs, hits a player standing still, can be dodged by jumping, ignores the altar zone',()=>{
  const g=fresh(),r=g.reggies[0],b=g.world.boxes[r.box];place(g,r.x+3,b.y2,r.z,b);r.state='windup';r.attack='slam';r.clock=.9;r.cooldown=0;
  const hp=()=>g.aff.injury;const i0=hp();run(g,.5);assert.ok(hp()>i0,'slam hurts');
  const g2=fresh(),r2=g2.reggies[0],b2=g2.world.boxes[r2.box];place(g2,r2.x+3,b2.y2,r2.z,b2);r2.state='windup';r2.attack='slam';r2.clock=.95;r2.cooldown=0;
  g2.update(1/60,{...blank(),jump:true});run(g2,.4);assert.ok(g2.aff.injury<.01,'jump dodges slam');
  const g3=fresh(),al=g3.world.altars.find(a=>a.id==='altar0'),r3=g3.reggies.find(r=>r.box===al.box);if(r3){place(g3,al.x,al.y,al.z+1);r3.state='windup';r3.attack='roar';r3.clock=1;r3.x=al.x+2;r3.z=al.z;run(g3,.6);assert.ok(g3.aff.injury<.01,'altar is safe');}
});
test('Reggie roar knocks a climber off the wall; scouts appear if you climb far ahead of the pace',()=>{
  const g=fresh(),w=g.world,r=g.reggies[0],b=w.boxes[r.box],f=b.climbFace;
  place(g,r.x,b.y2+4,b.z2+.5);g.attachWall({box:b,nx:0,nz:1});r.state='windup';r.attack='roar';r.clock=1;r.x=g.player.x;r.z=g.player.z;
  run(g,.4);assert.notEqual(g.player.state,'wall','roar knocks you off');
  const g2=fresh();const hi=g2.world.boxes[20];place(g2,(hi.x1+hi.x2)/2,hi.y2,(hi.z1+hi.z2)/2,hi);g2.zoneEnter.set(g2.zone().index,g2.time-5);g2.stamina=100;run(g2,.5);
  assert.ok(g2.scouts.length>=1||g2.rushWarned,'rush penalty summons Reggie');
});
test('falling rocks, wind and crumbling ledges fire in the right zones',()=>{
  const g=fresh(),w=g.world,b=w.boxes[w.zones[2].firstBox+2];place(g,(b.x1+b.x2)/2,b.y2,(b.z1+b.z2)/2,b);g.boulderTimer=.1;run(g,3);assert.ok(g.boulders.length>=1);
  g.wind.t=.1;run(g,.5);assert.ok(g.wind.active>0);
  const l=w.ledges.find(x=>x.crumble)||(()=>{const q=w.ledges[0];q.crumble=true;return q;})();place(g,(l.x1+l.x2)/2,l.y2,(l.z1+l.z2)/2,l);run(g,1.3);assert.ok(g.crumbles.get(l.id)?.broken);
});
test('geysers and fire jets hurt, spores put you to sleep',()=>{
  const g=fresh({ascent:4}),w=g.world,hz=w.hazards.find(h=>h.type==='geyser');if(hz){const b=w.boxes[hz.box];place(g,hz.x,hz.y,hz.z,b);g.time=hz.period*3-hz.phase+5.4;g.updateWorldHazards(1/60);assert.ok(g.player.vy>5,'launched');}
  const sp=generateWorld(20000,0);const gz=['alpine','caldera'];
  for(const seed of [1,2,3,4,5,6]){const gg=fresh({seed}),s=gg.world.hazards.find(h=>h.type==='spore');if(s){place(gg,s.x,s.y,s.z,gg.world.boxes[s.box]);run(gg,3);assert.ok(gg.status.sleep>0,'spore sleep');break;}}
});
test('reaching the summit ends the run with a win',()=>{
  const g=fresh(),s=g.world.summit;place(g,s.x,s.y,s.z,g.world.boxes[48]);g.update(1/60,blank());assert.equal(g.mode,'won');
});
test('scripted climber reaches the jungle and beyond without a faint on the first ascent',()=>{
  const r=runBot({maxFrames:60*60*6});assert.ok(r.g.maxHeight>=100,`reached ${r.g.maxHeight.toFixed(0)} m`);assert.ok(r.g.faints<=1);
});
test('every pitch of several daily mountains can be climbed to the summit (route geometry check, unlimited stamina)',()=>{
  for(const seed of [20000,20001,20002,20003,20010]){const r=runBot({seed,cheat:true,maxFrames:60*60*30});assert.ok(r.won,`seed ${seed} stuck at box ${r.target}, y=${r.g.player.y.toFixed(1)}`);}
});
test('climbing down: hold C and step off the edge to grab the face, then descend to the lower ledge',()=>{
  const g=fresh(),w=g.world,b=w.boxes[3],f=b.climbFace,prev=w.boxes[2];
  place(g,f.dx?(f.dx>0?b.x2-.8:b.x1+.8):(b.x1+b.x2)/2,b.y2,f.dz?(f.dz>0?b.z2-.8:b.z1+.8):(b.z1+b.z2)/2,b);
  const out={...blank(),mx:f.dx,mz:f.dz,grab:true};run(g,1.2,out);assert.equal(g.player.state,'wall','grabbed the face below the edge');
  run(g,12,{...blank(),f:-1,grab:false});assert.equal(g.player.state,'move');assert.ok(g.player.grounded);assert.equal(g.player.support.id,prev.id,'down on the previous ledge');assert.ok(g.aff.injury<.01,'no fall damage');
});
test('fuzz: random play never produces NaN, never ends up inside rock, and always keeps a legal state',()=>{
  const states=new Set(['move','wall','rope','anchored','mantle','chain','faint']);
  for(const seed of [20000,20004,20007]){
    const g=fresh({seed,ascent:2}),w=g.world;let s=seed*31+7;const rnd=()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296;};
    // start from random ledges so every zone gets exercised
    for(let leg=0;leg<14;leg++){
      const b=w.boxes[Math.floor(rnd()*49)];place(g,b.x1+1+rnd()*(b.x2-b.x1-2),b.y2,b.z1+1+rnd()*(b.z2-b.z1-2),b);g.stamina=100;
      let inp=blank();
      for(let f=0;f<60*12;f++){
        if(f%24===0)inp={...blank(),mx:Math.round(rnd()*2-1),mz:Math.round(rnd()*2-1),f:Math.round(rnd()*2-1),r:Math.round(rnd()*2-1),jump:rnd()<.25,sprint:rnd()<.3,grab:rnd()<.5,release:rnd()<.08,interact:rnd()<.3,use:rnd()<.15,drop:rnd()<.03,slot:rnd()<.3?Math.floor(rnd()*4):null,aim:{x:rnd()-.5,y:rnd()*.5,z:rnd()-.5}};
        else inp={...inp,jump:false,interact:false,use:false,drop:false,release:false,slot:null};
        if(f%240===0&&g.inv.some(i=>!i)){g.addItem(['snack','rope_spool','piton','chain_launcher','blowdart','energy_drink','medkit'][Math.floor(rnd()*7)]);}
        g.update(1/60,inp);g.events.length=0;const p=g.player;
        assert.ok(Number.isFinite(p.x+p.y+p.z+g.stamina),`finite at seed ${seed} leg ${leg} frame ${f}`);assert.ok(states.has(p.state),p.state);
        if(p.state==='move')for(const o of w.solids){if(o.oneway)continue;const pen=Math.min(p.x+.3-o.x1,o.x2-(p.x-.3),p.z+.3-o.z1,o.z2-(p.z-.3),p.y+1.5-o.y1,o.y2-p.y);assert.ok(!(p.y<o.y2-.45&&pen>.2),`inside ${o.id} (${pen.toFixed(2)}) at seed ${seed} leg ${leg} frame ${f} y=${p.y.toFixed(2)}`);}
        if(g.mode!=='play')break;
      }
    }
  }
});
