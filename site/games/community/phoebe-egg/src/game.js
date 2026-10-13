import {CAMP,NEST,CLIMBS,ground,move,findPath,lineClear,inAttack,blocked} from './rules.js';
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const approach=(a,b,t)=>a+(b-a)*Math.min(1,t);
export const ATTACKS={charge:'肚皮衝撞！向側面翻滾',roar:'瑞吉大吼！離開紅圈',slam:'拍地震波！躲上岩台',sweep:'甩身攻擊！拉開距離'};

export class Game {
  constructor(notify=()=>{},sound=()=>{}) {this.notify=notify;this.sound=sound;this.mode='title';this.reset();this.mode='title';}
  reset(){
    this.player={x:0,y:0,z:21,angle:Math.PI,hp:100,stamina:100,egg:null,roll:0,hurt:0,climb:null,vy:0,speed:0,sprinting:false,rollDir:{x:0,z:-1}};
    this.enemy={x:3,y:0,z:-17,angle:0,state:'patrol',clock:0,attack:'charge',cooldown:3,direction:{x:0,z:1},path:[],pathClock:0,hit:false,sequence:0};
    this.elapsed=0;this.delivered=0;this.broken=0;this.dodges=0;this.deposit=0;this.dropped=null;this.toast='';this.toastTime=0;this.result='';this.mode='play';
  }
  message(text){this.toast=text;this.toastTime=3.5;this.notify(text);}
  context(){
    const p=this.player;
    if(p.climb)return {type:'climbing',text:'攀爬中 · 蛋已固定在背袋'};
    if(p.roll>0)return {type:'rolling',text:'護好蛋，穩穩落地'};
    if(p.y>ground(p.x,p.z)+.12)return {type:'falling',text:'小心落差 · 高處落下會傷蛋'};
    if(p.egg&&distance(p,CAMP)<2.5&&p.y<.4)return {type:'deposit',text:'按住 E ／互動 · 將蛋放入營地'};
    if(!p.egg&&this.dropped&&distance(p,this.dropped)<1.7&&Math.abs(p.y-this.dropped.y)<.6)return {type:'pickup',text:'E ／互動 · 抱起放下的蛋'};
    if(!p.egg&&distance(p,NEST)<2.7&&p.y<.4)return {type:'nest',text:'E ／互動 · 抱起一顆蛋'};
    for(const climb of CLIMBS){
      if(distance(p,climb)<1.7&&p.y<.4)return {type:'climb',text:'E ／互動 · 攀上岩台（25 耐力）',climb,up:true};
      if(distance(p,{x:climb.topX,z:climb.topZ})<1.6&&Math.abs(p.y-climb.y)<.3)return {type:'climb',text:'E ／互動 · 安全爬下岩台（25 耐力）',climb,up:false};
    }
    if(p.egg)return {type:'drop',text:'送回綠色營地 · E 可放下蛋休息'};
    return {type:'walk',text:'前往金色蛋巢 · 岩台梯子可用 E 攀爬'};
  }
  interact(){
    if(this.mode!=='play')return;
    const p=this.player,c=this.context();
    if(c.type==='nest'||c.type==='pickup'){
      if(c.type==='nest'&&this.dropped){this.message('先取回地上的蛋；小地圖金色標記會指引你');return;}
      p.egg=c.type==='pickup'?{hp:this.dropped.hp}:{hp:3};this.dropped=null;this.sound('pickup');this.message('抱穩了！將蛋送回綠色營地');
    } else if(c.type==='drop'){
      this.dropped={x:p.x,y:p.y,z:p.z,hp:p.egg.hp};p.egg=null;this.sound('drop');this.message('蛋已安全放下，可在原地重新拾取');
    } else if(c.type==='climb'){
      if(p.stamina<25){this.message('耐力不足，稍微休息再攀爬');return;}
      p.stamina-=25;
      const end=c.up?{x:c.climb.topX,y:c.climb.y,z:c.climb.topZ}:{x:c.climb.x,y:0,z:c.climb.z};
      p.angle=Math.atan2(c.climb.topX-c.climb.x,c.climb.topZ-c.climb.z);
      p.climb={start:{x:p.x,y:p.y,z:p.z},end,t:0,duration:p.egg?2.1:1.5};this.deposit=0;this.sound('climb');
    }
  }
  roll(input){
    const p=this.player;
    if(this.mode!=='play'||p.roll>0||p.climb||p.y>ground(p.x,p.z)+.1)return;
    const cost=p.egg?30:22;
    if(p.stamina<cost){this.message('耐力不足，暫時步行恢復');return;}
    p.stamina-=cost;p.roll=.62;
    const len=Math.hypot(input.x,input.z);
    p.rollDir=len>.1?{x:input.x/len,z:input.z/len}:{x:Math.sin(p.angle),z:Math.cos(p.angle)};
    p.angle=Math.atan2(p.rollDir.x,p.rollDir.z);this.deposit=0;this.sound('roll');
  }
  damageEgg(){
    const p=this.player;if(!p.egg)return;
    p.egg.hp--;
    if(p.egg.hp<=0){p.egg=null;this.broken++;this.sound('break');this.message('蛋破了！返回蛋巢重新取蛋');}
    else {this.message(`蛋出現裂痕！還能承受 ${p.egg.hp} 次撞擊`);}
  }
  hit(damage=18){
    const p=this.player;
    if(p.hurt>0)return;
    // Invulnerability covers the central part of the roll, not the whole animation.
    if(p.roll>.12&&p.roll<.55){this.dodges++;this.message('漂亮閃避！');this.sound('dodge');return;}
    p.hp=Math.max(0,p.hp-damage);p.hurt=1.4;this.deposit=0;this.damageEgg();this.sound('hit');
    if(!p.climb){const dx=p.x-this.enemy.x,dz=p.z-this.enemy.z,l=Math.hypot(dx,dz)||1;move(p,dx/l*.8,dz/l*.8);}
    if(p.hp<=0)this.finish(false,'體力耗盡了，回營地休息再挑戰。');
  }
  finish(won,reason){this.mode=won?'won':'lost';this.result=reason;this.player.speed=0;this.sound(won?'win':'lose');}
  update(dt,input){
    if(this.mode!=='play')return;
    this.elapsed+=dt;this.toastTime=Math.max(0,this.toastTime-dt);if(!this.toastTime)this.toast='';
    if(this.elapsed>=360){this.elapsed=360;this.finish(false,'委託時間結束了。');return;}
    const p=this.player;p.hurt=Math.max(0,p.hurt-dt);p.speed=0;p.sprinting=false;
    if(p.climb){
      const c=p.climb;c.t=Math.min(1,c.t+dt/c.duration);const t=c.t*c.t*(3-2*c.t);
      p.x=approach(c.start.x,c.end.x,t);p.y=approach(c.start.y,c.end.y,t);p.z=approach(c.start.z,c.end.z,t);
      if(c.t===1){p.climb=null;p.vy=0;}
    } else {
      const len=Math.hypot(input.x,input.z),onGround=p.y<=ground(p.x,p.z)+.05;
      if(p.roll>0){
        p.roll=Math.max(0,p.roll-dt);const speed=p.egg?7:9.5;
        move(p,p.rollDir.x*speed*dt,p.rollDir.z*speed*dt);p.speed=speed;
      } else if(len>.06){
        p.sprinting=input.run&&p.stamina>1&&onGround;
        const speed=p.egg?(p.sprinting?4.8:3.3):(p.sprinting?7.2:4.8);
        const dx=input.x/Math.max(1,len),dz=input.z/Math.max(1,len);
        move(p,dx*speed*dt,dz*speed*dt);p.angle=Math.atan2(dx,dz);p.speed=speed;
        if(p.sprinting)p.stamina=Math.max(0,p.stamina-dt*(p.egg?18:14));
      }
      const floor=ground(p.x,p.z);
      if(p.y>floor+.01){
        p.vy-=18*dt;p.y+=p.vy*dt;
        if(p.y<=floor){if(p.vy<-8.5){p.hp=Math.max(0,p.hp-8);this.damageEgg();this.sound('hit');if(p.hp<=0)this.finish(false,'落地受傷，任務失敗。');}p.y=floor;p.vy=0;}
      } else {p.y=floor;p.vy=0;}
      if(!p.sprinting&&p.roll<=0)p.stamina=Math.min(100,p.stamina+dt*19);
    }
    if(this.mode!=='play')return;
    if(this.context().type==='deposit'&&input.use&&p.speed<.1){
      this.deposit+=dt;
      if(this.deposit>=1){
        this.delivered++;p.egg=null;this.deposit=0;p.hp=Math.min(100,p.hp+15);this.sound('deliver');
        this.message(`安全交付！${this.delivered} / 3 · 營地恢復 15 生命`);
        if(this.delivered>=3){this.finish(true,'三顆蛋都平安到家了！');return;}
      }
    } else this.deposit=0;
    this.updateEnemy(dt);
  }
  updateEnemy(dt){
    const e=this.enemy,p=this.player;e.clock+=dt;e.cooldown=Math.max(0,e.cooldown-dt);
    const d=distance(e,p),sees=lineClear(e,p),safe=distance(p,CAMP)<4.8;
    if(e.state==='windup'){
      if(e.clock>=1.05){e.state=e.attack==='charge'?'charge':'active';e.clock=0;e.hit=false;this.sound(e.attack);}
      return;
    }
    if(e.state==='charge'){
      const collided=move(e,e.direction.x*13*dt,e.direction.z*13*dt,.95);e.y=ground(e.x,e.z);
      if(!safe&&!e.hit&&inAttack('charge',e,p,e.direction)){this.hit(23);e.hit=true;}
      if(collided||e.clock>1.35||distance(e,CAMP)<5.5){e.state='recover';e.clock=0;}
      return;
    }
    if(e.state==='active'){
      if(!e.hit&&e.clock>.12){if(!safe&&inAttack(e.attack,e,p,e.direction))this.hit(e.attack==='slam'?24:18);e.hit=true;}
      if(e.clock>.55){e.state='recover';e.clock=0;}
      return;
    }
    if(e.state==='recover'){
      if(e.clock>1.6){e.state='chase';e.clock=0;e.cooldown=1.5;}
      return;
    }
    const aggro=!safe&&(d<18||!!p.egg||e.state==='chase');
    e.state=aggro?'chase':'patrol';
    if(aggro&&sees&&Math.abs(p.y-e.y)<1.4&&e.cooldown===0&&d<12){
      if(d>6.2)e.attack='charge';else e.attack=['roar','slam','sweep'][e.sequence++%3];
      if(e.attack==='sweep'&&d>3.6)e.attack='roar';
      if(e.attack==='slam'&&d>4.7)e.attack='charge';
      e.direction={x:(p.x-e.x)/(d||1),z:(p.z-e.z)/(d||1)};e.angle=Math.atan2(e.direction.x,e.direction.z);
      e.state='windup';e.clock=0;return;
    }
    const target=aggro?p:{x:6+Math.sin(this.elapsed*.1)*6,z:-15+Math.cos(this.elapsed*.1)*5,y:0};
    e.pathClock-=dt;
    if(e.pathClock<=0){e.path=findPath(e,target);e.pathClock=.8;}
    let next=e.path[0];
    if(next&&distance(e,next)<.65){e.path.shift();next=e.path[0];}
    if(!next&&distance(e,target)>1.4&&lineClear(e,target)&&Math.abs(e.y-ground(target.x,target.z))<.3)next=target;
    if(next){
      const dx=next.x-e.x,dz=next.z-e.z,l=Math.hypot(dx,dz)||1;
      const speed=aggro?2.35+this.delivered*.3:1.3;
      const nx=e.x+dx/l*speed*dt,nz=e.z+dz/l*speed*dt;
      if(distance({x:nx,z:nz},CAMP)>5.2){move(e,dx/l*speed*dt,dz/l*speed*dt,.9);e.angle=Math.atan2(dx,dz);e.y=ground(e.x,e.z);}
    }
  }
}
