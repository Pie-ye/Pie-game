import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../site/games/community/phoebe-egg/src/game.js';
import {ground,move,blocked,findPath,inAttack,CAMP,NEST,CLIMBS} from '../site/games/community/phoebe-egg/src/rules.js';
const idle={x:0,z:0,run:false,use:false};
const advance=(game,seconds,input=idle)=>{for(let i=0;i<Math.ceil(seconds*60);i++)game.update(1/60,input);};
function fresh(){const g=new Game();g.reset();g.enemy.cooldown=999;return g;}

test('terrain has continuous ramp, blocked ledge and collision-safe movement',()=>{
  assert.equal(ground(-8,0),3.2);assert.equal(ground(-8,-23),0);assert.equal(ground(-8,-18.5),1.6);
  assert.equal(blocked(-8,8,0),true);
  const p={x:1,y:0,z:12};move(p,0,-12);assert.ok(p.z>9.5,'cannot tunnel through rock');
  const ramp={x:-8.5,y:0,z:-24};for(let i=0;i<100;i++)move(ramp,0,.12);assert.ok(ramp.y>3);
});
test('egg pickup, drop, retrieval and held delivery preserve a single egg',()=>{
  const g=fresh();Object.assign(g.player,NEST);g.interact();assert.equal(g.player.egg.hp,3);
  g.player.z=-19;g.interact();assert.ok(g.dropped);assert.equal(g.player.egg,null);
  Object.assign(g.player,NEST);g.interact();assert.equal(g.player.egg,null,'cannot create duplicate egg');
  Object.assign(g.player,{x:g.dropped.x,y:g.dropped.y,z:g.dropped.z});g.interact();assert.ok(g.player.egg);assert.equal(g.dropped,null);
  Object.assign(g.player,CAMP);advance(g,.5,{...idle,use:true});assert.equal(g.delivered,0);
  advance(g,.7,{...idle,use:true});assert.equal(g.delivered,1);assert.equal(g.player.egg,null);
  advance(g,2,{...idle,use:true});assert.equal(g.delivered,1,'holding cannot score twice');
});
test('moving or releasing E cancels deposit progress',()=>{
  const g=fresh();Object.assign(g.player,CAMP);g.player.egg={hp:3};advance(g,.5,{...idle,use:true});assert.ok(g.deposit>.4);
  advance(g,.1);assert.equal(g.deposit,0);advance(g,.5,{...idle,use:true});advance(g,.1,{...idle,x:1,use:true});assert.equal(g.deposit,0);
});
test('climb carries egg safely up and down and charges stamina',()=>{
  const g=fresh(),c=CLIMBS[0];Object.assign(g.player,{x:c.x,y:0,z:c.z});g.player.egg={hp:3};g.interact();assert.ok(g.player.climb);assert.equal(g.player.stamina,75);
  advance(g,2.2);assert.equal(g.player.y,3.2);assert.equal(g.player.egg.hp,3);assert.equal(g.player.climb,null);
  g.interact();assert.ok(g.player.climb);advance(g,2.2);assert.equal(g.player.y,0);assert.equal(g.player.egg.hp,3);
});
test('insufficient stamina refuses roll and climb; rolling protects only during dodge window',()=>{
  const g=fresh(),p=g.player;Object.assign(p,{x:-15,z:10.1,stamina:10});g.interact();assert.equal(p.climb,null);g.roll({x:1,z:0});assert.equal(p.roll,0);
  p.stamina=100;p.egg={hp:3};g.roll({x:1,z:0});assert.equal(p.stamina,70);p.roll=.4;g.hit();assert.equal(p.hp,100);assert.equal(g.dodges,1);assert.equal(p.egg.hp,3);
  p.roll=.05;g.hit();assert.equal(p.hp,82);assert.equal(p.egg.hp,2);
});
test('breaking an egg allows replacement, high falls cause damage, and pause freezes state',()=>{
  const g=fresh();g.player.egg={hp:1};g.damageEgg();assert.equal(g.broken,1);assert.equal(g.player.egg,null);
  Object.assign(g.player,NEST);g.interact();assert.equal(g.player.egg.hp,3);
  Object.assign(g.player,{x:22,z:22,y:3.2,vy:0});advance(g,1);assert.equal(g.player.egg.hp,2);assert.equal(g.player.hp,92);
  g.mode='pause';const t=g.elapsed,x=g.player.x;advance(g,1,{...idle,x:1});assert.equal(g.elapsed,t);assert.equal(g.player.x,x);
});
test('attack respects rock occlusion, height and sweep facing',()=>{
  assert.equal(inAttack('roar',{x:1,y:0,z:4},{x:1,y:0,z:10},{x:0,z:1}),false);
  assert.equal(inAttack('roar',{x:-9,y:0,z:0},{x:-11,y:3.2,z:0},{x:-1,z:0}),false);
  assert.equal(inAttack('sweep',{x:20,y:0,z:20},{x:20,y:0,z:18},{x:0,z:1}),false);
  assert.equal(inAttack('sweep',{x:20,y:0,z:20},{x:20,y:0,z:22},{x:0,z:1}),true);
});
test('Reggie cannot climb: his paths stay on the lowland and the plateau is out of reach',()=>{
  const path=findPath({x:8,z:-20},{x:-8,z:0},true);
  assert.ok(path.every(p=>ground(p.x,p.z)<=.05),'lowland-only path never touches ramp or plateau');
  const g=fresh();Object.assign(g.player,{x:-8,y:3.2,z:-4});Object.assign(g.enemy,{x:-8,y:0,z:-25.5,state:'chase',cooldown:0});
  for(let i=0;i<60*20;i++){g.update(1/60,idle);assert.ok(ground(g.enemy.x,g.enemy.z)<=.05,'enemy never on ramp/plateau');assert.equal(g.player.hp,100,'player on the plateau is never hit');}
});
test('the plateau is a complete safe route: nest, ramp, plateau, ladder down, camp',()=>{
  const g=new Game();g.reset();
  function walk(x,z){for(let f=0;f<2400;f++){const dx=x-g.player.x,dz=z-g.player.z,l=Math.hypot(dx,dz);if(l<.3)return;g.update(1/60,{x:dx/l,z:dz/l,run:false,use:false});assert.equal(g.mode,'play');}assert.fail(`stuck going to ${x},${z} at ${g.player.x},${g.player.z},${g.player.y}`);}
  const wait=t=>{for(let i=0;i<t*60;i++)g.update(1/60,idle);};
  // A naive walker may lose an egg to Reggie; it just goes back for another, as a player would.
  for(let attempt=0;attempt<10&&g.delivered<3;attempt++){
    walk(10,21);walk(10,-23);walk(0,-23);while(g.player.roll>0)g.update(1/60,idle);g.interact();
    if(!g.player.egg)continue;
    walk(10,-23);walk(10,21);walk(0,23);advance(g,1.1,{...idle,use:true});
  }
  assert.equal(g.mode,'won');assert.equal(g.delivered,3);assert.ok(g.elapsed<360);
});
