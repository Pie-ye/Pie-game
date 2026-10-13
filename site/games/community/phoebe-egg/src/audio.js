let context=null,muted=false;
export function unlock(){try{context??=new(window.AudioContext||window.webkitAudioContext)();if(context.state==='suspended')context.resume().catch(()=>{});}catch{}}
export function toggle(){muted=!muted;return muted;}
export function play(type){
  if(muted||!context||context.state!=='running')return;
  const notes={pickup:[523,659],drop:[330],climb:[392,440],roll:[180,300],dodge:[880,1175],hit:[110,75],break:[170,90,55],deliver:[523,659,784],win:[523,659,784,1047],lose:[220,196,146],charge:[130,85],roar:[100,75,90],slam:[65],sweep:[150,95]}[type]||[440];
  notes.forEach((frequency,i)=>{const start=context.currentTime+i*.1,osc=context.createOscillator(),gain=context.createGain();osc.type=['hit','roar','slam','charge'].includes(type)?'sawtooth':'sine';osc.frequency.setValueAtTime(frequency,start);osc.frequency.exponentialRampToValueAtTime(frequency*.7,start+.17);gain.gain.setValueAtTime(.0001,start);gain.gain.exponentialRampToValueAtTime(.065,start+.01);gain.gain.exponentialRampToValueAtTime(.0001,start+.23);osc.connect(gain);gain.connect(context.destination);osc.start(start);osc.stop(start+.25);});
}
