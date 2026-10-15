# pie-peak 3D 資產製作流程

遊戲：`site/games/community/pie-peak/`。所有角色、道具、場景物件都是 Grok 參考圖 → Colab Hunyuan3D → GLB。

## 步驟

1. **參考圖（Grok）**：`grok-chars.md`、`grok-items.md`、`grok-world.md`、`grok-textures.md`。
   用 `grok --cwd <批次目錄> --always-approve --output-format plain -p "read prompt.md and generate ..."` 執行。
   角色圖必須是正面 A 字姿勢、手臂與腿與頭髮分開，Hunyuan3D 才做得出可綁骨架的網格。
2. **3D 建模（Colab）**：`colab-gen.py <group> [names...]`，環境用 `../phoebe-egg/colab-*.py` 安裝。
   角色 5 萬面、道具 5 千面、場景 1.2 萬面；先跑完整批形狀再跑貼圖，已完成的會略過。
3. **骨架與蒙皮（Colab + Blender bpy）**：
   - `rig_profiles.py <phoebe|fluorolo|reggie> bones.json` 依手動標註的地標（從形狀渲染圖讀出）產生骨骼。
   - `colab-rig.py in.glb bones.json out.glb` 合併重複頂點、建立骨架、依「到骨骼線段距離」算權重、平滑、保留 4 根影響，匯出 GLB。
   - 弗洛洛的辮子靠貼圖色相辨識，避免跟著手臂動。
4. **後處理**：`process_assets.py`（貼圖接縫、天空全景、HUD 圖示）、`optimize-glb.py`（貼圖重新編成 JPEG）。

## 骨骼命名

人形：`Root, Hips, Spine, Chest, Neck, Head, Shoulder_{L,R}, UpperArm_*, LowerArm_*, Hand_*, Fingers_*, UpperLeg_*, LowerLeg_*, Foot_*`。
`+X` 是角色的左側。瑞吉：`Root, Hips, Spine, Neck, Head, FlipperF1/F2_{L,R}, FlipperR1/F2_{L,R}`。

遊戲的 `src/rig.js` 只用世界座標下的「瞄準骨骼」與雙骨 IK，不依賴骨骼本身的 roll。

## 授權

菲比與弗洛洛是鳴潮角色，粉絲作品。Hunyuan3D 的授權條款適用於其輸出。
