import {ZONES,ITEMS} from './data.js';
import {ATTACK_INFO} from './rules.js';
const $=id=>document.getElementById(id);
const COLORS={hunger:'#f0a23a',injury:'#e5453b',poison:'#a55bd6',cold:'#6ec3ff',hot:'#ff7a3d',weight:'#9aa5aa'};
const LABEL={hunger:'飢餓',injury:'受傷',poison:'中毒',cold:'寒冷',hot:'燥熱',weight:'負重'};
export function makeHud(game){
  const slots=$('slots'),caps=$('caps'),chips=$('chips'),altBar=$('alt-bar');
  // altitude bar shows the six zones
  altBar.style.background='linear-gradient(to top,'+game.world.zones.map(z=>{const c='#'+ZONES[z.index].fog.toString(16).padStart(6,'0'),a=z.y0/game.world.height*100,b=z.y1/game.world.height*100;return `${c} ${a}%, ${c} ${b}%`;}).join(',')+')';
  const slotEls=[];
  for(let i=0;i<4;i++){const d=document.createElement('div');d.className='slot';d.innerHTML=`<span class="key">${i+1}</span><span class="count"></span>`;d.onclick=()=>{game.sel=i;};slots.append(d);slotEls.push(d);}
  const capEls={};for(const k of Object.keys(COLORS)){const d=document.createElement('div');d.className='cap';d.style.background=COLORS[k];d.style.opacity=.85;caps.append(d);capEls[k]=d;}
  let toastTimer=0,lastSig='',zoneNameShown='';
  function toast(text,ms=3200){if(!text)return;const t=$('toast');t.textContent=text;t.classList.add('on');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('on'),ms);}
  function iconFor(kind){return `<img alt="${ITEMS[kind].name}" title="${ITEMS[kind].name}" src="./assets/icons/${kind}.png" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'fallback',textContent:'${ITEMS[kind].name}'}))">`;}
  function renderSlots(){
    const sig=game.inv.map(i=>i?i.kind+(i.charges??'')+(i.ammo??''):'-').join('|')+game.sel;if(sig===lastSig)return;lastSig=sig;
    slotEls.forEach((el,i)=>{const it=game.inv[i];el.classList.toggle('sel',i===game.sel);el.querySelector('img,.fallback')?.remove();
      el.querySelector('.count').textContent=it?(it.ammo!=null?'×'+it.ammo:it.charges!=null?'×'+it.charges:''):'';
      if(it){el.insertAdjacentHTML('afterbegin',iconFor(it.kind));el.title=ITEMS[it.kind].name+' — '+ITEMS[it.kind].desc;}else el.title='空格';});
  }
  function update(dt,view){
    const info=game.info(),c=info.caps;
    // stamina bar: left = current stamina, right = what each affliction has taken away
    const max=info.max;$('fill').style.width=info.stamina+'%';$('fill').className=info.energy>0?'energy':info.exhausted||info.stamina<=0?'out':info.stamina<28?'low':'';
    $('max-mark').style.left=max+'%';
    let right=0;for(const k of ['hunger','injury','poison','cold','hot','weight']){const w=Math.max(0,c[k]*100);const el=capEls[k];el.style.width=w+'%';el.style.right=right+'%';el.style.display=w<.2?'none':'block';right+=w;}
    chips.innerHTML='';for(const k of ['hunger','injury','poison','cold','hot','weight']){const v=c[k]*100;if(v>=1){const s=document.createElement('span');s.className='chip';s.style.background=COLORS[k];s.textContent=`${LABEL[k]} −${v.toFixed(0)}%`;chips.append(s);}}
    if(info.energy>0){const s=document.createElement('span');s.className='chip';s.style.background='#ffd84a';s.textContent=`能量 ${info.energy.toFixed(0)}s`;chips.append(s);}
    if(game.status.sleep>0){const s=document.createElement('span');s.className='chip';s.style.background='#7f8cff';s.textContent='昏睡中…';chips.append(s);}
    // altitude
    const frac=Math.min(1,info.altitude/game.world.height);
    const bar=altBar.getBoundingClientRect(),panel=$('altitude').getBoundingClientRect();$('alt-marker').style.top=(30+(1-frac)*(bar.height||200)-3)+'px';
    $('alt-text').textContent=`${info.altitude.toFixed(0)} m`;
    const zn=`${info.zone.name} · ${info.altitude.toFixed(0)} / ${game.world.height.toFixed(0)} m${game.world.gloom===info.zone.id?' · 幽暗':''}`;if(zn!==zoneNameShown){zoneNameShown=zn;$('zone-name').textContent=zn;}
    renderSlots();
    const hint=info.interact||(game.player.state==='wall'?'W/S 上下 · A/D 橫移 · Space 蹬躍 · C 放手':game.player.state==='rope'?'W/S 沿繩攀爬 · Space+S 跳開':'');
    $('hint').textContent=hint;
    const sel=game.inv[game.sel],spec=sel&&ITEMS[sel.kind];$('aim').hidden=!(spec&&['chain','dart'].includes(spec.kind));
    // Reggie warning
    let warn='';for(const r of [...game.reggies,...game.scouts]){if(r.state==='windup'&&Math.hypot(r.x-game.player.x,r.z-game.player.z,r.y-game.player.y)<16){warn=ATTACK_INFO[r.attack].label;break;}}
    const w=$('warn');w.textContent=warn;w.classList.toggle('on',!!warn);
    // screen effects
    const fx=(id,v)=>{$(id).style.opacity=Math.max(0,Math.min(1,v)).toFixed(2);};
    view.hurt=Math.max(0,(view.hurt||0)-dt*1.6);fx('fx-hurt',view.hurt+(game.maxStamina()<25?.25:0));
    fx('fx-cold',c.cold*2.2);fx('fx-heat',c.hot*2.2);fx('fx-poison',c.poison*1.6);
    fx('fx-gloom',game.world.gloom===info.zone.id?.85:0);
    fx('fx-faint',game.player.state==='faint'?Math.min(1,(3.6-game.player.faintT)*2):0);fx('fx-sleep',game.status.sleep>0?.8:0);
  }
  return {toast,update,renderSlots};
}
