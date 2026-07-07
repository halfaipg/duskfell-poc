#!/usr/bin/env python3
"""Normalize generated landscape details into a runtime sprite sheet."""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path

from PIL import Image, ImageEnhance


ROOT = Path(__file__).resolve().parents[1]
SOURCE_PATH = ROOT / "assets" / "sprites" / "duskfell-details-source.png"
OUTPUT_PATH = ROOT / "assets" / "sprites" / "duskfell-details.png"
MANIFEST_PATH = ROOT / "assets" / "sprites" / "manifest.json"

CELL = 64
SOURCE_COLUMNS = 8
COLUMNS = 23
ROWS = 1
STATIC_FRAME_START = SOURCE_COLUMNS

DETAIL_SHEET = {
    "id": "duskfell-details",
    "image": "duskfell-details.png",
    "imageSha256": "",
    "frameGrid": {
        "cellWidth": CELL,
        "cellHeight": CELL,
        "columns": COLUMNS,
        "rows": ROWS,
        "frameCount": COLUMNS * ROWS,
    },
    "anchor": {
        "kind": "foot",
        "x": 32,
        "y": 54,
    },
    "footprint": {
        "kind": "diamond",
        "widthTiles": 0.75,
        "heightTiles": 0.75,
    },
    "render": {
        "layer": "terrain",
        "sort": "footprint-y",
        "zBias": -4,
        "scale": 0.72,
        "shadow": {
            "kind": "ellipse",
            "x": 32,
            "y": 56,
            "width": 30,
            "height": 8,
            "opacity": 0.18,
        },
    },
    "directions": [
        {
            "name": "neutral",
            "startFrame": 0,
            "frameCount": COLUMNS * ROWS,
        }
    ],
    "provenance": {
        "cleanRoom": True,
        "source": "generated concept sheet normalized from assets/sprites/duskfell-details-source.png",
        "createdAt": "2026-07-07",
        "license": "project-original-ai-assisted-review",
        "reviewer": "codex",
        "prompt": (
            "original clean-room military-plan-oblique dark fantasy terrain detail sheet with rock cluster, "
            "pebbles, grass tuft, wildflowers, scrub bush, fallen log, stump, mushrooms, and locally authored "
            "four sapling tree variants, four mature tree variants, four ancient tree variants, boulder, reeds, and ruined-stone static frames"
        ),
        "negativePrompt": "no text, no logos, no watermark, no copied commercial game assets, not 2:1 isometric",
        "method": "ai-generated",
        "tool": "OpenAI built-in image generation plus local chroma-key sprite-sheet normalization",
        "toolVersion": "built-in image generation 2026-07-07",
        "sourceHash": "",
        "termsSnapshot": "OpenAI service terms reviewed 2026-07-07 for internal PoC asset review",
        "model": "built-in image generation",
        "modelVersion": "2026-07-07",
        "seed": "unavailable-built-in-generation",
        "toolReview": {
            "status": "approved-internal",
            "reviewedAt": "2026-07-07",
            "reviewer": "codex",
            "sourceUrl": "https://openai.com/policies/service-terms",
            "risk": "internal PoC detail sheet from clean-room prompt; human art review still required before production approval",
        },
    },
    "approval": {
        "state": "review",
    },
}


def main() -> None:
    if not SOURCE_PATH.exists():
        raise SystemExit(f"missing generated detail source: {SOURCE_PATH}")

    source = remove_magenta_screen(Image.open(SOURCE_PATH).convert("RGBA"))
    atlas = Image.new("RGBA", (CELL * COLUMNS, CELL * ROWS), (0, 0, 0, 0))
    boxes = sprite_boxes(source)

    for column, box in enumerate(boxes):
        frame = source.crop(box)
        frame = remove_detached_artifacts(frame)
        frame = trim_and_fit(frame)
        atlas.alpha_composite(frame, (column * CELL, 0))

    draw_static_frames(atlas)

    atlas = ImageEnhance.Contrast(atlas).enhance(1.04)
    atlas.save(OUTPUT_PATH)

    image_hash = sha256_file(OUTPUT_PATH)
    source_hash = sha256_file(SOURCE_PATH)
    update_manifest(image_hash, source_hash)
    print(f"wrote {OUTPUT_PATH}")
    print(f"updated {MANIFEST_PATH} duskfell-details imageSha256={image_hash}")


def remove_magenta_screen(image: Image.Image) -> Image.Image:
    out = Image.new("RGBA", image.size, (0, 0, 0, 0))
    pixels = []
    for r, g, b, a in image.getdata():
        key_score = min(r, b) - g * 0.35
        if r > 150 and b > 135 and g < 80 and key_score > 112:
            alpha = 0
        elif r > 120 and b > 110 and g < 110 and key_score > 72:
            alpha = round(a * max(0, min(1, (112 - key_score) / 40)))
        else:
            alpha = a
        if alpha <= 3:
            pixels.append((0, 0, 0, 0))
        else:
            magenta_cap = max(g, min(r, b)) + 18
            pixels.append((min(r, magenta_cap), g, min(b, magenta_cap), alpha))
    out.putdata(pixels)
    return out


