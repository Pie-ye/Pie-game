import {T,mat,node,surface,loft,strand,piping,badge,profile} from './mesh-tools.mjs';
const ivory=mat('ivory-cloth',0xfff3da),navy=mat('navy-cloth',0x182b4a),blue=mat('blue-ribbon',0x438ec7),gold=mat('gold-embroidery',0xe3bd72),skin=mat('skin',0xffddc4);
const hair=mat('hair-gold',0xf8d795),hairShade=mat('hair-shadow',0xd7ae70),hairLight=mat('hair-highlight',0xffedba),purple=mat('violet-hat-trim',0x8f80ba);
hair.color.set(0xffffff);hair.userData.texture='phoebe-hair.png';
hairShade.color.set(0xe8d4af);hairShade.userData.texture='phoebe-hair.png';
const face=mat('anime-face',0xffffff);face.userData.texture='phoebe-face.png';face.userData.unlit=true;
const sole=mat('shoe-sole',0x172236),glove=mat('glove',0x27364b);

export function phoebe(){
  const root=node(null,'Phoebe'),rig=node(root,'rig'),body=node(rig,'body',0,1.12,0);
  // Tailored torso: narrower waist, shoulder breadth, front opening and pleated hem.
  loft(body,'navy-underdress',[[-.32,.49,.30],[-.27,.50,.30],[.0,.34,.23],[.34,.29,.22],[.59,.39,.24],[.7,.18,.17]],navy,{pleat:.018});
  loft(body,'white-tailored-coat',[[-.26,.54,.34],[-.18,.51,.32],[.05,.37,.26],[.32,.3,.24],[.53,.37,.25],[.62,.4,.24]],ivory,{start:.22,end:Math.PI*2-.22,pleat:.035});
  loft(body,'pleated-skirt',[[-.40,.55,.35],[-.35,.56,.35],[-.25,.505,.315]],ivory,{pleat:.055});
  for(let i=0;i<14;i++){
    const a=i/14*Math.PI*2;
    piping(body,`skirt-fold-${i}`,[[Math.sin(a)*.55,-.37,Math.cos(a)*.35],[Math.sin(a)*.49,-.15,Math.cos(a)*.31],[Math.sin(a)*.36,0,Math.cos(a)*.24]],.006, i%2?gold:navy);
  }
  const hem=[];for(let i=0;i<=56;i++){const a=i/56*Math.PI*2;hem.push([Math.sin(a)*.57,-.34,Math.cos(a)*.365]);}
  piping(body,'hem-navy-binding',hem,.02,navy);
  for(const side of [-1,1]){
    piping(body,`front-gold-seam-${side}`,[[side*.125,-.27,.345],[side*.10,.02,.268],[side*.08,.3,.247],[side*.10,.5,.258]],.012,gold);
    badge(body,`lapel-${side}`,[[0,0],[side*.19,.18],[side*.08,.36],[-side*.04,.23]],.028,navy,side*.14,.31,.247);
  }
  loft(body,'stand-collar',[[.59,.17,.155],[.7,.175,.16],[.78,.17,.155]],navy,{rings:10});
  badge(body,'blue-chest-ribbon',[[-.12,.2],[.12,.2],[.145,-.41],[0,-.33],[-.145,-.41]],.025,blue,0,.50,.31);
  badge(body,'ribbon-light-panel',[[-.06,.12],[.04,.12],[.06,-.27],[0,-.21],[-.05,-.27]],.009,mat('ribbon-light',0x77b2df),0,.50,.34);
  badge(body,'gold-star-clasp',[[0,.11],[.035,.035],[.1,0],[.035,-.03],[0,-.105],[-.035,-.03],[-.1,0],[-.035,.035]],.025,gold,0,.59,.35);
  for(let i=0;i<2;i++)piping(body,`shoulder-cord-${i}`,[[.02,.58,.34],[.18,.36-i*.05,.34],[.37,.35-i*.03,.24],[.4,.59,.06]],.025,navy);
  piping(body,'shoulder-gold-cord',[[.06,.6,.35],[.20,.4,.355],[.365,.4,.25],[.4,.61,.04]],.009,gold);
  badge(body,'side-navy-placket',[[-.035,.32],[.10,.32],[.21,-.29],[.06,-.3]],.035,navy,.27,.04,.29);
  for(let i=0;i<3;i++){
    const points=[];for(let j=0;j<12;j++){const a=j/12*Math.PI*2;points.push([Math.cos(a)*.032,Math.sin(a)*.032]);}
    badge(body,`button-${i}`,points,.016,gold,.35+i*.04,.24-i*.21,.335);
  }
  const head=node(body,'head',0,1.20,0);
  // Sculpted anime head with tapered jaw, flattened facial plane and UV-painted eyes.
  const faceMesh=loft(head,'sculpted-face',[[-.49,.015,.08,0,.04],[-.44,.16,.20,0,.03],[-.32,.36,.33,0,.015],[-.10,.50,.40],[.13,.515,.415],[.33,.47,.39],[.49,.32,.29],[.55,.025,.06]],face,{rings:56,segments:80,flatten:.46,uv:(_u,_v,p)=>[.5+p[0]/1.30,(p[1]+.55)/1.20]});
  const facePosition=faceMesh.geometry.attributes.position;
  for(let i=0;i<facePosition.count;i++){const x=facePosition.getX(i),y=facePosition.getY(i),z=facePosition.getZ(i);if(z>0)facePosition.setZ(i,z+.042*Math.exp(-x*x/.008-(y+.105)*(y+.105)/.006));}faceMesh.geometry.computeVertexNormals();
  for(const side of [-1,1])loft(head,`ear-${side}`,[[-.2,.04,.03,side*.485,.025],[-.10,.085,.055,side*.50,.025],[.04,.07,.045,side*.49,.02],[.08,.01,.01,side*.485,.02]],skin,{rings:16,segments:16});
  const hairRoot=node(head,'hair');
  // Continuous crown with individually tapered volumetric locks, rather than ellipsoids.
  loft(hairRoot,'hair-crown',[[.01,.52,.44],[.23,.53,.445],[.44,.42,.36],[.57,.11,.12]],hair,{start:.91,end:Math.PI*2-.91,rings:32});
  for(let i=0;i<13;i++){
    const a=.95+i/12*(Math.PI*2-1.9),s=Math.sin(a),c=Math.cos(a);
    strand(hairRoot,`long-lock-${i}`,[[s*.44,.39,c*.38],[s*.55,-.12,c*.45],[s*.56,-.65,c*.45],[s*(.65+.06*Math.sin(i)),-1.14,c*.45],[s*.69,-1.55+Math.abs(s)*.11,c*.36+.06]],.19,.065,i%3===0?hairShade:hair,{axis:[Math.cos(a),0,-Math.sin(a)],steps:38});
    if(i%2===0)strand(hairRoot,`lock-highlight-${i}`,[[s*.48,.2,c*.43],[s*.575,-.28,c*.492],[s*.60,-.72,c*.49],[s*.69,-1.2,c*.39]],.052,.007,hairLight,{axis:[Math.cos(a),0,-Math.sin(a)]});
  }
  for(let i=-3;i<=3;i++){
    const x=i*.127;
    strand(hairRoot,`bang-${i}`,[[x*.62,.50,.24],[x*.9,.4,.41],[x,.25,.46],[x+(i>0?.035:-.02),.16+Math.abs(i)*.015,.465]],.103,.047,i===-3?hairShade:hair,{steps:22});
    if(i%2===0)strand(hairRoot,`bang-sheen-${i}`,[[x*.8,.42,.435],[x,.32,.505],[x+.018,.22,.50]],.027,.004,hairLight,{steps:12});
  }
  for(const side of [-1,1]){
    strand(hairRoot,`face-framing-lock-${side}`,[[side*.42,.42,.29],[side*.5,.15,.365],[side*.53,-.25,.39],[side*.43,-.53,.40]],.105,.055,hair,{steps:30});
    const clip=node(head,`cross-clip-${side}`,side*.36,.28,.52);clip.visible=side===1;clip.rotation.z=.45;
    if(side===1){badge(clip,'clip-horizontal',[[-.13,-.035],[.13,-.035],[.13,.035],[-.13,.035]],.025,navy);badge(clip,'clip-vertical',[[-.035,-.13],[.035,-.13],[.035,.13],[-.035,.13]],.032,navy);badge(clip,'clip-blue',[[-.018,-.10],[.018,-.10],[.018,.10],[-.018,.10]],.005,blue,0,0,.04);}
  }
  const hat=node(head,'hat',0,.50,-.015);
  // Curved brim with a turned ivory edge, rounded dome and scalloped ribbon bands.
  surface(hat,'hat-brim',96,10,(u,v)=>{const a=u*Math.PI*2,r=.36+v*.69;return [Math.sin(a)*r,.04-.055*v+.055*v*v+Math.cos(a)*.016,Math.cos(a)*r*.89];},ivory);
  const edge=[];for(let i=0;i<=80;i++){const a=i/80*Math.PI*2;edge.push([Math.sin(a)*1.05,.04+Math.cos(a)*.016,Math.cos(a)*.935]);}
  piping(hat,'brim-ink-edge',edge,.016,navy);
  loft(hat,'hat-dome',[[.036,.54,.49],[.10,.54,.49],[.25,.5,.455],[.39,.415,.38],[.48,.28,.255],[.51,.015,.018]],ivory,{rings:38,segments:72});
  surface(hat,'hat-navy-band',96,8,(u,v)=>{const a=u*Math.PI*2,y=.08+v*(.17+.033*Math.cos(a*9));const r=.55-(y-.08)*.19;return [Math.sin(a)*r,y,Math.cos(a)*r*.91];},navy);
  for(let row=0;row<2;row++){
    const trim=[];for(let j=0;j<=100;j++){const a=j/100*Math.PI*2,y=.21+row*.065+.024*Math.cos(a*9),r=.553-(y-.08)*.19;trim.push([Math.sin(a)*r,y,Math.cos(a)*r*.91]);}
    piping(hat,`scallop-${row}`,trim,.016,row?navy:purple);
  }
  for(let i=0;i<12;i++){
    const a=i/12*Math.PI*2,star=badge(hat,`hat-star-${i}`,[[0,.042],[.011,.012],[.038,0],[.011,-.01],[0,-.04],[-.011,-.01],[-.038,0],[-.011,.012]],.008,gold,Math.sin(a)*.547,.147,Math.cos(a)*.498);star.rotation.y=a;
  }
  for(const side of [-1,1]){
    const arm=node(body,side<0?'armL':'armR',side*.37,.60,0);
    loft(arm,`bell-sleeve-${side}`,[[0,.13,.14],[-.11,.15,.16],[-.27,.17,.17],[-.48,.225,.205],[-.56,.24,.215]],ivory,{rings:32});
    loft(arm,`sleeve-cuff-${side}`,[[-.48,.228,.208],[-.52,.244,.22],[-.59,.239,.215]],navy,{rings:10});
    loft(arm,`sleeve-gold-edge-${side}`,[[-.49,.23,.211],[-.504,.238,.216]],gold,{rings:2});
    loft(arm,`gloved-palm-${side}`,[[-.55,.10,.07,0,.01],[-.63,.115,.075,0,.02],[-.73,.1,.072,0,.04],[-.77,.04,.04,0,.05]],glove,{rings:20,segments:24});
    for(let finger=0;finger<4;finger++)strand(arm,`finger-${side}-${finger}`,[[(-1.5+finger)*.047,-.71,.04],[(-1.5+finger)*.052,-.80,.065],[(-1.5+finger)*.047,-.83,.1]],.022,.025,glove,{blunt:true,steps:10,sides:8});
    strand(arm,`thumb-${side}`,[[side*.09,-.62,.045],[side*.14,-.70,.10],[side*.105,-.74,.15]],.045,.04,glove,{blunt:true,steps:12});
    const leg=node(rig,side<0?'legL':'legR',side*.21,.94,0);
    loft(leg,`stocking-${side}`,[[0,.12,.13],[-.1,.12,.125],[-.35,.10,.11],[-.52,.09,.10],[-.70,.08,.095],[-.79,.085,.10]],ivory,{rings:30,segments:28});
    for(let i=0;i<3;i++)loft(leg,`stocking-stripe-${side}-${i}`,[[-.12-i*.13,.119-i*.009,.128-i*.008],[-.165-i*.13,.116-i*.009,.125-i*.008]],navy,{rings:3,segments:28});
    const shoe=node(leg,`shoe-${side}`,0,-.82,.055);
    loft(shoe,'shoe-upper',[[-.09,.15,.245,0,.07],[-.045,.16,.255,0,.065],[.04,.145,.23,0,.04],[.14,.10,.145,0,0],[.18,.07,.08,0,-.015]],navy,{rings:25,segments:40});
    loft(shoe,'shoe-sole',[[-.11,.148,.25,0,.07],[-.085,.164,.261,0,.07],[-.055,.16,.256,0,.07]],sole,{rings:6});
    piping(shoe,'shoe-gold-detail',[[-.05,.06,.226],[0,.08,.246],[.05,.06,.226]],.012,gold);
  }
  node(body,'carry',0,-.02,.63);
  root.userData={author:'Pie Game',style:'anime',version:2};return root;
}

