import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../site/games/community/pie-phoebe/vendor/three.module.js';
import {makeEffects} from '../site/games/community/phoebe-egg/src/effects.js';

test('effects follow movement and attack transitions, freeze on pause, and reset',()=>{
  const effects=makeEffects(new T.Scene());
  const game={mode:'play',elapsed:1,player:{x:0,y:0,z:0,angle:0,speed:5,roll:0},
    enemy:{x:3,y:0,z:0,angle:0,state:'recover',attack:'slam'}};
  effects.update(.06,game);
  assert.ok(effects.pool.some(p=>p.mesh.visible),'walking emits particles');
  effects.clear();game.player.speed=0;
  for(const attack of ['slam','roar','sweep']){
    effects.clear();game.enemy.attack=attack;game.enemy.state='active';effects.update(.01,game);
    const live=effects.pool.filter(p=>p.mesh.visible);assert.ok(live.length>=16,attack);
    effects.update(.01,game);assert.equal(effects.pool.filter(p=>p.mesh.visible).length,live.length,'no repeated burst');
  }
  game.mode='pause';const lives=effects.pool.map(p=>p.life);effects.update(1,game);
  assert.deepEqual(effects.pool.map(p=>p.life),lives,'pause freezes particles');
  game.mode='play';game.elapsed=0;game.enemy.state='recover';effects.update(.01,game);
  assert.equal(effects.pool.filter(p=>p.mesh.visible).length,0,'restart clears old effects');
  game.player.roll=.62;effects.update(.01,game);
  assert.equal(effects.pool.filter(p=>p.mesh.visible).length,2,'roll creates ring and arc');
});