def sprite_boxes(image: Image.Image) -> list[tuple[int, int, int, int]]:
    alpha = image.getchannel("A")
    column_counts = [
        sum(1 for y in range(image.height) if alpha.getpixel((x, y)) > 8)
        for x in range(image.width)
    ]
    runs: list[tuple[int, int]] = []
    start: int | None = None
    for x, count in enumerate(column_counts):
        if count > 4 and start is None:
            start = x
        elif count <= 4 and start is not None:
            if x - start > 8:
                runs.append((start, x))
            start = None
    if start is not None:
        runs.append((start, image.width))

    if len(runs) != SOURCE_COLUMNS:
        source_cell_width = image.width / SOURCE_COLUMNS
        return [
            (
                round(column * source_cell_width),
                0,
                round((column + 1) * source_cell_width),
                image.height,
            )
            for column in range(SOURCE_COLUMNS)
        ]

    boxes = []
    for left, right in runs:
        padded = (
            max(0, left - 22),
            0,
            min(image.width, right + 22),
            image.height,
        )
        crop_alpha = image.crop(padded).getchannel("A")
        bbox = crop_alpha.getbbox()
        if bbox is None:
            boxes.append(padded)
            continue
        boxes.append((
            padded[0] + bbox[0],
            max(0, padded[1] + bbox[1] - 14),
            padded[0] + bbox[2],
            min(image.height, padded[1] + bbox[3] + 14),
        ))
    return boxes


def draw_static_frames(atlas: Image.Image) -> None:
    for variant in range(4):
        draw_tree_frame(atlas, STATIC_FRAME_START + variant, "sapling", variant)
        draw_tree_frame(atlas, STATIC_FRAME_START + 4 + variant, "mature", variant)
        draw_tree_frame(atlas, STATIC_FRAME_START + 8 + variant, "ancient", variant)
    draw_boulder_frame(atlas, STATIC_FRAME_START + 12)
    draw_reeds_frame(atlas, STATIC_FRAME_START + 13)
    draw_ruin_frame(atlas, STATIC_FRAME_START + 14)


