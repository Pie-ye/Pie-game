# Anime character remake — asset provenance

## Scope

The old runtime primitive assemblies have been replaced with independently loadable GLB 2.0 models. Meshes are authored offline with indexed lofted surfaces, curved volumetric locks, extruded clothing details, and node articulation. This is original project fan-art derived from the provided character images, not an official licensed model or a claim of manual Blender sculpting. Image generation supplies reference art and diffuse textures; it does not supply the 3D mesh.

- Original identity references: `site/games/community/pie-phoebe/assets/phoebe.png`, `reggie_open.png`.
- Generated modeling reference: `tools/phoebe-egg/anime-reference.png`.
- Generated diffuse textures: `site/games/community/phoebe-egg/assets/anime/phoebe-face.png`, `phoebe-hair.png`.
- Final geometry: `site/games/community/phoebe-egg/assets/anime/phoebe.glb`, `reggie.glb`.
- Build: `node tools/phoebe-egg/build-anime.mjs`.
- Method: built-in `image_gen` tool; no Grok or fallback API invocation.

GLB embeds the PNGs, and standard glTF importers can inspect the geometry and node hierarchy. Runtime uses an intentionally narrow local reader for this exporter: indexed POSITION/NORMAL/TEXCOORD_0, embedded PNG textures, node transforms, PBR color factors, and KHR_materials_unlit. It is not a general-purpose replacement for GLTFLoader. No mesh skin weights or animation clips are implied: gameplay animates named joint nodes.

## Prompt 1 — modeling reference sheet

Inputs: original Phoebe and Reggie PNGs.

Create a professional anime 3D character modeling reference sheet for the two supplied characters, preserving their specific identity closely. Image 1 is Phoebe character identity reference, Image 2 is Reggie sea lion identity reference. Wide clean off-white sheet. Top row: full-body front, side, and back of Phoebe, same scale and aligned, in relaxed A pose. Bottom row: front three-quarter and side of Reggie. Anime cel shaded game art, beautiful sculpted shapes, clean sophisticated linework, NOT primitive geometric toys, NOT clay, NOT SVG. Phoebe: petite 3.5 heads tall anime chibi, long flowing pale blonde hair in distinct sharp tapered locks reaching hem, delicate anime face with large lavender eyes, neat bangs, dark navy cross hairclip, broad flat ivory and dark navy hat with ivory scalloped crown trim and gold stars, white coat with navy panels and gold piped borders, blue chest ribbon, pleated ivory skirt with navy inset, striped white stockings and navy shoes. Preserve original reference outfit and color placement. Refined expressive anime face, not button doll eyes. Reggie: recognizable brown sea lion, streamlined continuous long neck/body, tan muzzle and belly, glossy big black eyes, broad powerful flippers, huge open expressive mouth with small pointed teeth and pink tongue; not a walrus, no long tusks. Include small face detail inset for Phoebe. No text, no labels, no watermark. This is a reference sheet, not an image to pretend is an actual 3D model.

## Prompt 2 — face diffuse texture

Input: generated modeling reference sheet.

Use case: stylized-concept. Asset type: actual UV diffuse texture for the FRONT FACE ONLY of an anime 3D character. Use the blonde girl's face identity from the supplied reference sheet. Output one square 1024x1024 seamless flat pale peach skin-colored canvas (#ffe1ce). NO head outline, NO ears, NO hair, NO hat, NO neck, NO borders, NO background objects. Paint only beautiful expressive 2D anime facial features directly on the uniform skin canvas, to be wrapped onto a sculpted 3D head. Exactly two large lavender purple eyes with dark upper eyelashes and subtle lower lash, iris violet gradient, star-like white eye highlights; centers at x=31% and x=69%, y=49%; each eye width about 24% of canvas, height 24%. Tiny soft eyebrows above eyes at y=29%. Very subtle small nose at x=50%, y=64%. Small cute closed smiling mouth at x=50%, y=76%, width 10%. Soft pink blush under outer eyes at y=66%. Symmetric frontal orthographic facial texture; clean polished Japanese anime drawing, crisp lash linework, soft painterly iris. Features centered with lots of plain skin margins on all four sides. No black oval button eyes, no realism, no 3D lighting baked in, no shadows, no text. This will be used as a real UV face texture so follow positions precisely.

## Prompt 3 — hair diffuse texture

No input images.

A square seamless horizontally tiling diffuse albedo texture for pale blonde anime character hair. The entire image is ONLY a continuous sheet of silky pale golden blonde hair fibers flowing perfectly vertically from top to bottom. Japanese anime cel-painted hair, elegant long thin strand lines, broad soft ivory highlight ribbons, fine honey-gold shadow streaks. Light cream gold palette #F8D795 #FFEAB5 #D9AE71. Straight vertical flow with slight natural sweep. Subtle high-quality hand-painted depth, NOT photographic strands, NOT a head or hairstyle, NO scalp, NO face, NO hair ends, NO background, NO text, no borders. Fairly light overall, low contrast, no dark brown black sections. This is a UV texture applied to separate 3D hair locks, all pixels must be usable hair texture.
