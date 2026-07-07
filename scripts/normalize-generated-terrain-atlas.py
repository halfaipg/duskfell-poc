#!/usr/bin/env python3
"""Build the clean-room runtime terrain atlas."""

from __future__ import annotations

import hashlib
import json
import math
import random
from pathlib import Path

from PIL import Image, ImageEnhance


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = ROOT / "assets" / "terrain" / "terrain-placeholder.png"
MANIFEST_PATH = ROOT / "assets" / "terrain" / "manifest.json"

SOURCE_PATH = ROOT / "assets" / "terrain" / "terrain-generated-source.png"
ATLAS_ROWS = 12
CELL = 64
MATERIALS = ["grass", "field", "dirt", "stone", "water", "settlement"]
MATERIAL_SOURCE_COLUMNS = {material: index for index, material in enumerate(MATERIALS)}
SOURCE_COLUMNS = len(MATERIALS)
EDGE_MASKS = ["north", "east", "south", "west"]
CORNER_MASKS = ["northEast", "southEast", "southWest", "northWest"]
PAIR_TRANSITIONS = [
    ("dirt", "grass"),
    ("stone", "dirt"),
    ("water", "dirt"),
    ("water", "grass"),
    ("dirt", "settlement"),
    ("settlement", "grass"),
]
MATERIAL_PALETTES = {
    "grass": {
        "base": (57, 91, 43),
        "dark": (31, 55, 34),
        "mid": (78, 121, 54),
        "light": (126, 151, 72),
        "accent": (202, 184, 76),
    },
    "field": {
        "base": (93, 105, 58),
        "dark": (55, 68, 43),
        "mid": (126, 133, 73),
        "light": (177, 166, 91),
        "accent": (108, 72, 42),
    },
    "dirt": {
        "base": (107, 72, 45),
        "dark": (62, 44, 33),
        "mid": (143, 96, 57),
        "light": (184, 131, 77),
        "accent": (82, 74, 60),
    },
    "stone": {
        "base": (91, 95, 89),
        "dark": (49, 56, 53),
        "mid": (120, 124, 112),
        "light": (159, 156, 133),
        "accent": (69, 74, 70),
    },
    "water": {
        "base": (35, 83, 92),
        "dark": (18, 49, 62),
        "mid": (52, 115, 121),
        "light": (100, 157, 151),
        "accent": (157, 147, 92),
    },
    "settlement": {
        "base": (156, 149, 119),
        "dark": (90, 82, 65),
        "mid": (187, 177, 139),
        "light": (218, 205, 158),
        "accent": (103, 112, 92),
    },
}