def draw_tree_frame(atlas: Image.Image, frame: int, stage: str, variant: int) -> None:
    draw_clean_tree_frame(atlas, frame, stage, variant)
    return

    ox = frame * CELL
    if stage == "sapling":
        if variant == 0:
            trunk = [(ox + 30, 57), (ox + 35, 57), (ox + 34, 42), (ox + 36, 30), (ox + 31, 29), (ox + 29, 43)]
            canopy = [
                (ox + 22, 33, 9, 11, (37, 81, 49, 255)),
                (ox + 34, 25, 12, 14, (66, 111, 62, 255)),
                (ox + 44, 35, 9, 11, (29, 67, 45, 255)),
                (ox + 33, 40, 14, 10, (42, 88, 52, 255)),
            ]
            highlights = [(ox + 31, 22, 5, 3), (ox + 39, 31, 4, 3)]
            branches = [
                ([(ox + 31, 45), (ox + 21, 36), (ox + 24, 33), (ox + 34, 42)], (42, 31, 23, 180)),
                ([(ox + 34, 44), (ox + 44, 37), (ox + 42, 34), (ox + 32, 41)], (42, 31, 23, 170)),
            ]
        else:
            trunk = [(ox + 27, 58), (ox + 33, 58), (ox + 32, 45), (ox + 29, 34), (ox + 33, 27), (ox + 37, 35), (ox + 35, 46)]
            canopy = [
                (ox + 18, 36, 8, 10, (30, 72, 48, 255)),
                (ox + 27, 25, 10, 13, (58, 104, 59, 255)),
                (ox + 39, 29, 13, 12, (38, 84, 52, 255)),
                (ox + 29, 42, 16, 9, (27, 64, 43, 255)),
            ]
            highlights = [(ox + 29, 24, 4, 3), (ox + 42, 27, 5, 3)]
            branches = [
                ([(ox + 31, 45), (ox + 18, 41), (ox + 21, 37), (ox + 33, 42)], (42, 31, 23, 175)),
                ([(ox + 32, 43), (ox + 49, 33), (ox + 46, 30), (ox + 30, 40)], (42, 31, 23, 185)),
            ]
    elif stage == "ancient":
        if variant == 0:
            trunk = [
                (ox + 25, 58), (ox + 40, 58), (ox + 38, 45), (ox + 42, 30),
                (ox + 37, 19), (ox + 31, 25), (ox + 26, 43),
            ]
            canopy = [
                (ox + 14, 31, 15, 16, (22, 56, 39, 255)),
                (ox + 23, 18, 17, 19, (37, 82, 51, 255)),
                (ox + 39, 15, 18, 20, (55, 98, 56, 255)),
                (ox + 52, 29, 13, 15, (20, 49, 38, 255)),
                (ox + 33, 36, 24, 16, (31, 71, 47, 255)),
                (ox + 31, 6, 10, 10, (79, 118, 65, 240)),
            ]
            highlights = [(ox + 25, 12, 6, 4), (ox + 40, 22, 5, 3), (ox + 18, 30, 4, 3)]
            branches = [
                ([(ox + 29, 46), (ox + 9, 32), (ox + 15, 27), (ox + 35, 40)], (42, 31, 23, 220)),
                ([(ox + 35, 43), (ox + 56, 31), (ox + 50, 25), (ox + 31, 38)], (42, 31, 23, 210)),
                ([(ox + 31, 55), (ox + 15, 61), (ox + 26, 51)], (53, 35, 25, 230)),
                ([(ox + 36, 55), (ox + 53, 59), (ox + 39, 51)], (48, 32, 24, 225)),
            ]
        else:
            trunk = [
                (ox + 22, 58), (ox + 38, 58), (ox + 39, 46), (ox + 36, 36),
                (ox + 39, 26), (ox + 34, 15), (ox + 29, 24), (ox + 25, 42),
            ]
            canopy = [
                (ox + 11, 39, 13, 15, (18, 48, 37, 255)),
                (ox + 20, 25, 18, 16, (30, 75, 48, 255)),
                (ox + 36, 12, 16, 19, (48, 92, 54, 255)),
                (ox + 51, 25, 14, 16, (22, 55, 39, 255)),
                (ox + 39, 39, 22, 14, (35, 74, 48, 255)),
                (ox + 20, 13, 11, 10, (64, 105, 62, 238)),
            ]
            highlights = [(ox + 22, 23, 6, 4), (ox + 39, 13, 5, 4), (ox + 53, 26, 4, 3)]
            branches = [
                ([(ox + 28, 47), (ox + 7, 43), (ox + 12, 36), (ox + 34, 41)], (42, 31, 23, 220)),
                ([(ox + 33, 43), (ox + 58, 39), (ox + 53, 31), (ox + 31, 38)], (42, 31, 23, 210)),
                ([(ox + 28, 55), (ox + 9, 60), (ox + 25, 50)], (53, 35, 25, 230)),
                ([(ox + 35, 56), (ox + 55, 57), (ox + 38, 50)], (48, 32, 24, 225)),
            ]
    else:
        if variant == 0:
            trunk = [
                (ox + 28, 56), (ox + 36, 56), (ox + 35, 43), (ox + 38, 31),
                (ox + 35, 22), (ox + 31, 27), (ox + 28, 43),
            ]
            canopy = [
                (ox + 16, 31, 12, 13, (28, 65, 44, 255)),
                (ox + 24, 20, 14, 16, (42, 88, 52, 255)),
                (ox + 39, 17, 14, 16, (57, 103, 58, 255)),
                (ox + 50, 31, 11, 13, (25, 58, 42, 255)),
                (ox + 33, 35, 20, 14, (35, 78, 49, 255)),
                (ox + 31, 8, 8, 8, (79, 122, 67, 242)),
            ]
            highlights = [(ox + 27, 13, 6, 4), (ox + 39, 23, 5, 3)]
            branches = [
                ([(ox + 29, 55), (ox + 17, 60), (ox + 26, 51)], (53, 35, 25, 230)),
                ([(ox + 35, 55), (ox + 49, 59), (ox + 38, 51)], (48, 32, 24, 225)),
                ([(ox + 31, 43), (ox + 15, 31), (ox + 20, 26), (ox + 35, 38)], (42, 31, 23, 210)),
                ([(ox + 35, 41), (ox + 52, 31), (ox + 47, 26), (ox + 32, 36)], (42, 31, 23, 200)),
            ]
        else:
            trunk = [
                (ox + 26, 57), (ox + 35, 57), (ox + 36, 45), (ox + 33, 34),
                (ox + 36, 24), (ox + 31, 19), (ox + 27, 31), (ox + 25, 44),
            ]
            canopy = [
                (ox + 13, 34, 13, 12, (24, 62, 43, 255)),
                (ox + 22, 23, 15, 15, (37, 86, 51, 255)),
                (ox + 37, 20, 16, 14, (52, 98, 58, 255)),
                (ox + 48, 35, 13, 12, (24, 58, 42, 255)),
                (ox + 29, 38, 23, 12, (34, 76, 48, 255)),
                (ox + 22, 12, 8, 8, (76, 118, 66, 238)),
            ]
            highlights = [(ox + 22, 18, 6, 4), (ox + 38, 22, 5, 3)]
            branches = [
                ([(ox + 29, 54), (ox + 13, 58), (ox + 25, 50)], (53, 35, 25, 230)),
                ([(ox + 34, 54), (ox + 51, 56), (ox + 37, 50)], (48, 32, 24, 225)),
                ([(ox + 30, 43), (ox + 13, 38), (ox + 17, 32), (ox + 34, 38)], (42, 31, 23, 210)),
                ([(ox + 34, 41), (ox + 54, 34), (ox + 49, 28), (ox + 32, 36)], (42, 31, 23, 200)),
            ]

    polygon(atlas, trunk, (74, 47, 29, 255))
    for points, color in branches:
        polygon(atlas, points, color)

    for cx, cy, rx, ry, _ in canopy:
        ellipse(atlas, cx, cy, rx + 2, ry + 2, (9, 28, 23, 190))

    for cx, cy, rx, ry, color in canopy:
        ellipse(atlas, cx, cy, rx, ry, color)

    for hx, hy, rx, ry in highlights:
        ellipse(atlas, hx, hy, rx, ry, (151, 171, 97, 84))
    ellipse(atlas, ox + 46, 38, 9, 6, (6, 22, 19, 86))
    draw_leaf_texture(atlas, ox, stage, variant, canopy)


