# 場景審稿一

對過 `../concept/01-island-overview.png`、`02-plaza.png`、`03-beach-dock.png`、`04-sky-palette.png`，以及 `ps1-title.png`、`ps1-overview.png`、`ps1-plaza.png`、`ps1-beach.png`、`ps1-houses.png`、`ps1-pond.png`。程式以這包的 `style.js.txt`、`island.js.txt`、`main.js.txt` 為準；屋頂色和池深在 `site/games/community/pie-island/src/layout.js`（`HOUSES[].roof`、`terrainHeight` 把池心壓到 −1.1 m，`WATER_Y = 0`）。

下面只列最擋「keshi 那種薄塗背景」的十件事，重的在前。每件都是現在就能改的常數或著色器。三階的位置 0.42／0.72、主光的西南方向、海水那四個 hex、霧色 `#D7E7F2`、步道的大色，這輪留著。

座標：+x 東、+z 南。`SUN_DIR = (-0.45, 1.05, 0.55)` 的仰角是 atan2(1.05, 0.71) ≈ 56°，太陽在西南，這條方向是對的。

取色是區塊平均。概念稿天頂約 `#9ABDCA`–`#AACCE3`（藍比紅高）。遊戲裡抬頭才看得到的天（`ps1-beach` 上方）是 `#B0A3A6`，左邊 `#D0B8AB`，紅高於藍。草地一塊（`ps1-overview` 左上）`#89904F`，同塊亮度第 10 百分位 80、第 90 百分位 186。池心 `#8EBDB6`。小屋牆約 `#6D5E3D`，兩片屋頂是 `#626781` 和 `#C75F5A`。

## 1. 天是粉灰全景，霧接不上去

`ps1-beach` 的天是暫用的 `sky_day_8`：整片粉灰，沒有 `#90BEDF` 的天頂，也沒有幾朵大而軟的積雲。`04` 的天頂是粉藍，地平才有一條蜜桃。`ps1-title` 上方的 `#A5C3D3` 是遠海被霧洗過，不是這張全景。

`loadSkyPanorama` 成功之後只把 `makeSky()` 那顆球藏起來，全景原色進 `scene.background`。`makeSky` 的備用色還是飽和藍 `#4fb0f2`，而且 `pow(s, 300.0)` 畫了一顆太陽，方向 `(-0.45, 0.55, 0.7)` 跟真正的主光也不一樣。`makeClouds` 的 16 團球仍開著，材質是冷色自發光 `#dfefff`。粉天、冷霧 `#D7E7F2`、冷雲三層疊在地平上，所以海邊是一條髒白。

霧密度 0.0065 先不要加。粉天底下收到聖經的 0.018，廣場會被粉霧吃掉。

**改 `island.js` 的 `makeSky`。** 全景改畫在這顆球上，用亮度把雲留下來，色相換成色票。不要太陽盤。

```glsl
uniform sampler2D uMap; uniform float uHasMap;
uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uCloud; uniform vec3 uShade;
varying vec3 vDir;
void main() {
  vec3 dir = normalize(vDir);
  float k = smoothstep(0.0, 0.62, dir.y);
  vec3 col = mix(uHorizon, uTop, k);
  if (uHasMap > 0.5) {
    vec2 uv = vec2(atan(dir.z, dir.x) / 6.2831853 + 0.5, asin(clamp(dir.y, -1.0, 1.0)) / 3.14159265 + 0.5);
    float l = dot(texture2D(uMap, uv).rgb, vec3(0.299, 0.587, 0.114));
    float cloud = smoothstep(0.62, 0.88, l);
    float belly = smoothstep(0.40, 0.58, l) * (1.0 - cloud);
    col = mix(col, uShade, belly * 0.8);
    col = mix(col, uCloud, cloud);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
```

常數：`uTop #90BEDF`、`uHorizon #E7F3F8`、`uCloud #F5F6F0`、`uShade #C3C7D3`。`loadSkyPanorama` 改把貼圖塞進 `sky.material.uniforms.uMap`，`uHasMap = 1`，球保持可見，不要再指定 `scene.background`。同一支 callback 裡 `clouds.visible = false`。

天空改完若地平仍是一刀切，再把 `main.js` 的 `FogExp2` 密度從 0.0065 收到 0.01。25 m 外的廣場大約只吃 6% 霧，100 m 外約 60%。

## 2. 草地是一條條長的黃綠

