import {CELL,PLAYER,ZONES,ITEMS,COST,ASCENTS,BASE_SLOTS,MAX_SLOTS,PASSIVE,MIST_START,ROUTES} from './data.js';
import {generateWorld} from './world.js';
import {mulberry32,daySeed} from './rng.js';
import {moveBody,supportAt,pointSolid,rayCast,GRAVITY,overlaps} from './physics.js';
import {makeReggie,updateReggie} from './reggie.js';
import {ATTACK_INFO,clamp,approach} from './rules.js';

const V3=(x,y,z)=>({x,y,z});
export class Game{
  constructor(opts={}){this.opts={seed:opts.seed??daySeed(),ascent:opts.ascent??0};this.mode='title';this.events=[];this.reset(opts);this.mode='title';}
  emit(type,data={}){this.events.push({type,...data});}
  toast(text,ms=3200){this.emit('toast',{text,ms});}
  reset(opts={}){
    if(opts.seed!==undefined)this.opts.seed=opts.seed;if(opts.ascent!==undefined)this.opts.ascent=opts.ascent;
    const seed=this.opts.seed,ascent=this.opts.ascent;
    this.rand=mulberry32((seed*7919+ascent*104729)>>>0);
    if(!(opts.keepWorld&&this.world&&this.world.seed===seed&&this.world.ascent===ascent))this.world=generateWorld(seed,ascent);const w=this.world,s=w.spawn;
    this.player={x:s.x,y:0,z:s.z,vx:0,vy:0,vz:0,yaw:s.yaw,state:'move',grounded:true,wall:null,rope:null,anchor:null,mantle:null,chain:null,peakY:0,attachT:0,offCool:0,lunge:0,hurtCd:0,eat:0,use:0,faintT:0,support:null,climbPhase:0,speed:0,sprinting:false};
    this.aff={hunger:.04,injury:0,poison:0,cold:0,hot:0,sleepBuild:0};
    this.stamina=100;this.bonus=0;this.exhausted=false;this.status={energy:0,sleep:0,crash:0};
    this.slots=BASE_SLOTS;this.inv=Array(MAX_SLOTS).fill(null);this.sel=0;this.inv[0]={kind:'snack'};
    this.time=0;this.mode='play';this.won=false;this.faints=0;this.falls=0;this.itemsUsed=0;this.maxHeight=0;this.respawn={x:s.x,y:0,z:s.z,altar:'start'};
    this.reggies=w.reggies.map(d=>makeReggie(d,w));this.scouts=[];this.boulders=[];this.rope=null;this.placedRopes=[];this.ropes=w.ropes.map(r=>({...r}));this.anchors=w.anchors.map(a=>({...a}));this.hives=w.hives.map(h=>({...h,angry:0,cd:0}));this.bounce=[];this.shelves=[];this.flagRespawn=null;this.flags=[];
    this.effects={balloon:0};this.mist={y:-40,started:false,inside:0,lastWarn:0};this.lost=false;
    this.zoneEnter=new Map([[0,0]]);this.rushWarned=false;this.boulderTimer=14;this.wind={t:rand(this.rand,12,20),active:0,dir:{x:1,z:0},warn:0};
    this.crumbles=new Map();this.pickupHint='';this.hint='';this.stats={altars:0};this.dartAmmo=0;
    this.tipsSeen=new Set();this.signsSeen=new Set();
    this.events=[];
    this.emit('reset');
  }
  tip(id,text,ms=5200){if(this.tipsSeen.has(id)||this.opts.noTips)return;this.tipsSeen.add(id);this.toast(text,ms);}
  tipsUpdate(){
    const p=this.player,a=this.aff;
    if(p.state==='wall')this.tip('wall','抓住岩壁了：W／S 上下、A／D 橫移，每一秒都在消耗體力');
    if(p.state==='wall'&&this.stamina<28)this.tip('low','體力快沒了！找附近的平台休息，或釘岩釘、用繩索');
    if(p.state==='move'&&p.grounded&&p.support&&p.support.kind==='ledge')this.tip('ledge','在平台上體力會快速恢復，趁機吃東西、撿東西');
    if(a.hunger>.25||a.injury>.05||a.poison>0||a.cold>.04||a.hot>.04)this.tip('caps','體力條右側的色塊，是飢餓、受傷、中毒、冷熱與負重扣掉的上限');
    if(a.cold>.04)this.tip('cold','太冷了！靠近營火或祭壇，或喝熱茶');
    if(a.hot>.04)this.tip('hot','太熱了！離開熔岩壁面，或使用冰敷袋');
    for(const r of this.reggies)if(r.state==='windup'&&Math.hypot(r.x-p.x,r.z-p.z)<14)this.tip('reggie','紅色範圍是瑞吉的攻擊：跳起來可以閃掉拍地、甩身和衝撞；他吼叫時別抓在牆上離他太近');
    if(this.bonus>5)this.tip('bonus','金色的是額外體力：會先被消耗，而且不會自己恢復');
    if(this.mist.started&&p.y<this.mist.y+40)this.tip('mistnear','濃霧在腳下追上來：少繞路、少停留，必要時走直壁');
    if(this.nearAltar(p,3.5))this.tip('altar','按 E 啟動祭壇：存檔、恢復體力、解毒。昏迷後會在這裡醒來');
    if(this.status.energy>20&&false)this.tip('energy','');
  }
  // ---- derived values ------------------------------------------------------------------------------------------------
  weightFrac(){return this.inv.reduce((n,i)=>n+(i?ITEMS[i.kind].weight:0),0)*1.5/100*(this.world.asc.weight??1);}
  caps(){const a=this.aff;return {hunger:a.hunger*.45,injury:a.injury,poison:a.poison,cold:a.cold,hot:a.hot,weight:this.weightFrac()};}
  maxStamina(){const c=this.caps();return 100*(1-clamp(c.hunger+c.injury+c.poison+c.cold+c.hot+c.weight,0,.97));}
  zone(){return this.world.zoneAt(this.player.y-.05);}
  nearAltar(p,r){for(const a of this.world.altars)if(Math.hypot(a.x-p.x,a.z-p.z)<r&&Math.abs(a.y-p.y)<2.5)return a;return null;}
  nearFire(p,r=7){for(const c of this.world.campfires)if(Math.hypot(c.x-p.x,c.z-p.z)<r&&Math.abs(c.y-p.y)<3)return true;return !!this.nearAltar(p,r);}
  spend(v){if(this.bonus>0){const t=Math.min(this.bonus,v);this.bonus-=t;v-=t;}this.stamina=Math.max(0,this.stamina-v);}
  climbMul(){return this.world.asc.climb??1;}
  slotCount(){return this.slots;}
  hasItem(kind){return this.inv.findIndex(i=>i&&i.kind===kind);}
  // ---- damage and fainting ---------------------------------------------------------------------------------------------
  hurtPlayer(injury,stamina,source,opts={}){
    const p=this.player;if(p.hurtCd>0||p.state==='faint'||this.mode!=='play')return false;
    if(source&&['slam','sweep','charge'].includes(source.attack)&&!p.grounded&&p.y>(source.y??0)+.7){this.toast('漂亮閃避！',1200);this.emit('sound',{name:'dodge'});p.hurtCd=.6;return false;}
    p.hurtCd=.9;this.aff.injury=Math.min(.9,this.aff.injury+injury*(1+this.world.ascent*.08));this.spend(stamina);
    this.emit('sound',{name:'hit'});this.emit('hurt',{injury});
    const l=Math.hypot(opts.dx||0,opts.dz||0)||1;
    if(p.state==='wall'||p.state==='rope'||p.state==='anchored'){if(opts.dropGrip||this.stamina<8)this.letGo(true);}
    else if(opts.knock){p.vx+=(opts.dx/l)*opts.knock*3;p.vz+=(opts.dz/l)*opts.knock*3;p.vy=Math.max(p.vy,3);p.grounded=false;}
    return true;
  }
  faint(reason){
    const p=this.player;if(p.state==='faint')return;
    p.state='faint';p.faintT=3.6;p.wall=null;p.rope=null;p.anchor=null;p.vx=p.vz=0;this.faints++;this.emit('faint',{reason});
    this.toast({fall:'摔得太重，昏迷了…',drown:'掉進海裡了…',stamina:'體力耗盡，昏迷了…',cap:'身體撐不住，昏迷了…',mist:'被濃霧追上了，昏迷了…'}[reason]||'昏迷了…',3200);
  }
  wake(){
    const p=this.player,a=this.aff;let r=this.respawn;
    if(this.flagRespawn){r=this.flagRespawn;this.flagRespawn=null;this.emit('flagUsed');}
    else if(this.mist.started&&r.y<this.mist.y+3){ // the mist swallowed the old camp: wake at the highest altar above it
      const up=this.world.altars.filter(x=>x.active&&x.y>this.mist.y+6).sort((x,y)=>y.y-x.y)[0];
      if(!up){this.lost=true;this.mode='lost';this.emit('lost');this.toast('濃霧吞沒了所有營地…',4000);return;}
      r={x:up.x+1.4,y:up.y,z:up.z+1.4,altar:up.id};this.respawn=r;}
    Object.assign(p,{x:r.x,y:r.y,z:r.z,vx:0,vy:0,vz:0,state:'move',grounded:true,wall:null,rope:null,anchor:null,peakY:r.y,hurtCd:1.5});
    a.injury*=.5;a.poison=0;a.cold=0;a.hot=0;a.hunger=Math.max(a.hunger,.35);a.sleepBuild=0;this.status.sleep=0;this.status.crash=0;this.status.energy=0;
    this.stamina=this.maxStamina()*.6;
    this.bonus=0;this.effects.balloon=0;
    if(this.world.ascent>=2){for(let i=0;i<this.slots;i++)if(this.inv[i]&&!['snack','bandage'].includes(this.inv[i].kind)&&this.rand()<.6)this.inv[i]=null;}
    this.emit('wake');this.toast('在祭壇醒來。小心點！',3000);
  }
  letGo(forced=false){
    const p=this.player;if(!['wall','rope','anchored'].includes(p.state))return;
    const n=p.wall;p.state='move';p.grounded=false;p.peakY=p.y;p.offCool=forced?.7:.35;
    if(n){p.vx=n.nx*1.2;p.vz=n.nz*1.2;}p.vy=0;p.wall=null;p.rope=null;p.anchor=null;
  }
  // ---- main update ---------------------------------------------------------------------------------------------------
  update(dt,inp){
    if(this.mode!=='play')return;dt=Math.min(dt,.05);
    const p=this.player;this.time+=dt;
    p.hurtCd=Math.max(0,p.hurtCd-dt);p.offCool=Math.max(0,p.offCool-dt);p.use=Math.max(0,p.use-dt);
    this.handleSelect(inp);
    if(p.state==='faint'){p.faintT-=dt;if(p.faintT<=0)this.wake();this.updateWorldHazards(dt);this.updateReggies(dt);return;}
    this.updateStatus(dt);this.updateMist(dt);this.updateDynamic(dt);
    if(this.status.sleep>0){this.sleeping(dt);}
    else{
      if(p.eat>0){p.eat-=dt;if(p.eat<=0)this.finishUse();}
      this.actions(inp);
      switch(p.state){case'move':this.moveState(dt,inp);break;case'wall':this.wallState(dt,inp);break;case'rope':this.ropeState(dt,inp);break;
        case'mantle':this.mantleState(dt);break;case'chain':this.chainState(dt);break;case'anchored':this.anchoredState(dt,inp);break;}
    }
    this.ejectIfStuck();this.afflictions(dt);this.staminaCheck(dt);this.tipsUpdate();
    this.updateWorldHazards(dt);this.updateReggies(dt);this.progress(dt);
    if(p.y<-3||Math.abs(p.x)>this.world.limit||Math.abs(p.z)>this.world.limit)this.faint('drown');
    this.maxHeight=Math.max(this.maxHeight,p.y);
  }
  // Safety net: if any path ever leaves the player inside rock, push out through the nearest face.
  ejectIfStuck(){
    const p=this.player;if(p.state==='faint'||p.state==='mantle'||p.state==='chain')return;
    for(const b of this.world.solids){if(b.dead)continue;
      if(b.oneway||!overlaps(p,b,.25,1.4))continue;
      const pens=[[p.x+.3-b.x1,-1,0,'x',b.x1-.31],[b.x2-(p.x-.3),1,0,'x',b.x2+.31],[p.z+.3-b.z1,0,-1,'z',b.z1-.31],[b.z2-(p.z-.3),0,1,'z',b.z2+.31]];
      pens.sort((a,c)=>a[0]-c[0]);const up=b.y2-p.y;
      if(up<.9&&up<pens[0][0]){p.y=b.y2;p.vy=0;p.grounded=true;p.support=b;}
      else{const [,nx,nz,axis,val]=pens[0];p[axis]=val;if(p.state!=='move'){const st=p.state;p.state='move';p.grounded=false;p.wall=null;p.rope=null;p.peakY=p.y;p.vx=nx*1.5;p.vz=nz*1.5;}}
      this.emit('unstick');return;
    }
  }
  // ---- selection / actions ---------------------------------------------------------------------------------------------
  handleSelect(inp){const n=this.slots;if(inp.slot!=null&&inp.slot>=0&&inp.slot<n){this.sel=inp.slot;}if(inp.slotStep)this.sel=(this.sel+inp.slotStep+n)%n;}
  actions(inp){
    const p=this.player;
    if(inp.interact)this.interact();
    if(inp.drop)this.dropItem();
    if(inp.use&&p.eat<=0&&p.use<=0)this.startUse(inp);
  }
  addItem(kind){
    const spec=ITEMS[kind];const data={kind};if(spec.charges)data.charges=spec.charges;if(spec.ammo)data.ammo=spec.ammo;
    if(spec.kind==='pack'){if(this.slots>=MAX_SLOTS)return false;this.slots=Math.min(MAX_SLOTS,this.slots+2);this.emit('slots');this.toast('背包變大了：現在有 '+this.slots+' 格',2400);return 'pack';}
    const slot=this.inv.slice(0,this.slots).findIndex(i=>!i);if(slot<0)return false;this.inv[slot]=data;if(this.inv[this.sel]===null||slot===this.sel)this.sel=slot;return true;
  }
  dropItem(){
    const it=this.inv[this.sel];if(!it)return;const p=this.player;this.inv[this.sel]=null;
    this.world.items.push({kind:it.kind,x:p.x+Math.sin(p.yaw)*.8,y:p.y,z:p.z+Math.cos(p.yaw)*.8,taken:false,dropped:true,charges:it.charges,ammo:it.ammo});this.emit('sound',{name:'drop'});
  }
  interactables(){
    const p=this.player,out=[];
    for(const it of this.world.items)if(!it.taken&&Math.hypot(it.x-p.x,it.z-p.z)<1.8&&Math.abs(it.y-p.y)<1.6)out.push({type:'item',ref:it,d:Math.hypot(it.x-p.x,it.z-p.z),label:`E 撿起 ${ITEMS[it.kind].name}`});
    for(const c of this.world.crates)if(!c.opened&&Math.hypot(c.x-p.x,c.z-p.z)<2&&Math.abs(c.y-p.y)<1.6)out.push({type:'crate',ref:c,d:Math.hypot(c.x-p.x,c.z-p.z),label:'E 打開補給箱'});
    for(const a of this.world.altars)if(Math.hypot(a.x-p.x,a.z-p.z)<2.6&&Math.abs(a.y-p.y)<1.8)out.push({type:'altar',ref:a,d:Math.hypot(a.x-p.x,a.z-p.z),label:a.active?'E 在祭壇休息':'E 啟動祭壇（存檔點）'});
    for(const c of this.world.crystals)if(!c.used&&Math.hypot(c.x-p.x,c.z-p.z)<2&&Math.abs(c.y-p.y)<1.6)out.push({type:'crystal',ref:c,d:Math.hypot(c.x-p.x,c.z-p.z),label:'E 吸收水晶能量'});
    {const it=this.inv[this.sel];
      if(it&&['berry_red','berry_blue','mushroom_item','coconut','granola_bar'].includes(it.kind)&&!it.cooked)
        for(const c of this.world.campfires)if(Math.hypot(c.x-p.x,c.z-p.z)<3&&Math.abs(c.y-p.y)<2){out.push({type:'cook',ref:c,d:Math.hypot(c.x-p.x,c.z-p.z)-.5,label:`E 在營火上烤 ${ITEMS[it.kind].name}（變安全、更補）`});break;}}
    for(const h of this.hives)if(!h.taken&&Math.hypot(h.x-p.x,h.z-p.z)<2.2&&Math.abs(h.y-p.y)<1.8)out.push({type:'hive',ref:h,d:Math.hypot(h.x-p.x,h.z-p.z),label:'E 取蜂巢蜜（會被蜜蜂叮）'});
    out.sort((a,b)=>a.d-b.d);return out;
  }
  interact(){
    const p=this.player,list=this.interactables();if(!list.length)return;const t=list[0],w=this.world;
    if(t.type==='item'){
      const added=this.addItem(t.ref.kind);
      if(!added){this.toast(ITEMS[t.ref.kind].kind==='pack'?'你已經背著最大的背包了':'背包滿了！按 G 丟掉一件');return;}
      if(added==='pack'){t.ref.taken=true;this.emit('sound',{name:'pickup'});this.emit('taken',{item:t.ref});return;}
      const slot=this.inv.findIndex((i,idx)=>i&&i.kind===t.ref.kind&&idx===this.sel)>=0?this.sel:this.inv.findLastIndex(i=>i&&i.kind===t.ref.kind);
      if(t.ref.charges!=null&&this.inv[slot])this.inv[slot].charges=t.ref.charges;if(t.ref.ammo!=null&&this.inv[slot])this.inv[slot].ammo=t.ref.ammo;
      t.ref.taken=true;if(['berry_red','berry_blue','mushroom_item'].includes(t.ref.kind))this.tip('gamble','野莓與蘑菇可能有毒：餓壞了才賭一把，解毒劑可以救你');this.emit('sound',{name:'pickup'});this.emit('taken',{item:t.ref});this.toast(`撿到 ${ITEMS[t.ref.kind].name}`,1400);
      if(['magic_bean','shelf_fungus','bounce_fungus','parasol','balloon','compass','checkpoint_flag','cure_all','honeycomb','chain_launcher','piton','rope_spool'].includes(t.ref.kind))this.tip('item:'+t.ref.kind,`${ITEMS[t.ref.kind].name}：${ITEMS[t.ref.kind].desc}`,5200);
    }else if(t.type==='crate'){
      t.ref.opened=true;this.emit('sound',{name:'crate'});this.emit('crate',{crate:t.ref});
      t.ref.loot.forEach((k,i)=>w.items.push({kind:k,x:t.ref.x+(i?.9:-.9),y:t.ref.y,z:t.ref.z+.4,taken:false}));this.toast('補給箱裡有東西！',1800);
    }else if(t.type==='altar'){
      const a=t.ref;if(!a.active){a.active=true;this.stats.altars++;this.emit('altar',{altar:a});this.toast('祭壇啟動！之後昏迷會在這裡醒來',3600);}
      this.respawn={x:a.x+1.4,y:a.y,z:a.z+1.4,altar:a.id};
      this.aff.injury=Math.max(0,this.aff.injury-.2);this.aff.hunger=Math.max(.05,this.aff.hunger-.25);this.aff.poison=0;this.stamina=this.maxStamina();this.emit('sound',{name:'altar'});
    }else if(t.type==='cook'){
      const it=this.inv[this.sel];if(it){it.cooked=true;this.emit('sound',{name:'eat'});this.emit('cook',{campfire:t.ref});this.toast(`${ITEMS[it.kind].name}烤得香噴噴：不會中毒，也更補`,2400);}
    }else if(t.type==='hive'){
      t.ref.taken=true;t.ref.angry=9;this.emit('hive',{hive:t.ref});this.emit('sound',{name:'crate'});
      for(let k=0;k<2;k++)w.items.push({kind:'honeycomb',x:t.ref.x+(k?.8:-.8),y:t.ref.y,z:t.ref.z+.6,taken:false});this.toast('蜂巢掉出蜂巢蜜！蜜蜂生氣了，快離開',2600);
    }else if(t.type==='crystal'){
      t.ref.used=true;this.aff.injury=Math.max(0,this.aff.injury-.3);this.aff.cold=Math.max(0,this.aff.cold-.2);this.aff.hot=Math.max(0,this.aff.hot-.2);this.stamina=this.maxStamina();this.bonus=Math.min(60,this.bonus+15);this.emit('sound',{name:'crystal'});this.emit('crystal',{crystal:t.ref});this.toast('水晶讓你精神一振',1800);
    }
  }
  // ---- item use ------------------------------------------------------------------------------------------------------
  startUse(inp){
    const it=this.inv[this.sel];if(!it)return;const spec=ITEMS[it.kind],p=this.player;
    if(['food','drink','heal','cure','cureall','warm','cool'].includes(spec.kind)){p.eat=.8;p.use=.8;p.using=this.sel;this.emit('use',{kind:it.kind,start:true});return;}
    p.use=.5;
    if(spec.kind==='rope')this.useRope(it);
    else if(spec.kind==='piton')this.usePiton(it);
    else if(spec.kind==='chain')this.useChain(it,inp);
    else if(spec.kind==='dart')this.useDart(it,inp);
    else if(spec.kind==='light')this.toast('提燈已在背包中，視野會變遠');
    else if(spec.kind==='compass')this.toast('指南針會在畫面上指出下一個營地');
    else if(spec.kind==='parasol')this.toast('把陽傘拿在手上（選中它），空中就會慢慢飄落');
    else if(spec.kind==='bean')this.useBean(it);
    else if(spec.kind==='shelf')this.useShelf(it);
    else if(spec.kind==='bounce')this.useBounce(it);
    else if(spec.kind==='balloon'){this.effects.balloon=20;this.consume(this.sel);this.toast('氣球讓你變輕了 20 秒：跳得更高',2400);this.emit('balloon');}
    else if(spec.kind==='flag')this.useFlag(it);
  }
  consume(slot){this.inv[slot]=null;this.itemsUsed++;}
  finishUse(){
    const p=this.player,slot=p.using??this.sel,it=this.inv[slot];if(!it)return;const spec=ITEMS[it.kind],a=this.aff,asc=this.world.asc;
    this.emit('use',{kind:it.kind,done:true});this.emit('sound',{name:spec.kind==='food'?'eat':'drink'});
    if(spec.hunger)a.hunger=clamp(a.hunger+spec.hunger/100*(1/.45)*.45*(it.cooked?1.4:1),0,1);
    if(it.cooked)this.bonus=Math.min(60,this.bonus+8);
    if(spec.bonus){this.bonus=Math.min(60,this.bonus+spec.bonus);}
    if(spec.kind==='cureall'){a.injury=0;a.poison=0;a.cold=0;a.hot=0;this.stamina=this.maxStamina();this.bonus=Math.min(60,this.bonus+20);this.toast('萬靈丹：全身舒暢',2200);}
    if(spec.stamina)this.stamina=Math.min(this.maxStamina(),this.stamina+spec.stamina);
    if(spec.injury)a.injury=Math.max(0,a.injury+spec.injury/100);
    if(spec.cold)a.cold=Math.max(0,a.cold+spec.cold/100*.45);if(spec.heat)a.hot=Math.max(0,a.hot+spec.heat/100*.45);
    if(spec.kind==='cure'){a.poison=0;this.toast('毒解了');}
    if(spec.poisonChance&&!it.cooked&&this.rand()<spec.poisonChance*asc.poison){a.poison=Math.min(.6,a.poison+.28);this.toast('糟了！有毒！',2600);this.emit('poison');}
    else if(spec.kind==='food')this.toast(`${spec.name}：飢餓緩解`,1600);
    if(spec.kind==='drink'){this.status.energy=25;this.toast('能量全開！25 秒內攀爬更快，之後會昏睡',3200);}
    this.consume(slot);
  }
  useRope(it){
    const p=this.player;if(!p.grounded||p.state!=='move'){this.toast('要站在平台邊緣才能垂繩');return;}
    const box=p.support&&p.support.kind==='column'?p.support:null;if(!box){this.toast('要站在平台邊緣才能垂繩');return;}
    let best=null;
    for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const edge=dx?(dx>0?box.x2:box.x1):0,eZ=dz?(dz>0?box.z2:box.z1):0;
      const d=dx?Math.abs(p.x-edge):Math.abs(p.z-eZ);
      if(d<1.4&&(!best||d<best.d)&&!this.world.rims.some(r=>r.column===box.id&&r.dx===dx&&r.dz===dz))best={dx,dz,d,edge,eZ};
    }
    if(!best){this.toast('靠近平台邊緣再使用繩索捲');return;}
    const lower=this.world.topOfCell(box.i+best.dx,box.j+best.dz),len=ITEMS.rope_spool.length,yBottom=Math.max(lower,box.y2-len)+.1;
    if(box.y2-yBottom<2){this.toast('這裡下方太低，不需要繩索');return;}
    const rope={id:'rope'+this.placedRopes.length,x:best.dx?best.edge+best.dx*.45:p.x,z:best.dz?best.eZ+best.dz*.45:p.z,yTop:box.y2,yBottom,box:box.id,wall:{dx:best.dx,dz:best.dz},placed:true};
    this.ropes.push(rope);this.placedRopes.push(rope);this.consume(this.sel);this.emit('rope',{rope});this.toast('繩索垂下去了',1800);
  }
  usePiton(it){
    const p=this.player;if(p.state!=='wall'){this.toast('抓在岩壁上才能釘岩釘');return;}
    this.anchors.push({x:p.x,y:p.y+.8,z:p.z,nx:p.wall.nx,nz:p.wall.nz,charges:3});this.emit('piton',{anchor:this.anchors.at(-1)});this.emit('sound',{name:'piton'});
    this.consume(this.sel);this.toast('岩釘固定好了：附近可以安心休息',2200);
  }
  useChain(it,inp){
    const p=this.player;if(this.stamina<COST.chain){this.toast('體力不夠');return;}
    const o=V3(p.x,p.y+1,p.z),d=inp.aim||V3(Math.sin(p.yaw),.6,Math.cos(p.yaw)),l=Math.hypot(d.x,d.y,d.z)||1,dir=V3(d.x/l,d.y/l,d.z/l);
    const hit=rayCast(this.world,o,dir,20);
    if(!hit||hit.box.kind==='ground'||(Math.abs(hit.normal.y)<.5&&!hit.box.climb)){this.toast('鏈條沒有射中岩壁');p.use=.3;return;}
    it.ammo=(it.ammo??3)-1;this.spend(COST.chain);
    const n=hit.normal;let tx,ty,tz,wall=null;
    if(Math.abs(n.y)>.5){tx=hit.point.x;tz=hit.point.z;ty=hit.point.y;}   // top surface: land on it
    else{tx=hit.point.x+n.x*PLAYER.wallOffset;tz=hit.point.z+n.z*PLAYER.wallOffset;ty=hit.point.y-.75;wall={nx:n.x,nz:n.z};}
    if(ty<p.y+1||(wall&&pointSolid(this.world,tx,ty+.75,tz))){this.toast(ty<p.y+1?'目標太低':'目標太窄',1000);it.ammo++;this.stamina+=COST.chain;return;}
    p.chain={tx,ty,tz,wall,t:0,dur:Math.max(.35,Math.hypot(tx-p.x,ty-p.y,tz-p.z)/16),from:V3(p.x,p.y,p.z),hook:hit.point};p.state='chain';p.wall=null;this.emit('chain',{from:o,to:hit.point});this.emit('sound',{name:'chain'});
    if(it.ammo<=0){this.inv[this.sel]=null;this.toast('鏈條用完了');}
  }
  useDart(it,inp){
    const p=this.player,d=inp.aim||V3(Math.sin(p.yaw),0,Math.cos(p.yaw));let best=null;
    for(const r of [...this.reggies,...this.scouts]){
      const dx=r.x-p.x,dy=r.y+.8-(p.y+1),dz=r.z-p.z,l=Math.hypot(dx,dy,dz);if(l>16)continue;
      const cos=(dx*d.x+dy*d.y+dz*d.z)/(l*Math.hypot(d.x,d.y,d.z)||1);if(cos>.93&&(!best||l<best.l))best={r,l};
    }
    it.ammo=(it.ammo??3)-1;this.emit('dart',{from:V3(p.x,p.y+1,p.z),to:best?V3(best.r.x,best.r.y+.9,best.r.z):V3(p.x+d.x*12,p.y+1+d.y*12,p.z+d.z*12)});this.emit('sound',{name:'dart'});
    if(best){best.r.sleep=12;best.r.state='sleep';this.toast('命中！瑞吉睡著了 12 秒',2200);}else this.toast('沒有射中');
    if(it.ammo<=0){this.inv[this.sel]=null;}
  }
  // Magic bean: plant it beside a wall that rises above you; a vine grows up the wall.
  useBean(it){
    const p=this.player,b=p.support;
    if(!p.grounded||p.state!=='move'||!b||b.kind!=='column'){this.toast('站在高牆前才能種魔豆');return;}
    let best=null;
    for(const r of b.risers||[]){const edge=r.dx?(r.dx>0?b.x2:b.x1):(r.dz>0?b.z2:b.z1),d=r.dx?Math.abs(p.x-edge):Math.abs(p.z-edge);if(d<2.6&&(!best||d<best.d))best={...r,d,edge};}
    if(!best){this.toast('旁邊要有比你高的岩壁');return;}
    const nb=this.world.boxAtCell(b.i+best.dx,b.j+best.dz),top=Math.min(nb.y2,b.y2+12);
    const rope={id:'bean'+this.placedRopes.length,vine:true,bean:true,x:best.dx?best.edge-best.dx*.45:p.x,z:best.dz?best.edge-best.dz*.45:p.z,yTop:top,yBottom:b.y2,box:b.id,wall:{dx:-best.dx,dz:-best.dz},placed:true};
    this.ropes.push(rope);this.placedRopes.push(rope);this.consume(this.sel);this.emit('rope',{rope});this.emit('sound',{name:'crate'});this.toast(top>=nb.y2?'魔豆長成了藤蔓，一路通到上面':'魔豆長出 12 公尺的藤蔓，還差一點才到頂',2600);
  }
  // Shelf fungus: grows a platform out of the wall under your hands. It is a rest stop for 40 seconds.
  useShelf(it){
    const p=this.player;if(p.state!=='wall'||!p.wall){this.toast('抓在岩壁上才能長出棚架菇');return;}
    const w=p.wall,d=2,wid=2.6,nx=w.nx,nz=w.nz,px=p.x-nx*PLAYER.wallOffset,pz=p.z-nz*PLAYER.wallOffset;
    const cx=px+nx*d/2,cz=pz+nz*d/2,hx=nx?d/2:wid/2,hz=nz?d/2:wid/2,y=p.y+.05;
    const L={id:'shelf'+this.time.toFixed(1),x1:cx-hx,x2:cx+hx,z1:cz-hz,z2:cz+hz,y1:y-.4,y2:y,oneway:true,climb:false,kind:'ledge',zone:this.zone().index,column:-1,shelf:true,ttl:40,nx,nz};
    this.world.ledges.push(L);this.world.solids.push(L);this.shelves.push(L);
    it.charges=(it.charges??2)-1;if(it.charges<=0)this.inv[this.sel]=null;this.itemsUsed++;
    p.state='move';p.grounded=true;p.y=y;p.support=L;p.wall=null;p.vx=p.vy=p.vz=0;p.peakY=y;p.offCool=.3;p.lunge=0;
    this.emit('shelf',{shelf:L});this.emit('sound',{name:'crate'});this.toast('棚架菇長出來了：在上面好好休息 40 秒',2400);
  }
  useBounce(it){
    const p=this.player;if(!p.grounded||p.state!=='move'){this.toast('要站在地面上才能放彈跳菇');return;}
    const pad={x:p.x+Math.sin(p.yaw)*1.2,y:p.y,z:p.z+Math.cos(p.yaw)*1.2,r:1.2,cd:0};
    this.bounce.push(pad);it.charges=(it.charges??2)-1;if(it.charges<=0)this.inv[this.sel]=null;this.itemsUsed++;this.emit('bouncePad',{pad});this.emit('sound',{name:'crate'});this.toast('彈跳菇放好了：踩上去會被彈高',2200);
  }
  useFlag(it){
    const p=this.player;if(!p.grounded||p.state!=='move'){this.toast('要站穩了才能插路標旗');return;}
    this.flagRespawn={x:p.x,y:p.y,z:p.z,altar:'flag'};this.flags.push({x:p.x,y:p.y,z:p.z});this.consume(this.sel);this.emit('flag',{x:p.x,y:p.y,z:p.z});this.toast('路標旗插下了：下次昏迷會在這裡醒來',2600);
  }
  // The next camp above you, for the compass.
  guide(){const p=this.player;return this.world.camps.find(c=>c.y>p.y+1.5)||null;}
  updateMist(dt){
    const m=this.mist,asc=this.world.asc,p=this.player;if(!asc.mist)return;
    if(!m.started){if(this.time>=MIST_START){m.started=true;m.y=-20;this.toast('濃霧從山腳升起了！不要停下來，往高處走',4200);this.emit('mist',{start:true});}return;}
    m.y+=asc.mist*dt;
    const d=m.y-p.y;m.in=d>0&&p.state!=='faint';
    if(d>0&&p.state!=='faint'){m.inside+=dt;this.spend((9+d*.2)*dt);this.aff.cold=Math.min(.45,this.aff.cold+.02*dt);
      if(this.time-m.lastWarn>6){m.lastWarn=this.time;this.toast('你在濃霧裡！體力正在流失',1800);}
      if(this.stamina<=0&&p.state!=='faint'){this.faint('mist');}}
    else m.inside=Math.max(0,m.inside-dt);
  }
  // timed things: shelf platforms, balloon, beehives, bounce pads
  updateDynamic(dt){
    const p=this.player,w=this.world;
    if(this.effects.balloon>0)this.effects.balloon=Math.max(0,this.effects.balloon-dt);
    for(const s of [...this.shelves]){s.ttl-=dt;if(s.ttl<=0){s.dead=true;s.oneway=true;this.shelves.splice(this.shelves.indexOf(s),1);for(const arr of [w.ledges,w.solids]){const i=arr.indexOf(s);if(i>=0)arr.splice(i,1);}
      if(p.support===s){p.grounded=false;p.peakY=p.y;p.support=null;}this.emit('shelfGone',{shelf:s});}}
    for(const pad of this.bounce){pad.cd=Math.max(0,pad.cd-dt);}
    for(const h of this.hives){
      h.angry=Math.max(0,h.angry-dt);h.cd=Math.max(0,h.cd-dt);
      const near=Math.hypot(h.x-p.x,h.z-p.z)<3.4&&Math.abs(h.y-p.y)<4;
      if(near&&(!h.taken||h.angry>0)&&p.state!=='faint'&&h.cd<=0){h.cd=1.4;this.aff.poison=Math.min(.6,this.aff.poison+.03);this.spend(6);this.emit('sound',{name:'thorn'});this.emit('hurt',{injury:0});this.toast('被蜜蜂叮了！',900);}
    }
  }
  // ---- status, afflictions, stamina --------------------------------------------------------------------------------------
  updateStatus(dt){
    const s=this.status,p=this.player;
    if(s.energy>0){s.energy-=dt;if(s.energy<=0){s.sleep=7;s.crash=1;this.toast('能量耗盡…好睏…',2600);if(p.state==='wall'||p.state==='rope')this.letGo(true);}}
  }
  sleeping(dt){
    const s=this.status,p=this.player;s.sleep-=dt;
    this.stamina=Math.min(this.maxStamina(),this.stamina+22*dt);
    if(p.state==='wall'||p.state==='rope'||p.state==='anchored'){this.letGo(true);}
    this.physicsOnly(dt);
  }
  physicsOnly(dt){
    const p=this.player;if(p.state!=='move')return;
    p.vx*=Math.pow(.02,dt);p.vz*=Math.pow(.02,dt);this.integrate(dt,{});
  }
  afflictions(dt){
    const a=this.aff,z=this.zone(),asc=this.world.asc,p=this.player;
    a.hunger=Math.min(1,a.hunger+.0016*dt*z.hunger*asc.hunger);
    if(a.poison>0)a.poison=Math.max(0,a.poison-.0045*dt);
    a.injury=Math.max(0,a.injury-.00035*dt);
    const fire=this.nearFire(p),gust=this.wind.active>0?2.2:1;
    if(asc.cold&&p.y>z.y0+2&&z.temp<=0){a.cold=Math.min(.45,a.cold+(fire?-.03:.0016*asc.hazards)*dt);}
    else if(z.temp<0&&p.y>z.y0+2){a.cold=Math.min(.45,a.cold+(fire?-.03:.0013*-z.temp*asc.hazards*gust)*dt);}else a.cold=Math.max(0,a.cold-(fire?.03:.004)*dt);
    if(z.temp>0){const near=this.hazardNear('hot',p)?2.2:1;a.hot=Math.min(.45,a.hot+(fire?-.02:.001*z.temp*near*asc.hazards)*dt);}else a.hot=Math.max(0,a.hot-(fire?.03:.003)*dt);
    a.cold=Math.max(0,a.cold);a.hot=Math.max(0,a.hot);
    if(p.state==='move'&&p.grounded&&this.nearAltar(p,3.2))a.poison=Math.max(0,a.poison-.02*dt);
  }
  staminaCheck(dt){
    const p=this.player,max=this.maxStamina();
    const resting=(p.state==='move'&&p.grounded&&!p.sprinting)||p.state==='faint'||p.state==='mantle';
    if(resting&&!this.mist.in)this.stamina+=(p.state==='move'&&this.nearFire(p,5)?24:18)*dt*(this.exhausted?.7:1);
    else if(p.state==='anchored')this.stamina+=7*dt;
    this.stamina=clamp(this.stamina,0,max);
    if(this.stamina<=0&&['move'].includes(p.state)&&p.grounded)this.exhausted=true;if(this.exhausted&&this.stamina>=Math.min(20,max*.4))this.exhausted=false;
    if(max<=4&&p.state!=='faint')this.faint('cap');
  }
  // ---- movement: ground and air ----------------------------------------------------------------------------------------
  integrate(dt,inp){
    const p=this.player,w=this.world;
    p.vy=Math.max(-48,p.vy+GRAVITY*dt*(this.effects.balloon>0?.35:1));
    const sel=this.inv[this.sel];
    if(sel&&sel.kind==='parasol'&&!p.grounded&&p.vy<-2.8){p.vy=-2.8;p.peakY=Math.min(p.peakY,p.y+3);if(!p.glide){p.glide=true;this.emit('glide',{on:true});}}else if(p.glide&&(p.grounded||!sel||sel.kind!=='parasol')){p.glide=false;this.emit('glide',{on:false});}
    const hit=moveBody(w,p,p.vx*dt,p.vy*dt,p.vz*dt);
    if(hit.landed&&p.vy<=0){this.land(hit.landed);}else if(!hit.landed&&p.vy<-.5){p.grounded=false;}
    if(hit.ceiling&&p.vy>0)p.vy=0;
    // standing check: still supported?
    const sup=supportAt(w,p.x,p.z,p.y);if(p.grounded&&!(sup.box&&p.y-sup.y<.12)){p.grounded=false;}
    if(!p.grounded)p.peakY=Math.max(p.peakY,p.y);else p.support=sup.box;
    return hit;
  }
  land(box){
    const p=this.player,drop=p.peakY-p.y;p.vy=0;
    if(!p.grounded){
      p.grounded=true;p.support=box;
      if(drop>5){const fm=this.world.asc.fall??1,inj=Math.min(.5,(drop-5)*.02*fm);this.aff.injury=Math.min(.9,this.aff.injury+inj);this.spend(drop*.6);this.falls++;this.emit('sound',{name:'thud'});this.emit('landed',{drop});
        this.toast(drop>24/Math.sqrt(fm)?'':`摔傷了（落差 ${drop.toFixed(0)} 公尺）`,1800);if(drop>24/Math.sqrt(fm))this.faint('fall');}
      else if(drop>1.2)this.emit('sound',{name:'land'});
    }
    p.peakY=p.y;
  }
  moveState(dt,inp){
    const p=this.player,st=this.status;
    const energy=st.energy>0?1.4:1,inj=1-this.aff.injury*.25-this.aff.poison*.1;
    let wantSprint=inp.sprint&&p.grounded&&this.stamina>2&&!this.exhausted&&(Math.abs(inp.mx)+Math.abs(inp.mz)>.1);
    const speed=(wantSprint?5.4:3.1)*energy*inj;
    const gust=this.wind.active>0&&!p.grounded?this.wind.dir:null;
    let tx=inp.mx*speed,tz=inp.mz*speed;
    if(!p.grounded){tx=p.vx+(tx-p.vx)*Math.min(1,dt*2.2);tz=p.vz+(tz-p.vz)*Math.min(1,dt*2.2);}
    const k=Math.min(1,dt*(p.grounded?14:3));
    if(p.grounded||!this.opts.noAir){p.vx+=(tx-p.vx)*k;p.vz+=(tz-p.vz)*k;}
    if(gust){p.vx+=gust.x*4*dt;p.vz+=gust.z*4*dt;}
    p.sprinting=wantSprint;if(wantSprint)this.spend(COST.sprint*dt*(this.zone().id==='beach'?1:1.08));
    p.speed=Math.hypot(p.vx,p.vz);if(p.speed>.4)p.yaw=Math.atan2(p.vx,p.vz);
    if(inp.jump&&p.grounded&&this.stamina>=COST.jump&&!this.exhausted){p.vy=this.effects.balloon>0?9.6:7.6;p.grounded=false;p.peakY=p.y;this.spend(COST.jump);this.emit('sound',{name:'jump'});this.emit('jumped');}
    const hit=this.integrate(dt,inp);
    if(p.grounded)for(const pad of this.bounce){if(pad.cd<=0&&Math.hypot(pad.x-p.x,pad.z-p.z)<pad.r&&Math.abs(pad.y-p.y)<.4){pad.cd=.6;p.vy=15;p.grounded=false;p.peakY=p.y;this.emit('sound',{name:'jump'});this.emit('bounce',{pad});}}
    // attach to wall / edge / rope
    p.attachT=Math.max(0,p.attachT-dt);
    if(p.offCool<=0&&this.stamina>6){
      {const rope=this.findRope(p,inp);if(rope){this.attachRope(rope);return;}}
      const pushing=hit.x||hit.z;
      if(pushing){
        const c=hit.x&&(Math.abs(inp.mx)>.2)?{box:hit.x.box,nx:hit.x.nx,nz:0}:hit.z&&Math.abs(inp.mz)>.2?{box:hit.z.box,nx:0,nz:hit.z.nz}:null;
        if(c&&c.box.climb&&(-c.nx*inp.mx-c.nz*inp.mz)>.35*Math.hypot(inp.mx,inp.mz)){p.attachT+=dt*2;if(p.attachT>=.3||(!p.grounded&&p.attachT>=.1))this.attachWall(c);}
      }
      if(inp.grab&&p.state==='move'){const f=this.findGrabFace(p)||this.edgeGrab(p,inp);if(f){this.attachWall(f);if(f.drop)p.y=f.box.y2-1.0;}}
    }
    if(p.state==='move'&&!p.grounded&&p.y<-2.5)this.faint('drown');
  }
  findGrabFace(p){
    const w=this.world;
    for(const [nx,nz] of [[Math.round(Math.sin(p.yaw)*-1)||0,Math.round(Math.cos(p.yaw)*-1)||0],[1,0],[-1,0],[0,1],[0,-1]]){
      if(!nx&&!nz)continue;
      const chest=p.y+.75,px=p.x-nx*.75,pz=p.z-nz*.75;
      const b=pointSolid(w,px,chest,pz,true);
      if(b&&!pointSolid(w,p.x,chest,p.z))return {box:b,nx,nz};
    }
    return null;
  }
  // Standing at a column's edge with C held and pushing outwards: lower yourself over the lip and hang on the face below.
  edgeGrab(p,inp){
    const b=p.support;if(!b||b.kind!=='column'||!p.grounded||!b.climb)return null;
    const exposed=this.world.faces.filter(f=>f.box===b.id);
    for(const [nx,nz] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const d=nx?(nx>0?b.x2-p.x:p.x-b.x1):(nz>0?b.z2-p.z:p.z-b.z1);
      if(d>.9||(inp.mx*nx+inp.mz*nz)<.3)continue;
      const face=exposed.find(f=>f.dx===nx&&f.dz===nz);if(!face||b.y2-face.y0<2.2)continue;
      if(this.world.rims.some(r=>r.column===b.id&&r.dx===nx&&r.dz===nz))continue;
      return {box:b,nx,nz,drop:true};
    }
    return null;
  }
  freeAt(x,y,z){const q={x,y,z};return !this.world.solids.some(b=>!b.oneway&&overlaps(q,b,.27,1.4));}
  attachWall(c){
    const p=this.player,b=c.box;
    {const tx=c.nx?(c.nx>0?b.x2+PLAYER.wallOffset:b.x1-PLAYER.wallOffset):p.x,tz=c.nz?(c.nz>0?b.z2+PLAYER.wallOffset:b.z1-PLAYER.wallOffset):p.z,ty=c.drop?b.y2-1.0:p.y;
      if(!this.freeAt(tx,ty,tz))return;}p.state='wall';p.grounded=false;p.vx=p.vy=p.vz=0;p.lunge=0;p.attachT=0;p.climbPhase=0;
    p.wall={box:b,nx:c.nx,nz:c.nz};
    if(c.nx)p.x=c.nx>0?b.x2+PLAYER.wallOffset:b.x1-PLAYER.wallOffset;if(c.nz)p.z=c.nz>0?b.z2+PLAYER.wallOffset:b.z1-PLAYER.wallOffset;
    p.yaw=Math.atan2(-c.nx,-c.nz);this.emit('grab');this.emit('sound',{name:'grab'});
  }
  // ---- wall climbing --------------------------------------------------------------------------------------------------
  wallProbe(x,y,z,w){
    const chest=y+.75;
    const hold=pointSolid(this.world,x-w.nx*(PLAYER.wallOffset+.18),chest,z-w.nz*(PLAYER.wallOffset+.18),true);
    if(!hold)return null;if(pointSolid(this.world,x,chest,z))return null;return hold;
  }
  slipAt(p){return this.world.hazards.find(h=>h.type==='slip'&&this.volHit(h,p));}
  volHit(h,p){return p.x+.3>h.x1&&p.x-.3<h.x2&&p.z+.3>h.z1&&p.z-.3<h.z2&&p.y+1.2>h.y1&&p.y<h.y2;}
  hazardNear(type,p){return this.world.hazards.some(h=>h.type===type&&this.volHit(h,p));}
  anchorNear(p,r){return this.anchors.find(a=>a.charges>0&&Math.hypot(a.x-p.x,a.y-(p.y+.8),a.z-p.z)<r);}
  wallState(dt,inp){
    const p=this.player,w=p.wall,st=this.status;const prevY=p.y;
    p.yaw=Math.atan2(-w.nx,-w.nz);
    if(inp.release){this.letGo();return;}
    if(inp.jump&&inp.f<-.3){this.emit('sound',{name:'jump'});p.state='move';p.grounded=false;p.vx=w.nx*3.6;p.vz=w.nz*3.6;p.vy=4.6;p.peakY=p.y;p.offCool=.5;p.wall=null;return;}
    const rx=w.nz,rz=-w.nx;
    const energy=st.energy>0?1.45:1,gust=this.wind.active>0,slip=this.slipAt(p),hotWall=this.hazardNear('hot',p);
    const zoneMul=1+this.zone().temp*0+(this.world.zoneAt(p.y).index||0)*.06,anchor=this.anchorNear(p,1.5);
    let up=inp.f,side=inp.r;
    let drainMul=zoneMul*(slip?(slip.ice?2:1.6):1)*(hotWall?1.5:1)*(gust?2.2:1)*(st.energy>0?.75:1)*(anchor?.25:1)*(1+this.aff.injury*.6);
    let speedUp=1.5*energy,speedSide=1.3*energy;if(slip){speedUp*=slip.ice?.4:.55;}
    let dy=0,dl=0,cost;
    if(inp.jump&&p.lunge<=0&&this.stamina>=COST.lunge){p.lunge=.34;this.spend(COST.lunge*drainMul*this.climbMul());this.emit('sound',{name:'lunge'});this.emit('lunge');}
    if(p.lunge>0){p.lunge-=dt;dy=2.6/.34*dt;cost=0;}
    else{
      dy=up>.1?up*speedUp*dt:up<-.1?up*2.4*dt:0;dl=Math.abs(side)>.1?side*speedSide*dt:0;
      cost=up>.1?COST.climbUp:Math.abs(side)>.1?COST.climbSide:up<-.1?COST.climbDown:COST.hang;
      if(up>.1&&Math.abs(side)>.1)cost=(COST.climbUp+COST.climbSide)/2*1.1;
    }
    if(slip&&p.lunge<=0)dy-=(slip.ice?.55:.35)*dt;
    if(gust)dl+=this.wind.dir.x*rx*.9*dt+this.wind.dir.z*rz*.9*dt;
    this.spend(cost*drainMul*this.climbMul()*dt);
    p.climbPhase+=(Math.abs(dy)+Math.abs(dl))*1.6;p.speed=(Math.abs(dy)+Math.abs(dl))/dt;
    // lateral
    if(dl){const nx=p.x+rx*dl,nz=p.z+rz*dl;const h=this.wallProbe(nx,p.y,nz,w);if(h){p.x=nx;p.z=nz;w.box=h;}}
    // vertical
    if(dy){
      const ny=p.y+dy;
      if(dy<0){const sup=supportAt(this.world,p.x,p.z,ny+.3);if(sup.box&&ny<=sup.y+.02){p.state='move';p.grounded=true;p.y=sup.y;p.wall=null;p.peakY=p.y;p.support=sup.box;p.vx=w.nx*1;p.vz=w.nz*1;p.offCool=.3;return;}}
      const h=this.wallProbe(p.x,ny,p.z,w);
      if(h){p.y=ny;w.box=h;}
      else if(dy>0){
        // above the top edge? mantle onto the column top
        const top=w.box.y2;
        if(top-p.y<=1.2){const tx=p.x-w.nx*.9,tz=p.z-w.nz*.9;const q={x:tx,y:top,z:tz};
          if(!this.world.solids.some(b=>!b.oneway&&overlaps(q,b))){p.state='mantle';p.mantle={from:V3(p.x,p.y,p.z),to:V3(tx,top,tz),t:0,dur:.55};p.lunge=0;this.emit('sound',{name:'mantle'});return;}
        }
        p.lunge=0;
      }else{
        // moving down: land on whatever is below
        const sup=supportAt(this.world,p.x,p.z,p.y);
        if(sup.box&&p.y-sup.y<.5){p.state='move';p.grounded=true;p.y=sup.y;p.wall=null;p.peakY=p.y;p.support=sup.box;p.vx=w.nx*1;p.vz=w.nz*1;return;}
      }
    }
    // rest ledges
    for(const l of this.world.ledges){
      if(l.crumble&&this.crumbles.get(l.id)?.broken)continue;
      if(p.x>l.x1-.1&&p.x<l.x2+.1&&p.z>l.z1-.1&&p.z<l.z2+.1&&prevY<l.y2-.12&&p.y>=l.y2-.12&&p.y<=l.y2+.4&&dy>0){p.state='move';p.grounded=true;p.y=l.y2;p.wall=null;p.peakY=p.y;p.support=l;p.vx=p.vz=0;p.lunge=0;return;}
    }
    // out of stamina
    if(this.stamina<=0){
      const an=this.anchorNear(p,2.8);
      if(an){an.charges--;p.state='anchored';p.anchor=an;this.toast('岩釘救了你！趕快恢復體力',2400);this.emit('sound',{name:'piton'});}
      else{this.toast('體力耗盡，抓不住了！',1800);this.letGo(true);}
    }
  }
  anchoredState(dt,inp){
    const p=this.player,an=p.anchor;p.speed=0;
    p.x+=(an.x-p.x)*Math.min(1,dt*4)*0;p.yaw=Math.atan2(-an.nx,-an.nz);
    if(this.stamina>=Math.min(35,this.maxStamina()*.6)||inp.release){p.state='wall';p.wall={box:this.wallProbe(p.x,p.y,p.z,{nx:an.nx,nz:an.nz})||p.wall?.box,nx:an.nx,nz:an.nz};p.anchor=null;if(!p.wall.box){p.state='move';p.grounded=false;}}
  }
  mantleState(dt){
    const p=this.player,m=p.mantle;m.t+=dt;const t=clamp(m.t/m.dur,0,1),e=t*t*(3-2*t);
    p.x=m.from.x+(m.to.x-m.from.x)*e;p.z=m.from.z+(m.to.z-m.from.z)*e;p.y=m.from.y+(m.to.y-m.from.y)*(t<.6?e*1.0:1);
    p.speed=0;if(t>=1){p.state='move';p.grounded=true;p.y=m.to.y;p.mantle=null;p.peakY=p.y;p.vx=p.vz=0;p.wall=null;p.offCool=.25;const s=supportAt(this.world,p.x,p.z,p.y);p.support=s.box;}
  }
  chainState(dt){
    const p=this.player,c=p.chain;c.t+=dt;const t=clamp(c.t/c.dur,0,1),e=t*t*(3-2*t);
    p.x=c.from.x+(c.tx-c.from.x)*e;p.y=c.from.y+(c.ty-c.from.y)*e;p.z=c.from.z+(c.tz-c.from.z)*e;p.speed=0;
    if(t>=1){p.chain=null;if(c.wall){p.state='wall';p.wall={box:pointSolid(this.world,p.x-c.wall.nx*.7,p.y+.75,p.z-c.wall.nz*.7,true),nx:c.wall.nx,nz:c.wall.nz};if(!p.wall.box){p.state='move';p.grounded=false;p.peakY=p.y;}}
      else{p.state='move';p.grounded=false;p.vy=0;p.peakY=p.y;}}
  }
  // ---- ropes and vines -----------------------------------------------------------------------------------------------
  findRope(p,inp){
    for(const r of this.ropes){
      if(p.y>r.yTop+.1||p.y<r.yBottom-1.2)continue;
      if(Math.hypot(r.x-p.x,r.z-p.z)>.75)continue;
      const lowEnd=p.y<=r.yBottom+.9;
      if(inp.grab||(lowEnd&&inp.mx*(r.wall.dx||0)*-1+inp.mz*(r.wall.dz||0)*-1>.2)||(!p.grounded&&p.y>r.yBottom))return r;
    }
    return null;
  }
  attachRope(r){const p=this.player;p.state='rope';p.rope=r;p.grounded=false;p.vx=p.vy=p.vz=0;p.x=r.x;p.z=r.z;p.wall={box:null,nx:r.wall.dx,nz:r.wall.dz};p.yaw=Math.atan2(-r.wall.dx,-r.wall.dz);p.climbPhase=0;this.emit('grab');}
  ropeState(dt,inp){
    const p=this.player,r=p.rope;
    if(inp.release||(inp.jump&&inp.f<-.3)){if(inp.jump){p.state='move';p.grounded=false;p.vx=r.wall.dx*3;p.vz=r.wall.dz*3;p.vy=4;p.offCool=.5;p.rope=null;p.wall=null;return;}this.letGo();return;}
    const up=inp.f,energy=this.status.energy>0?1.4:1;
    const gust=this.wind.active>0;
    const dy=up>.1?up*1.7*energy*dt:up<-.1?up*2.4*dt:0;
    this.spend((up>.1?COST.rope:up<-.1?COST.rope*.4:COST.ropeIdle)*(gust?1.6:1)*this.climbMul()*dt);
    p.y+=dy;p.climbPhase+=Math.abs(dy)*1.6;p.speed=Math.abs(dy)/dt;
    if(p.y>=r.yTop-.05&&up>0){
      const tx=p.x-r.wall.dx*.9,tz=p.z-r.wall.dz*.9,q={x:tx,y:r.yTop,z:tz};
      if(!this.world.solids.some(b=>!b.oneway&&overlaps(q,b))){p.state='mantle';p.mantle={from:V3(p.x,p.y,p.z),to:V3(tx,r.yTop,tz),t:0,dur:.5};p.rope=null;return;}
      p.y=r.yTop-.05;
    }
    if(p.y<=r.yBottom&&up<0){const sup=supportAt(this.world,p.x,p.z,p.y);p.state='move';p.grounded=true;p.y=Math.max(sup.y,p.y);p.rope=null;p.wall=null;p.offCool=.3;p.peakY=p.y;p.support=sup.box;return;}
    if(this.stamina<=0){this.toast('體力耗盡，鬆手了！',1600);this.letGo(true);}
  }
  // ---- world hazards ----------------------------------------------------------------------------------------------------
  updateWorldHazards(dt){
    const p=this.player,w=this.world,asc=w.asc,zone=this.zone(),a=this.aff;
    if(p.state==='faint')return;
    for(const h of w.hazards){
      if(h.type==='thorn'&&this.volHit(h,p)&&(p.state==='wall'||p.state==='rope'||p.grounded)){h.cd=(h.cd??0)-dt;if(h.cd<=0){h.cd=1.1;this.aff.injury=Math.min(.9,this.aff.injury+.035);this.spend(14);this.emit('sound',{name:'thorn'});this.emit('hurt',{injury:.035});this.toast('被荊棘刺到了！',1200);if(p.state==='wall')this.letGo(true);}}
      if(h.type==='hot'&&p.state==='wall'&&this.volHit(h,p)){a.hot=Math.min(.45,a.hot+.02*dt*asc.hazards);}
      if(h.type==='geyser'&&Math.abs(h.y-p.y)<2&&Math.hypot(h.x-p.x,h.z-p.z)<h.r){
        const ph=(this.time+h.phase)%h.period;if(ph>5.2&&ph<6.4&&!h.fired){h.fired=true;p.vy=11;p.grounded=false;p.peakY=p.y;if(p.state!=='move')this.letGo(true);a.hot=Math.min(.45,a.hot+.04);a.injury=Math.min(.9,a.injury+.02);this.spend(10);this.emit('sound',{name:'geyser'});this.toast('間歇泉噴發！',1200);}
        if(ph<5)h.fired=false;
      }
      if(h.type==='firejet'&&Math.abs(h.y-p.y)<2.5&&Math.hypot(h.x-p.x,h.z-p.z)<h.r){
        const ph=(this.time+h.phase)%h.period;if(ph>3.6&&ph<4.6){h.cd=(h.cd??0)-dt;if(h.cd<=0){h.cd=1.2;a.hot=Math.min(.45,a.hot+.05);a.injury=Math.min(.9,a.injury+.05);this.spend(12);this.emit('sound',{name:'fire'});this.toast('被火焰燒到了！',1200);this.hurtPlayer(0,0,null,{knock:1.5,dx:p.x-h.x,dz:p.z-h.z});}}
      }
      if(h.type==='spore'&&Math.abs(h.y-p.y)<3&&Math.hypot(h.x-p.x,h.z-p.z)<h.r){a.sleepBuild+=dt;if(a.sleepBuild>1.6&&this.status.sleep<=0&&(a.sporeCd??0)<=0){this.status.sleep=5;a.sleepBuild=0;a.sporeCd=9;this.toast('孢子讓你昏昏欲睡…',2000);}}
    }
    a.sporeCd=Math.max(0,(a.sporeCd??0)-dt);
    if(a.sleepBuild>0&&!w.hazards.some(h=>h.type==='spore'&&Math.hypot(h.x-p.x,h.z-p.z)<h.r))a.sleepBuild=Math.max(0,a.sleepBuild-dt);
    // crumbling ledges
    for(const l of w.ledges){
      if(!l.crumble||l.dead)continue;let c=this.crumbles.get(l.id);if(!c){c={t:0,broken:false,respawn:0};this.crumbles.set(l.id,c);}
      if(c.broken){c.respawn-=dt;if(c.respawn<=0){c.broken=false;c.t=0;l.oneway=true;l.y1=l.y1;this.emit('ledge',{id:l.id,broken:false});}continue;}
      if(p.grounded&&p.support===l){c.t+=dt;if(c.t>.9){c.broken=true;c.respawn=14;this.emit('ledge',{id:l.id,broken:true});this.emit('sound',{name:'crumble'});p.grounded=false;p.peakY=p.y;this.toast('平台碎裂了！',1200);}}
      else c.t=Math.max(0,c.t-dt);
    }
    // wind
    const wd=this.wind;
    if(zone.id==='alpine'||zone.id==='citadel'||zone.id==='forge'&&false){
      wd.t-=dt;if(wd.active>0)wd.active-=dt;
      if(wd.t<=0){wd.t=range2(this.rand,14,24)/asc.hazards;wd.active=3.6;const ang=this.rand()*Math.PI*2;wd.dir={x:Math.cos(ang),z:Math.sin(ang)};this.emit('wind',{dir:wd.dir});this.toast('強風來襲！抓緊！',1600);}
      else if(wd.t<1.2&&!wd.warned){wd.warned=true;this.emit('windWarn');}
      if(wd.t>1.3)wd.warned=false;
    }else wd.active=0;
    // falling rocks
    if(['jungle','alpine','caldera','citadel'].includes(zone.id)&&p.y>8){
      this.boulderTimer-=dt;
      if(this.boulderTimer<=0){this.boulderTimer=range2(this.rand,11,19)/asc.hazards;this.spawnBoulder(zone);}
    }
    for(const b of this.boulders){
      b.t+=dt;if(b.t<b.delay)continue;b.vy=Math.min(40,b.vy+22*dt);b.y-=b.vy*dt;
      if(!b.hit&&Math.hypot(b.x-p.x,b.z-p.z)<1&&b.y<p.y+1.7&&b.y>p.y-.3&&p.state!=='faint'){b.hit=true;this.hurtPlayer(.07,22,null,{knock:2,dx:p.x-b.x,dz:p.z-b.z,dropGrip:true});this.emit('rockHit',{b});}
      const s=supportAt(w,b.x,b.z,b.y+.3,.6);if(b.y<=s.y+.4||b.y<-1)b.dead=true;
    }
    this.boulders=this.boulders.filter(b=>!b.dead);
  }
  spawnBoulder(zone){
    const p=this.player,off=this.rand()*Math.PI*2,x=p.x+Math.cos(off)*(this.rand()*2.5),z=p.z+Math.sin(off)*(this.rand()*2.5);
    this.boulders.push({x,z,y:p.y+30,vy:0,t:0,delay:1.6,hit:false,zone:zone.id});this.emit('rockWarn',{x,z});
  }
  // ---- Reggie -----------------------------------------------------------------------------------------------------------
  updateReggies(dt){
    for(const r of this.reggies)updateReggie(this,r,dt);
    this.scouts=this.scouts.filter(r=>updateReggie(this,r,dt));
  }
  // ---- progress: zones, rush penalty, summit ------------------------------------------------------------------------------
  progress(dt){
    const p=this.player,w=this.world,z=this.zone();
    if(!this.zoneEnter.has(z.index)&&p.y>=z.y0){this.zoneEnter.set(z.index,this.time);this.emit('zone',{zone:z});this.toast(`進入 ${z.name} 區`,3600);}
    const t=this.time-(this.zoneEnter.get(z.index)??0),expected=z.y0+.55*t+38;
    if(p.y>expected&&this.scouts.length===0&&!this.rushWarned&&p.state!=='faint'){
      // climbed far ahead of the pace: Reggie shows up on a ledge above to slow you down
      const above=w.boxes.filter(b=>b.y2>p.y+2&&b.y2<p.y+26&&Math.hypot((b.x1+b.x2)/2-p.x,(b.z1+b.z2)/2-p.z)<24).sort((a,b)=>a.y2-b.y2)[0];
      if(above&&!this.nearAltar({x:(above.x1+above.x2)/2,z:(above.z1+above.z2)/2,y:above.y2},5)){
        const r=makeReggie({id:100+this.scouts.length,box:above.id,zone:z.index,home:{x:(above.x1+above.x2)/2,z:(above.z1+above.z2)/2},scout:true,ttl:40},w);r.state='chase';this.scouts.push(r);this.rushWarned=true;
        this.emit('scout',{r});this.toast('爬太快了！瑞吉出現了',3200);
      }
    }
    if(p.y<expected-20)this.rushWarned=false;
    for(const sg of w.signs){
      if(this.signsSeen.has(sg.stage)||Math.hypot(sg.x-p.x,sg.z-p.z)>10||Math.abs(sg.y-p.y)>6)continue;
      this.signsSeen.add(sg.stage);
      this.emit('sign',{sign:sg});
      this.toast('前方三條路（面向前方，由左到右）：'+sg.lanes.map((st,i)=>`${['左','中','右'][i]}＝${ROUTES[st].name}（${ROUTES[st].short}）`).join('　')+'　· 按 M 看路線圖',7000);
    }
    if(!this.won&&Math.hypot(w.summit.x-p.x,w.summit.z-p.z)<2.6&&Math.abs(w.summit.y-p.y)<1.8){this.won=true;this.mode='won';this.emit('won');}
  }
  // ---- summary for UI ----------------------------------------------------------------------------------------------------
  info(){
    const p=this.player,z=this.zone(),max=this.maxStamina();
    return {altitude:p.y,height:this.world.height,zone:z,stamina:this.stamina,max,caps:this.caps(),state:p.state,exhausted:this.exhausted,energy:this.status.energy,sleep:this.status.sleep,
      interact:this.interactables()[0]?.label||'',time:this.time,bonus:this.bonus,slots:this.slots,
      lane:(p.support&&p.support.lane>=0)?ROUTES[p.support.style].name:'',mistY:this.mist.started?this.mist.y:null,balloon:this.effects.balloon,guide:this.hasItem('compass')>=0?this.guide():null};
  }
}
function range2(rand,a,b){return a+(b-a)*rand();}
function rand(r,a,b){return a+(b-a)*r();}
