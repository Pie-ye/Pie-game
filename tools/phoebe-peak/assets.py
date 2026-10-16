"""Prompt lists for the LoRA art pass: Mountain_village_fantasy (SDXL, scenery and props) and phoebe_chibi_anima (Anima, Phoebe).
usage: python3 assets.py <outdir>   writes colab/jobs-*.json for colab/sdxl-gen.py"""
import json, pathlib, sys
P = 'villagehmmb, '
OBJ = ', game asset, isolated on a plain white background, single object, centered, full object visible, three-quarter view, soft lighting, painterly fantasy style'
props = {
 'palm_tree': 'a tropical coconut palm tree with a curved trunk, green fronds and coconuts',
 'berry_bush': 'a lush green bush full of red and blue berries',
 'mushroom_cluster': 'a cluster of big red mushrooms with white spots and brown mushrooms',
 'thorn_bush': 'a dangerous thorny bramble bush with long sharp spikes',
 'snow_pine': 'a snow covered pine tree with drooping snowy branches',
 'ice_spike': 'a cluster of sharp translucent blue ice crystal spikes on a snowy base',
 'lava_rock': 'a black volcanic rock with glowing orange lava cracks and embers',
 'geyser': 'a rocky geyser vent with a column of white steam rising',
 'furnace': 'a squat stone furnace with fire in its mouth, a chimney with smoke and iron bands',
 'anvil_gear': 'a blacksmith anvil with a large iron gear and chains, sparks',
 'ruin_pillar': 'a broken ancient stone pillar with carvings, moss and vines',
 'torch_stand': 'a stone torch stand with a burning orange flame',
 'boulder': 'a round grey brown boulder with cracks and moss',
 'altar': 'a small stone altar with a floating glowing cyan crystal, a little brazier and glowing runes',
 'campfire': 'a campfire ring of logs with warm flames, small stones and a little cooking pot',
 'crate': 'a wooden supply crate with rope straps and a red cross emblem, lid closed',
 'crystal_cluster': 'a cluster of glowing cyan blue crystals growing from a rock',
 'summit_flag': 'a stone cairn on a mountain top with a big red flag with a golden star flying in the wind',
 'beehive': 'a wild beehive hanging from a short tree branch, a few bees around it',
 'cabin': 'a small cozy wooden mountain cabin with a glowing lantern and a signboard',
 'tent': 'a cozy canvas camping tent with a lantern and a sleeping bag at the entrance',
 'signpost': 'a wooden trail signpost with three arrow boards pointing left, forward and right',
 'lamp_post': 'a tall wooden lamp post with a hanging glowing lantern',
 'barrels': 'a stack of wooden barrels and sacks with a rope',
}
items = {
 'snack': 'a small bag of airline snacks, a packet with a paper plane logo',
 'coconut': 'a whole brown coconut with a straw',
 'berry_red': 'a sprig of shiny red berries with leaves',
 'berry_blue': 'a sprig of shiny blue berries with leaves',
 'mushroom_item': 'a single plump red mushroom with white spots',
 'energy_drink': 'a can of energy drink with a lightning bolt label',
 'medkit': 'a white first aid kit box with a red cross and a handle',
 'bandage': 'a roll of white bandage with a safety pin',
 'antidote': 'a small green potion bottle with a cork and a leaf label',
 'hot_tea': 'a steaming cup of hot tea with a lid and a tea bag',
 'ice_pack': 'a blue ice pack bag covered in frost',
 'rope_spool': 'a coil of thick rope on a wooden spool',
 'piton': 'a metal climbing piton peg with a ring and a small hammer',
 'chain_launcher': 'a steampunk chain launcher gun with a grappling hook and chain',
 'blowdart': 'a wooden blowgun tube with a few colorful darts',
 'lantern_item': 'a portable brass oil lantern with a glowing flame',
 'granola_bar': 'a granola bar in a half opened wrapper with oats and nuts',
 'honeycomb': 'a golden honeycomb piece dripping honey',
 'winterberry': 'a sprig of yellow winter berries with a little snow',
 'aloe_vera': 'an aloe vera leaf cut open with gel',
 'cure_all': 'a golden glowing elixir bottle with a star shape label',
 'magic_bean': 'a single large magical glowing green bean seed with a tiny sprout',
 'shelf_fungus': 'an orange shelf bracket fungus mushroom',
 'bounce_fungus': 'a springy bouncy purple mushroom with a round cap',
 'parasol': 'a closed red parasol umbrella with a wooden handle',
 'balloon': 'a bunch of three colorful balloons tied with a string',
 'compass': 'a brass compass with a glass top and a red needle',
 'checkpoint_flag': 'a small red triangular flag on a wooden pole',
 'backpack': 'a green hiking backpack with straps and a bedroll',
}
walls = {
 'beach': 'sandstone cliff rock face with horizontal layers, shells and coral fossils, sand in the cracks, beige',
 'jungle': 'red ochre rock wall covered with deep green moss, vines and ferns, small flowers in the cracks',
 'alpine': 'grey blue rock wall with snow in the cracks, icicles and frost',
 'caldera': 'black basalt columnar rock wall with orange glowing lava cracks and smoke',
 'forge': 'dark iron grey rock wall inlaid with iron plates, rivets, gears and chains, red glow in the cracks',
 'citadel': 'ancient grey white stone brick castle wall with carved reliefs, moss, some crumbled bricks',
}
ledges = {
 'beach': 'white sand ground with seaweed and small shells',
 'jungle': 'green grass and mossy stone ground with small flowers',
 'alpine': 'flat pure white snow ground with frost',
 'caldera': 'black volcanic rock ground with fine glowing orange cracks',
 'forge': 'iron grate floor plates with pipes and rivets',
 'citadel': 'ancient stone slab floor with engraved patterns',
}
skies = {
 'sky_beach': 'a clear blue sky with fluffy white clouds, pink orange horizon, calm sea with tiny islands, seaside afternoon',
 'sky_jungle': 'a humid yellow green sky with thin mist and warm golden clouds, distant green mountains',
 'sky_alpine': 'a cold pale blue to white sky with high thin clouds, distant snowy peaks and snow mist',
 'sky_caldera': 'a dim orange red sky with thick grey smoke clouds, distant volcano glow',
 'sky_forge': 'a deep red and dark grey sky with drifting soot, sparks and industrial smoke, distant fiery mountains',
 'sky_citadel': 'a dusk purple pink sky with a golden sea of clouds below, dreamy mountain summit above the clouds',
}
def obj(name, desc, w=.6, seeds=(1, 2), size=(1024, 1024)):
    return dict(name=name, prompt=P + desc + OBJ, lora=w, seeds=list(seeds), w=size[0], h=size[1])