概念稿的草是短筆，主色 `#9EB14E`，亮 `#C6CE6B`，暗 `#6E7B36`。遊戲這塊地是畫面的主體，筆觸長到跟小路同寬，亮暗差一倍以上（80 對 186），顏色落在 `#89904F`，比色票更暗、更黃。

`makeTerrain` 把同一張長筆貼圖鋪在 `vPos.xz / 7.0`，第二層是 `/ 23.0`。7 m 一格，鏡頭在 9 m 外時一筆就占掉角色那麼高。第二層只是更大的色塊，拆不開筆觸。`applyShadow(mat, { color: '#8C9A6A', t: 0.32 })` 再往灰綠混，暗部離 `#6E7B36` 更遠。

**改 `makeTerrain` 裡 `#include <map_fragment>` 那段。** 先把重複縮小，再按亮度收進三個色。第二輪短筆圖來了之後，這段校色仍留著。

```glsl
vec2 uvA = vPos.xz / 2.2;
vec2 uvB = vPos.xz / 1.15 + vec2(0.37, 0.18);
vec3 g = mix(texture2D(tGrass, uvA).rgb, texture2D(tGrass, uvB).rgb, 0.45);
float l = dot(g, vec3(0.299, 0.587, 0.114));
vec3 sh = vec3(0.427, 0.482, 0.212);   // #6E7B36
vec3 mid = vec3(0.620, 0.694, 0.306);  // #9EB14E
vec3 hi = vec3(0.776, 0.808, 0.420);   // #C6CE6B
vec3 base = mix(sh, mid, smoothstep(0.22, 0.55, l));
base = mix(base, hi, smoothstep(0.55, 0.82, l));
```

三個 `vec3` 是線性值，因為這段乘進 `diffuseColor` 時貼圖已經是線性。`/ 2.2` 是現在這張長筆圖的權宜：筆還是斜的，只是一筆從大約 1 m 收到 0.3 m。短筆圖到了再放回 `/ 3.5` 左右。

同一支呼叫改成 `applyShadow(mat, { color: '#6E7B36', t: 0.55, steps: SCENE_STEPS })`。沙、步道、廣場不要跟草共用這支影色；權重出來之後在著色器裡分：

```glsl
vec3 shadowTint = mix(vec3(0.427, 0.482, 0.212), vec3(0.894, 0.788, 0.643), vSplat.x); // 草 → 沙影 #E4C9A4
shadowTint = mix(shadowTint, vec3(0.894, 0.824, 0.682), max(vSplat.y, vSplat.z));       // 步道 #E4D2AE 再暗一點
```

要分影色就得把 `uShadow` 從常數改成 varying。較小的一步是草的權重最高時用上面的 `#6E7B36`，其餘仍用 `#C3C7D3`。

## 3. 光是「鋪平的環境光 + 一塊硬影子」

三階函式寫在 `style.js` 的 `toonPars`，階距也對。畫面上仍是平的綠加一塊近黑的影（小屋縫、樹洞取到 `#201E2A`）。原因有三個：

- `main.js` 的 `HemisphereLight` 強度 1.1，約是聖經環境光 0.55 的兩倍，朝上的面被填平。
- `DirectionalLight` 強度 2.3。`toonPars` 裡 `tone * directLight.color * RECIPROCAL_PI * 0.9`，受光面很亮。
- 這版 three 在呼叫 `RE_Direct` 之前就做了 `directLight.color *= shadow`。影裡顏色是 0，`toonPars` 算出的影色整段被乘掉，只剩間接光。`makeRamp` 的 `gradientMap` 也沒人讀，`RE_Direct_Toon` 換掉了 `lights_toon_pars_fragment`。改 `makeRamp` 的 `lo`／`mid` 不會影響畫面。

方向不用動。強度和影子的算法要動。

**`main.js`：** `hemi.intensity = 0.55`，`sun.intensity = 1.15`。`sun.shadow.radius = 6`，影緣不要再是一條刀口。

**`style.js` 的 `toonPars`：** 用沒有被影子乘過的光色算三階，影子只把結果往影色再拉一點。

