"""Pair-transition painting recipes for the generated terrain atlas."""

from __future__ import annotations

import math
import random

from PIL import Image

from pixel_art_primitives import draw_leaf_chip, ellipse, line, polygon, put_pixel, rect
from terrain_atlas_materials import CELL, MATERIAL_PALETTES


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


def paint_pair_transition_details(
    image: Image.Image,
    family: str,
    from_palette: dict,
    to_palette: dict,
    rng: random.Random,
) -> None:
    if family == "shore":
        paint_pair_shore(image, from_palette, to_palette, rng)
    elif family == "plaza":
        paint_pair_plaza(image, from_palette, to_palette, rng)
    elif family == "rocky":
        paint_pair_rocky(image, from_palette, to_palette, rng)
    elif family == "path":
        paint_pair_path(image, from_palette, to_palette, rng)
    else:
        paint_pair_soft(image, from_palette, to_palette, rng)


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
