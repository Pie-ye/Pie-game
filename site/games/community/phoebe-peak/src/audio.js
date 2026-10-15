// WebAudio-synthesised effects; no samples are shipped.
let ctx=null,muted=false,master=null,windGain=null;
export function unlock(){try{ctx??=new(window.AudioContext||window.webkitAudioContext)();if(ctx.state==='suspended')ctx.resume().catch(()=>{});if(!master){master=ctx.createGain();master.gain.value=.55;master.connect(ctx.destination);}}catch{}}
export function toggle(){muted=!muted;if(master)master.gain.value=muted?0:.55;return muted;}
const ok=()=>ctx&&ctx.state==='running'&&!muted;
function tone(f0,f1,dur,type='sine',vol=.2,delay=0){
  const t=ctx.currentTime+delay,o=ctx.createOscillator(),g=ctx.createGain();o.type=type;o.frequency.setValueAtTime(f0,t);o.frequency.exponentialRampToValueAtTime(Math.max(20,f1),t+dur);
  g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(vol,t+.01);g.gain.exponentialRampToValueAtTime(.0008,t+dur);o.connect(g);g.connect(master);o.start(t);o.stop(t+dur+.05);
}
function noise(dur,vol=.2,freq=1200,q=.8,delay=0,type='lowpass'){
  const t=ctx.currentTime+delay,len=Math.floor(ctx.sampleRate*dur),buf=ctx.createBuffer(1,len,ctx.sampleRate),d=buf.getChannelData(0);
  for(let i=0;i<len;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/len,1.5);
  const s=ctx.createBufferSource();s.buffer=buf;const f=ctx.createBiquadFilter();f.type=type;f.frequency.value=freq;f.Q.value=q;const g=ctx.createGain();g.gain.value=vol;s.connect(f);f.connect(g);g.connect(master);s.start(t);
}
const FX={
  jump:()=>tone(260,520,.14,'triangle',.14),land:()=>noise(.1,.18,500),thud:()=>{noise(.28,.5,260);tone(90,40,.3,'sine',.35);},
  grab:()=>{noise(.07,.18,2200,1,0,'highpass');tone(180,120,.08,'square',.05);},lunge:()=>{tone(200,700,.2,'sawtooth',.12);noise(.15,.1,1800,1,0,'highpass');},
  mantle:()=>{noise(.18,.15,900);tone(150,230,.2,'triangle',.12);},pickup:()=>{tone(660,990,.1,'sine',.16);tone(990,1320,.12,'sine',.12,.08);},drop:()=>tone(300,160,.12,'triangle',.14),
  eat:()=>{for(let i=0;i<4;i++)noise(.06,.2,1500,2,i*.12,'bandpass');},drink:()=>{for(let i=0;i<3;i++)tone(300+i*40,180,.1,'sine',.1,i*.13);},
  crate:()=>{noise(.3,.3,600);tone(140,90,.25,'square',.1);},altar:()=>{[392,494,587,784].forEach((f,i)=>tone(f,f,.5,'sine',.13,i*.12));},crystal:()=>{[880,1175,1568].forEach((f,i)=>tone(f,f*1.01,.45,'triangle',.1,i*.07));},
  hit:()=>{noise(.2,.4,500);tone(130,55,.25,'sawtooth',.25);},dodge:()=>{tone(880,1320,.1,'sine',.12);},thorn:()=>{noise(.12,.18,3000,1,0,'highpass');tone(520,260,.1,'square',.07);},
  geyser:()=>noise(.7,.3,900,.5,0,'bandpass'),fire:()=>{noise(.5,.25,700,.4);tone(110,70,.4,'sawtooth',.1);},crumble:()=>{noise(.6,.35,450);},
  piton:()=>{tone(1400,1000,.05,'square',.12);tone(1400,1000,.05,'square',.12,.1);tone(1400,1000,.05,'square',.12,.2);},chain:()=>{for(let i=0;i<5;i++)tone(900+i*60,700,.04,'square',.07,i*.04);noise(.2,.12,2500,1,.15,'highpass');},
  dart:()=>{noise(.12,.2,3500,1,0,'highpass');tone(1100,500,.12,'triangle',.08);},faint:()=>{tone(300,70,.9,'sawtooth',.2);},wake:()=>{[262,330,392].forEach((f,i)=>tone(f,f,.3,'sine',.12,i*.12));},
  won:()=>{[523,659,784,1047,1319].forEach((f,i)=>tone(f,f,.5,'triangle',.16,i*.14));},zone:()=>{[330,440,554].forEach((f,i)=>tone(f,f,.4,'sine',.1,i*.1));},
  roar:()=>{tone(180,70,.7,'sawtooth',.3);tone(260,90,.6,'square',.12);noise(.6,.25,400);},slam:()=>{tone(70,28,.5,'sine',.5);noise(.4,.4,220);},sweep:()=>{noise(.35,.25,1400,.6,0,'bandpass');tone(300,160,.3,'sawtooth',.12);},charge:()=>{tone(120,260,.45,'sawtooth',.2);noise(.4,.18,600);},
  rock:()=>{noise(.5,.4,320);tone(100,45,.4,'sine',.3);},wind:()=>noise(1.8,.22,700,.3,0,'bandpass'),poison:()=>{tone(220,110,.6,'sawtooth',.14);},
};
export function play(name){if(!ok())return;try{FX[name]?.();}catch{}}