```glsl
uniform vec3 uSun; // 線性的 #FFF4E0 * 1.15，約 vec3(1.15, 1.08, 0.92)
float ndl = dot(geometryNormal, directLight.direction);
float w = 0.04;
float shadowW = 1.0 - smoothstep(T1 - w, T1 + w, ndl);
float litW = smoothstep(T2 - w, T2 + w, ndl);
vec3 albedo = material.diffuseColor;
vec3 shadowCol = mix(albedo, uShadow * dot(albedo, vec3(0.333)) * 1.4, uShadowT);
vec3 tone = mix(albedo, shadowCol, shadowW);
tone = mix(tone, mix(albedo, uLit, uLitT), litW);
float occ = clamp(length(directLight.color) / max(length(uSun), 0.001), 0.0, 1.0);
tone = mix(tone, shadowCol, (1.0 - occ) * 0.45);
reflectedLight.directDiffuse += tone * uSun * RECIPROCAL_PI * 0.9;
```

`T1`／`T2` 仍是現在的 `steps`。`applyShadow` 多傳一個 `uSun`。`w` 從現在寫死的 0.045 改回 0.04，跟聖經的軟邊一致。

`toToon` 現在所有場景網格都往 `#C3C7D3` 混 0.3。牆可以，葉子會發灰。在 `toToon` 裡按材質名分：

| 材質名 | color | t |
| --- | --- | --- |
| `leafsGreen`、`leafsDark`、`grass` | `#3A5C4E` | 0.45 |
| `woodBark`、`wood`，以及 `makeHouses` 的屋頂 | `#A8743E` | 0.35 |
| `stone`、`dirt` | `#9D836A` | 0.30 |
| 其餘（牆、雲） | `#C3C7D3` | 0.25 |

## 4. 全畫面深度線把岸、池、樹冠描成黑邊

聖經的線只在房子和角色上，色 `#6A5A4E`，粗約 2–3 cm，而且會斷。草、水、雲不描。`createPost` 用深度相對差，`smoothstep(0.035, 0.09, rel)`，60 m 內都畫。岸線和池緣是整片水深對地形的落差，所以 `ps1-pond` 的池有一圈黑邊。線色再乘上像素自己的顏色：`uLine * (0.55 + 0.45 * col)`，暗部的線就接近黑。

**改 `createPost` 的片段著色器。** 門檻提高，近處才畫，線用固定的暖褐，並且跳過水色。

```glsl
float rel = max(dx, dy) / max(d, 0.001);
float edge = smoothstep(0.11, 0.20, rel) * (1.0 - smoothstep(18.0, 36.0, d));
float mx = max(col.r, max(col.g, col.b));
float mn = min(col.r, min(col.g, col.b));
if (col.g > col.r && col.b > col.r && (mx - mn) < 0.16) edge = 0.0;   // 水面
float br = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
edge *= step(0.28, br);                                                // 斷線
col = mix(col, uLine, edge * 0.45);
```

房子和角色要另做倒殼，全畫面這條線才夠細。在 `makeHouses` 每個牆、屋頂網格，以及角色根節點，複製一份：`side = BackSide`，`color #6A5A4E`，`polygonOffset` 關掉，頂點沿法線推出模型尺寸的 1.2%（房子約 3 cm）。草、水、雲、樹冠不要進這份。

## 5. 海水和蓮花池是同一片淺薄荷綠

四個色票已經設對：`uSand #F0E1C6`、`uShallow #8BCCC6`、`uDeep #3E94B0`、`uFoam #F7FBFF`。曲線把它們用掉了。

```glsl
col = mix(uSand, uShallow, smoothstep(0.0, 0.45, depth));
col = mix(col, uDeep, smoothstep(0.6, 3.0, depth));
```

池心深度只有 1.1 m（`terrainHeight` 壓到 −1.1）。第一段在 0.45 m 已經全是淺水，第二段在 1.1 m 只混進大約一成外海色。取色 `#8EBDB6`，就是這支淺水。白點是 `smoothstep(0.86, 0.98, ripple)` 的正弦光斑，整池都有，不是碎的白筆。岸邊 `alpha` 從 0.5 起，淺處直接透出底下的草地貼圖，邊緣發綠。

概念稿是近岸透沙、很快變成 `#8BCCC6`、外面 `#3E94B0`，高光是碎筆。池要更深，不要跟海共用浪紋。

**改 `makeWater` 的片段著色器。**

