#!/usr/bin/env python3
"""Build biome border composites: two enriched biome patches blended along an
organic noise mask. The mask defines WHERE the border is (engine contract);
the img2img healing pass defines HOW it looks."""
import os, sys, random, base64, json
from PIL import Image, ImageFilter

ROOT = "/Users/j/Documents/New project/uo-chain-sandbox-poc"
CAND = os.path.join(ROOT, "assets/terrain/candidates")
SCRATCH = os.path.dirname(os.path.abspath(__file__))
S = 1024

def value_noise(size, cells, seed, octaves=3):
    """Smooth 2D value noise in [0,1] via random L-grids upsampled bicubic."""
    rng = random.Random(seed)
    acc = None
    amp_total = 0.0
    for o in range(octaves):
        c = cells * (2 ** o)
        amp = 0.5 ** o
        grid = Image.new("L", (c, c))
        grid.putdata([rng.randrange(256) for _ in range(c * c)])
        layer = grid.resize((size, size), Image.BICUBIC)
        if acc is None:
            acc = layer
        else:
            acc = Image.blend(acc, layer, amp / (amp_total + amp))
        amp_total += amp
    return acc

def border_mask(seed, wander=150, feather=36):
    """Meandering vertical boundary through the middle: 0=left biome, 255=right."""
    noise = value_noise(S, 6, seed, octaves=4)
    npx = noise.load()
    mask = Image.new("L", (S, S))
    mpx = mask.load()
    for y in range(S):
        for x in range(S):
            # signed distance from wandering centerline
            d = x - (S * 0.5 + (npx[x, y] / 255.0 - 0.5) * 2 * wander)
            v = max(0.0, min(1.0, 0.5 + d / (2.0 * feather)))
            mpx[x, y] = int(v * 255)
    return mask.filter(ImageFilter.GaussianBlur(4))

def border_mask_gradual(seed, wander=140, feather=64, patch_amp=170):
    """Wide ecotone: patches/islands of each biome interleave across a ~3-4 tile
    band. Mid-frequency noise perturbs the signed distance so the 50% line grows
    fingers and detached islands; feather keeps every patch edge soft."""
    center = value_noise(S, 6, seed, octaves=3)          # low-freq centerline wander
    patch = value_noise(S, 14, seed + 7, octaves=3)      # mid-freq patchiness
    cpx, ppx = center.load(), patch.load()
    mask = Image.new("L", (S, S))
    mpx = mask.load()
    for y in range(S):
        for x in range(S):
            d = x - (S * 0.5 + (cpx[x, y] / 255.0 - 0.5) * 2 * wander)
            d += (ppx[x, y] / 255.0 - 0.5) * 2 * patch_amp
            v = max(0.0, min(1.0, 0.5 + d / (2.0 * feather)))
            mpx[x, y] = int(v * 255)
    return mask.filter(ImageFilter.GaussianBlur(3))

PAIRS = [
    # (name, left patch file, right patch file, mask seed)
    ("meadow-fenmarsh",  "style-painterly.png", "style-fenmarsh.png",  101),
    ("meadow-ashlands",  "style-painterly.png", "style-ashlands.png",  202),
    ("meadow-chalkdowns","style-painterly.png", "style-chalkdowns.png",303),
    ("fenmarsh-blight",  "style-fenmarsh.png",  "style-cursedmoor.png",404),
    ("meadow-frostfell", "style-painterly.png", "style-frostfell.png", 505),
]
if len(sys.argv) > 1 and sys.argv[1] == "frost":
    PAIRS = [("meadow-frostfell", "style-painterly.png", "style-frostfell.png", 505)]

gradual = len(sys.argv) > 1 and sys.argv[1] == "gradual"
for name, left, right, seed in PAIRS:
    A = Image.open(os.path.join(CAND, left)).convert("RGB")
    B = Image.open(os.path.join(CAND, right)).convert("RGB")
    if gradual:
        mask = border_mask_gradual(seed)
        suffix = "-gradual"
    else:
        mask = border_mask(seed)
        suffix = ""
    comp = Image.composite(B, A, mask)
    mask.save(os.path.join(SCRATCH, f"border-{name}{suffix}-mask.png"))
    comp.save(os.path.join(SCRATCH, f"border-{name}{suffix}-composite.png"))
    print("built", name, suffix or "(abrupt)")
print("done")
