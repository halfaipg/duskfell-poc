#!/usr/bin/env python3
"""Compose three boards: biome catalog, border showcase (military view with
player standing on each border), and the border-method strip."""
import os
from math import radians, cos, sin
from PIL import Image, ImageDraw, ImageFont, ImageEnhance, ImageChops

ROOT = "/Users/j/Documents/New project/uo-chain-sandbox-poc"
CAND = os.path.join(ROOT, "assets/terrain/candidates")
CARDS = os.path.join(ROOT, "assets/sprites/player-cards/candidates")
SCRATCH = os.path.dirname(os.path.abspath(__file__))

PPT = 64
TILES = 12
P = PPT * TILES  # plan size 768
VW, VH = 640, 360

try:
    FONT = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 22)
    FONT_SM = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 17)
except Exception:
    FONT = FONT_SM = ImageFont.load_default()

# ---- player sprite (unified wretch, SW game angle) ----
def load_sprite(sh=112):
    src = Image.open(os.path.join(CARDS, "duskfell-uo-wretch-game-angle-sw.png")).convert("RGBA")
    bbox = src.getbbox()
    fig = src.crop(bbox)
    scale = sh / fig.height
    half = fig.resize((max(1, int(fig.width * scale / 2)), sh // 2), Image.LANCZOS)
    rgb = half.convert("RGB").quantize(48).convert("RGB")
    a = half.getchannel("A").point(lambda v: 255 if v >= 96 else 0)
    half = Image.merge("RGBA", (*rgb.split(), a))
    return half.resize((half.width * 2, half.height * 2), Image.NEAREST)

SPRITE = load_sprite()

def tone(im):
    im = ImageEnhance.Color(im).enhance(0.82)
    im = ImageEnhance.Brightness(im).enhance(0.94)
    tint = Image.new("RGB", im.size, (243, 236, 226))
    return ImageChops.multiply(im, tint)

def military_panel(patch_path, label, player_uv):
    plan = Image.open(patch_path).convert("RGB").resize((P, P), Image.LANCZOS)
    plan = plan.quantize(96).convert("RGBA")
    mil = plan.rotate(45, expand=True, resample=Image.NEAREST)
    MW = mil.width

    def p2m(u, v):
        px, py = (u - 0.5) * P, (v - 0.5) * P
        a = radians(-45)
        return (MW / 2 + px * cos(a) - py * sin(a), MW / 2 + px * sin(a) + py * cos(a))

    mx, my = p2m(*player_uv)
    canvas = Image.new("RGBA", (VW, VH), (8, 8, 10, 255))
    ox, oy = int(VW * 0.5 - mx), int(VH * 0.55 - my)
    canvas.alpha_composite(mil, (ox, oy))
    canvas.alpha_composite(SPRITE, (int(VW * 0.5 - SPRITE.width / 2), int(VH * 0.55 - SPRITE.height * 0.94)))
    panel = tone(canvas.convert("RGB"))
    d = ImageDraw.Draw(panel)
    tw = d.textlength(label, font=FONT)
    d.rectangle([0, 0, tw + 20, 34], fill=(12, 12, 12))
    d.text((10, 5), label, fill=(240, 235, 225), font=FONT)
    return panel

def player_u_on_border(mask_path, v=0.55):
    """Find where the boundary centerline crosses row v."""
    mask = Image.open(mask_path).convert("L")
    y = int(v * mask.height)
    row = [mask.getpixel((x, y)) for x in range(mask.width)]
    for x in range(mask.width):
        if row[x] >= 128:
            return x / mask.width
    return 0.5

# ---------------- board 1: biome catalog ----------------
BIOMES = [
    ("Heartland Meadow", "style-painterly.png"),
    ("Autumn Heath", "style-autumnheath.png"),
    ("Chalk Downs", "style-chalkdowns.png"),
    ("Frostfell", "style-frostfell.png"),
    ("Fenmarsh", "style-fenmarsh.png"),
    ("Dark Moor", "style-darkmoor.png"),
    ("Ashlands", "style-ashlands.png"),
    ("Cursed Blight", "style-cursedmoor.png"),
]
SW = 320
cat = Image.new("RGB", (SW * 4, (SW + 34) * 2), (10, 10, 12))
for i, (name, fn) in enumerate(BIOMES):
    r, c = divmod(i, 4)
    sw = Image.open(os.path.join(CAND, fn)).convert("RGB").resize((SW, SW), Image.LANCZOS)
    sw = tone(sw.quantize(96).convert("RGB"))
    x, y = c * SW, r * (SW + 34)
    cat.paste(sw, (x, y + 34))
    d = ImageDraw.Draw(cat)
    d.rectangle([x, y, x + SW, y + 34], fill=(12, 12, 12))
    d.text((x + 10, y + 5), name, fill=(240, 235, 225), font=FONT)
cat.save(os.path.join(CAND, "biome-catalog.png"))
print("biome-catalog.png")

# ---------------- board 2: border showcase ----------------
BORDERS = [
    ("Meadow → Fenmarsh", "meadow-fenmarsh"),
    ("Meadow → Ashlands", "meadow-ashlands"),
    ("Meadow → Chalk Downs", "meadow-chalkdowns"),
    ("Meadow → Frostfell", "meadow-frostfell"),
    ("Fenmarsh → Cursed Blight", "fenmarsh-blight"),
]
panels = []
for label, name in BORDERS:
    healed = f"/tmp/out-border-{name}.png"
    # keep the healed patch as a candidate asset
    Image.open(healed).save(os.path.join(CAND, f"border-{name}.png"))
    u = player_u_on_border(os.path.join(SCRATCH, f"border-{name}-mask.png"), v=0.55)
    panels.append(military_panel(healed, label, (u, 0.55)))

# 6th panel: method mini-diagram
comp = Image.open(os.path.join(SCRATCH, "border-meadow-ashlands-composite.png")).convert("RGB")
healed = Image.open("/tmp/out-border-meadow-ashlands.png").convert("RGB")
mask = Image.open(os.path.join(SCRATCH, "border-meadow-ashlands-mask.png")).convert("L")
half_w = VW // 2
method = Image.new("RGB", (VW, VH), (10, 10, 12))
method.paste(comp.resize((half_w, VH - 34), Image.LANCZOS), (0, 34))
method.paste(healed.resize((half_w, VH - 34), Image.LANCZOS), (half_w, 34))
d = ImageDraw.Draw(method)
d.rectangle([0, 0, VW, 34], fill=(12, 12, 12))
d.text((10, 5), "HOW: masked composite → one img2img heal", fill=(240, 235, 225), font=FONT_SM)
d.text((10, VH - 26), "raw paste (hard seam)", fill=(255, 255, 255), font=FONT_SM)
d.text((half_w + 10, VH - 26), "healed (blended, boundary kept)", fill=(255, 255, 255), font=FONT_SM)
d.line([half_w, 34, half_w, VH], fill=(12, 12, 12), width=3)
panels.append(method)

board = Image.new("RGB", (VW * 2, VH * 3), (10, 10, 12))
for i, p in enumerate(panels):
    r, c = divmod(i, 2)
    board.paste(p, (c * VW, r * VH))
board.save(os.path.join(CAND, "biome-border-board.png"))
print("biome-border-board.png")

# ---------------- board 3: method progression strip ----------------
name = "meadow-fenmarsh"
comp = Image.open(os.path.join(SCRATCH, f"border-{name}-composite.png")).convert("RGB")
mask = Image.open(os.path.join(SCRATCH, f"border-{name}-mask.png")).convert("L")
healed = Image.open(f"/tmp/out-border-{name}.png").convert("RGB")
# contour of mask midline on healed output
contour = healed.copy()
cd = ImageDraw.Draw(contour)
for y in range(0, 1024, 2):
    row_prev = None
    for x in range(0, 1024, 2):
        v = mask.getpixel((x, y)) >= 128
        if row_prev is not None and v != row_prev:
            cd.ellipse([x - 2, y - 2, x + 2, y + 2], fill=(255, 60, 60))
        row_prev = v
SW2 = 400
labels = ["1. biome patches pasted along mask", "2. one img2img heal pass",
          "3. boundary stayed put (mask overlay)"]
imgs = [comp, healed, contour]
strip = Image.new("RGB", (SW2 * 3 + 8, SW2 + 40), (10, 10, 12))
for i, (im, lb) in enumerate(zip(imgs, labels)):
    strip.paste(im.resize((SW2, SW2), Image.LANCZOS), (i * (SW2 + 4), 40))
    ImageDraw.Draw(strip).text((i * (SW2 + 4) + 8, 9), lb, fill=(240, 235, 225), font=FONT_SM)
strip.save(os.path.join(CAND, "biome-border-method.png"))
print("biome-border-method.png")