const brown=mat('reggie-brown',0x785247),brownLight=mat('reggie-warm',0x966c54),brownDark=mat('reggie-flippers',0x573d38),cream=mat('reggie-cream',0xecc899),mouth=mat('mouth-interior',0x431c32),tongue=mat('tongue',0xe47991),white=mat('ivory-teeth',0xfff2d9),black=mat('eye-black',0x172034),shine=mat('eye-shine',0xffffff);
black.userData.unlit=true;shine.userData.unlit=true;
export function reggie(){
  const root=node(null,'Reggie'),body=node(root,'body');
  const rows=[[.02,.05,.12,0,-.55],[.18,1.05,1.55,0,-.5],[.5,1.22,1.66,0,-.43],[.9,1.16,1.53,0,-.36],[1.3,.94,1.2,0,-.12],[1.7,.73,.88,0,.4],[2.1,.65,.65,0,.88],[2.48,.62,.52,0,1.1],[2.78,.46,.40,0,1.13],[2.95,.12,.15,0,1.1],[2.98,.008,.01,0,1.1]];
  loft(body,'continuous-sealion-sculpt',rows,brown,{segments:80,rings:88});
  surface(body,'cream-chest',40,40,(u,v)=>{
    const [y,rx,rz,,cz]=profile(rows,.035+v*.60),a=(u-.5)*(1.9-.7*v);
    return [Math.sin(a)*(rx+.012),y,cz+Math.cos(a)*(rz+.012)];
  },cream);
  const head=node(body,'head',0,2.30,1.18);
  // Sculpted eye patches follow the forehead, with anime highlights, not protruding eyeballs.
  for(const side of [-1,1]){
    const eye=node(head,`eye-${side}`,side*.345,.29,.396);eye.rotation.y=side*.3;
    surface(eye,'eye-outline',48,12,(u,v)=>{const a=u*Math.PI*2,r=v;return [Math.cos(a)*.178*r,Math.sin(a)*.20*r,.035*(1-r*r)];},black);
    surface(eye,'eye-reflection',32,8,(u,v)=>{const a=u*Math.PI*2;return [Math.cos(a)*.064*v-.041,Math.sin(a)*.077*v+.065,.039];},shine);
    surface(eye,'small-reflection',20,5,(u,v)=>{const a=u*Math.PI*2;return [Math.cos(a)*.022*v+.066,Math.sin(a)*.026*v-.074,.036];},shine);
    piping(head,`brow-${side}`,[[side*.19,.49,.36],[side*.34,.53,.35],[side*.46,.48,.27]],.027,brownDark);
  }
  const jaw=node(head,'jaw',0,-.34,.55);
  // Deep concave mouth surface, raised lip ring, separately modeled tongue and teeth.
  surface(jaw,'mouth-cavity',64,24,(u,v)=>{const a=u*Math.PI*2;return [Math.cos(a)*.43*v,Math.sin(a)*.59*v,-.13*(1-v*v)];},mouth);
  const lip=[];for(let i=0;i<=72;i++){const a=i/72*Math.PI*2;lip.push([Math.cos(a)*.45,Math.sin(a)*.61,.01]);}
  piping(jaw,'raised-mouth-lip',lip,.043,brownDark);
  const lowerLip=[];for(let i=0;i<=32;i++){const a=Math.PI+i/32*Math.PI;lowerLip.push([Math.cos(a)*.46,Math.sin(a)*.64-.015,.005]);}
  piping(jaw,'cream-lower-jaw',lowerLip,.072,cream);
  surface(jaw,'sculpted-tongue',40,20,(u,v)=>{const a=u*Math.PI*2;return [Math.cos(a)*.28*v,-.36+Math.sin(a)*.19*v,.02+.07*(1-v*v)];},tongue);
  piping(jaw,'tongue-crease',[[0,-.47,.085],[.015,-.37,.10],[0,-.25,.075]],.009,mat('tongue-crease',0xad4f6b));
  for(const row of [-1,1])for(let i=-3;i<=3;i++){
    const x=i*.103,y=row*Math.sqrt(1-(x/.44)**2)*.52;
    strand(jaw,`tooth-${row}-${i}`,[[x,y,.025],[x,y-row*.055,.055],[x+Math.sign(x)*.008,y-row*.13,.04]],.047,.035,white,{steps:10,sides:10});
  }
  for(const side of [-1,1]){
    strand(head,`muzzle-${side}`,[[0,.34,.51],[side*.19,.24,.61],[side*.36,.16,.54]],.13,.10,cream,{blunt:true,axis:[0,1,0],steps:22});
    for(let i=0;i<4;i++)piping(head,`whisker-${side}-${i}`,[[side*.20,.19,.67],[side*.55,.17-i*.04,.65],[side*.87,.18-i*.10,.53],[side*1.12,.21-i*.14,.39]],.009,white);
  }
  badge(head,'heart-shaped-nose',[[-.13,.06],[-.1,.12],[0,.14],[.1,.12],[.13,.06],[.05,-.03],[0,-.075],[-.05,-.03]],.07,black,0,.30,.65);
  piping(head,'nose-shine',[[-.075,.394,.727],[-.015,.408,.733],[.035,.399,.73]],.013,shine);
  for(const side of [-1,1]){
    const fin=node(body,side<0?'flipperL':'flipperR',side*.77,.65,.38);
    strand(fin,`front-flipper-${side}`,[[0,0,0],[side*.32,-.31,.13],[side*.66,-.48,.5],[side*.89,-.53,.67]],.36,.095,brownDark,{axis:[0,0,1],steps:32,blunt:true});
    for(let i=0;i<3;i++)piping(fin,`flipper-crease-${i}`,[[side*.47,-.42,.37+i*.12],[side*.70,-.50,.48+i*.1],[side*.82,-.515,.57+i*.07]],.008,brownLight);
    strand(body,`tail-flipper-${side}`,[[side*.24,.21,-1.64],[side*.52,.1,-1.98],[side*.65,.08,-2.4],[side*.45,.08,-2.65]],.32,.065,brownDark,{axis:[1,0,0],steps:26,blunt:true});
  }
  root.userData={author:'Pie Game',style:'anime',version:2};return root;
}
