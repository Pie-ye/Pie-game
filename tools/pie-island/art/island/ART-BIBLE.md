# 小島樂園美術聖經：日式動漫畫風

這份文件把整座島從現在的 Kenney 低多邊形，改成安靜的日式動漫畫風。角色仍是上一份設計的**暖蘋果**（見 `../design/DESIGN.md`）。場景參考 X 帳號 [@keshiAIart](https://x.com/keshiAIart)。

概念稿在 `island/concept/`。底模與 LoRA 的直接下載網址在最後一節。

## 參考畫風

作者簡介寫的工具是 **Niji Journey、Midjourney、Grok、Vidu、Seedance 2.0 / 2.5**。2026 年 8 月到 10 月的靜畫，貼文內文幾乎都只寫 `midjourney v8.2`。總集編寫明：圖像是 Midjourney，影片是 Seedance 2.0 / 2.5，提示詞與剪接是 Claude，平台是 ArtCraft / TapNow / Dreamina，音樂是 Suno。作者沒有公開 Stable Diffusion 的底模、LoRA 或完整提示詞。下面的畫風是從實際貼文歸納的，SD 方案是最接近、而且能用網址下載的替代。

看過的重點：

- 2026-09-20 的草地（[貼文](https://x.com/keshiAIart/status/2101583213739298867)）是場景的主參考。天空占畫面大半，積雲大而軟，地平線低，草花用點筆，右邊一間木屋很小。
- 2026-08-26 的咖啡店門口（[貼文](https://x.com/keshiAIart/status/2092513737723035870)）是建築參考。奶油牆、舊木、磚，陽光洗過，窗是色塊。
- 2026-10-04 的街景（[貼文](https://x.com/keshiAIart/status/2106629222194417790)）看得到白牆、紅瓦、乾淨的藍天和少數積雲。
- 其餘人物圖用來確認線、上色與點綴色。人是修長的，**不要**把暖蘋果畫成那樣。

### 線條

線細，而且會斷，不會把每塊顏色框死。衣服、頭髮、機械有素描線；皮膚和大色塊幾乎無線，形狀靠明暗。線色是暖褐 `#6A5A4E`，不是純黑。小島在 720p 還要讀得清，所以概念稿的線比原圖稍完整，進 3D 之後建築和角色留細線，草、水和雲不描邊。

### 上色

薄塗。底是水彩的透明層，亮部用一點不透明水粉提白。明暗大約三階，階與階之間是軟邊。這不是平塗賽璐璐，也不是厚重油畫。

### 光影

高調。大面積是奶油色和粉藍，陰影不壓黑。晴天的影子偏暖灰；雲的底部偏一點紫灰 `#C3C7D3`。主光從斜上方來，亮部是 `#F6E2C4` 那種暖白，不是冷白聚光。

### 天空與雲

晴天：天頂 `#90BEDF`，往下稍淺，地平線接近 `#E7F3F8`，雲少而大。

傍晚（`03-beach-dock.png` 這一檔）：天頂仍是粉藍，地平線加一條蜜桃 `#F4C4A0`。雲還是同一批積雲，只是下緣吃到暖光。

雲的畫法：一大團、邊是軟的、內部兩到三筆明暗。底部用 `#C3C7D3`，受光面 `#F5F6F0`。不要硬邊棉花糖，也不要寫實的卷積雲絲。天空留白要比島上的物件多。

### 植物、水、建築

植物是一筆筆的綠，有 `#C6CE6B`、`#9EB14E`、`#3A5C4E` 三層，不是低模三角面。椰子樹的葉是放射的大筆，不是每根葉脈都畫。

水很淺的地方透出沙色 `#F0E1C6`，往外變成 `#8BCCC6`，再遠是 `#3E94B0`。高光是碎的白筆 `#F7FBFF`，沒有銳利的鏡面倒影。

建築是被陽光洗過的奶油牆 `#F4EFE6`、暖褐屋頂 `#C47A4A`、舊木 `#CBA97A`。窗是小色塊。四間小屋門朝廣場，形狀簡單，輪廓在斜上方俯視還分得開。

### 色票

| 用途 | Hex | 用法 |
| --- | --- | --- |
| 天頂 | `#90BEDF` | 晴天與傍晚的天空頂端 |
| 晴天地平 | `#E7F3F8` | 正午天空盒的地平 |
| 傍晚地平 | `#F4C4A0` | 傍晚天空盒、遠霧 |
| 雲 | `#F5F6F0` | 積雲受光 |
| 雲底 | `#C3C7D3` | 雲的陰影，也是角色的環境陰影傾向 |
| 草亮 | `#C6CE6B` | 草坡受光 |
| 草 | `#9EB14E` | 草地貼圖的主色 |
| 草影 | `#6E7B36` | 草地陰影階 |
| 沙 | `#F0E1C6` | 沙灘、淺灘底 |
| 沙影 | `#E4C9A4` | 沙上的軟影 |
| 步道 | `#E4D2AE` | 壓實的土路，不是木板 |
| 木板 | `#CBA97A` | 碼頭、長椅、船 |
| 木影 | `#A8743E` | 木板縫與暗階 |
| 崖壁 | `#C9A380` | 島緣小崖的受光 |
| 崖影 | `#9D836A` | 崖的暗階 |
| 淺水 | `#8BCCC6` | 岸邊海水 |
| 外海 | `#3E94B0` | 天空盒與深水 |
| 水高光 | `#F7FBFF` | 碎浪、噴泉 |
| 葉 | `#587760` | 樹冠中間調 |
| 葉影 | `#3A5C4E` | 葉叢暗部 |
| 牆 | `#F4EFE6` | 小屋外牆 |
| 屋頂 | `#C47A4A` | 瓦或木屋頂 |
| 珊瑚紅 | `#E25B45` | 帳篷、花、一件衣服。一畫面只用一個焦點 |
| 黃銅 | `#C4925A` | 路燈、船的金屬小件 |
| 線 | `#6A5A4E` | 描邊與素描線 |
| 紙底 | `#F0F0EE` | 設定圖背景 |

氛圍用作者自己的說法：安靜、不花俏。廣場可以有幾個暖蘋果在走，不要人群、招牌字、霓虹。

### 關鍵詞

高調、粉藍積雲、斷線、薄塗水粉、奶油高光、三階軟影、珊瑚紅只做點綴、安靜的夏天、斜上方仍看得清的小島。

## 3D（three.js）怎麼做出這個畫風

現在的島是高飽和、硬邊、少階的低模。新的目標是同一座島（廣場噴水池、四間小屋、南邊碼頭、北邊高台、東北蓮花池、北邊農田、東南營地），換受光和貼圖，不換動線。

### 卡通著色

用三階，不要兩階，也不要五階以上。兩階會回到現在的塑膠低模；階太多會變成寫實。

階的位置（以 N·L 為準，0 是背光，1 是正對光）：

- 0.00–0.42：陰影
- 0.42–0.72：中間
- 0.72–1.00：亮部

陰影不是固有色乘黑色。各材質乘自己的影色：草 `#6E7B36`、沙 `#E4C9A4`、木 `#A8743E`、崖 `#9D836A`、牆往 `#C3C7D3` 混 25%。階與階用約 0.04 的寬度做平滑，避免一刀切。

環境光 `#F4EFE6`，強度約 0.55。主光 `#FFF4E0`。晴天仰角約 55°，從西南來；傍晚仰角約 18°，地平霧改成 `#F4C4A0`。

### 描邊

建築和角色要描邊。草、水面、雲、天空不要。

倒殼（背面膨脹）即可。顏色 `#6A5A4E`。小屋的線約模型尺寸的 1.2%（一座幾公尺寬的房子大約 2–3 cm）。暖蘋果的線大約 1.5 cm，讓角色在 120 px 高時還有一圈暖線。線不要純黑，不要比 keshi 的斷線更粗。

### 草地、沙灘、步道、崖壁、木板

貼圖都是無縫、沒有地標（不要在平鋪圖裡畫一朵特別大的花或一條路）。花、石頭、椰子是另放的物件。

- **草**：1024 albedo，主色 `#9EB14E`。再用頂點色把高處偏 `#C6CE6B`、低處偏 `#6E7B36`。法線很弱，roughness 1。
- **沙**：albedo 主色 `#F0E1C6`，法線強度約 0.25。涉水區用深度把沙色混進水色。
- **步道**：壓實土 `#E4D2AE`，比沙暗一點、比木板粉。跟碼頭木板分開兩張圖。
- **崖壁**：島緣若有小段垂直面，用垂直 UV 或三平面，不要把草地貼圖拉長。影色 `#9D836A`。
- **木板**：只給碼頭、船、長椅。縫要沿著板的方向，平鋪時縫距穩定，避免出現一塊特別寬的板。

### 水面

兩層就夠。

底色依深度：岸邊從沙 `#F0E1C6` 混到 `#8BCCC6`，島外到 `#3E94B0`。高光只有一條窄的亮階，顏色 `#F7FBFF`。岸邊約 1 公尺是泡沫帶，顏色 `#F7FBFF`，透明度約 0.35。反射天空時把粗糙度放在 0.15–0.25，倒影是糊的色塊。法線慢速捲動。深水碰撞維持現在的規則：淺灘走得進去，深水與池塘走不進去。蓮花池用更深一點的 `#3E94B0`，上面另放蓮葉，不要跟海水共用同一張有浪紋的圖。

### 霧與遠景

`FogExp2`。晴天顏色 `#D7E7F2`，傍晚 `#F4C4A0`。密度低到遠方帆船還在，只是發白。島的尺度若大約百米，密度從 0.012 試到 0.018。霧不要吃掉廣場。

遠景海平線可以用一條雲帶卡片放在天空盒前面，視差很小。島本身的幾何不要畫進天空盒，否則地平線上會有第二座島。

### 後製

Bloom 只吃高於 0.92 的像素，強度 0.18，半徑 0.35。讓雲邊、噴泉和水面碎光亮一點。陰影抬約 0.04，高光略暖，飽和約 1.04。不要強對比，不要暗角，不要鏡頭光斑。

天空優先用生成的 2:1 全景當 `scene.background`。雲若要動，全景當底，另外 2–3 片很淡的雲卡在遠處慢移。

## 暖蘋果放進這個場景

比例、五官、貼圖位置都照 `DESIGN.md` 和 `spec.json`，不要改成 keshi 那種修長人物。要改的是受光，讓圓潤的角色坐得進薄塗場景。

- 身體 roughness 0.82，metalness 0。用跟場景同一條三階 ramp。陰影是固有色往 `#C3C7D3` 混 28%，不要往黑混。
- 臉維持設計：roughness 0.92。臉貼圖當 emissive 的強度從 0.4 降到 0.35，軟陰影才不會把五官洗掉，也不會白成一塊貼紙。
- 描邊跟場景同一支 `#6A5A4E`，角色比小屋清楚一點。
- 頭髮 roughness 0.9。一圈很弱的暖色 rim，顏色 `#F6E2C4`，強度約 0.15。
- 衣服保留設計稿的奶油、黃、藍、珊瑚。珊瑚紅 `#E25B45` 一個畫面只做一個焦點，例如花冠或帳篷，不要每個人都紅。
- 膚色用設計稿的暖色。不用綠、不用藍。
- 不要用不受光的材質。角色若完全不吃光，會浮在薄塗的島前面。

## SD 素材

Colab L4、diffusers 或 ComfyUI。下面的提示詞給 **Animagine XL 4.0**。它是 SDXL 動畫微調，授權 OpenRAIL++，跟後面的 SDXL LoRA 同一族。

建議取樣：DPM++ 2M Karras，28 步，CFG 6，clip skip 2。出圖後再放大。天空盒最終放到 4096×2048，平鋪圖維持 1024×1024 即可。

**正向開頭**（每條都加上）：

```
masterpiece, high score, great score, absurdres
```

**共用負向**（物件設定圖另外再加 ground, horizon, cast shadow）：

```
lowres, worst quality, low quality, low score, bad score, average score, jpeg artifacts, signature, watermark, username, text, logo, letters, blurry, photo, photorealistic, realistic, 3d render, cgi, unreal engine, neon, pure black outline, thick outline, flat cel shading, dark, night, snow, mountain, crowd
```

LoRA 怎麼疊，見下一節。天空用新海誠那顆把雲拉大；平鋪地面不要加它，否則雲和光斑會跑進貼圖。小屋可以加本機的 `villagehmmb`，權重壓低，並在負向保留 `snow, mountain`，避免拉去雪山村。

無縫圖幾乎不會一次就接上。生成後把圖左右、上下各錯開一半拼成 2×2，接縫若出現，只重繪十字縫。平鋪圖裡不要放花、石頭、路燈這類只出現一次的東西。

給 Hunyuan3D 的設定圖：單一物件、白底 `#F0F0EE`、三分之四視角、物件完整在畫面裡、光線均勻、不要地面投影。

### 1. 晴天天空全景

用途：`scene.background` 的天空盒。只有天空和很遠的海平線，沒有島。

尺寸：1536×768（2:1），放大到 4096×2048。

正向：

```
masterpiece, high score, great score, absurdres, PEAnimeBG, Background, anime, scenery, equirectangular sky panorama, 2:1, powder blue sky #90BEDF, soft gradient to pale horizon #E7F3F8, a few large soft cumulus clouds, cloud highlights #F5F6F0, cloud undersides #C3C7D3, thin broken ink, gouache and watercolor, high-key daylight, straight horizon at the middle, left and right edges continue, distant calm sea, no island, no land, no people, Makoto Shinkai Style page
```

負向：共用負向，再加 `island, building, tree, boat, sun disc, lens flare, text`。

LoRA：新海誠 0.65，PE Anime BG 0.35。

### 2. 傍晚天空全景

用途：同一座島的第二個時段。天頂不變，地平線換成蜜桃。

尺寸：1536×768，放大到 4096×2048。

正向：

```
masterpiece, high score, great score, absurdres, PEAnimeBG, Background, anime, scenery, equirectangular sky panorama, 2:1, powder blue zenith #90BEDF, warm peach horizon band #F4C4A0, large soft cumulus with warm lower edges, cloud highlights #F5F6F0, thin broken ink, gouache, quiet late afternoon, straight horizon at the middle, seamless left and right, distant calm sea, no island, no people, Makoto Shinkai Style page
```

負向：與晴天天空相同。

LoRA：新海誠 0.6，PE Anime BG 0.3。

### 3. 遠景海平線與雲

用途：天空盒前面的一條遠景，或天空盒生成失敗時的備用雲帶。

尺寸：1536×640。

正向：

```
masterpiece, high score, great score, absurdres, PEAnimeBG, anime scenery, a wide distant sea horizon, low horizon line, powder blue sky, large soft cumulus, pale turquoise sea #8BCCC6 becoming #3E94B0, one tiny white sail on the horizon, gouache, thin broken ink, high-key, no island, no beach, no people, Makoto Shinkai Style page
```

負向：共用負向，再加 `island, beach, pier, close-up`。

LoRA：新海誠 0.7，PE Anime BG 0.3。

### 4. 草地平鋪

尺寸：1024×1024。

正向：

```
masterpiece, high score, great score, absurdres, PEAnimeBG, seamless pattern, tileable texture, surface only, anime gouache grass, yellow-green #9EB14E with lighter #C6CE6B and softer shadow #6E7B36, short painted strokes, even lighting, no flowers, no path, no horizon, top-down
```

負向：共用負向，再加 `flower, rock, path, sky, horizon, object`。

LoRA：只加 PE Anime BG 0.8。

### 5. 沙灘平鋪

尺寸：1024×1024。

正向：

```
masterpiece, high score, great score, absurdres, PEAnimeBG, seamless pattern, tileable texture, surface only, pale cream sand #F0E1C6, soft warm shadows #E4C9A4, fine painterly grain, even lighting, top-down, no footprints, no objects, no horizon
```

負向：共用負向，再加 `footprint, shell, grass, water, sky`。

LoRA：PE Anime BG 0.75。

### 6. 步道平鋪

尺寸：1024×1024。

正向：

```
masterpiece, high score, great score, absurdres, PEAnimeBG, seamless pattern, tileable texture, surface only, packed dirt path, warm beige #E4D2AE, soft gouache, even lighting, top-down, no planks, no stones as landmarks, no horizon
```

負向：共用負向，再加 `wood planks, cobblestone, sky, grass`。

LoRA：PE Anime BG 0.75。

### 7. 崖壁平鋪

尺寸：1024×1024。垂直貼在島緣。

正向：

```
masterpiece, high score, great score, absurdres, PEAnimeBG, seamless pattern, tileable texture, anime painted cliff rock, tan #C9A380, shadow #9D836A, soft vertical cracks, gouache, even lighting, no plants, no sky, no horizon
```

負向：共用負向，再加 `grass, tree, sky, water`。

LoRA：PE Anime BG 0.8。

### 8. 碼頭木板平鋪

尺寸：1024×1024。

正向：

```
masterpiece, high score, great score, absurdres, PEAnimeBG, seamless pattern, tileable texture, weathered honey wood planks #CBA97A, shadow gaps #A8743E, planks running horizontally, even gaps, gouache, even lighting, no nails as a focal point, no horizon, no boat
```

負向：共用負向，再加 `boat, water, sky, people`。

LoRA：PE Anime BG 0.7。

### 9. 水面

尺寸：1024×1024。著色器還是主體，這張只提供細碎高光與顏色變化。

正向：

```
masterpiece, high score, great score, absurdres, PEAnimeBG, seamless pattern, tileable texture, shallow tropical water surface, turquoise #8BCCC6, soft white ripple highlights #F7FBFF, painterly, no horizon, no boat, no reflection of a building, even lighting, top-down
```

負向：共用負向，再加 `horizon, island, fish, boat`。

LoRA：PE Anime BG 0.65。

### 10. 椰子樹設定圖

用途：Hunyuan3D 轉一棵可重複放置的椰子樹。

尺寸：1024×1024。

正向：

```
masterpiece, high score, great score, absurdres, PEAnimeBG, a single coconut palm tree, full tree in frame, three-quarter view, cream paper background #F0F0EE, slender trunk, radiating green fronds in #587760 and #3A5C4E with light #C6CE6B, thin broken ink, gouache, even soft light, no ground, no cast shadow, no coconuts piled around, one tree only
```

負向：共用負向，再加 `ground, horizon, cast shadow, forest, crowd`。

LoRA：PE Anime BG 0.6。

### 11. 樹葉平鋪（椰子葉卡片用）

尺寸：1024×1024。若 3D 樹冠太重，用這張做十字交叉的葉卡。

正向：

```
masterpiece, high score, great score, absurdres, PEAnimeBG, seamless pattern, tileable anime palm leaves, painterly fronds, greens #587760 #3A5C4E #C6CE6B, gouache strokes, even lighting, no trunk, no sky, no coconuts
```

負向：共用負向，再加 `trunk, sky, flower, text`。

LoRA：PE Anime BG 0.7。

### 12. 小屋設定圖

用途：Hunyuan3D。四間小屋共用這一個形，門朝前，再換屋頂與牆的顏色。

尺寸：1024×1024。

正向：

```
masterpiece, high score, great score, absurdres, PEAnimeBG, villagehmmb, a single small cottage, three-quarter view, cream walls #F4EFE6, warm brown roof #C47A4A, one wooden door facing the camera, two small windows as color blocks, simple mailbox beside the door, cream paper background, full building in frame, even soft light, thin broken ink, gouache, no ground, no cast shadow, no people, no text
```

負向：共用負向，再加 `ground, horizon, cast shadow, snow, mountain, crowd, signage`。

LoRA：PE Anime BG 0.55，`villagehmmb` 0.45。

### 13. 碼頭設定圖

尺寸：1024×1024。

正向：

```
masterpiece, high score, great score, absurdres, PEAnimeBG, a single short wooden pier section, three-quarter view, honey planks #CBA97A, simple posts, cream paper background, full object in frame, even light, gouache, thin ink, no water, no boat, no ground shadow, no people
```

負向：共用負向，再加 `water, boat, beach, people, cast shadow`。

LoRA：PE Anime BG 0.65。

### 14. 噴水池設定圖

尺寸：1024×1024。

正向：

```
masterpiece, high score, great score, absurdres, PEAnimeBG, a single low round stone fountain, three-quarter view, pale stone, a small spray of water, cream paper background, full object in frame, gouache, thin ink, even light, no plaza, no people, no ground shadow
```

負向：共用負向，再加 `plaza, people, text, cast shadow`。

LoRA：PE Anime BG 0.6。

### 15. 花草小物

分四次生成，每次一張、白底、1024×1024，三分之四視角，完整入鏡，無地面投影。LoRA 都是 PE Anime BG 0.6。

蓮花（放東北池）：

```
masterpiece, high score, great score, absurdres, PEAnimeBG, a single lotus plant, round green leaf and one pale pink flower, three-quarter view, cream paper background, gouache, thin ink, even light, no pond, no ground shadow
```

野花一叢（廣場與步道邊，不要每朵都不同）：

```
masterpiece, high score, great score, absurdres, PEAnimeBG, a small clump of simple white and coral wildflowers, coral #E25B45 used once, three-quarter view, cream paper background, gouache, no ground shadow, no people
```

粉帳（東南營地，只做一個）：

```
masterpiece, high score, great score, absurdres, PEAnimeBG, a single small camping tent, coral pink canvas #E25B45, three-quarter view, cream paper background, gouache, thin ink, no campfire, no ground shadow, no people
```

長椅：

```
masterpiece, high score, great score, absurdres, PEAnimeBG, a single simple wooden bench, honey wood #CBA97A, three-quarter view, cream paper background, gouache, no ground shadow, no people
```

這四條的負向都用共用負向，再加 `ground, horizon, cast shadow, text`。

## 底模與 LoRA

作者的原圖不能在 SD 裡復現成同一顆模型。下面選的是：場景像那張草地與藍天、授權能下、Colab 上 SDXL 載得動。權重是起始值，雲太搶就降新海誠，線太硬就降 PE。

### 建議組合

| 角色 | 名稱 | 基底 | 權重 | 觸發詞 | 為什麼 |
| --- | --- | --- | --- | --- | --- |
| 底模 | Animagine XL 4.0 | SDXL | — | 見各條正向開頭的 score 標籤 | 動畫先驗夠，標籤好控，OpenRAIL++，直接下載 |
| 場景 LoRA | PE Anime Background | SDXL 1.0 | 0.75–0.9；與別人疊加時 0.35–0.6 | `PEAnimeBG`, `Background`, `anime`, `scenery` | 專門拉動畫背景。作者建議 0.8–1 |
| 天空 LoRA | Makoto Shinkai Style | SDXL 1.0 | 單獨 0.8；疊加 0.6–0.7 | `Makoto Shinkai Style page` | 對上 2026-09-20 那張：大積雲、低地平線、乾淨的藍。`page` 若把畫面變成分鏡，就拿掉這個詞 |
| 本機小屋 | Mountain_village_fantasy | SDXL 1.0 | 0.4–0.55 | `villagehmmb` | 91 張訓練圖幾乎都有 house / scenery。只在小屋用，並壓住雪山 |

取樣若發灰，把 PE 降到 0.6，不要先加 CFG。

### 直接下載（已確認網址會回檔）

底模，二選一，優先第一個：

- Animagine XL 4.0：<https://huggingface.co/cagliostrolab/animagine-xl-4.0/resolve/main/animagine-xl-4.0.safetensors>
- 若 LoRA 在動畫底模上發糊，改回 SDXL 原版再把 LoRA 權重提高：<https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors>

LoRA：

- PE Anime Background，Civitai 模型 137169、版本 **151356**，檔名 `PE_AnimeBG.safetensors`。Hugging Face：<https://huggingface.co/rajkumaralma/pe_anime-background/resolve/main/PE_AnimeBG.safetensors>。Civitai：<https://civitai.com/api/download/models/151356>
- Makoto Shinkai Style，Civitai 模型 105984、版本 **153903**，檔名 `Makoto Shinkai Style.safetensors`：<https://civitai.com/api/download/models/153903>

自然語言比較像 Midjourney 的另一個底模是 Illustrious XL v1.1（授權沿用 SDXL license）：<https://huggingface.co/OnomaAIResearch/Illustrious-XL-v1.1/resolve/main/Illustrious-XL-v1.1.safetensors>。上面兩顆 LoRA 是用 SDXL 1.0 訓練的，掛在 Illustrious 上請從 0.4 起試。小島素材仍以 Animagine 這組為準。

### 本機已有的 LoRA

路徑在 `/home/pieye/Container/colab_lora/`。

- `Mountain_village_fantasy.safetensors`：用。SDXL，網路 dim 32，clip skip 1，觸發詞 `villagehmmb`。訓練標籤以 house、scenery、sky、mountain 為主。
- `Hi-Fi_Rush_Style_Illustrious-000016.safetensors`：不用在場景。它是粗線、平塗、漫畫式的角色風格，跟薄塗水粉相反。檔名寫 Illustrious，掛錯底模會更不穩。
- `phoebe_chibi_anima_v1.safetensors`：不用在場景。架構是 Anima（`anima-base-v1.0`），不是 SDXL。它是 Q 版角色，不能跟上面的底模一起載。
- `gwentCB01.safetensors`：不用。SD 1.5、訓練圖約 28 張，走的是卡牌插畫，底模和氣氛都不對。

也曾看過、但直接下載會被 Civitai 要求登入，所以不列進建議：Ghibli Background（版本 2513171）、Better Anime Backgrounds 的 SDXL 版（版本 772218）。

## 概念稿

四張都在 `island/concept/`。它們是配置與色票的橋，線比 keshi 的原圖稍完整，讓俯瞰還數得出廣場、池和碼頭。原圖的筆觸更鬆、留白更多；進 SD 時照上一節的提示詞，不要照概念稿把線描死。

| 檔案 | 內容 |
| --- | --- |
| `01-island-overview.png` | 斜上方俯瞰。廣場噴水池、攤位、長椅、蓮花池、高台坡道、農田、沙灘、木碼頭、小船、粉紅帳篷、遠帆、椰子樹。小屋在這張裡清楚的是三間主屋加兩個攤位；第四間的位置以本文件為準，東西兩側各兩間，門朝廣場，不要把攤位算成小屋。 |
| `02-plaza.png` | 廣場近景。圓形噴水池、長椅、路燈、奶油牆小屋、椰子樹。五個暖蘋果比例的人在走：大頭、短身、連指手套、不同膚色與髮色。牆面沒有招牌字。 |
| `03-beach-dock.png` | 晴天偏傍晚。奶油沙、木碼頭、小船、粉帳、椰子樹、遠方白帆。地平線是 `#F4C4A0`。 |
| `04-sky-palette.png` | 上方是粉藍積雲與傍晚地平線，下方六格是草、沙、木板、崖壁、淺水、葉。色票字是事後依畫面取樣標上的，與上表一致。 |

## 參考網址

畫風貼文：

- <https://x.com/keshiAIart>
- <https://x.com/keshiAIart/status/2101583213739298867>（草地與天空，場景主參考，midjourney v8.2）
- <https://x.com/keshiAIart/status/2092513737723035870>（咖啡店門口，建築）
- <https://x.com/keshiAIart/status/2106629222194417790>（街景、白牆與藍天）
- <https://x.com/keshiAIart/status/2112015891731034257>（四張，midjourney v8.2，線與上色）
- <https://x.com/keshiAIart/status/2107734483441160221>
- <https://x.com/keshiAIart/status/2106646205375914461>
- <https://x.com/keshiAIart/status/2101130764922601583>
- <https://x.com/keshiAIart/status/2089261163741925591>
- <https://x.com/keshiAIart/status/2088239049723330675>
- <https://x.com/keshiAIart/status/2088231198451794190>
- <https://x.com/keshiAIart/status/2109254874185740516>（總集編的工具說明：Midjourney、Seedance、Claude、Suno）
- <https://x.com/keshiAIart/status/2075906970465480947>（今年也、良い夏を）
- <https://x.com/keshiAIart/status/2061788597930623280>（いつかの帰り道）

LoRA 與底模：

- <https://huggingface.co/cagliostrolab/animagine-xl-4.0/resolve/main/animagine-xl-4.0.safetensors>
- <https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors>
- <https://huggingface.co/OnomaAIResearch/Illustrious-XL-v1.1/resolve/main/Illustrious-XL-v1.1.safetensors>
- <https://huggingface.co/rajkumaralma/pe_anime-background/resolve/main/PE_AnimeBG.safetensors>
- <https://civitai.com/api/download/models/151356>
- <https://civitai.com/models/137169?modelVersionId=151356>
- <https://civitai.com/api/download/models/153903>
- <https://civitai.com/models/105984?modelVersionId=153903>
