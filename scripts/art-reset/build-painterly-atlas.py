#!/usr/bin/env python3
"""Painterly terrain atlas: same 10x12 engine contract, but tiles cut from the
new biome patches with soft alpha transitions instead of procedural triangle
masks. Updates manifest like the stock generator."""
import sys, random
from pathlib import Path
from PIL import Image, ImageChops, ImageEnhance, ImageFilter

ROOT = Path("/Users/j/Documents/New project/uo-chain-sandbox-poc")
sys.path.insert(0, str(ROOT / "scripts"))
from asset_pipeline_utils import read_json, sha256_file, write_json
from terrain_atlas_materials import ATLAS_ROWS, CELL, MATERIALS, PAIR_TRANSITIONS
from terrain_atlas_manifest import terrain_tiles

CAND = ROOT / "assets/terrain/candidates"
OUT = ROOT / "assets/terrain/terrain-placeholder.png"
MANIFEST = ROOT / "assets/terrain/manifest.json"

# material -> (patch file, crop box of a REPRESENTATIVE texture region)
SOURCES = {
    "grass":      ("ground-level-meadow.png", (180, 420, 400, 640)),
    "field":      ("style-autumnheath.png", (240, 500, 460, 720)),
    "dirt":       ("style-painterly.png", (400, 430, 610, 640)),
    "stone":      ("style-chalkdowns.png", (430, 400, 650, 620)),
    "water":      ("border-meadow-water-gradual.png", (680, 140, 920, 380)),
    "settlement": ("style-painterly.png", (350, 420, 640, 710)),
    "cobble":     ("style-painterly.png", (300, 340, 560, 600)),
    "rock":       ("style-ashlands.png", (580, 490, 820, 730)),
    "ruin":       ("style-cursedmoor.png", (480, 440, 740, 700)),
    "shore":      ("border-band-shore.png", (360, 360, 620, 620)),
}

