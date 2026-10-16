# phoebe-peak 美術與骨架流程（LoRA 版）

使用者提供兩個 LoRA（放在 `/home/pieye/Container/colab_lora/`）：

| LoRA | 底模 | 用途 |
| --- | --- | --- |
| `phoebe_chibi_anima_v1` | Anima（circlestone-labs/Anima，ComfyUI 載入） | 菲比啾比本人 |
| `Mountain_village_fantasy` | SDXL（這裡用 Animagine XL 4.0） | 道具、營地建築、道具圖示來源、天空、岩壁與地面貼圖 |

## 流程

1. **Colab 工作階段**：`colab new -s pk-char --gpu L4`，再開第二個（L4 或 T4）。同一帳號最多約三個，其他代理可能佔用 `pie-lora`，不要動別人的。T4 的記憶體跑不動貼圖模型，要用 L4。
2. **環境**：`colab/3d-setup.py`（Hunyuan3D-2 與貼圖擴充，約 10 分鐘）、`colab/comfy-setup.py`（ComfyUI 與 Anima 權重）。LoRA 檔用 `colab/upload-lora.sh` 切成 20 MB 分片上傳。
3. **出圖**：
   - 菲比：`colab/anima-gen.py` 加 `colab/phoebe-jobs.json`。提示詞要有 `phoebe_chibi, chibi_style, front view, A-pose, arms slightly spread`，才會得到手臂張開、雙腿分開的站姿；這種站姿最好綁骨架。
   - 其他：`assets.py` 產生 `colab/jobs-*.json`，`colab/sdxl-gen.py` 批次出圖（LoRA 權重 0.5–0.8）。物件圖用白底、單一主體；貼圖要明講 `seamless tileable pattern, flat orthographic view, no perspective`，並把 LoRA 降到 0.4，否則會畫成有透視的插圖。
4. **挑圖**：下載後做拼圖檢視（見 `process-art.py`、`glb-sheet.py`）。
5. **3D**：`colab/hy-textured.py`（Hunyuan3D-2mini 形狀＋貼圖 turbo；角色 40000 面、道具 2500–8000 面）。多件工作用 `colab/hy-queue.py` 排隊。下載後用 `../phoebe-egg/optimize-glb.py` 壓貼圖。
6. **骨架**：`build-rig.py <phoebe.glb> <out.json>`。髮辮在手臂後方（z < −0.1），手臂在前方，所以用「髮辮膠囊＋位置」而不是只靠顏色分類；分類是硬規則，髮只跟頭與髮骨走，其他部位不跟髮骨。`rig-sheet.py` 輸出各動作拼圖。
7. **圖示**：`glb-sheet.py <out.png> a.glb b.glb ... --icons <dir>` 直接由成品 GLB 繪出透明 96 px 圖示，不再去背。
8. **天空與貼圖**：`process-art.py sky|tex`。天空左右接縫用交叉淡化處理；貼圖取中央區域、去除暈影後存成 512 px JPEG。
9. **地面與海**：`build-ground.mjs`（半徑 145 公尺的島，沿用 `textures/` 的沙與水）。
10. 瑞吉姿勢模型沿用搬蛋大作戰的 GLB。
11. `refs/` 保存最後採用的參考圖（縮小的 JPG）：菲比、29 個道具、24 個場景物件、六張天空，方便重現。

## 注意事項

- `colab exec` 在 VM 忙碌時常常逾時；用 `colab/run-detached.sh` 或寫成背景程序，再用 `colab/peek.sh`（檔案 API）讀記錄。
- 不要用 `pkill -f` 去殺含自己指令列的字串；用 `/proc` 逐一比對。
- 用 `colab new -s 名稱` 兩次會讓第一個工作階段從本機記錄中遺失（仍在計費），務必先 `colab sessions`。
- 岩壁不再用烘焙模型：`src/terrain.js` 依世界座標取樣貼圖，起伏在頂點著色器中計算，遠處用平面背板。
