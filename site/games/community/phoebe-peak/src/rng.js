// Deterministic helpers: the whole mountain is a pure function of (day seed, ascent).
export function mulberry32(seed){let a=seed>>>0;return()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
export function daySeed(now=Date.now()){return Math.floor(now/86400000);}
export const pick=(rand,list)=>list[Math.floor(rand()*list.length)];
export const range=(rand,a,b)=>a+(b-a)*rand();
export function weighted(rand,table){let total=0;for(const [,w] of table)total+=w;let r=rand()*total;for(const [v,w] of table){r-=w;if(r<=0)return v;}return table[0][0];}