def main() -> None:
    source_image = load_source_image()
    atlas = Image.new("RGBA", (CELL * len(MATERIALS), CELL * ATLAS_ROWS), (0, 0, 0, 255))
    for material_index, material in enumerate(MATERIALS):
        for row, variant in enumerate(("flat", "slope", "transition")):
            tile = paint_material_tile(material, variant, material_index * 101 + row * 37, source_image)
            atlas.alpha_composite(tile, (material_index * CELL, row * CELL))

    for material_index, material in enumerate(MATERIALS):
        generic = atlas.crop((material_index * CELL, 2 * CELL, (material_index + 1) * CELL, 3 * CELL))
        for edge_index, edge in enumerate(EDGE_MASKS):
            variant = directional_transition_variant(generic, edge=edge)
            atlas.alpha_composite(variant, (material_index * CELL, (3 + edge_index) * CELL))
        for corner_index, corner in enumerate(CORNER_MASKS):
            variant = directional_transition_variant(generic, corner=corner)
            atlas.alpha_composite(variant, (material_index * CELL, (7 + corner_index) * CELL))

    for pair_index, (from_material, to_material) in enumerate(PAIR_TRANSITIONS):
        pair_tile = paint_pair_transition_tile(from_material, to_material, 900 + pair_index * 41, source_image)
        atlas.alpha_composite(pair_tile, (pair_index * CELL, 11 * CELL))

    atlas.save(OUTPUT_PATH)
    digest = hashlib.sha256(OUTPUT_PATH.read_bytes()).hexdigest()
    source_digest = source_hash()
    manifest = json.loads(MANIFEST_PATH.read_text())
    manifest["tileSheet"]["rows"] = ATLAS_ROWS
    manifest["tileSheet"]["frameCount"] = SOURCE_COLUMNS * ATLAS_ROWS
    manifest["tileSheet"]["sha256"] = digest
    manifest["tiles"] = terrain_tiles()
    provenance = manifest.setdefault("provenance", {})
    provenance["source"] = "AI-assisted clean-room source texture sheet normalized by scripts/normalize-generated-terrain-atlas.py"
    provenance["prompt"] = "original clean-room military-plan-oblique fantasy MMO terrain texture source sheet with lush grass, trampled field grass, dirt path, rocky ground, shallow water, worn stone plaza, slopes, and edge transition variants"
    provenance["method"] = "ai-assisted-source-plus-deterministic-local-normalization"
    provenance["tool"] = "OpenAI built-in image generation plus Pillow local image processing"
    provenance["toolVersion"] = "Pillow 2026-07-07 runtime"
    provenance["sourceHash"] = source_digest
    if SOURCE_PATH.exists():
        provenance["sourceImageHash"] = hashlib.sha256(SOURCE_PATH.read_bytes()).hexdigest()
    provenance["termsSnapshot"] = "OpenAI service terms reviewed 2026-07-07 for source concept; local deterministic terrain generation adds no external source"
    MANIFEST_PATH.write_text(f"{json.dumps(manifest, indent=2)}\n")
    print(f"wrote {OUTPUT_PATH}")
    print(f"updated {MANIFEST_PATH} tileSheet.sha256={digest}")
    print(f"updated {MANIFEST_PATH} provenance.sourceHash={source_digest}")


def load_source_image() -> Image.Image | None:
    if not SOURCE_PATH.exists():
        return None
    return Image.open(SOURCE_PATH).convert("RGBA")


def source_hash() -> str:
    hasher = hashlib.sha256()
    hasher.update(Path(__file__).read_bytes())
    if SOURCE_PATH.exists():
        hasher.update(SOURCE_PATH.read_bytes())
    return hasher.hexdigest()


def paint_material_tile(material: str, variant: str, seed: int, source_image: Image.Image | None = None) -> Image.Image:
    palette = MATERIAL_PALETTES[material]
    rng = random.Random(seed)
    if source_image is not None:
        image = source_material_tile(source_image, material, variant, rng)
    else:
        image = Image.new("RGBA", (CELL, CELL), (*palette["base"], 255))
        paint_block_noise(image, palette, rng, variant)

        if material == "grass":
            paint_grass(image, palette, rng, variant)
        elif material == "field":
            paint_field(image, palette, rng, variant)
        elif material == "dirt":
            paint_dirt(image, palette, rng, variant)
        elif material == "stone":
            paint_rocky_ground(image, palette, rng, variant)
        elif material == "water":
            paint_water(image, palette, rng, variant)
        elif material == "settlement":
            paint_settlement(image, palette, rng, variant)

    if variant == "slope":
        paint_slope_striations(image, palette, rng, material)
    elif variant == "transition":
        paint_transition_scatter(image, palette, rng, material)
    return image