```glsl
vec3 col = mix(uSand, uShallow, smoothstep(0.02, 0.22, depth));
col = mix(col, uDeep, smoothstep(0.45, 1.3, depth));
float spark = smoothstep(0.94, 0.995, ripple);
col = mix(col, uFoam, spark * 0.28);
float foam = smoothstep(0.18, 0.0, depth);
col = mix(col, uFoam, foam * 0.35);
float alpha = mix(0.78, 0.94, smoothstep(0.05, 0.6, depth));
```

1.1 m 的池心會落在外海色上，白點只留最亮的一截。沙色靠混色，不靠把 alpha 降到 0.5。

池緣現在會被 `groundSplat` 塗成步道（`q < POND.r + 1.4` 時拉高 `path`）。那圈米色不是概念稿的草坡。`layout.js` 的 `groundSplat` 拿掉這段，池岸回到草。

## 6. 小屋仍是深色木屋，屋頂是四種原色

`ps1-houses` 的牆約 `#6D5E3D`，屋頂一塊藍 `#626781`、一塊紅 `#C75F5A`。概念稿是奶油牆 `#F4EFE6`、暖褐頂 `#C47A4A`、窗是小色塊。`layout.js` 的四個 `roof` 是 `#e2545b`、`#5b8def`、`#5cc48a`、`#ffb35c`。珊瑚紅在聖經裡一個畫面只做一個焦點（帳篷），不是一整片屋頂。山牆 `#f4e7c9` 已經接近，窗卻是 `#9fd8ff` 再加 emissive `#4a7a9a`，讀起來像塑膠燈。

**`makeHouses`：** 牆的材質先 `clone()`，`color.set('#F4EFE6')`，`roughness = 1`，`map` 的影響拿掉（設 `map = null`，或另乘 0.25 只留很淡的板縫）。門那片 clone 成 `#CBA97A`。`roofMat.color.set('#C47A4A')`，忽略 `h.roof`。屋脊用 `#A8743E`。窗的 `emissiveIntensity = 0`，顏色 `#B7D0C8`。四間同一套色，第二輪模型來了再換網格。

## 7. 剩下的 Kenney 先按模型名重新上色

已換上的是椰子樹、闊葉樹、灌木、蓮花。截圖裡仍是低模的：尖頂樹、噴水池（灰環）、路燈、攤位、碼頭、木桶、木箱、帳篷。`RECOLOR` 只有六個材質名，而且是動森那種飽和綠（`grass #5fb04c`、`leafsGreen #62c04c`、`leafsDark #3f9a46`）。尖頂樹和路燈的材質名不在表裡，所以上色沒打到。

第二輪模型沒到之前，在 `loadModel` 用模型路徑乘色，讓整座島先坐進同一套色票。Kenney 的 albedo 多半是白底加貼圖，`material.color` 會乘上去。

| 路徑含有 | 乘上 |
| --- | --- |
| `tree_pine`、`tree_default`、`tree-high`、`tree_tall` | `#587760` |
| `lantern` | `#C4925A` |
| `fountain` | `#E6E0D4` |
| `stall`、`bench` | `#C47A4A` |
| `dock`、`boat`、`barrel`、`crate`、`chest` | `#CBA97A` |
| `rock` | `#C9A380` |
| `tent` | `#E25B45`（場上只留一座，另一座暫時 `visible = false`） |

`RECOLOR` 改成聖經的葉子：`leafsGreen #587760`、`leafsDark #3A5C4E`。若材質裡有亮綠這個名字，設 `#C6CE6B`。

尖頂樹只改色仍是圓錐。闊葉樹已經夠多的區域，把 `tree_pine` 從擺設裡拿掉，遠景就不會再被一排綠錐打斷。噴水池這輪只能變成暖灰石環，水柱等第二輪的模型。

碼頭在 `ps1-beach` 是飽和的橙木，亮暗差很大。乘上 `#CBA97A` 之後，再靠第 3 項把硬影拿掉，板子才會接近 `#CBA97A`／`#A8743E`。

## 8. 廣場是會重複的粉磚

`ps1-plaza` 的地面平均 `#CCBAA4`，暗縫落到亮度 134。概念稿 `02` 是大塊暖石，縫很淡。`makeTerrain` 用 `vPos.xz / 5.0` 鋪第一輪那張粉磚，5 m 就重複一次，溝縫是貼圖裡畫死的。

新圖還沒到之前，在同一段著色器裡把廣場拉回奶油，並壓掉溝縫的對比：

