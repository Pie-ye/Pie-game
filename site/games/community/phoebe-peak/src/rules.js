export const ATTACK_INFO={
  charge:{label:'肚皮衝撞！向側面翻滾'},
  roar:{radius:6,label:'瑞吉大吼！遠離他或抓緊岩壁'},
  slam:{radius:4.8,label:'拍地震波！跳起或遠離'},
  sweep:{radius:3.8,label:'甩身攻擊！拉開距離'},
};
export const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
export const approach=(v,t,s)=>v<t?Math.min(t,v+s):Math.max(t,v-s);