def make_tileable(im):
    """offset-wrap + blended seam repair -> repeatable 64px tile"""
    im = im.resize((CELL, CELL), Image.LANCZOS)
    off = ImageChops.offset(im, CELL // 2, CELL // 2)
    # radial-ish mask: keep offset image at edges (its seams are now center)
    mask = Image.new("L", (CELL, CELL), 0)
    from PIL import ImageDraw
    d = ImageDraw.Draw(mask)
    d.ellipse([8, 8, CELL - 8, CELL - 8], fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(10))
    return Image.composite(im, off, mask)

def base_tile(material, seed):
    fn, box = SOURCES[material]
    src = Image.open(CAND / fn).convert("RGB")
    rng = random.Random(seed)
    # jitter the crop a little per variant for row variety
    bx = list(box)
    jx = rng.randint(-60, 60); jy = rng.randint(-60, 60)
    W, H = src.size
    w = bx[2] - bx[0]; h = bx[3] - bx[1]
    x0 = max(0, min(W - w, bx[0] + jx)); y0 = max(0, min(H - h, bx[1] + jy))
    crop = src.crop((x0, y0, x0 + w, y0 + h))
    t = make_tileable(crop)
    t = ImageEnhance.Color(t).enhance(0.95)
    t = ImageEnhance.Contrast(t).enhance(1.05)
    if material == "stone":
        t = ImageEnhance.Brightness(t).enhance(0.86)
    if material == "settlement":
        t = ImageEnhance.Brightness(t).enhance(0.94)
    return t.convert("RGBA")

def slope_tile(material, seed):
    t = base_tile(material, seed)
    # subtle diagonal striation darkening, no hard shapes
    grad = Image.new("L", (CELL, CELL))
    for y in range(CELL):
        for x in range(CELL):
            grad.putpixel((x, y), int(24 * ((x + y) % 16) / 15))
    dark = ImageEnhance.Brightness(t.convert("RGB")).enhance(0.86).convert("RGBA")
    return Image.composite(dark, t, grad)

def noise_mask(seed, cells=6):
    rng = random.Random(seed)
    g = Image.new("L", (cells, cells))
    g.putdata([rng.randrange(256) for _ in range(cells * cells)])
    return g.resize((CELL, CELL), Image.BICUBIC)

def transition_tile(material, seed):
    """generic transition: texture with ~55% noisy alpha"""
    t = base_tile(material, seed)
    m = noise_mask(seed + 5)
    alpha = m.point(lambda v: max(0, min(255, int(v * 0.9 + 40))))
    t.putalpha(alpha)
    return t

def edge_tile(material, edge, seed):
    """texture fading from opaque at `edge` to transparent at the far side"""
    t = base_tile(material, seed)
    ramp = Image.new("L", (CELL, CELL))
    for y in range(CELL):
        for x in range(CELL):
            if edge == "north": v = 1 - y / CELL
            elif edge == "south": v = y / CELL
            elif edge == "west": v = 1 - x / CELL
            else: v = x / CELL
            ramp.putpixel((x, y), int(255 * max(0.0, min(1.0, v * 1.6 - 0.15))))
    noisy = ImageChops.multiply(ramp, noise_mask(seed + 9).point(lambda v: 128 + v // 2))
    t.putalpha(noisy.filter(ImageFilter.GaussianBlur(2)))
    return t

def corner_tile(material, corner, seed):
    t = base_tile(material, seed)
    cx = CELL if "East" in corner else 0
    cy = 0 if "north" in corner else CELL
    ramp = Image.new("L", (CELL, CELL))
    maxd = (CELL ** 2 + CELL ** 2) ** 0.5
    for y in range(CELL):
        for x in range(CELL):
            d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5 / maxd
            ramp.putpixel((x, y), int(255 * max(0.0, min(1.0, 1.35 - d * 2.1))))
    noisy = ImageChops.multiply(ramp, noise_mask(seed + 11).point(lambda v: 128 + v // 2))
    t.putalpha(noisy.filter(ImageFilter.GaussianBlur(2)))
    return t

def pair_tile(a, b, seed):
    ta = base_tile(a, seed).convert("RGB")
    tb = base_tile(b, seed + 3).convert("RGB")
    m = noise_mask(seed + 7).point(lambda v: 255 if v > 118 else 0).filter(ImageFilter.GaussianBlur(3))
    return Image.composite(ta, tb, m).convert("RGBA")

EDGES = ["north", "east", "south", "west"]
CORNERS = ["northEast", "southEast", "southWest", "northWest"]

atlas = Image.new("RGBA", (CELL * len(MATERIALS), CELL * ATLAS_ROWS), (0, 0, 0, 255))
for mi, mat in enumerate(MATERIALS):
    s = mi * 131
    atlas.alpha_composite(base_tile(mat, s), (mi * CELL, 0))
    atlas.alpha_composite(slope_tile(mat, s + 1), (mi * CELL, CELL))
    tr = transition_tile(mat, s + 2)
    tile_bg = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    tile_bg.alpha_composite(tr)
    atlas.paste(tile_bg, (mi * CELL, 2 * CELL))
    for ei, e in enumerate(EDGES):
        et = edge_tile(mat, e, s + 3 + ei)
        cellim = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
        cellim.alpha_composite(et)
        atlas.paste(cellim, (mi * CELL, (3 + ei) * CELL))
    for ci, c in enumerate(CORNERS):
        ct = corner_tile(mat, c, s + 7 + ci)
        cellim = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
        cellim.alpha_composite(ct)
        atlas.paste(cellim, (mi * CELL, (7 + ci) * CELL))
for pi, (fa, fb) in enumerate(PAIR_TRANSITIONS):
    atlas.alpha_composite(pair_tile(fa, fb, 900 + pi * 43), (pi * CELL, 11 * CELL))

atlas.save(OUT)
digest = sha256_file(OUT)
manifest = read_json(MANIFEST)
manifest["tileSheet"]["columns"] = len(MATERIALS)
manifest["tileSheet"]["rows"] = ATLAS_ROWS
manifest["tileSheet"]["frameCount"] = len(MATERIALS) * ATLAS_ROWS
manifest["tileSheet"]["sha256"] = digest
manifest["tiles"] = terrain_tiles()
prov = manifest.setdefault("provenance", {})
prov["source"] = "painterly biome patches (3D bake + img2img sandwich) sliced by scratchpad build-painterly-atlas.py"
prov["method"] = "ai-assisted-source-plus-deterministic-local-normalization"
write_json(MANIFEST, manifest)
print("atlas written", digest[:16])