```glsl
vec3 plaza = texture2D(tPlaza, vPos.xz / 6.5).rgb;
float lp = dot(plaza, vec3(0.299, 0.587, 0.114));
plaza = mix(vec3(lp), vec3(0.820, 0.740, 0.600), 0.82); // 往 #E4D2AE 的線性值
base = mix(base, plaza, vSplat.z);
```

`/ 6.5` 讓同一條縫在畫面上變大、變少。這仍是過渡。第二輪的圖要大塊、淺縫、沒有粉點。

沙這輪不用重做。`ps1-beach` 的沙比 `#F0E1C6` 橙，多半是第 3 項的硬影，不是另一張錯誤的貼圖。

## 9. 後製把整張圖抬亮，草更黃，高光沒有光暈

`createPost` 對每個像素做 `col * 0.96 + 0.04`。聖經說的是暗部抬 0.04，不是連天和沙一起抬。後面 `mix(灰, col, 1.04)` 把已經偏黃的草再推黃一點。高光那筆 `vec3(0.012, 0.006, -0.008)` 又往藍減，粉天會更髒。`main.js` 的 `NeutralToneMapping`、`toneMappingExposure = 1.02` 可以留。

Bloom 沒有做。聖經是只吃高於 0.92 的像素，強度 0.18，半徑 0.35，用在雲邊和水面碎光。天空和第 5 項沒改之前先不要加，否則粉雲和白點會暈開。

**暗部才抬，飽和幾乎不動：**

```glsl
float l0 = dot(col, vec3(0.299, 0.587, 0.114));
float sh = 1.0 - smoothstep(0.18, 0.42, l0);
col = mix(col, col * 0.96 + vec3(0.04, 0.042, 0.048), sh);
float l = dot(col, vec3(0.299, 0.587, 0.114));
col = mix(vec3(l), col, 1.01);
col += vec3(0.018, 0.010, 0.0) * smoothstep(0.84, 1.0, l);
```

天空改成粉藍之後，再在同一個全螢幕著色器裡加一層很窄的 bloom：亮度超過 0.92 的鄰近 4 個像素平均，乘 0.18 加回去。不要暗角，不要光斑。

## 10. 換上的樹和蓮花仍是一塊綠、幾個暗洞

闊葉樹的樹冠是一層黃綠殼，裡頭是黑的洞（樹冠取色約 `#A6A759`，洞掉進近黑）。椰子樹比較像，但葉是一片深綠色，沒有 `#C6CE6B`／`#587760`／`#3A5C4E` 三筆。蓮花從上往下看是池面上的暗塊，白點則是第 5 項的光斑。`loadModel` 只把粗糙度壓到 0.8、金屬度改 0，生成貼圖的顏色原樣留下。`toonify` 之後又往 `#C3C7D3` 混，葉子更灰。

**`loadModel`，名稱以 `anime/` 開頭時**加一段跟草地同一套的亮度重映射，乘在 albedo 上：

```glsl
float l = dot(albedo, vec3(0.299, 0.587, 0.114));
vec3 leaf = mix(vec3(0.227, 0.361, 0.306), vec3(0.345, 0.467, 0.376), smoothstep(0.15, 0.45, l)); // #3A5C4E → #587760
leaf = mix(leaf, vec3(0.776, 0.808, 0.420), smoothstep(0.55, 0.85, l));                            // → #C6CE6B
albedo = mix(albedo, leaf, 0.75);
```

蓮花若整株都走這段，花會變綠。模型名含 `lotus` 時，亮度高的那截改乘 `#E7B6C8`，不要走 `#C6CE6B`。`applyAnimeModels` 裡蓮花的 `height` 收到 0.4 上下，讓它貼在水面上，而不是一株小樹立在池心。

樹冠不要進第 4 項的倒殼。黑邊拿掉、三層綠補上之後，洞仍會在；那是網格的問題，等下一輪設定圖，這輪靠上色和線就能先不像低模。

## 建議的改動順序

1. `makeSky` 的校色，並關掉程式雲。天一對，後面的霧和海水才看得出。
2. `main.js` 的光強度，加上 `toonPars` 不要讓 shadow map 把直射光乘成 0。
3. `createPost` 的線和暗部抬升。
4. `makeWater` 的深淺曲線，以及池岸不要再塗步道。
5. 草地的 UV 和三色重映射。
6. 小屋牆頂、Kenney 路徑乘色、廣場脫粉。
7. `anime/` 葉子的三色，蓮花縮小。天空穩定之後再加那層窄 bloom。