def draw_clean_tree_frame(atlas: Image.Image, frame: int, stage: str, variant: int) -> None:
    ox = frame * CELL
    base_y = 57
    species = variant % 4
    palettes = [
        {
            "bark": (79, 50, 31, 255),
            "bark_dark": (39, 29, 23, 245),
            "bark_light": (135, 94, 57, 145),
            "leaf": (36, 88, 50, 255),
            "leaf_dark": (10, 34, 27, 240),
            "leaf_mid": (57, 113, 62, 255),
            "leaf_light": (142, 166, 92, 115),
            "seed": (205, 177, 80, 185),
            "rot": (96, 72, 50, 145),
            "moss": (86, 120, 72, 150),
        },
        {
            "bark": (57, 42, 31, 255),
            "bark_dark": (25, 24, 22, 248),
            "bark_light": (110, 83, 55, 125),
            "leaf": (25, 64, 48, 255),
            "leaf_dark": (8, 25, 25, 245),
            "leaf_mid": (42, 86, 60, 255),
            "leaf_light": (103, 139, 91, 105),
            "seed": (148, 168, 108, 150),
            "rot": (72, 58, 45, 150),
            "moss": (66, 111, 83, 165),
        },
        {
            "bark": (88, 62, 39, 255),
            "bark_dark": (43, 31, 24, 250),
            "bark_light": (163, 128, 75, 140),
            "leaf": (61, 94, 54, 250),
            "leaf_dark": (18, 38, 31, 230),
            "leaf_mid": (96, 122, 69, 245),
            "leaf_light": (181, 176, 102, 105),
            "seed": (219, 158, 77, 180),
            "rot": (106, 74, 49, 160),
            "moss": (118, 129, 78, 145),
        },
        {
            "bark": (96, 83, 62, 255),
            "bark_dark": (42, 38, 32, 248),
            "bark_light": (174, 158, 112, 130),
            "leaf": (79, 113, 70, 245),
            "leaf_dark": (23, 48, 38, 226),
            "leaf_mid": (120, 143, 85, 238),
            "leaf_light": (205, 198, 130, 118),
            "seed": (225, 207, 118, 170),
            "rot": (121, 99, 68, 150),
            "moss": (138, 151, 100, 130),
        },
    ][species]
    stage_data = {
        "sapling": {"height": 30, "trunk": 4, "crown_y": 32, "crown": 0.76, "roots": 1},
        "mature": {"height": 46, "trunk": 8, "crown_y": 25, "crown": 1.02, "roots": 2},
        "ancient": {"height": 56, "trunk": 12, "crown_y": 19, "crown": 1.2, "roots": 3},
    }[stage]
    lean = [-4, 2, -2, 4][species]
    trunk_w = stage_data["trunk"]
    top_x = ox + 32 + lean
    base_x = ox + 32
    trunk_top_y = base_y - stage_data["height"]

    root_spread = 6 + stage_data["roots"] * 3
    polygon(
        atlas,
        [
            (base_x - trunk_w - root_spread, base_y),
            (base_x - trunk_w // 2, base_y - 5),
            (top_x - max(2, trunk_w // 2), trunk_top_y),
            (top_x + max(2, trunk_w // 2), trunk_top_y + 1),
            (base_x + trunk_w // 2, base_y - 5),
            (base_x + trunk_w + root_spread, base_y),
            (base_x + trunk_w // 2, base_y + 1),
            (base_x - trunk_w // 2, base_y + 1),
        ],
        palettes["bark"],
    )
    line(atlas, base_x - trunk_w // 2, base_y - 4, top_x - 1, trunk_top_y + 5, palettes["bark_dark"], width=2)
    line(atlas, base_x + trunk_w // 2, base_y - 5, top_x + 2, trunk_top_y + 7, palettes["bark_light"], width=1)
    draw_tree_root_knuckles(atlas, base_x, base_y, stage, species, palettes)

    branch_sets = {
        "sapling": [(-8, -17, -2), (9, -20, 2)],
        "mature": [(-16, -25, -3), (17, -29, 4), (-10, -36, -1), (12, -38, 3)],
        "ancient": [(-23, -30, -5), (24, -34, 5), (-18, -45, -2), (18, -48, 4), (-10, -22, -6), (11, -24, 7)],
    }[stage]
    for dx, dy, bias in branch_sets:
        start_y = base_y + dy * 0.58
        line(atlas, round(top_x + bias * 0.45), round(start_y), round(top_x + dx), base_y + dy, palettes["bark_dark"], width=2)
        line(atlas, round(top_x + bias * 0.45), round(start_y - 1), round(top_x + dx), base_y + dy - 1, palettes["bark"], width=1)
    draw_tree_side_branches(atlas, top_x, base_y, stage, species, palettes)

    if species == 1:
        draw_needle_tree_crown(atlas, ox, top_x, trunk_top_y, stage, palettes, stage_data["crown"])
    elif species == 2:
        draw_sparse_tree_crown(atlas, ox, top_x, trunk_top_y, stage, palettes, stage_data["crown"])
    else:
        draw_broad_tree_crown(atlas, ox, top_x, base_y - stage_data["crown_y"], stage, palettes, stage_data["crown"], species)

    if stage == "ancient":
        hollow_y = base_y - 13
        ellipse(atlas, base_x + lean // 2, hollow_y, 3, 5, (14, 12, 11, 170))
        line(atlas, base_x - 7, base_y - 1, base_x - 17, base_y + 2, palettes["bark_dark"], width=2)
        line(atlas, base_x + 7, base_y - 1, base_x + 18, base_y + 2, palettes["bark_dark"], width=2)

    draw_tree_age_cues(atlas, ox, top_x, base_x, base_y, trunk_top_y, stage, species, palettes)
    draw_tree_resource_cues(atlas, ox, frame, top_x, base_y, stage, species, palettes)
    draw_tree_pixel_noise(atlas, ox, frame, stage, species, palettes)


def draw_tree_root_knuckles(
    atlas: Image.Image,
    base_x: int,
    base_y: int,
    stage: str,
    species: int,
    palette: dict[str, tuple[int, int, int, int]],
) -> None:
    roots = {
        "sapling": [(-5, 0, -11, 3), (5, -1, 11, 2)],
        "mature": [(-7, 0, -17, 4), (6, -1, 16, 2), (-2, 1, -7, 5)],
        "ancient": [(-9, -1, -22, 4), (8, -1, 23, 3), (-3, 1, -15, 7), (4, 1, 15, 7)],
    }[stage]
    for index, (x0, y0, x1, y1) in enumerate(roots):
        color = palette["bark_dark"] if (index + species) % 2 else palette["bark"]
        line(atlas, base_x + x0, base_y + y0, base_x + x1, base_y + y1, color, width=2)
        line(atlas, base_x + x0, base_y + y0 - 1, base_x + x1, base_y + y1 - 1, palette["bark_light"], width=1)


def draw_tree_side_branches(
    atlas: Image.Image,
    top_x: int,
    base_y: int,
    stage: str,
    species: int,
    palette: dict[str, tuple[int, int, int, int]],
) -> None:
    if stage == "sapling":
        twigs = [(-5, -26, -13, -31), (4, -23, 12, -29)]
    elif stage == "mature":
        twigs = [(-8, -31, -22, -36), (8, -34, 23, -41), (-4, -23, -17, -25), (5, -26, 19, -29)]
    else:
        twigs = [
            (-10, -37, -31, -43),
            (10, -39, 31, -47),
            (-7, -25, -28, -27),
            (8, -27, 29, -30),
            (-1, -47, -10, -55),
            (4, -49, 14, -57),
        ]
    for index, (x0, y0, x1, y1) in enumerate(twigs):
        if stage == "sapling" and (index + species) % 3 == 0:
            continue
        line(atlas, top_x + x0, base_y + y0, top_x + x1, base_y + y1, palette["bark_dark"], width=1)


def draw_tree_age_cues(
    atlas: Image.Image,
    ox: int,
    top_x: int,
    base_x: int,
    base_y: int,
    trunk_top_y: int,
    stage: str,
    species: int,
    palette: dict[str, tuple[int, int, int, int]],
) -> None:
    if stage == "sapling":
        ellipse(atlas, top_x - 7, trunk_top_y + 17, 2, 2, palette["leaf_light"])
        ellipse(atlas, top_x + 8, trunk_top_y + 19, 2, 2, palette["leaf_light"])
        return

    if stage == "mature":
        for offset in (-9, 8):
            line(atlas, base_x + offset, base_y - 21, base_x + offset + (species % 3) - 1, base_y - 8, palette["moss"], width=1)
        if species == 2:
            ellipse(atlas, ox + 19, base_y - 19, 3, 5, palette["rot"])
        return

    for offset in (-14, -6, 7, 15):
        line(atlas, base_x + offset, trunk_top_y + 21, base_x + offset + (species % 3) - 1, base_y - 5, palette["moss"], width=1)
    for index, x in enumerate((base_x - 12, base_x + 12, base_x + 3)):
        ellipse(atlas, x, base_y - 10 - index * 5, 2 + (index % 2), 3, palette["rot"])
    if species in (2, 3):
        for x0, y0, x1, y1 in ((-20, -18, -31, -12), (18, -22, 30, -16), (-4, -34, 4, -43)):
            line(atlas, top_x + x0, base_y + y0, top_x + x1, base_y + y1, (35, 28, 23, 185), width=1)


def draw_tree_resource_cues(
    atlas: Image.Image,
    ox: int,
    frame: int,
    top_x: int,
    base_y: int,
    stage: str,
    species: int,
    palette: dict[str, tuple[int, int, int, int]],
) -> None:
    counts = {"sapling": 2, "mature": 4, "ancient": 6}
    for index in range(counts[stage]):
        x = ox + 14 + ((frame * 11 + species * 13 + index * 9) % 37)
        y = 9 + ((frame * 7 + species * 17 + index * 11) % (32 if stage != "sapling" else 25))
        if atlas.getpixel((x, y))[3] <= 30:
            x = top_x + ((index % 3) - 1) * (7 + species)
            y = base_y - (26 + index * 4)
        rx = 1 if stage == "sapling" else 2
        ellipse(atlas, x, y, rx, rx, palette["seed"])
    if stage == "ancient":
        fungus_color = (186, 164, 111, 170) if species != 1 else (126, 151, 134, 160)
        for index in range(3):
            ellipse(atlas, ox + 23 + index * 8, base_y - 4 - (index % 2), 2, 1, fungus_color)


def draw_broad_tree_crown(
    atlas: Image.Image,
    ox: int,
    cx: int,
    cy: int,
    stage: str,
    palette: dict[str, tuple[int, int, int, int]],
    size: float,
    species: int,
) -> None:
    base = {
        "sapling": [(-8, 0, 8, 11), (2, -7, 10, 12), (11, 2, 7, 9), (0, 9, 13, 8)],
        "mature": [(-17, 1, 14, 16), (-5, -13, 16, 18), (14, -8, 15, 17), (21, 6, 11, 13), (1, 12, 22, 13), (-19, 14, 10, 10)],
        "ancient": [(-25, 4, 16, 18), (-13, -13, 18, 19), (7, -18, 20, 22), (25, -5, 17, 18), (18, 14, 20, 15), (-8, 15, 25, 15), (-28, 20, 12, 10)],
    }[stage]
    seed = {"sapling": 17, "mature": 31, "ancient": 47}[stage] + species * 23
    for dx, dy, rx, ry in base:
        draw_chunky_leaf_cluster(
            atlas,
            round(cx + dx * size),
            round(cy + dy * size),
            round(rx * size + 3),
            round(ry * size + 3),
            palette["leaf_dark"],
            seed + dx * 3 + dy,
            ragged=True,
        )
    colors = [palette["leaf"], palette["leaf_mid"], palette["leaf_dark"], palette["leaf"]]
    for index, (dx, dy, rx, ry) in enumerate(base):
        draw_chunky_leaf_cluster(
            atlas,
            round(cx + dx * size),
            round(cy + dy * size),
            round(rx * size),
            round(ry * size),
            colors[(index + species) % len(colors)],
            seed + index * 19,
        )
    carve_crown_notches(atlas, ox, cx, cy, stage, species)
    draw_crown_leaf_facets(atlas, ox, cx, cy, stage, species, palette)


def draw_needle_tree_crown(
    atlas: Image.Image,
    ox: int,
    cx: int,
    trunk_top_y: int,
    stage: str,
    palette: dict[str, tuple[int, int, int, int]],
    size: float,
) -> None:
    rows = {
        "sapling": [(23, 15), (31, 21), (40, 27)],
        "mature": [(12, 19), (23, 28), (34, 36), (45, 42)],
        "ancient": [(6, 20), (18, 32), (31, 43), (44, 49), (55, 54)],
    }[stage]
    for index, (offset_y, width) in enumerate(rows):
        y = trunk_top_y + offset_y
        half = round(width * size * 0.5)
        points = [
            (cx, y - round(12 * size)),
            (cx - half, y + round(8 * size)),
            (cx + (index % 2) - round(half * 0.28), y + round(4 * size)),
            (cx + half, y + round(8 * size)),
        ]
        polygon(atlas, points, palette["leaf_dark"] if index % 2 else palette["leaf"])
        line(atlas, cx - half + 2, y + round(6 * size), cx + half - 2, y + round(6 * size), palette["leaf_mid"], width=1)


def draw_sparse_tree_crown(
    atlas: Image.Image,
    ox: int,
    cx: int,
    trunk_top_y: int,
    stage: str,
    palette: dict[str, tuple[int, int, int, int]],
    size: float,
) -> None:
    clusters = {
        "sapling": [(-7, 7, 7, 8), (8, 2, 8, 9), (0, -5, 7, 8)],
        "mature": [(-20, 4, 10, 11), (-7, -13, 11, 12), (13, -11, 12, 13), (22, 6, 9, 10), (0, 11, 13, 10)],
        "ancient": [(-27, 5, 10, 12), (-16, -15, 12, 13), (8, -22, 13, 14), (27, -7, 11, 13), (16, 15, 12, 10), (-6, 19, 14, 9)],
    }[stage]
    crown_y = trunk_top_y + (17 if stage == "sapling" else 11 if stage == "mature" else 9)
    for index, (dx, dy, rx, ry) in enumerate(clusters):
        color = palette["leaf_mid"] if index % 2 else palette["leaf"]
        draw_chunky_leaf_cluster(
            atlas,
            round(cx + dx * size),
            round(crown_y + dy * size),
            round(rx * size),
            round(ry * size),
            color,
            59 + index * 17 + len(stage) * 11,
        )
        if index % 2 == 0:
            draw_leaf_chip(
                atlas,
                round(cx + dx * size - 4),
                round(crown_y + dy * size - 4),
                max(3, round(rx * size * 0.5)),
                max(2, round(ry * size * 0.34)),
                palette["leaf_light"],
                93 + index,
            )
    carve_crown_notches(atlas, ox, cx, crown_y, stage, 2)


def draw_chunky_leaf_cluster(
    image: Image.Image,
    cx: int,
    cy: int,
    rx: int,
    ry: int,
    color: tuple[int, int, int, int],
    seed: int,
    ragged: bool = False,
) -> None:
    rx = max(3, rx)
    ry = max(3, ry)
    jitter_x = (seed % 5) - 2
    jitter_y = ((seed // 5) % 5) - 2
    points = [
        (cx - rx + jitter_x, cy - ry // 4),
        (cx - rx // 2, cy - ry + jitter_y),
        (cx + rx // 5, cy - ry - (1 if ragged else 0)),
        (cx + rx, cy - ry // 3 + ((seed // 3) % 3) - 1),
        (cx + rx - rx // 5, cy + ry // 2),
        (cx + rx // 4, cy + ry + ((seed // 7) % 3) - 1),
        (cx - rx // 2, cy + ry - ry // 5),
        (cx - rx - ((seed // 11) % 2), cy + ry // 3),
    ]
    polygon(image, points, color)

    chip_count = 2 if rx < 8 else 3 if rx < 15 else 4
    for index in range(chip_count):
        px = cx - rx + 2 + ((seed * 13 + index * 11) % max(3, rx * 2 - 4))
        py = cy - ry + 2 + ((seed * 17 + index * 7) % max(3, ry * 2 - 4))
        if ((px - cx) / max(1, rx)) ** 2 + ((py - cy) / max(1, ry)) ** 2 > 1.1:
            continue
        chip_w = 2 + ((seed + index) % 3)
        chip_h = 1 + ((seed // 3 + index) % 3)
        rect(image, px, py, chip_w, chip_h, color)


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


def carve_crown_notches(image: Image.Image, ox: int, cx: int, cy: int, stage: str, species: int) -> None:
    notches = {
        "sapling": [(-15, -2, 5, 5), (13, 6, 5, 4), (0, -15, 4, 4)],
        "mature": [(-28, 0, 7, 6), (25, 4, 7, 7), (-7, -28, 6, 5), (8, 19, 6, 5)],
        "ancient": [(-34, 5, 8, 7), (31, -1, 8, 8), (-12, -35, 7, 6), (13, 25, 8, 6), (-27, 21, 6, 5)],
    }[stage]
    for index, (dx, dy, width, height) in enumerate(notches):
        if (index + species) % 4 == 0 and stage != "ancient":
            continue
        clear_rect(image, cx + dx, cy + dy, width, height, ox, ox + CELL)


def draw_crown_leaf_facets(
    image: Image.Image,
    ox: int,
    cx: int,
    cy: int,
    stage: str,
    species: int,
    palette: dict[str, tuple[int, int, int, int]],
) -> None:
    count = {"sapling": 5, "mature": 9, "ancient": 13}[stage]
    for index in range(count):
        x = ox + 9 + ((species * 23 + index * 7 + len(stage) * 11) % 47)
        y = 6 + ((species * 13 + index * 11 + len(stage) * 5) % 43)
        if image.getpixel((x, y))[3] <= 20:
            continue
        color = palette["leaf_light"] if index % 3 == 0 else palette["leaf_dark"]
        draw_leaf_chip(image, x, y, 3 + (index % 3), 2 + ((index + species) % 2), color, index + species)


def clear_rect(image: Image.Image, x: int, y: int, width: int, height: int, min_x: int, max_x: int) -> None:
    for py in range(y, y + height):
        for px in range(x, x + width):
            if px < min_x or px >= max_x or py < 0 or py >= image.height:
                continue
            image.putpixel((px, py), (0, 0, 0, 0))


def draw_tree_pixel_noise(
    atlas: Image.Image,
    ox: int,
    frame: int,
    stage: str,
    species: int,
    palette: dict[str, tuple[int, int, int, int]],
) -> None:
    count = {"sapling": 22, "mature": 42, "ancient": 58}[stage]
    for index in range(count):
        x = ox + 8 + ((frame * 29 + index * 17 + species * 11) % 48)
        y = 6 + ((frame * 13 + index * 23 + species * 7) % 45)
        existing = atlas.getpixel((x, y))
        if existing[3] <= 20:
            continue
        color = palette["leaf_light"] if index % 5 == 0 else palette["leaf_dark"] if index % 3 == 0 else palette["leaf_mid"]
        put_pixel(atlas, x, y, color)
        if stage != "sapling" and index % 11 == 0:
            put_pixel(atlas, min(ox + CELL - 1, x + 1), y, color)


def draw_leaf_texture(
    atlas: Image.Image,
    ox: int,
    stage: str,
    variant: int,
    canopy: list[tuple[int, int, int, int, tuple[int, int, int, int]]],
) -> None:
    stage_seed = {"sapling": 11, "mature": 23, "ancient": 37}[stage] + variant * 19
    for index in range(42 if stage == "ancient" else 30 if stage == "mature" else 18):
        blob = canopy[(index + variant) % len(canopy)]
        cx, cy, rx, ry, _ = blob
        angle = ((stage_seed * 17 + index * 53) % 360) / 57.2958
        radius = ((stage_seed * 29 + index * 31) % 100) / 100
        px = round(cx + math.cos(angle) * rx * 0.78 * radius)
        py = round(cy + math.sin(angle) * ry * 0.72 * radius)
        color = (128, 153, 88, 70) if index % 3 == 0 else (8, 24, 20, 58)
        put_pixel(atlas, px, py, color)
        if index % 5 == 0:
            put_pixel(atlas, px + 1, py, color)


def draw_boulder_frame(atlas: Image.Image, frame: int) -> None:
    ox = frame * CELL
    polygon(atlas, [(ox + 13, 50), (ox + 20, 35), (ox + 34, 29), (ox + 50, 38), (ox + 55, 51), (ox + 35, 58)], (57, 61, 59, 255))
    polygon(atlas, [(ox + 20, 35), (ox + 34, 29), (ox + 43, 39), (ox + 28, 43)], (104, 105, 94, 255))
    polygon(atlas, [(ox + 43, 39), (ox + 55, 51), (ox + 35, 58), (ox + 36, 47)], (39, 44, 43, 255))
    polygon(atlas, [(ox + 14, 50), (ox + 28, 43), (ox + 35, 58)], (73, 74, 65, 255))
    line(atlas, ox + 27, 40, ox + 35, 55, (199, 184, 129, 135), width=1)
    line(atlas, ox + 39, 36, ox + 49, 48, (30, 33, 31, 140), width=1)


def draw_reeds_frame(atlas: Image.Image, frame: int) -> None:
    ox = frame * CELL
    for index, base_x in enumerate(range(18, 48, 5)):
        top_x = ox + base_x + ((index % 3) - 1) * 3
        top_y = 26 + (index % 2) * 4
        line(atlas, ox + base_x, 55, top_x, top_y, (54, 92, 57, 230), width=2)
        ellipse(atlas, top_x, top_y - 3, 2, 6, (121, 101, 58, 235))
    for base_x in range(16, 51, 7):
        line(atlas, ox + base_x, 56, ox + base_x - 4, 35, (75, 118, 72, 190), width=1)
        line(atlas, ox + base_x, 56, ox + base_x + 5, 38, (50, 86, 55, 170), width=1)


def draw_ruin_frame(atlas: Image.Image, frame: int) -> None:
    ox = frame * CELL
    rect(atlas, ox + 16, 42, 14, 12, (91, 88, 76, 255))
    rect(atlas, ox + 29, 35, 16, 19, (108, 105, 91, 255))
    rect(atlas, ox + 43, 44, 9, 10, (79, 78, 70, 255))
    rect(atlas, ox + 21, 53, 29, 5, (66, 65, 58, 255))
    rect(atlas, ox + 18, 40, 10, 3, (166, 155, 116, 110))
    line(atlas, ox + 16, 42, ox + 52, 54, (28, 29, 25, 120), width=1)
    line(atlas, ox + 30, 35, ox + 44, 54, (32, 33, 29, 130), width=1)


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


def remove_detached_artifacts(image: Image.Image) -> Image.Image:
    alpha = image.getchannel("A")
    width, height = image.size
    visited = bytearray(width * height)
    components: list[list[int]] = []

    for index, value in enumerate(alpha.getdata()):
        if value <= 8 or visited[index]:
            continue
        stack = [index]
        visited[index] = 1
        component = []
        while stack:
            current = stack.pop()
            component.append(current)
            x = current % width
            y = current // width
            for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if nx < 0 or ny < 0 or nx >= width or ny >= height:
                    continue
                neighbor = ny * width + nx
                if visited[neighbor] or alpha.getpixel((nx, ny)) <= 8:
                    continue
                visited[neighbor] = 1
                stack.append(neighbor)
        components.append(component)

    if not components:
        return image

    largest = max(len(component) for component in components)
    keep = {
        index
        for component in components
        if len(component) >= max(12, largest * 0.012)
        for index in component
    }
    out = Image.new("RGBA", image.size, (0, 0, 0, 0))
    out.putdata([pixel if index in keep else (0, 0, 0, 0) for index, pixel in enumerate(image.getdata())])
    return out


def trim_and_fit(frame: Image.Image) -> Image.Image:
    bbox = frame.getchannel("A").getbbox()
    if bbox is None:
        return Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))

    trimmed = frame.crop(expand_box(bbox, frame.size, 8))
    scale = min(58 / trimmed.width, 54 / trimmed.height, 1.0)
    resized = trimmed.resize(
        (max(1, round(trimmed.width * scale)), max(1, round(trimmed.height * scale))),
        Image.Resampling.LANCZOS,
    )
    output = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    x = round((CELL - resized.width) / 2)
    y = CELL - 7 - resized.height
    output.alpha_composite(resized, (x, y))
    return output


def expand_box(box: tuple[int, int, int, int], size: tuple[int, int], padding: int) -> tuple[int, int, int, int]:
    left, top, right, bottom = box
    width, height = size
    return (
        max(0, left - padding),
        max(0, top - padding),
        min(width, right + padding),
        min(height, bottom + padding),
    )


def update_manifest(image_hash: str, source_hash: str) -> None:
    manifest = json.loads(MANIFEST_PATH.read_text())
    sheet = next((candidate for candidate in manifest["sheets"] if candidate["id"] == DETAIL_SHEET["id"]), None)
    if sheet is None:
        sheet = DETAIL_SHEET.copy()
        manifest["sheets"].insert(7, sheet)
    else:
        sheet.update({key: value for key, value in DETAIL_SHEET.items() if key not in {"provenance", "approval"}})
        sheet.setdefault("provenance", {}).update(DETAIL_SHEET["provenance"])
        sheet.setdefault("approval", {}).update(DETAIL_SHEET["approval"])
    sheet["imageSha256"] = image_hash
    sheet["provenance"]["sourceHash"] = source_hash
    MANIFEST_PATH.write_text(f"{json.dumps(manifest, indent=2)}\n")


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


if __name__ == "__main__":
    main()
