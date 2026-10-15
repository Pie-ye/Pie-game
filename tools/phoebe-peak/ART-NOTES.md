# phoebe-peak 美術與骨架流程

1. **參考圖**（Grok）：`grok-peak-rock.md`（六區岩壁與平台）、`grok-peak-props.md`（場景道具）、`grok-peak-items.md`（16 種道具，同時處理成 HUD 圖示 `make-icons.py`）、`grok-peak-sky.md`（六張全景天空）。縮小後的參考圖留在 `refs/`。
2. **3D 模型**（Colab）：`colab-textured.py`（Hunyuan3D-2mini 形狀＋Hunyuan3D-2 貼圖；道具用較快參數，面數依用途分級）。環境建置沿用 `../phoebe-egg/colab-setup.py`、`colab-hunyuan-setup.py`、`colab-paint-setup.py`；貼圖階段需要 L4 等級的記憶體。下載後用 `../phoebe-egg/optimize-glb.py` 壓縮貼圖。
3. **骨架**：`build-rig.py` 由菲比 GLB 算出 `assets/phoebe.rig.json`；`rig-diagnose.py` 畫出各骨頭的主要影響區。
4. **地面與海**：`build-ground.mjs` 烘焙 `island.glb`、`sea.glb`。
5. 瑞吉姿勢模型與蛋、補給箱沿用搬蛋大作戰的 GLB（複製進本遊戲，自成一體）。
