// 載入 Grok 生成的圖（assets/*.png，已去背、縮小）與漸層特效底圖，轉成 three.js 貼圖。
import { THREE, makeTexture } from './gfx.js';
import * as FX from './fxtex.js';

const NAMES = [
  'phoebe', 'reggie_closed', 'reggie_open',
  'enemy_hum', 'enemy_bat', 'enemy_golem', 'enemy_shooter',
  'enemy_vanguard', 'enemy_weaver', 'enemy_conductor', 'enemy_crab', 'enemy_lighthouse', 'enemy_hive', 'enemy_obelisk', 'enemy_egg',
  'fish_blue', 'fish_gold', 'heart', 'chest', 'decor_crystal', 'decor_grass',
  'fx_star', 'fx_mirror', 'fx_shot', 'phrolova', 'phrolova_atk', 'hecate',
  'fx_slash', 'fx_lily_stand', 'fx_lily_flat', 'fx_burst', 'fx_note', 'ground', 'rinascita-plaza',
];

function loadImage(name) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`missing asset ${name}`));
    img.src = `./assets/${name}.png`;
  });
}

/** 回傳 { tex: {名稱: THREE.Texture}, aspect: {名稱: 寬/高} } */
export async function loadAssets() {
  const imgs = await Promise.all(NAMES.map(loadImage));
  const tex = {};
  const aspect = {};
  NAMES.forEach((n, i) => {
    const img = imgs[i];
    const t = makeTexture(img, { repeat: n === 'ground' });
    if (n === 'ground') t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping;
    tex[n] = t;
    aspect[n] = img.naturalWidth / img.naturalHeight;
  });
  tex.glow = makeTexture(FX.glow());
  tex.ring = makeTexture(FX.ring());
  tex.disc = makeTexture(FX.disc());
  tex.beam = makeTexture(FX.beam());
  tex.shadow = makeTexture(FX.shadow());
  tex.halo = makeTexture(FX.halo());
  tex.sigil = makeTexture(FX.sigil());
  tex.prism = makeTexture(FX.prism());
  tex.pillar = makeTexture(FX.pillar());
  return { tex, aspect, images: imgs };
}