def source_material_tile(source: Image.Image, material: str, variant: str, rng: random.Random) -> Image.Image:
    column = MATERIAL_SOURCE_COLUMNS[material]
    column_width = max(1, source.width // len(MATERIALS))
    x0 = column * column_width
    x1 = source.width if column == len(MATERIALS) - 1 else (column + 1) * column_width
    crop_size = min(source.height, x1 - x0, 256)
    inset = max(0, crop_size // 16)
    max_x = max(x0, x1 - crop_size - inset)
    max_y = max(0, source.height - crop_size - inset)
    crop_x = rng.randint(x0 + inset, max_x) if max_x > x0 + inset else x0
    crop_y = rng.randint(inset, max_y) if max_y > inset else 0
    patch = source.crop((crop_x, crop_y, crop_x + crop_size, crop_y + crop_size))
    patch = patch.resize((CELL, CELL), Image.Resampling.LANCZOS)
    patch = ImageEnhance.Color(patch).enhance(0.9 if material in {"grass", "field"} else 0.86)
    patch = ImageEnhance.Contrast(patch).enhance(1.12 if material != "water" else 1.04)
    patch = ImageEnhance.Brightness(patch).enhance(0.92 if material in {"stone", "settlement"} else 0.96)
    return patch.convert("RGBA")


def paint_block_noise(image: Image.Image, palette: dict, rng: random.Random, variant: str) -> None:
    for y in range(0, CELL, 4):
        for x in range(0, CELL, 4):
            color = palette["base"]
            roll = rng.random()
            if roll < 0.22:
                color = shade(color, 0.82)
            elif roll > 0.82:
                color = mix(color, palette["light"], 0.2 if variant == "flat" else 0.13)
            rect(image, x, y, 4, 4, (*color, 255))
    for _ in range(120):
        x = rng.randrange(CELL)
        y = rng.randrange(CELL)
        color = palette["mid"] if rng.random() > 0.45 else palette["dark"]
        put_pixel(image, x, y, (*color, 120))


def paint_grass(image: Image.Image, palette: dict, rng: random.Random, variant: str) -> None:
    clumps = 26 if variant != "transition" else 16
    for _ in range(clumps):
        x = rng.randrange(2, CELL - 3)
        y = rng.randrange(3, CELL - 4)
        height = rng.randrange(3, 8)
        color = palette["light"] if rng.random() > 0.72 else palette["mid"]
        line(image, x, y + 2, x + rng.choice([-1, 0, 1]), y - height, (*color, 160), width=1)
        if rng.random() > 0.55:
            line(image, x - 1, y + 2, x - 2, y - max(2, height - 2), (*palette["dark"], 120), width=1)
        if rng.random() > 0.62:
            line(image, x + 1, y + 2, x + 2, y - max(2, height - 1), (*palette["mid"], 135), width=1)
        if rng.random() > 0.78:
            rect(image, x - 1, y - height - 1, 2, 2, (*palette["accent"], 150))
    for _ in range(16):
        draw_leaf_chip(image, rng.randrange(2, CELL - 8), rng.randrange(2, CELL - 8), rng.randrange(4, 8), rng.randrange(2, 5), (*palette["dark"], 130), rng.randrange(99))


def paint_field(image: Image.Image, palette: dict, rng: random.Random, variant: str) -> None:
    spacing = 9 if variant != "slope" else 8
    for y in range(4, CELL, spacing):
        wobble = rng.randrange(-2, 3)
        line(image, 1, y + wobble, CELL - 2, y - 4 + wobble, (*palette["dark"], 86), width=1)
        line(image, 3, y - 2 + wobble, CELL - 5, y - 6 + wobble, (*palette["light"], 58), width=1)
    for _ in range(16):
        x = rng.randrange(2, CELL - 3)
        y = rng.randrange(2, CELL - 3)
        line(image, x, y + 3, x + rng.choice([-1, 0, 1]), y - rng.randrange(3, 7), (*palette["light"], 132), width=1)


def paint_dirt(image: Image.Image, palette: dict, rng: random.Random, variant: str) -> None:
    for _ in range(70 if variant != "transition" else 44):
        x = rng.randrange(2, CELL - 2)
        y = rng.randrange(2, CELL - 2)
        radius = rng.choice([1, 1, 2, 2, 3])
        color = palette["light"] if rng.random() > 0.72 else palette["dark"] if rng.random() < 0.38 else palette["mid"]
        ellipse(image, x, y, radius, max(1, radius - 1), (*color, 155))
    for _ in range(12):
        x = rng.randrange(0, CELL - 9)
        y = rng.randrange(0, CELL - 5)
        draw_leaf_chip(image, x, y, rng.randrange(5, 10), rng.randrange(2, 4), (*palette["dark"], 130), rng.randrange(99))


def paint_rocky_ground(image: Image.Image, palette: dict, rng: random.Random, variant: str) -> None:
    for _ in range(42 if variant != "transition" else 30):
        x = rng.randrange(0, CELL - 8)
        y = rng.randrange(0, CELL - 7)
        w = rng.randrange(5, 13)
        h = rng.randrange(4, 9)
        color = palette["mid"] if rng.random() > 0.42 else palette["base"]
        points = [
            (x + 1, y + h // 2),
            (x + w // 3, y),
            (x + w, y + rng.randrange(1, max(2, h // 2 + 1))),
            (x + w - 1, y + h),
            (x + rng.randrange(1, max(2, w // 2)), y + h),
        ]
        polygon(image, points, (*palette["dark"], 150))
        inner = [(px, py + 1) for px, py in points]
        polygon(image, inner, (*color, 210))
        if rng.random() > 0.55:
            line(image, x + 2, y + 2, x + w - 2, y + h - 1, (*palette["light"], 110), width=1)


def paint_water(image: Image.Image, palette: dict, rng: random.Random, variant: str) -> None:
    for y in range(2, CELL, 6):
        shift = int(math.sin(y * 0.4) * 4)
        line(image, shift, y, CELL + shift, y - 5, (*palette["light"], 70), width=1)
        line(image, shift - 5, y + 3, CELL + shift - 5, y - 2, (*palette["dark"], 90), width=1)
    for _ in range(18):
        x = rng.randrange(2, CELL - 8)
        y = rng.randrange(2, CELL - 3)
        line(image, x, y, x + rng.randrange(4, 12), y - rng.choice([1, 2]), (*palette["mid"], 115), width=1)


def paint_settlement(image: Image.Image, palette: dict, rng: random.Random, variant: str) -> None:
    for y in range(-8, CELL + 8, 14):
        for x in range(-16, CELL + 16, 18):
            offset = 9 if (y // 14) % 2 else 0
            px = x + offset
            color = palette["mid"] if rng.random() > 0.35 else palette["base"]
            polygon(
                image,
                [(px, y + 7), (px + 8, y), (px + 17, y + 7), (px + 9, y + 14)],
                (*palette["dark"], 130),
            )
            polygon(
                image,
                [(px + 1, y + 7), (px + 8, y + 1), (px + 16, y + 7), (px + 9, y + 13)],
                (*color, 230),
            )
            if rng.random() > 0.62:
                line(image, px + 4, y + 6, px + 13, y + 8, (*palette["light"], 115), width=1)
    for _ in range(8):
        rect(image, rng.randrange(0, CELL - 5), rng.randrange(0, CELL - 4), rng.randrange(2, 5), 1, (*palette["accent"], 100))


def paint_slope_striations(image: Image.Image, palette: dict, rng: random.Random, material: str) -> None:
    for offset in range(-CELL, CELL * 2, 13):
        alpha = 58 if material != "water" else 42
        line(image, offset, CELL, offset + CELL, 0, (*palette["dark"], alpha), width=1)
        if material != "settlement":
            line(image, offset + 4, CELL, offset + CELL + 4, 0, (*palette["light"], 34), width=1)


def paint_transition_scatter(image: Image.Image, palette: dict, rng: random.Random, material: str) -> None:
    edge_color = MATERIAL_PALETTES["grass"]["dark"] if material not in {"grass", "water"} else palette["accent"]
    for _ in range(22):
        x = rng.randrange(CELL)
        y = rng.randrange(CELL)
        if rng.random() > 0.55:
            ellipse(image, x, y, rng.choice([1, 2]), 1, (*edge_color, 72))
        else:
            line(image, x, y + 2, x + rng.choice([-1, 0, 1]), y - 3, (*edge_color, 92), width=1)


def paint_pair_transition_tile(
    from_material: str,
    to_material: str,
    seed: int,
    source_image: Image.Image | None = None,
) -> Image.Image:
    rng = random.Random(seed)
    base = paint_material_tile(to_material, "transition", seed + 7, source_image)
    from_palette = MATERIAL_PALETTES[from_material]
    to_palette = MATERIAL_PALETTES[to_material]
    family = pair_family(from_material, to_material)
    if source_image is not None:
        from_tile = source_material_tile(source_image, from_material, "transition", random.Random(seed + 13))
        paint_source_pair_blend(base, from_tile, family, rng)

    if family == "shore":
        paint_pair_shore(base, from_palette, to_palette, rng)
    elif family == "plaza":
        paint_pair_plaza(base, from_palette, to_palette, rng)
    elif family == "rocky":
        paint_pair_rocky(base, from_palette, to_palette, rng)
    elif family == "path":
        paint_pair_path(base, from_palette, to_palette, rng)
    else:
        paint_pair_soft(base, from_palette, to_palette, rng)
    return base


def paint_source_pair_blend(target: Image.Image, source: Image.Image, family: str, rng: random.Random) -> None:
    patch_count = {
        "shore": 18,
        "plaza": 16,
        "rocky": 18,
        "path": 22,
        "soft": 20,
    }.get(family, 18)
    for _ in range(patch_count):
        width = rng.randrange(12, 30)
        height = rng.randrange(5, 18)
        x = rng.randrange(-8, CELL - 5)
        y = rng.randrange(-4, CELL - 3)
        alpha = {
            "shore": rng.randrange(72, 128),
            "plaza": rng.randrange(54, 104),
            "rocky": rng.randrange(60, 118),
            "path": rng.randrange(78, 138),
            "soft": rng.randrange(46, 96),
        }.get(family, 80)
        angle = rng.choice([-0.42, -0.22, 0.18, 0.36])
        paste_source_patch(target, source, x, y, width, height, alpha, angle)


def paste_source_patch(
    target: Image.Image,
    source: Image.Image,
    x: int,
    y: int,
    width: int,
    height: int,
    alpha: int,
    angle: float,
) -> None:
    for py in range(height):
        for px in range(width):
            nx = (px - width / 2) / max(1, width / 2)
            ny = (py - height / 2) / max(1, height / 2)
            if nx * nx + ny * ny > 1:
                continue
            edge = 1 - min(1, max(abs(nx), abs(ny)))
            wave = math.sin((px + py) * 0.45 + angle * 5) * 0.12
            local_alpha = max(0, min(255, round(alpha * (0.45 + edge * 0.55 + wave))))
            sx = (x + px * 2 + py) % CELL
            sy = (y + py * 2 + px) % CELL
            r, g, b, _ = source.getpixel((sx, sy))
            put_pixel(target, x + px, y + py, (r, g, b, local_alpha))


def pair_family(from_material: str, to_material: str) -> str:
    if from_material == "water" or to_material == "water":
        return "shore"
    if from_material == "settlement" or to_material == "settlement":
        return "plaza"
    if from_material == "stone" or to_material == "stone":
        return "rocky"
    if from_material == "dirt" or to_material == "dirt":
        return "path"
    return "soft"


def paint_pair_path(image: Image.Image, from_palette: dict, to_palette: dict, rng: random.Random) -> None:
    for _ in range(42):
        x = rng.randrange(0, CELL - 8)
        y = rng.randrange(0, CELL - 4)
        color = from_palette["mid"] if rng.random() > 0.35 else from_palette["dark"]
        draw_leaf_chip(image, x, y, rng.randrange(5, 12), rng.randrange(2, 5), (*color, 130), rng.randrange(99))
    for _ in range(28):
        x = rng.randrange(2, CELL - 3)
        y = rng.randrange(3, CELL - 4)
        line(image, x, y + 2, x + rng.choice([-2, -1, 1, 2]), y - rng.randrange(3, 8), (*to_palette["light"], 145), width=1)


def paint_pair_rocky(image: Image.Image, from_palette: dict, to_palette: dict, rng: random.Random) -> None:
    for _ in range(36):
        x = rng.randrange(0, CELL - 10)
        y = rng.randrange(0, CELL - 8)
        w = rng.randrange(5, 12)
        h = rng.randrange(3, 8)
        color = from_palette["mid"] if rng.random() > 0.5 else from_palette["dark"]
        polygon(
            image,
            [(x, y + h // 2), (x + w // 3, y), (x + w, y + 1), (x + w - 1, y + h), (x + 2, y + h)],
            (*color, 145),
        )
    for _ in range(18):
        rect(image, rng.randrange(0, CELL - 4), rng.randrange(0, CELL - 2), rng.randrange(2, 5), 1, (*to_palette["light"], 85))


def paint_pair_shore(image: Image.Image, from_palette: dict, to_palette: dict, rng: random.Random) -> None:
    for y in range(3, CELL, 7):
        shift = rng.randrange(-4, 5)
        line(image, shift, y, CELL + shift, y - rng.randrange(1, 4), (*MATERIAL_PALETTES["water"]["light"], 105), width=1)
    for _ in range(28):
        x = rng.randrange(1, CELL - 6)
        y = rng.randrange(1, CELL - 4)
        color = to_palette["accent"] if rng.random() > 0.38 else from_palette["light"]
        ellipse(image, x, y, rng.choice([1, 2]), 1, (*color, 120))


def paint_pair_plaza(image: Image.Image, from_palette: dict, to_palette: dict, rng: random.Random) -> None:
    for _ in range(24):
        x = rng.randrange(0, CELL - 12)
        y = rng.randrange(0, CELL - 9)
        w = rng.randrange(7, 14)
        h = rng.randrange(4, 8)
        polygon(
            image,
            [(x, y + h // 2), (x + w // 2, y), (x + w, y + h // 2), (x + w // 2, y + h)],
            (*MATERIAL_PALETTES["settlement"]["light"], 135),
        )
        line(image, x + 1, y + h // 2, x + w - 1, y + h // 2, (*MATERIAL_PALETTES["settlement"]["dark"], 95), width=1)
    for _ in range(18):
        x = rng.randrange(1, CELL - 5)
        y = rng.randrange(1, CELL - 4)
        draw_leaf_chip(image, x, y, rng.randrange(4, 9), rng.randrange(2, 4), (*from_palette["dark"], 105), rng.randrange(99))


def paint_pair_soft(image: Image.Image, from_palette: dict, to_palette: dict, rng: random.Random) -> None:
    for _ in range(34):
        x = rng.randrange(2, CELL - 3)
        y = rng.randrange(3, CELL - 4)
        color = from_palette["mid"] if rng.random() > 0.5 else to_palette["light"]
        line(image, x, y + 2, x + rng.choice([-1, 1]), y - rng.randrange(3, 7), (*color, 125), width=1)


def directional_transition_variant(source: Image.Image, edge: str | None = None, corner: str | None = None) -> Image.Image:
    variant = source.copy()
    pixels = variant.load()
    for y in range(CELL):
        for x in range(CELL):
            alpha = transition_weight(x, y, edge=edge, corner=corner)
            if alpha <= 0:
                continue
            r, g, b, a = pixels[x, y]
            highlight = min(255, int(r * 1.2 + 18)), min(255, int(g * 1.17 + 15)), min(255, int(b * 1.08 + 8))
            shadow = int(r * 0.55), int(g * 0.55), int(b * 0.55)
            t = min(1.0, alpha)
            if edge in {"south", "west"} or corner in {"southEast", "southWest"}:
                mixed = tuple(int(shadow[i] * t + (r, g, b)[i] * (1 - t)) for i in range(3))
            else:
                mixed = tuple(int(highlight[i] * t + (r, g, b)[i] * (1 - t)) for i in range(3))
            pixels[x, y] = (mixed[0], mixed[1], mixed[2], a)
    paint_mask_edge_marks(variant, edge=edge, corner=corner)
    return variant


def paint_mask_edge_marks(image: Image.Image, edge: str | None = None, corner: str | None = None) -> None:
    rng = random.Random(f"{edge}:{corner}")
    for _ in range(16):
        x = rng.randrange(CELL)
        y = rng.randrange(CELL)
        if transition_weight(x, y, edge=edge, corner=corner) <= 0.08:
            continue
        color = (31, 39, 30, 80) if rng.random() > 0.45 else (211, 196, 137, 70)
        if rng.random() > 0.45:
            line(image, x - 2, y + 1, x + 3, y - 1, color, width=1)
        else:
            rect(image, x, y, rng.randrange(2, 5), 1, color)


def transition_weight(x: int, y: int, edge: str | None, corner: str | None) -> float:
    u = x / max(1, CELL - 1)
    v = y / max(1, CELL - 1)
    depth = 0.42
    feather = 0.12
    if edge == "north":
        return falloff(v, depth, feather)
    if edge == "east":
        return falloff(1 - u, depth, feather)
    if edge == "south":
        return falloff(1 - v, depth, feather)
    if edge == "west":
        return falloff(u, depth, feather)
    if corner == "northEast":
        return max(0.0, min(falloff(v, depth, feather), falloff(1 - u, depth, feather)))
    if corner == "southEast":
        return max(0.0, min(falloff(1 - v, depth, feather), falloff(1 - u, depth, feather)))
    if corner == "southWest":
        return max(0.0, min(falloff(1 - v, depth, feather), falloff(u, depth, feather)))
    if corner == "northWest":
        return max(0.0, min(falloff(v, depth, feather), falloff(u, depth, feather)))
    return 0.0


def falloff(distance: float, depth: float, feather: float) -> float:
    if distance <= depth - feather:
        return 0.34
    if distance >= depth:
        return 0.0
    return ((depth - distance) / feather) * 0.34


def shade(color: tuple[int, int, int], factor: float) -> tuple[int, int, int]:
    return tuple(max(0, min(255, round(channel * factor))) for channel in color)


def mix(left: tuple[int, int, int], right: tuple[int, int, int], amount: float) -> tuple[int, int, int]:
    return tuple(round(left[index] * (1 - amount) + right[index] * amount) for index in range(3))


def rect(image: Image.Image, x: int, y: int, width: int, height: int, color: tuple[int, int, int, int]) -> None:
    for py in range(y, y + height):
        for px in range(x, x + width):
            put_pixel(image, px, py, color)


def ellipse(image: Image.Image, cx: int, cy: int, rx: int, ry: int, color: tuple[int, int, int, int]) -> None:
    for py in range(cy - ry, cy + ry + 1):
        for px in range(cx - rx, cx + rx + 1):
            nx = (px - cx) / max(1, rx)
            ny = (py - cy) / max(1, ry)
            if nx * nx + ny * ny <= 1:
                put_pixel(image, px, py, color)


def polygon(image: Image.Image, points: list[tuple[int, int]], color: tuple[int, int, int, int]) -> None:
    if not points:
        return
    min_x = min(x for x, _ in points)
    max_x = max(x for x, _ in points)
    min_y = min(y for _, y in points)
    max_y = max(y for _, y in points)
    for py in range(min_y, max_y + 1):
        for px in range(min_x, max_x + 1):
            if point_in_polygon(px + 0.5, py + 0.5, points):
                put_pixel(image, px, py, color)


def point_in_polygon(x: float, y: float, points: list[tuple[int, int]]) -> bool:
    inside = False
    j = len(points) - 1
    for i, point in enumerate(points):
        xi, yi = point
        xj, yj = points[j]
        if (yi > y) != (yj > y):
            intersect = (xj - xi) * (y - yi) / max(0.0001, yj - yi) + xi
            if x < intersect:
                inside = not inside
        j = i
    return inside


def line(
    image: Image.Image,
    x0: int,
    y0: int,
    x1: int,
    y1: int,
    color: tuple[int, int, int, int],
    width: int = 1,
) -> None:
    dx = abs(x1 - x0)
    dy = -abs(y1 - y0)
    sx = 1 if x0 < x1 else -1
    sy = 1 if y0 < y1 else -1
    err = dx + dy
    x = x0
    y = y0
    while True:
        for py in range(y - width // 2, y + width // 2 + 1):
            for px in range(x - width // 2, x + width // 2 + 1):
                put_pixel(image, px, py, color)
        if x == x1 and y == y1:
            break
        e2 = 2 * err
        if e2 >= dy:
            err += dy
            x += sx
        if e2 <= dx:
            err += dx
            y += sy


def draw_leaf_chip(
    image: Image.Image,
    x: int,
    y: int,
    width: int,
    height: int,
    color: tuple[int, int, int, int],
    seed: int,
) -> None:
    points = [
        (x, y + height // 2),
        (x + width // 3, y),
        (x + width, y + (seed % 3)),
        (x + width - 1, y + height),
        (x + width // 4, y + height + ((seed // 3) % 2)),
    ]
    polygon(image, points, color)


def put_pixel(image: Image.Image, x: int, y: int, color: tuple[int, int, int, int]) -> None:
    if x < 0 or y < 0 or x >= image.width or y >= image.height:
        return
    src_r, src_g, src_b, src_a = color
    if src_a >= 255:
        image.putpixel((x, y), color)
        return
    dst_r, dst_g, dst_b, dst_a = image.getpixel((x, y))
    alpha = src_a / 255
    out_a = src_a + dst_a * (1 - alpha)
    if out_a <= 0:
        image.putpixel((x, y), (0, 0, 0, 0))
        return
    out = (
        round((src_r * src_a + dst_r * dst_a * (1 - alpha)) / out_a),
        round((src_g * src_a + dst_g * dst_a * (1 - alpha)) / out_a),
        round((src_b * src_a + dst_b * dst_a * (1 - alpha)) / out_a),
        round(out_a),
    )
    image.putpixel((x, y), out)


def terrain_tiles() -> list[dict]:
    tiles: list[dict] = []
    for index, material in enumerate(MATERIALS):
        tiles.append(tile_entry(material, "flat-base", index, surface_role(material, "flat")))
    for index, material in enumerate(MATERIALS):
        tiles.append(tile_entry(material, "slope-texture", 6 + index, surface_role(material, "slope")))
    for index, material in enumerate(MATERIALS):
        tiles.append(tile_entry(material, "transition", 12 + index, surface_role(material, "transition")))
    for edge_index, edge in enumerate(EDGE_MASKS):
        for material_index, material in enumerate(MATERIALS):
            tiles.append(
                tile_entry(
                    material,
                    "transition",
                    18 + edge_index * len(MATERIALS) + material_index,
                    surface_role(material, "transition"),
                    mask={"type": "edge", "edge": edge},
                )
            )
    for corner_index, corner in enumerate(CORNER_MASKS):
        for material_index, material in enumerate(MATERIALS):
            tiles.append(
                tile_entry(
                    material,
                    "transition",
                    42 + corner_index * len(MATERIALS) + material_index,
                    surface_role(material, "transition"),
                    mask={"type": "corner", "corner": corner},
                )
            )
    pair_frame_start = len(MATERIALS) * 11
    for pair_index, (from_material, to_material) in enumerate(PAIR_TRANSITIONS):
        tiles.append(
            tile_entry(
                to_material,
                "pair-transition",
                pair_frame_start + pair_index,
                surface_role(to_material, "transition"),
                pair={"from": from_material, "to": to_material},
            )
        )
    return tiles


def tile_entry(material: str, kind: str, frame: int, role: str, mask: dict | None = None, pair: dict | None = None) -> dict:
    entry = {
        "id": f"{material}-{tile_id_part(kind, mask)}",
        "material": material,
        "kind": kind,
        "frame": frame,
        "surface": {
            "walkable": material != "water",
            "role": role,
        },
    }
    if mask:
        entry["mask"] = mask
    if pair:
        entry["id"] = f"{pair['from']}-to-{pair['to']}-pair-transition"
        entry["pair"] = pair
    return entry


def tile_id_part(kind: str, mask: dict | None) -> str:
    if not mask:
        return {
            "flat-base": "flat-placeholder",
            "slope-texture": "slope-placeholder",
            "transition": "transition-placeholder",
            "pair-transition": "pair-transition",
        }[kind]
    if mask["type"] == "edge":
        return f"transition-{mask['edge']}"
    return f"transition-{mask['corner']}"


def surface_role(material: str, variant: str) -> str:
    if material == "water":
        return "liquid" if variant == "flat" else "liquid-slope" if variant == "slope" else "shoreline"
    if material == "settlement":
        return "surface" if variant == "flat" else "surface-slope" if variant == "slope" else "surface-edge"
    return "slope" if variant == "slope" else "edge" if variant == "transition" else "ground"


if __name__ == "__main__":
    main()
