# phoebe-egg 3D assets — provenance and rebuild

Every visible object in the game is a GLB under `site/games/community/phoebe-egg/assets/models/`.
Only gameplay UI markers (delivery ring, attack telegraphs) and particle effects are built at runtime.

## Pipeline

1. **Reference images** — Grok image generation, prompt in `grok-prompt.md` (15 white-background, 3/4-view images;
   outputs kept in `refs/`). Characters use `site/games/community/pie-phoebe/assets/phoebe.png` and `reggie_closed.png` as identity references.
2. **Colab 3D** — `colab-textured.py` on a Colab GPU: Hunyuan3D-2mini shape (40 steps, octree 320, seed 2026), floater/degenerate cleanup,
   quadric face reduction (budgets in the script), then Hunyuan3D-2 `paint-v2-0-turbo` texture. Environment setup:
   `colab-setup.py` → `colab-hunyuan-setup.py` → `colab-paint-setup.py` (compiles the CUDA extensions against a micromamba CUDA 12.4 toolchain).
   The paint stage needs more than the 12 GB RAM of a T4 session; it ran on an L4 session. Shapes were generated on a T4.
   Provenance and timings: `assets/models/textured.json`.
3. **Size** — `optimize-glb.py` re-encodes embedded textures to JPEG (1024 px props, 2048 px characters).
4. **Terrain, sea, sky** — Grok seamless textures (`grok-textures.md`, `textures/`), `compose-ground.py` blends grass/sand/paths into one
   4096 px ground map, `build-terrain.mjs` bakes `ground.glb`, `sea.glb`, `sky.glb`. Collision stays in `src/rules.js`; models are fitted to those volumes at load.

## Runtime notes

- Characters are rigged at load time: a 7-bone skeleton with height/side blended skin weights, driven by the same state the old rig used.
- Large stone/grass props are desaturated in `src/assets.js` because the paint model oversaturates them.
- Rights: fan characters belong to their respective rights holders; TripoSR was evaluated and dropped, so no TripoSR output ships.