def tex(name, desc, seeds=(1, 2)):
    return dict(name=name, bg='scene', lora=.65, seeds=list(seeds), w=1024, h=1024,
                prompt=P + 'seamless texture, flat front view, filling the whole frame, no sky, no horizon, ' + desc + ', hand painted fantasy game texture, evenly lit')
def sky(name, desc, seeds=(1, 2)):
    return dict(name=name, bg='scene', lora=.8, seeds=list(seeds), w=1536, h=768,
                prompt=P + 'scenery, no humans, wide panorama, ' + desc + ', no buildings, no ground, clouds')
jobs = {
 'props': [obj(k, v) for k, v in props.items()],
 'items': [obj(k, v, .5) for k, v in items.items()],
 'tex': [tex('wall_' + k, v) for k, v in walls.items()] + [tex('ledge_' + k, v) for k, v in ledges.items()],
 'sky': [sky(k, v) for k, v in skies.items()],
}
jobs['props'][jobs['props'].index(next(j for j in jobs['props'] if j['name'] == 'beehive'))]['seeds'] = [1, 2, 3]
out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '.'); out.mkdir(exist_ok=True, parents=True)
for k, v in jobs.items():
    (out / f'jobs-{k}.json').write_text(json.dumps({'items': v}, ensure_ascii=False, indent=1)); print(k, len(v), 'jobs')
