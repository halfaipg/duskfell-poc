#!/usr/bin/env python3
"""Build terrain-generated-source.png (6 material columns) from the new
painterly biome patches, feeding the engine's own atlas generator."""
import os
from PIL import Image

ROOT = "/Users/j/Documents/New project/uo-chain-sandbox-poc"
CAND = os.path.join(ROOT, "assets/terrain/candidates")
OUT = os.path.join(ROOT, "assets/terrain/terrain-generated-source.png")
COLW, COLH = 512, 1024

def crops_column(specs):
    """specs: list of (image_path, box) — stacked vertically, each scaled to 512x512."""
    col = Image.new("RGB", (COLW, COLH))
    y = 0
    for path, box in specs:
        im = Image.open(path).convert("RGB").crop(box).resize((COLW, COLW), Image.LANCZOS)
        col.paste(im, (0, y))
        y += COLW
    return col

P = lambda name: os.path.join(CAND, name)
COLUMNS = [
    # grass: pure meadow, two different regions
    [(P("ground-level-meadow.png"), (0, 300, 620, 920)),
     (P("style-painterly.png"), (30, 430, 560, 960))],
    # field: dry autumn heath grass
    [(P("style-autumnheath.png"), (80, 380, 640, 940)),
     (P("style-autumnheath.png"), (380, 80, 940, 640))],
    # dirt: bare earth / mud
    [(P("style-painterly.png"), (300, 330, 760, 790)),
     (P("border-band-soggy.png"), (250, 250, 800, 800))],
    # stone: gravel + flint
    [(P("border-meadow-water-gradual.png"), (0, 0, 340, 340)),
     (P("style-chalkdowns.png"), (330, 320, 830, 820))],
    # water: open water
    [(P("border-meadow-water-gradual.png"), (560, 60, 1010, 510)),
     (P("border-meadow-water-gradual.png"), (620, 380, 1000, 760))],
    # settlement: pale worn chalk ground
    [(P("style-chalkdowns.png"), (60, 340, 560, 840)),
     (P("style-chalkdowns.png"), (420, 480, 900, 960))],
]
sheet = Image.new("RGB", (COLW * 6, COLH))
for i, specs in enumerate(COLUMNS):
    sheet.paste(crops_column(specs), (i * COLW, 0))
sheet.save(OUT)
print("wrote", OUT, sheet.size)
