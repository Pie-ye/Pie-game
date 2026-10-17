"""Prepare the original complete hero and a single Colab H3 generation job."""
import importlib.util
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'tools/city-art/output/hero-run-fullbody'
OUT.mkdir(parents=True, exist_ok=True)
skill = Path('/home/pieye/.agents/skills/minimax-h3-colab/scripts/runner.py')
spec = importlib.util.spec_from_file_location('h3_runner', skill)
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)

# The original complete illustration, including its actual hands and shoes.
hero = Image.open(ROOT/'site/shell/city/assets/hero.webp').convert('RGBA')
hero.thumbnail((500, 620), Image.Resampling.LANCZOS)
reference = Image.new('RGBA', (768, 768), (0, 255, 0, 255))
reference.alpha_composite(hero, ((768-hero.width)//2, 700-hero.height))
reference.convert('RGB').save(OUT/'reference.png')
prompt = runner.compose_ref2va_prompt(
    subject_definitions='S1 is the single chibi anime girl in <Picture 1>: short light brown bob hair, oversized gray and orange headphones, oversized orange hooded jacket with its round sleeve emblem, dark short skirt, bare thighs, dark socks, and chunky gray black orange sneakers. Her complete original hand-drawn design is the identity reference.',
    summary='A clean full-body 2D sprite animation of S1 running in place toward screen right on a perfectly flat bright green chroma-key background. One uninterrupted stationary camera shot.',
    retention_analysis='Preserve the exact reference character, chibi proportions, face, hairstyle, headphones, oversized jacket, skirt, shoes, bold ink outlines, warm cel-shaded colors and drawn texture. Render every part including hands and legs in the same illustrated style. Retain the entire head and both feet inside the frame at all times. Only change the pose and animate the clothing and hair naturally.',
    shots=[dict(start_seconds=0, description='The full-body girl S1 from <Picture 1> is centered, facing screen right in a consistent side view, and immediately runs in place at a steady moderate pace, repeating about seven complete running cycles during five seconds. Her legs alternate clear forward contact, weight absorption, push-off, bent-knee recovery and a brief airborne phase. The arms swing opposite the corresponding legs, elbows naturally bent, the fists and sneakers fully drawn. Her torso gently rises and falls, jacket hem and hair bounce slightly. The root stays at the same horizontal position and the virtual ground level stays fixed. She keeps the same body size, outfit and facing direction throughout. The complete figure occupies about 75 percent of the image height with ample space around the swinging limbs. Background is solid pure bright green RGB 0,255,0, evenly lit and completely featureless. No scenery, floor line, cast shadow, text, speed lines, particles, props or other characters. No camera movement, cuts, zooms, turning, walking toward camera, sliding across screen, morphing or character redesign. End in the same continuing run so a middle complete cycle can loop.')],
    overall_soundscape='Quiet soft rhythmic footsteps only; no speech.',
    non_diegetic_music='N/A', image_count=1, duration_seconds=5,
)
(OUT/'prompt.txt').write_text(prompt+'\n')
manifest = {'jobs':[{'id':'fullbody-run-v1','title':'Original full-body running cycle',
    'reference_images':[str(OUT/'reference.png')], 'prompt_file':str(OUT/'prompt.txt'),
    'duration_seconds':5, 'seed':2026101701, 'output_path':str(OUT/'fullbody-run.mp4')}]}
(OUT/'jobs.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n')
print(OUT/'jobs.json')
